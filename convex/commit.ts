// ─────────────────────────────────────────────────────────────────────────────
// commit.ts — commitFetchResult, THE atomic core (D-6 / I9).
//
// ONE Convex mutation = ONE serializable transaction. In it:
//   • read the prior *confirmed* snapshot + worker + active assignment
//   • run the pure reasoning: diff (Step 5) + bind_identity + check_privilege (Step 6)
//   • deriveDisposition (gate.ts) — fail closed first, else union every conflict kind
//   • db.insert the snapshot with its final disposition (append-only — I5)
//   • apply the GATE:
//       confirmed  → flip current_confirmed_snapshot_id to the new row
//       conflict   → create_mismatch_case (idempotent), set open_case_id,
//                    scheduler.runAfter(0, sendAlert) — all in THIS txn (I8/I9)
//       unconfirmed→ pointer + open_case_id untouched (I6)
//   • write the fetch / extract / diff / gate audit rows
//
// No query can ever observe the snapshot without its consequence. `snapshots` is
// NEVER patched or replaced (M7 = 0). Only cases.resolveCase clears open_case_id.
// ─────────────────────────────────────────────────────────────────────────────
import { internalMutation, type MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { v, ConvexError } from "convex/values";
import {
  extractedFields,
  fetchStatus,
  disposition as dispositionV,
  caseType as caseTypeV,
  type CaseDetail,
  type ConflictKind,
} from "./contract";
import type { Doc, Id } from "./_generated/dataModel";
import { diff_snapshot, diffConflictKinds } from "./diff";
import { bind_identity, identityBlocksConfirm } from "./identity";
import { check_privilege, privilegeBlocksConfirm } from "./privilege";
import { deriveDisposition, pickHeadlineType } from "./gate";

// ── create_mismatch_case — internal helper (NOT a registered mutation). ──────
// Idempotent per (license, open case): returns created:false if open_case_id is
// already set. Never auto-resolves (I4). D-10a: caller passes the headline
// `type` (highest-priority kind); `detail.detected_types` keeps every kind.
export async function create_mismatch_case(
  ctx: MutationCtx,
  input: {
    license_id: Id<"licenses">;
    worker_id: Id<"workers">;
    type: ConflictKind;
    snapshot_a_id: Id<"snapshots">;
    snapshot_b_id: Id<"snapshots">;
    reason: string;
    detail: CaseDetail;
  },
): Promise<{ case_id: Id<"mismatch_cases">; created: boolean }> {
  const license = await ctx.db.get(input.license_id);
  if (!license) throw new ConvexError(`create_mismatch_case: license ${input.license_id} not found`);
  if (license.open_case_id != null) {
    return { case_id: license.open_case_id, created: false };
  }
  const case_id = await ctx.db.insert("mismatch_cases", {
    license_id: input.license_id,
    worker_id: input.worker_id,
    type: input.type,
    snapshot_a_id: input.snapshot_a_id,
    snapshot_b_id: input.snapshot_b_id,
    reason: input.reason,
    detail: input.detail,
    resolution_state: "open",
    resolved_by: null,
    resolved_at: null,
    resolution_note: null,
  });
  return { case_id, created: true };
}

function buildReason(
  detected: readonly ConflictKind[],
  fields: Doc<"snapshots">["extracted_fields"],
  prior: Doc<"snapshots"> | null,
  identity: Doc<"snapshots">["identity_result"],
  privilege: Doc<"snapshots">["privilege_result"],
  nameRegistered: string,
): string {
  const parts: string[] = [];
  if (detected.includes("identity") && identity) {
    parts.push(
      `identity: board name "${fields?.licensee_name ?? "?"}" vs registered "${nameRegistered}" — ${identity.mismatch_reason} (similarity ${identity.registered_name_similarity.toFixed(2)}${identity.number_matches ? "" : ", license number mismatch"})`,
    );
  }
  if (detected.includes("privilege") && privilege) {
    parts.push(
      `privilege: ${fields?.privilege_type ?? "?"} not valid for assignment ${privilege.assignment_state} — ${privilege.reason}`,
    );
  }
  if (detected.includes("status")) {
    const now = fields?.status_word ?? fields?.status_normalized ?? "?";
    const was = prior?.extracted_fields?.status_word ?? prior?.extracted_fields?.status_normalized ?? "?";
    parts.push(`status: board now "${now}" vs last confirmed "${was}"`);
  }
  return parts.join(" · ") || "conflict detected";
}

export const commitFetchResult = internalMutation({
  args: {
    license_id: v.id("licenses"),
    fetched_at: v.number(),
    source_url: v.string(),
    source_mode: v.union(v.literal("live"), v.literal("fixture")),
    raw_payload_storage_id: v.union(v.id("_storage"), v.null()),
    raw_payload_excerpt: v.string(),
    raw_payload_sha256: v.string(),
    raw_payload_bytes: v.number(),
    fetch_status: fetchStatus,
    fetch_http_code: v.union(v.number(), v.null()),
    extracted_fields: v.union(extractedFields, v.null()),
    extractor_model: v.union(v.string(), v.null()),
    extractor_raw_response: v.union(v.string(), v.null()),
    retry_of_snapshot_id: v.union(v.id("snapshots"), v.null()),
  },
  returns: v.object({
    snapshot_id: v.id("snapshots"),
    disposition: dispositionV,
    case_id: v.union(v.id("mismatch_cases"), v.null()),
    case_type: v.union(caseTypeV, v.null()),
    detected_types: v.array(v.union(v.literal("identity"), v.literal("privilege"), v.literal("status"))),
    alert_scheduled: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const license = await ctx.db.get(args.license_id);
    if (!license) {
      throw new ConvexError(`commitFetchResult: license ${args.license_id} not found`);
    }

    const priorConfirmed: Doc<"snapshots"> | null = license.current_confirmed_snapshot_id
      ? await ctx.db.get(license.current_confirmed_snapshot_id)
      : null;

    const worker = await ctx.db.get(license.worker_id);
    const nameRegistered = worker?.name_registered ?? "";
    const assignment = await ctx.db
      .query("assignments")
      .withIndex("by_worker", (q) => q.eq("worker_id", license.worker_id))
      .filter((q) => q.eq(q.field("active"), true))
      .first();
    const assignmentState = assignment?.assignment_state ?? license.issuing_state;

    // ── pure reasoning — ALL runs INSIDE this transaction (D-6) ─────────────
    const diff_result =
      args.extracted_fields != null
        ? diff_snapshot(
            args.extracted_fields,
            priorConfirmed?.extracted_fields ?? null,
            priorConfirmed?._id ?? null,
          )
        : null;

    const identity_result =
      args.extracted_fields != null
        ? bind_identity(
            { license_number: license.license_number, name_registered: nameRegistered },
            args.extracted_fields,
          )
        : null;

    const privilege_result =
      args.extracted_fields != null
        ? check_privilege(
            args.extracted_fields.privilege_type,
            assignmentState,
            args.extracted_fields.primary_state_of_residence,
            license.issuing_state,
          )
        : null;

    // ── GATE (pure) ────────────────────────────────────────────────────────
    const diffKinds =
      diff_result != null && !diff_result.agrees ? diffConflictKinds(diff_result) : [];
    const { disposition: dispo, detected } = deriveDisposition({
      fetch_status: args.fetch_status,
      confidence: args.extracted_fields?.extraction_confidence ?? null,
      diffKinds,
      identityOk: identity_result ? !identityBlocksConfirm(identity_result) : null,
      privilegeOk: privilege_result ? !privilegeBlocksConfirm(privilege_result) : null,
      caseAlreadyOpen: license.open_case_id != null,
    });

    // ── the ONE snapshot insert (append-only, I5) ─────────────────────────
    const snapshotId = await ctx.db.insert("snapshots", {
      license_id: args.license_id,
      fetched_at: args.fetched_at,
      source_url: args.source_url,
      source_mode: args.source_mode,
      raw_payload_storage_id: args.raw_payload_storage_id,
      raw_payload_excerpt: args.raw_payload_excerpt,
      raw_payload_sha256: args.raw_payload_sha256,
      raw_payload_bytes: args.raw_payload_bytes,
      fetch_status: args.fetch_status,
      fetch_http_code: args.fetch_http_code,
      retry_of_snapshot_id: args.retry_of_snapshot_id,
      extracted_fields: args.extracted_fields,
      extractor_model: args.extractor_model,
      extractor_raw_response: args.extractor_raw_response,
      diff_result,
      identity_result,
      privilege_result,
      disposition: dispo,
    });

    // ── gate application (same txn — I9) ──────────────────────────────────
    let case_id: Id<"mismatch_cases"> | null = null;
    let case_type: ConflictKind | null = null;
    let alert_scheduled = false;

    if (dispo === "confirmed") {
      // flip the pointer to the row just inserted
      await ctx.db.patch(args.license_id, {
        current_confirmed_snapshot_id: snapshotId,
        last_fetch_at: args.fetched_at,
      });
    } else if (dispo === "conflict") {
      case_type = pickHeadlineType(detected);
      const detail: CaseDetail = {
        conflicts: diff_result?.conflicts ?? [],
        detected_types: detected,
        ...(identity_result ? { identity_result } : {}),
        ...(privilege_result ? { privilege_result } : {}),
      };
      const created = await create_mismatch_case(ctx, {
        license_id: args.license_id,
        worker_id: license.worker_id,
        type: case_type,
        snapshot_a_id: priorConfirmed?._id ?? snapshotId,
        snapshot_b_id: snapshotId,
        reason: buildReason(
          detected,
          args.extracted_fields,
          priorConfirmed,
          identity_result,
          privilege_result,
          nameRegistered,
        ),
        detail,
      });
      case_id = created.case_id;
      if (created.created) {
        await ctx.db.patch(args.license_id, {
          open_case_id: created.case_id,
          last_fetch_at: args.fetched_at,
        });
        // transactional: the alert is scheduled IFF this txn commits (I9).
        await ctx.scheduler.runAfter(0, internal.alert.sendAlert, { caseId: created.case_id });
        alert_scheduled = true;
      } else {
        // a case is already open on this license — no new case, no new alert (I8).
        await ctx.db.patch(args.license_id, { last_fetch_at: args.fetched_at });
      }
    } else {
      // unconfirmed — pointer + open_case_id untouched (I6 fail-closed)
      await ctx.db.patch(args.license_id, { last_fetch_at: args.fetched_at });
    }

    // ── audit rows: one per loop stage, same txn ─────────────────────────
    const base = {
      at: args.fetched_at,
      license_id: args.license_id,
      snapshot_id: snapshotId,
      actor: "system",
    };
    await ctx.db.insert("audit_events", {
      ...base,
      case_id: null,
      stage: "fetch",
      outcome: args.fetch_status,
      message:
        `fetch ${args.fetch_status} (${args.fetch_http_code ?? "—"}) ${args.source_url}` +
        (args.retry_of_snapshot_id ? ` · retry of ${args.retry_of_snapshot_id}` : ""),
    });
    await ctx.db.insert("audit_events", {
      ...base,
      case_id: null,
      stage: "extract",
      outcome: args.extracted_fields
        ? "ok"
        : args.fetch_status === "extraction_refused"
          ? "refused"
          : args.fetch_status === "extraction_failed"
            ? "failed"
            : "skipped",
      message: args.extractor_model
        ? `extracted via ${args.extractor_model}` +
          (args.extracted_fields ? ` · confidence ${args.extracted_fields.extraction_confidence}` : "")
        : "no extraction (non-ok fetch)",
    });
    await ctx.db.insert("audit_events", {
      ...base,
      case_id: null,
      stage: "diff",
      outcome: !diff_result
        ? "skipped"
        : diff_result.compared_snapshot_id == null
          ? "no_prior"
          : diff_result.agrees
            ? "agrees"
            : `conflict:${diff_result.conflicts.map((c) => c.field).join(",")}`,
      message: !diff_result
        ? "no extraction to diff"
        : diff_result.compared_snapshot_id == null
          ? "first snapshot — nothing to diff"
          : diff_result.agrees
            ? `diff vs confirmed ${diff_result.compared_snapshot_id}: agrees`
            : `diff vs confirmed ${diff_result.compared_snapshot_id}: ${diff_result.conflicts
                .map((c) => `${c.field} ${c.prior}→${c.current}`)
                .join("; ")}`,
    });
    await ctx.db.insert("audit_events", {
      ...base,
      case_id,
      stage: "gate",
      outcome:
        dispo === "conflict"
          ? `conflict:${case_type}` + (detected.length > 1 ? `[${[...detected].sort().join(",")}]` : "")
          : dispo,
      message:
        `gate → ${dispo}` +
        (dispo === "conflict"
          ? ` · case ${case_id} type=${case_type} detected=[${[...detected].sort().join(",")}]` +
            (alert_scheduled ? " · alert scheduled" : " · case already open (no new alert)")
          : "") +
        (identity_result
          ? ` · identity ${identity_result.match_confidence}` +
            (identity_result.mismatch_reason !== "none" ? `(${identity_result.mismatch_reason})` : "")
          : "") +
        (privilege_result
          ? ` · privilege ${privilege_result.valid ? "valid" : "invalid"}(${privilege_result.reason})`
          : ""),
    });

    // Demo mode: advance the fixture cursor so the next fetch serves the next
    // fixture in the sequence (no-op for live licenses — empty sequence).
    if (license.fixture_sequence.length > 0) {
      await ctx.db.patch(args.license_id, {
        fixture_cursor: Math.min(license.fixture_cursor + 1, license.fixture_sequence.length),
      });
    }

    return {
      snapshot_id: snapshotId,
      disposition: dispo,
      case_id,
      case_type: case_type,
      detected_types: detected,
      alert_scheduled,
    };
  },
});

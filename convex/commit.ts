// ─────────────────────────────────────────────────────────────────────────────
// commit.ts — commitFetchResult, THE atomic core (D-6 / I9).
//
// ONE Convex mutation = ONE serializable transaction. It reads the prior
// confirmed snapshot, runs the pure reasoning (diff / identity / privilege —
// wired in Steps 5–6), db.inserts the snapshot with its final disposition, and
// applies the GATE (pointer flip OR open case + scheduled alert — Step 7), plus
// every audit row. No query can observe the snapshot without its consequence.
//
// Step 3 skeleton: reasoning is null, the GATE is stubbed to "confirm when the
// fetch is ok". Steps 4–7 fill the branches in place — the transaction shape and
// the single entry point exist from the start.
// ─────────────────────────────────────────────────────────────────────────────
import { internalMutation } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import { extractedFields, fetchStatus, disposition as dispositionV } from "./contract";
import type { Doc } from "./_generated/dataModel";
import { diff_snapshot } from "./diff";
import { bind_identity, identityBlocksConfirm } from "./identity";
import { check_privilege, privilegeBlocksConfirm } from "./privilege";

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
    alert_scheduled: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const license = await ctx.db.get(args.license_id);
    if (!license) {
      throw new ConvexError(`commitFetchResult: license ${args.license_id} not found`);
    }

    // Prior *confirmed* snapshot — the diff baseline (Step 5 reads its fields).
    const priorConfirmed: Doc<"snapshots"> | null = license.current_confirmed_snapshot_id
      ? await ctx.db.get(license.current_confirmed_snapshot_id)
      : null;

    // Worker (registered name) + active assignment (assignment state) — the
    // identity + privilege check inputs (I2 / I3). Read in the SAME txn.
    const worker = await ctx.db.get(license.worker_id);
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

    // I2 — number + registered name, never name-string alone.
    const identity_result =
      args.extracted_fields != null
        ? bind_identity(
            {
              license_number: license.license_number,
              name_registered: worker?.name_registered ?? "",
            },
            args.extracted_fields,
          )
        : null;

    // I3 — extracted privilege type vs the worker's ACTUAL assignment state.
    const privilege_result =
      args.extracted_fields != null
        ? check_privilege(
            args.extracted_fields.privilege_type,
            assignmentState,
            args.extracted_fields.primary_state_of_residence,
            license.issuing_state,
          )
        : null;

    // ── GATE (Step 7 completes: disagreement/invalid → conflict + case + alert) ─
    const fetchOk = args.fetch_status === "ok";
    const confidenceLow = args.extracted_fields?.extraction_confidence === "low";
    const diffDisagrees = diff_result != null && !diff_result.agrees;
    const identityBad = identity_result != null && identityBlocksConfirm(identity_result);
    const privilegeBad = privilege_result != null && privilegeBlocksConfirm(privilege_result);

    let dispo: Doc<"snapshots">["disposition"];
    if (!fetchOk || args.extracted_fields == null || confidenceLow) {
      dispo = "unconfirmed"; // I6 fail-closed
    } else if (diffDisagrees || identityBad || privilegeBad) {
      // Step 7 upgrades this branch to disposition:"conflict" + create_mismatch_case
      // (with D-10a headline-type priority identity > privilege > status).
      // Until then: never a silent pass — a disagreeing/invalid fetch does NOT confirm.
      dispo = "unconfirmed";
    } else {
      dispo = "confirmed";
    }

    // ── the ONE snapshot insert (append-only, I5) ───────────────────────────
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

    // ── gate application (same txn) ────────────────────────────────────────
    const case_id: null = null;
    const alert_scheduled = false;
    if (dispo === "confirmed") {
      await ctx.db.patch(args.license_id, {
        current_confirmed_snapshot_id: snapshotId,
        last_fetch_at: args.fetched_at,
      });
    } else {
      // pointer + open_case_id untouched (I6 fail-closed)
      await ctx.db.patch(args.license_id, { last_fetch_at: args.fetched_at });
    }

    // ── audit rows: one per loop stage, same txn ───────────────────────────
    const base = {
      at: args.fetched_at,
      license_id: args.license_id,
      snapshot_id: snapshotId,
      case_id: null as null,
      actor: "system",
    };
    await ctx.db.insert("audit_events", {
      ...base,
      stage: "fetch",
      outcome: args.fetch_status,
      message:
        `fetch ${args.fetch_status} (${args.fetch_http_code ?? "—"}) ${args.source_url}` +
        (args.retry_of_snapshot_id ? ` · retry of ${args.retry_of_snapshot_id}` : ""),
    });
    await ctx.db.insert("audit_events", {
      ...base,
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
      stage: "gate",
      outcome: dispo,
      message:
        `gate → ${dispo}` +
        (identity_result
          ? ` · identity ${identity_result.match_confidence}` +
            (identity_result.mismatch_reason !== "none" ? `(${identity_result.mismatch_reason})` : "")
          : "") +
        (privilege_result
          ? ` · privilege ${privilege_result.valid ? "valid" : "invalid"}(${privilege_result.reason})`
          : ""),
    });

    return { snapshot_id: snapshotId, disposition: dispo, case_id, alert_scheduled };
  },
});

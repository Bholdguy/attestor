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

    // ── pure reasoning (Steps 5–6 populate these; all run in THIS txn) ───────
    const diff_result = null;
    const identity_result = null;
    const privilege_result = null;

    // ── GATE (Step 7 completes: conflict → case + alert; low/!ok → unconfirmed) ─
    const fetchOk = args.fetch_status === "ok";
    const dispo: Doc<"snapshots">["disposition"] = fetchOk ? "confirmed" : "unconfirmed";

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
      message: `fetch ${args.fetch_status} (${args.fetch_http_code ?? "—"}) ${args.source_url}`,
    });
    await ctx.db.insert("audit_events", {
      ...base,
      stage: "extract",
      outcome: args.extracted_fields ? "ok" : "skipped",
      message: args.extractor_model
        ? `extracted via ${args.extractor_model}`
        : "no extraction (skeleton / non-ok fetch)",
    });
    await ctx.db.insert("audit_events", {
      ...base,
      stage: "diff",
      outcome: priorConfirmed ? "pending" : "no_prior",
      message: priorConfirmed
        ? `diff vs confirmed ${priorConfirmed._id} (wired in Step 5)`
        : "first snapshot — nothing to diff",
    });
    await ctx.db.insert("audit_events", {
      ...base,
      stage: "gate",
      outcome: dispo,
      message: `gate → ${dispo}`,
    });

    return { snapshot_id: snapshotId, disposition: dispo, case_id, alert_scheduled };
  },
});

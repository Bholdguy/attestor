// Read queries for the operator dashboard. Step 4: getSnapshot (raw payload +
// retry linkage). Step 9: getLicenseTimeline / compareSnapshots.
import { query } from "./_generated/server";
import { v } from "convex/values";
import { deriveBadge, STALENESS_THRESHOLD_MS_DEFAULT } from "./badge";

export const getSnapshot = query({
  args: { snapshotId: v.id("snapshots") },
  handler: async (ctx, { snapshotId }) => {
    const snap = await ctx.db.get(snapshotId);
    if (!snap) return null;

    // Full raw HTML lives in file storage (D-8) — hand the UI an off-origin URL,
    // never inline HTML (SECURITY §3: board content is untrusted).
    const raw_payload_url = snap.raw_payload_storage_id
      ? await ctx.storage.getUrl(snap.raw_payload_storage_id)
      : null;

    let retry_of: { _id: string; fetch_status: string; fetched_at: number } | null = null;
    if (snap.retry_of_snapshot_id) {
      const prior = await ctx.db.get(snap.retry_of_snapshot_id);
      if (prior) {
        retry_of = {
          _id: prior._id,
          fetch_status: prior.fetch_status,
          fetched_at: prior.fetched_at,
        };
      }
    }

    return { ...snap, raw_payload_url, retry_of };
  },
});

/**
 * The full timeline for one license: every snapshot (a dot) + every audit event,
 * in time order, with the current badge + confirmed pointer. Powers
 * WorkerTimeline (F1 "a hire-time-only check would have missed this" proof).
 */
export const getLicenseTimeline = query({
  args: { licenseId: v.id("licenses") },
  handler: async (ctx, { licenseId }) => {
    const license = await ctx.db.get(licenseId);
    if (!license) return null;
    const worker = await ctx.db.get(license.worker_id);
    const settings = await ctx.db.query("settings").first();
    const staleness = settings?.staleness_threshold_ms ?? STALENESS_THRESHOLD_MS_DEFAULT;

    const snapshots = (
      await ctx.db
        .query("snapshots")
        .withIndex("by_license", (q) => q.eq("license_id", licenseId))
        .collect()
    ).sort((a, b) => a._creationTime - b._creationTime);

    const audit = (
      await ctx.db
        .query("audit_events")
        .withIndex("by_license", (q) => q.eq("license_id", licenseId))
        .collect()
    ).sort((a, b) => a._creationTime - b._creationTime);

    const latest = snapshots.length ? snapshots[snapshots.length - 1] : null;
    const badge = deriveBadge(
      {
        current_confirmed_snapshot_id: license.current_confirmed_snapshot_id,
        open_case_id: license.open_case_id,
        last_fetch_at: license.last_fetch_at,
      },
      latest ? { fetch_status: latest.fetch_status } : null,
      Date.now(),
      staleness,
    );

    return {
      license: {
        _id: license._id,
        license_number: license.license_number,
        issuing_state: license.issuing_state,
        board_profile_url: license.board_profile_url,
        current_confirmed_snapshot_id: license.current_confirmed_snapshot_id,
        open_case_id: license.open_case_id,
        last_fetch_at: license.last_fetch_at,
        watch_enabled: license.watch_enabled,
      },
      worker: worker
        ? { name_hired: worker.name_hired, name_registered: worker.name_registered }
        : null,
      badge,
      snapshots: snapshots.map((s) => ({
        _id: s._id,
        _creationTime: s._creationTime,
        fetched_at: s.fetched_at,
        source_mode: s.source_mode,
        fetch_status: s.fetch_status,
        fetch_http_code: s.fetch_http_code,
        disposition: s.disposition,
        retry_of_snapshot_id: s.retry_of_snapshot_id,
        status_normalized: s.extracted_fields?.status_normalized ?? null,
        is_confirmed_pointer: s._id === license.current_confirmed_snapshot_id,
      })),
      audit_events: audit.map((a) => ({
        _id: a._id,
        at: a.at,
        stage: a.stage,
        outcome: a.outcome,
        message: a.message,
        actor: a.actor,
        snapshot_id: a.snapshot_id,
        case_id: a.case_id,
      })),
    };
  },
});

/** Side-by-side field comparison of two snapshots (the CompareView). */
export const compareSnapshots = query({
  args: { aId: v.id("snapshots"), bId: v.id("snapshots") },
  handler: async (ctx, { aId, bId }) => {
    const [a, b] = await Promise.all([ctx.db.get(aId), ctx.db.get(bId)]);
    if (!a || !b) return null;
    const FIELDS = [
      "licensee_name",
      "license_number",
      "status_word",
      "status_normalized",
      "issue_date",
      "expire_date",
      "privilege_type",
      "primary_state_of_residence",
      "extraction_confidence",
    ] as const;
    const rows = FIELDS.map((f) => {
      const av = a.extracted_fields ? String(a.extracted_fields[f] ?? "—") : "—";
      const bv = b.extracted_fields ? String(b.extracted_fields[f] ?? "—") : "—";
      return { field: f, a: av, b: bv, differs: av !== bv };
    });
    return {
      a: {
        _id: a._id,
        fetched_at: a.fetched_at,
        disposition: a.disposition,
        source_mode: a.source_mode,
      },
      b: {
        _id: b._id,
        fetched_at: b.fetched_at,
        disposition: b.disposition,
        source_mode: b.source_mode,
      },
      rows,
      identity_b: b.identity_result,
      privilege_b: b.privilege_result,
      diff_b: b.diff_result,
    };
  },
});

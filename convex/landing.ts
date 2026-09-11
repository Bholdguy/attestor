// landing.ts — read-only queries for the public landing page. Additive; touches
// no existing behaviour, schema, or tests. The "Verify before you trust" section
// shows REAL snapshots from the deployment (never fabricated).
import { query } from "./_generated/server";

export const standingEvidence = query({
  args: {},
  handler: async (ctx) => {
    const all = await ctx.db.query("snapshots").order("desc").take(120);
    const withBlob = all.filter((s) => s.raw_payload_storage_id != null && s.raw_payload_sha256);

    // Dedupe by payload hash (a search shell fetched twice has one hash), then
    // pick a spread: prefer live snapshots, backfill with distinct fixtures so
    // the section shows variety — every row is a real, hash-verifiable record.
    const seen = new Set<string>();
    const distinct = withBlob.filter((s) => {
      if (seen.has(s.raw_payload_sha256)) return false;
      seen.add(s.raw_payload_sha256);
      return true;
    });
    const live = distinct.filter((s) => s.source_mode === "live");
    const rest = distinct.filter((s) => s.source_mode !== "live");
    const chosen = [...live, ...rest].slice(0, 3);

    const rows = await Promise.all(
      chosen.map(async (s) => {
        const license = await ctx.db.get(s.license_id);
        const worker = license ? await ctx.db.get(license.worker_id) : null;
        return {
          _id: s._id,
          fetched_at: s.fetched_at,
          source_mode: s.source_mode,
          source_url: s.source_url,
          fetch_status: s.fetch_status,
          fetch_http_code: s.fetch_http_code,
          disposition: s.disposition,
          raw_payload_sha256: s.raw_payload_sha256,
          raw_payload_bytes: s.raw_payload_bytes,
          raw_payload_url: s.raw_payload_storage_id
            ? await ctx.storage.getUrl(s.raw_payload_storage_id)
            : null,
          worker_name: worker?.name_hired ?? null,
          license_number: license?.license_number ?? null,
        };
      }),
    );
    return { rows, total_snapshots: all.length, any_live: live.length > 0 };
  },
});

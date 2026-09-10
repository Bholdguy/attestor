// Read queries for the operator dashboard. Step 4 adds getSnapshot (raw payload
// + retry linkage); Step 9 adds getWorkerTimeline / compareSnapshots.
import { query } from "./_generated/server";
import { v } from "convex/values";

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

// Internal read queries used by actions (actions can't touch the DB directly).
import { internalQuery } from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";

/**
 * The cron sweep's fan-out set (D-1/D-7): watch_enabled licenses that are NOT
 * demo-driven. A license with a non-empty fixture_sequence is stepped only by
 * demo.runDemoSequence, never the live cron.
 */
export const watchedLicenseIds = internalQuery({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db
      .query("licenses")
      .withIndex("by_watch_enabled", (q) => q.eq("watch_enabled", true))
      .collect();
    return rows.filter((r) => r.fixture_sequence.length === 0).map((r) => r._id);
  },
});

export const isDemoMode = internalQuery({
  args: {},
  handler: async (ctx) => (await ctx.db.query("settings").first())?.demo_mode ?? false,
});

/**
 * Everything runForLicense needs to perform a fetch for one license, plus the
 * settings that decide live vs fixture mode. Kept as one query so the action
 * makes a single DB round-trip (ARCHITECTURE §4 step 2a).
 */
export const loopInputs = internalQuery({
  args: { licenseId: v.id("licenses") },
  handler: async (ctx, { licenseId }) => {
    const license = await ctx.db.get(licenseId);
    if (!license) return null;
    const worker = await ctx.db.get(license.worker_id);
    const assignment = await ctx.db
      .query("assignments")
      .withIndex("by_worker", (q) => q.eq("worker_id", license.worker_id))
      .filter((q) => q.eq(q.field("active"), true))
      .first();
    const settings = await ctx.db.query("settings").first();

    // Demo mode / a sequenced license serves the fixture at fixture_cursor
    // (clamped to the last entry). Live licenses have an empty sequence.
    const seq = license.fixture_sequence;
    const resolved_fixture_id =
      seq.length > 0 ? seq[Math.min(license.fixture_cursor, seq.length - 1)] : null;

    return {
      license,
      worker,
      assignment,
      demo_mode: settings?.demo_mode ?? false,
      resolved_fixture_id,
    };
  },
});

/**
 * If this license's most recent snapshot was a FETCH-level failure
 * (rate_limited / blocked / timeout / http_error), return its id so the next
 * sweep's snapshot can link back via retry_of_snapshot_id — the timeline shows
 * the retry as its own dot connected to the failure, never a gap (D-7).
 */
export const retryTarget = internalQuery({
  args: { licenseId: v.id("licenses") },
  handler: async (ctx, { licenseId }): Promise<Id<"snapshots"> | null> => {
    const latest = await ctx.db
      .query("snapshots")
      .withIndex("by_license", (q) => q.eq("license_id", licenseId))
      .order("desc")
      .first();
    if (!latest) return null;
    const retryable = ["rate_limited", "blocked", "timeout", "http_error"];
    return retryable.includes(latest.fetch_status) ? latest._id : null;
  },
});

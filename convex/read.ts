// Internal read queries used by actions (actions can't touch the DB directly).
import { internalQuery } from "./_generated/server";
import { v } from "convex/values";

/** All watch_enabled license ids — the cron sweep's fan-out set (D-1/D-7). */
export const watchedLicenseIds = internalQuery({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db
      .query("licenses")
      .withIndex("by_watch_enabled", (q) => q.eq("watch_enabled", true))
      .collect();
    return rows.map((r) => r._id);
  },
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
    return {
      license,
      worker,
      assignment,
      demo_mode: settings?.demo_mode ?? false,
    };
  },
});

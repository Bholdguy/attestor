// runSweep — the cron entry point (D-1). Reads watch_enabled licenses and
// staggers one scheduled runForLicense per license so a sweep never bursts past
// ~15 fetches/min in live mode (D-7). A rate-limited fetch is still a recorded
// snapshot, never a silent skip — that logic lives in firecrawl.ts / commit.ts.
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";

const FETCH_STAGGER_MS = Math.max(
  0,
  Number(process.env.FETCH_STAGGER_MS ?? 4000) || 4000,
);

export const runSweep = internalAction({
  args: {},
  // Explicit returns validator — also breaks the self-referential type inference
  // cycle (runSweep → internal.* → runSweep).
  returns: v.object({ scheduled: v.number(), staggerMs: v.number(), skipped: v.string() }),
  handler: async (ctx): Promise<{ scheduled: number; staggerMs: number; skipped: string }> => {
    // Demo mode drives its own compressed chain (demo.runDemoSequence); the live
    // cron stands down so it can't perturb the deterministic sequence (Step 10).
    const demoMode = await ctx.runQuery(internal.read.isDemoMode, {});
    if (demoMode) return { scheduled: 0, staggerMs: FETCH_STAGGER_MS, skipped: "demo_mode" };

    const licenseIds = await ctx.runQuery(internal.read.watchedLicenseIds, {});
    for (let i = 0; i < licenseIds.length; i++) {
      await ctx.scheduler.runAfter(
        i * FETCH_STAGGER_MS,
        internal.loop.runForLicense,
        { licenseId: licenseIds[i] },
      );
    }
    return { scheduled: licenseIds.length, staggerMs: FETCH_STAGGER_MS, skipped: "" };
  },
});

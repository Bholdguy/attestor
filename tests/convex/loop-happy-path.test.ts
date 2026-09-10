import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import schema from "../../convex/schema";
import { api, internal } from "../../convex/_generated/api";
import { modules } from "./setup";

const WORKER = {
  name_registered: "Maria S. Gomez",
  name_hired: "Maria Gomez",
  license_number: "RN-4471102",
  issuing_state: "NY",
  assignment_state: "NY",
  facility_name: "Mercy General",
  board_profile_url: "fixture://active_clean",
  license_type: "RN" as const,
  declared_privilege_type: "single_state" as const,
};

describe("Step 3 — scheduled watch → atomic commit", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  test("addWorker → one runForLicense → one commitFetchResult → exactly one snapshot + 4 audit rows", async () => {
    const t = convexTest(schema, modules);

    const { licenseId } = await t.mutation(api.roster.addWorker, WORKER);

    // addWorker schedules runForLicense at runAfter(0); drain the scheduler.
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    await t.run(async (ctx) => {
      const snaps = await ctx.db
        .query("snapshots")
        .withIndex("by_license", (q) => q.eq("license_id", licenseId))
        .collect();
      expect(snaps).toHaveLength(1);
      const [snap] = snaps;
      expect(snap.disposition).toBe("confirmed");
      expect(snap.source_mode).toBe("live");
      expect(snap.fetch_status).toBe("ok");
      expect(snap.raw_payload_sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(snap.raw_payload_excerpt.length).toBeGreaterThan(0);

      // pointer moved to this snapshot, in the same commit
      const license = await ctx.db.get(licenseId);
      expect(license?.current_confirmed_snapshot_id).toEqual(snap._id);
      expect(license?.last_fetch_at).toEqual(snap.fetched_at);
      expect(license?.open_case_id).toBeNull();

      // one audit row per loop stage, all tied to this snapshot
      const audit = await ctx.db
        .query("audit_events")
        .withIndex("by_license", (q) => q.eq("license_id", licenseId))
        .collect();
      const stages = audit.map((a) => a.stage).sort();
      expect(stages).toEqual(["diff", "extract", "fetch", "gate"]);
      const gate = audit.find((a) => a.stage === "gate");
      expect(gate?.outcome).toBe("confirmed");
      expect(gate?.snapshot_id).toEqual(snap._id);
      expect(audit.every((a) => a.actor === "system")).toBe(true);
    });
  });

  test("badge goes ⚪ → 🟢 with a non-null confirmed_snapshot_id after the first sweep", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(api.roster.addWorker, WORKER);

    let roster = await t.query(api.roster.listRoster, {});
    expect(roster).toHaveLength(1);
    // before the scheduled fetch resolves it is unconfirmed with no pointer
    expect(roster[0].confirmedSnapshotId).toBeNull();
    expect(roster[0].badge).toBe("unconfirmed");

    await t.finishAllScheduledFunctions(vi.runAllTimers);

    roster = await t.query(api.roster.listRoster, {});
    expect(roster[0].badge).toBe("verified");
    expect(roster[0].confirmedSnapshotId).not.toBeNull();
    expect(roster[0].confirmedSnapshotId).toEqual(roster[0].latestSnapshotId);
  });

  test("runSweep fans out exactly one runForLicense per watch_enabled license", async () => {
    const t = convexTest(schema, modules);
    const a = await t.mutation(api.roster.addWorker, WORKER);
    const b = await t.mutation(api.roster.addWorker, {
      ...WORKER,
      name_hired: "Sarah Jenkins",
      name_registered: "Sarah A. Jenkins",
      license_number: "RN-2298475",
      board_profile_url: "fixture://name_ok",
    });
    // drain the per-worker initial ticks first
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    await t.action(internal.sweep.runSweep, {});
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    await t.run(async (ctx) => {
      for (const id of [a.licenseId, b.licenseId]) {
        const snaps = await ctx.db
          .query("snapshots")
          .withIndex("by_license", (q) => q.eq("license_id", id))
          .collect();
        // one from addWorker's initial tick + one from the explicit sweep
        expect(snaps).toHaveLength(2);
      }
    });
  });

  test("bad state code is rejected and writes no row (SECURITY §3)", async () => {
    const t = convexTest(schema, modules);
    await expect(
      t.mutation(api.roster.addWorker, { ...WORKER, issuing_state: "New York" }),
    ).rejects.toThrow(/2-letter state code/);
    await t.run(async (ctx) => {
      expect(await ctx.db.query("workers").collect()).toHaveLength(0);
      expect(await ctx.db.query("licenses").collect()).toHaveLength(0);
    });
  });
});

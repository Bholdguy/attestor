import { convexTest, type TestConvex } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import schema from "../../convex/schema";
import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { modules } from "./setup";

// AC2 — the headline integration test. A status change between two fetches never
// silently updates the badge without a mismatch case; the confirmed-snapshot
// pointer is byte-identical to its pre-fetch value; badge 🟠 comes ONLY from
// open_case_id; only resolveCase (actor+note) flips it back.

const WORKER = {
  name_registered: "Maria S. Gomez",
  name_hired: "Maria Gomez",
  license_number: "RN-4471102",
  issuing_state: "NY",
  assignment_state: "NY",
  facility_name: "Mercy General",
  board_profile_url: "fixture://flip_active",
  license_type: "RN" as const,
  declared_privilege_type: "single_state" as const,
};

function snapsFor(t: TestConvex<typeof schema>, licenseId: Id<"licenses">) {
  return t.run(async (ctx) => {
    const s = await ctx.db
      .query("snapshots")
      .withIndex("by_license", (q) => q.eq("license_id", licenseId))
      .collect();
    return s.sort((a, b) => a._creationTime - b._creationTime);
  });
}

describe("conflict-never-silent (AC2)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  test("status flip ⇒ conflict case, pointer held, badge 🟠 via open_case_id, human-only resolve", async () => {
    const t = convexTest(schema, modules);

    // 1) seed + first fetch (active) ⇒ 🟢, capture S1
    const { licenseId } = await t.mutation(api.roster.addWorker, WORKER);
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    let roster = await t.query(api.roster.listRoster, {});
    expect(roster[0].badge).toBe("verified");
    const S1 = roster[0].confirmedSnapshotId as Id<"snapshots">;
    expect(S1).not.toBeNull();

    // 2) board now says Expired
    await t.run((ctx) => ctx.db.patch(licenseId, { board_profile_url: "fixture://flip_expired" }));
    await t.action(internal.sweep.runSweep, {});
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    // 3) assertions
    const after = await snapsFor(t, licenseId);
    expect(after).toHaveLength(2);
    const S2 = after[1];
    expect(S2.disposition).toBe("conflict");

    const lic = await t.run((ctx) => ctx.db.get(licenseId));
    // pointer BYTE-IDENTICAL to its pre-fetch value
    expect(lic?.current_confirmed_snapshot_id).toEqual(S1);
    expect(lic?.open_case_id).not.toBeNull();

    // exactly one open case, type status, snapshot_a=S1 snapshot_b=S2
    const cases = await t.run((ctx) =>
      ctx.db
        .query("mismatch_cases")
        .withIndex("by_license", (q) => q.eq("license_id", licenseId))
        .collect(),
    );
    expect(cases).toHaveLength(1);
    expect(cases[0]._id).toEqual(lic?.open_case_id);
    expect(cases[0].type).toBe("status");
    expect(cases[0].snapshot_a_id).toEqual(S1);
    expect(cases[0].snapshot_b_id).toEqual(S2._id);
    expect(cases[0].detail.detected_types).toContain("status");
    expect(cases[0].resolution_state).toBe("open");

    // badge is 🟠 SOLELY because open_case_id is set
    roster = await t.query(api.roster.listRoster, {});
    expect(roster[0].badge).toBe("needs_review");
    expect(roster[0].confirmedSnapshotId).toEqual(S1); // still points at T1

    // the gate scheduled an alert in-transaction
    const gateAudit = await t.run(async (ctx) =>
      (
        await ctx.db
          .query("audit_events")
          .withIndex("by_license", (q) => q.eq("license_id", licenseId))
          .collect()
      ).find((a) => a.stage === "gate" && a.snapshot_id === S2._id),
    );
    expect(gateAudit?.outcome).toMatch(/^conflict:status/);
    expect(gateAudit?.message).toMatch(/alert scheduled/);
    expect(gateAudit?.case_id).toEqual(cases[0]._id);

    // 4) re-fetch, still expired ⇒ NO new case, NO new alert, badge unchanged
    await t.action(internal.sweep.runSweep, {});
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const casesAgain = await t.run((ctx) =>
      ctx.db
        .query("mismatch_cases")
        .withIndex("by_license", (q) => q.eq("license_id", licenseId))
        .collect(),
    );
    expect(casesAgain).toHaveLength(1); // still exactly one
    const alertAudits = await t.run(async (ctx) =>
      (
        await ctx.db
          .query("audit_events")
          .withIndex("by_license", (q) => q.eq("license_id", licenseId))
          .collect()
      ).filter((a) => a.stage === "alert"),
    );
    expect(alertAudits).toHaveLength(1); // only the first case scheduled one
    roster = await t.query(api.roster.listRoster, {});
    expect(roster[0].badge).toBe("needs_review");
    expect(roster[0].confirmedSnapshotId).toEqual(S1);

    // 5) human resolves: confirmed ⇒ open_case_id cleared, pointer adopts S2
    const res = await t.mutation(api.cases.resolveCase, {
      case_id: cases[0]._id,
      decision: "confirmed",
      actor: "nurse-ops",
      note: "Board confirms expiry — worker pulled from schedule.",
    });
    expect(res.resolution_state).toBe("confirmed");

    const licAfter = await t.run((ctx) => ctx.db.get(licenseId));
    expect(licAfter?.open_case_id).toBeNull();
    expect(licAfter?.current_confirmed_snapshot_id).toEqual(S2._id); // adopted the new reality

    const resolveAudit = await t.run(async (ctx) =>
      (
        await ctx.db
          .query("audit_events")
          .withIndex("by_license", (q) => q.eq("license_id", licenseId))
          .collect()
      ).filter((a) => a.stage === "resolve"),
    );
    expect(resolveAudit).toHaveLength(1);
    expect(resolveAudit[0].actor).toBe("nurse-ops");
    expect(resolveAudit[0].outcome).toBe("case_confirmed");
    expect(resolveAudit[0].message).toContain("worker pulled");

    // badge leaves 🟠 (now stale/verified depending on clock, but NOT needs_review)
    roster = await t.query(api.roster.listRoster, {});
    expect(roster[0].badge).not.toBe("needs_review");
  });

  test("resolveCase requires a non-empty actor and note", async () => {
    const t = convexTest(schema, modules);
    const { licenseId } = await t.mutation(api.roster.addWorker, WORKER);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    await t.run((ctx) => ctx.db.patch(licenseId, { board_profile_url: "fixture://flip_expired" }));
    await t.action(internal.sweep.runSweep, {});
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const c = await t.run((ctx) => ctx.db.get(licenseId)).then((l) => l!.open_case_id!);

    await expect(
      t.mutation(api.cases.resolveCase, { case_id: c, decision: "dismissed", actor: "  ", note: "x" }),
    ).rejects.toThrow(/actor/);
    await expect(
      t.mutation(api.cases.resolveCase, { case_id: c, decision: "dismissed", actor: "x", note: "" }),
    ).rejects.toThrow(/note/);
    // still open
    expect((await t.run((ctx) => ctx.db.get(licenseId)))?.open_case_id).toEqual(c);
  });

  test("dismissed resolution clears the case but does NOT move the pointer", async () => {
    const t = convexTest(schema, modules);
    const { licenseId } = await t.mutation(api.roster.addWorker, WORKER);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const S1 = (await t.query(api.roster.listRoster, {}))[0].confirmedSnapshotId;

    await t.run((ctx) => ctx.db.patch(licenseId, { board_profile_url: "fixture://flip_expired" }));
    await t.action(internal.sweep.runSweep, {});
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const c = (await t.run((ctx) => ctx.db.get(licenseId)))!.open_case_id!;

    await t.mutation(api.cases.resolveCase, {
      case_id: c,
      decision: "dismissed",
      actor: "nurse-ops",
      note: "Board data-entry error, confirmed still active by phone.",
    });
    const lic = await t.run((ctx) => ctx.db.get(licenseId));
    expect(lic?.open_case_id).toBeNull();
    expect(lic?.current_confirmed_snapshot_id).toEqual(S1); // unchanged on dismiss
  });
});

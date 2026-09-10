import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import schema from "../../convex/schema";
import { api, internal } from "../../convex/_generated/api";
import { modules } from "./setup";

// Step 9 DoD — a scripted experience B flips the badge 🟢 → 🟠 in the listRoster
// query result with NO reload. (convex-test re-runs the query on each call; the
// real client gets this reactively over wss — same query, changed result.)

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

describe("reactivity (experience B)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  test("listRoster badge goes verified → needs_review across a flip, same query", async () => {
    const t = convexTest(schema, modules);
    const { licenseId } = await t.mutation(api.roster.addWorker, WORKER);
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const before = await t.query(api.roster.listRoster, {});
    expect(before).toHaveLength(1);
    expect(before[0].badge).toBe("verified");
    expect(before[0].confirmedSnapshotId).not.toBeNull(); // I1 — status carries its snapshot id
    const pointerBefore = before[0].confirmedSnapshotId;

    await t.run((ctx) => ctx.db.patch(licenseId, { board_profile_url: "fixture://flip_expired" }));
    await t.action(internal.sweep.runSweep, {});
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const after = await t.query(api.roster.listRoster, {});
    expect(after[0].badge).toBe("needs_review"); // flipped, no reload
    expect(after[0].confirmedSnapshotId).toEqual(pointerBefore); // pointer unchanged (I5)
    expect(after[0].openCaseId).not.toBeNull();
    expect(after[0].latestDisposition).toBe("conflict");
  });

  test("getLicenseTimeline reflects the same flip: T2 conflict, pointer still T1", async () => {
    const t = convexTest(schema, modules);
    const { licenseId } = await t.mutation(api.roster.addWorker, WORKER);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    await t.run((ctx) => ctx.db.patch(licenseId, { board_profile_url: "fixture://flip_expired" }));
    await t.action(internal.sweep.runSweep, {});
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const tl = await t.query(api.timeline.getLicenseTimeline, { licenseId });
    expect(tl).not.toBeNull();
    expect(tl!.badge).toBe("needs_review");
    expect(tl!.snapshots).toHaveLength(2);
    expect(tl!.snapshots[0].disposition).toBe("confirmed");
    expect(tl!.snapshots[0].is_confirmed_pointer).toBe(true);
    expect(tl!.snapshots[1].disposition).toBe("conflict");
    expect(tl!.snapshots[1].is_confirmed_pointer).toBe(false);
    // audit trail has all stages
    const stages = new Set(tl!.audit_events.map((a) => a.stage));
    expect(stages).toContain("fetch");
    expect(stages).toContain("gate");
  });

  test("compareSnapshots highlights the differing status row", async () => {
    const t = convexTest(schema, modules);
    const { licenseId } = await t.mutation(api.roster.addWorker, WORKER);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    await t.run((ctx) => ctx.db.patch(licenseId, { board_profile_url: "fixture://flip_expired" }));
    await t.action(internal.sweep.runSweep, {});
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const tl = await t.query(api.timeline.getLicenseTimeline, { licenseId });
    const [a, b] = tl!.snapshots;
    const cmp = await t.query(api.timeline.compareSnapshots, { aId: a._id, bId: b._id });
    expect(cmp).not.toBeNull();
    const statusRow = cmp!.rows.find((r) => r.field === "status_normalized")!;
    expect(statusRow.a).toBe("active");
    expect(statusRow.b).toBe("expired");
    expect(statusRow.differs).toBe(true);
    expect(cmp!.diff_b?.agrees).toBe(false);
  });
});

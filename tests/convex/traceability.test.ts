import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import schema from "../../convex/schema";
import { api } from "../../convex/_generated/api";
import { modules } from "./setup";

// I1 / AC8 — no status is ever displayed without a snapshot id behind it. Every
// listRoster / getLicenseTimeline row carries confirmed_snapshot_id; a null
// pointer renders ⚪ with no fake status.

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

describe("traceability (I1 / AC8)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  test("listRoster always returns confirmedSnapshotId; null ⇒ unconfirmed, no fake status", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(api.roster.addWorker, WORKER);

    // before the first fetch resolves: pointer is null, badge unconfirmed
    let roster = await t.query(api.roster.listRoster, {});
    expect(roster[0]).toHaveProperty("confirmedSnapshotId");
    expect(roster[0].confirmedSnapshotId).toBeNull();
    expect(roster[0].badge).toBe("unconfirmed");
    expect(roster[0].latestSnapshotId).toBeNull();

    await t.finishAllScheduledFunctions(vi.runAllTimers);

    roster = await t.query(api.roster.listRoster, {});
    // now confirmed — the badge's backing snapshot id is present and non-null
    expect(roster[0].confirmedSnapshotId).not.toBeNull();
    expect(roster[0].badge).toBe("verified");
    expect(roster[0].confirmedSnapshotId).toEqual(roster[0].latestSnapshotId);
  });

  test("getLicenseTimeline carries the pointer + marks which snapshot it is", async () => {
    const t = convexTest(schema, modules);
    const { licenseId } = await t.mutation(api.roster.addWorker, WORKER);
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const tl = await t.query(api.timeline.getLicenseTimeline, { licenseId });
    expect(tl!.license.current_confirmed_snapshot_id).not.toBeNull();
    const pointed = tl!.snapshots.filter((s) => s.is_confirmed_pointer);
    expect(pointed).toHaveLength(1);
    expect(pointed[0]._id).toEqual(tl!.license.current_confirmed_snapshot_id);
  });

  test("a fetch failure never produces a confirmed pointer (fail-closed still traceable)", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(api.roster.addWorker, { ...WORKER, board_profile_url: "fixture://blocked_page" });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const roster = await t.query(api.roster.listRoster, {});
    expect(roster[0].confirmedSnapshotId).toBeNull();
    expect(roster[0].badge).toBe("unconfirmed");
    expect(roster[0].latestFetchStatus).toBe("blocked");
    expect(roster[0].latestDisposition).toBe("unconfirmed");
  });
});

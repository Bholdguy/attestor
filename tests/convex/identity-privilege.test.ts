import { convexTest, type TestConvex } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import schema from "../../convex/schema";
import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { modules } from "./setup";
import { diffIsStatusConflict } from "../../convex/diff";

// Step 6 DoD — the name-change fixture yields an IDENTITY-typed signal that is
// distinct from any status flag; the privilege fixture yields a PRIVILEGE-typed
// signal; the two (and status) are never conflated in the stored result.

const nurseB = {
  name_registered: "Sarah A. Jenkins",
  name_hired: "Sarah Jenkins",
  license_number: "RN-2298475",
  issuing_state: "NY",
  assignment_state: "NY",
  facility_name: "St. Anne's",
  board_profile_url: "fixture://name_ok",
  license_type: "RN" as const,
  declared_privilege_type: "single_state" as const,
};

const nurseC = {
  name_registered: "David R. Okafor",
  name_hired: "David Okafor",
  license_number: "RN-7781340",
  issuing_state: "CA",
  assignment_state: "CA", // CA is NOT an NLC member — a multistate license can't reach it
  facility_name: "Bay Medical",
  board_profile_url: "fixture://privilege_ok",
  license_type: "RN" as const,
  declared_privilege_type: "multistate" as const,
};

const nurseMC = {
  name_registered: "Karen M. Blackwood",
  name_hired: "Karen Blackwood",
  license_number: "RN-6650391",
  issuing_state: "CA",
  assignment_state: "CA",
  facility_name: "Bay Medical",
  board_profile_url: "fixture://mc_t1",
  license_type: "RN" as const,
  declared_privilege_type: "single_state" as const,
};

function latest(t: TestConvex<typeof schema>, licenseId: Id<"licenses">) {
  return t.run(async (ctx) => {
    const s = await ctx.db
      .query("snapshots")
      .withIndex("by_license", (q) => q.eq("license_id", licenseId))
      .collect();
    return s.sort((a, b) => a._creationTime - b._creationTime);
  });
}

describe("Step 6 — identity + privilege binding, distinct signals", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  test("name-change fixture ⇒ identity signal (legal_name_change), NOT a status flag", async () => {
    const t = convexTest(schema, modules);
    const { licenseId } = await t.mutation(api.roster.addWorker, nurseB);
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    // T1 name_ok ⇒ confirmed, identity exact, privilege valid
    let snaps = await latest(t, licenseId);
    expect(snaps[0].disposition).toBe("confirmed");
    expect(snaps[0].identity_result?.match_confidence).toBe("exact");
    expect(snaps[0].privilege_result?.valid).toBe(true);

    // T2 name_changed — surname differs vs the REGISTERED name
    await t.run((ctx) => ctx.db.patch(licenseId, { board_profile_url: "fixture://name_changed" }));
    await t.action(internal.sweep.runSweep, {});
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    snaps = await latest(t, licenseId);
    const s2 = snaps[1];
    // identity-typed signal
    expect(s2.identity_result?.match_confidence).toBe("name_change_suspected");
    expect(s2.identity_result?.mismatch_reason).toBe("legal_name_change");
    expect(s2.identity_result?.number_matches).toBe(true);
    // privilege is fine — not conflated
    expect(s2.privilege_result?.valid).toBe(true);
    // the diff sees a licensee_name change, but that is NOT a status flip
    expect(s2.diff_result?.agrees).toBe(false);
    expect(diffIsStatusConflict(s2.diff_result!)).toBe(false);
    expect(s2.diff_result?.conflicts.some((c) => c.field === "status_normalized")).toBe(false);
    // never a silent pass — a conflict case, pointer held (Step 7)
    expect(s2.disposition).toBe("conflict");
    const licAfter = await t.run((ctx) => ctx.db.get(licenseId));
    expect(licAfter?.current_confirmed_snapshot_id).toEqual(snaps[0]._id);
    const caseRow = await t.run((ctx) => ctx.db.get(licAfter!.open_case_id!));
    expect(caseRow?.type).toBe("identity"); // identity-typed, not status
    expect(caseRow?.detail.detected_types).toEqual(["identity"]);

    const gate = await t.run(async (ctx) =>
      (
        await ctx.db
          .query("audit_events")
          .withIndex("by_license", (q) => q.eq("license_id", licenseId))
          .collect()
      ).filter((a) => a.stage === "gate" && a.snapshot_id === s2._id),
    );
    expect(gate[0].message).toMatch(/identity name_change_suspected\(legal_name_change\)/);
  });

  test("privilege-violation fixture ⇒ privilege signal, identity stays exact", async () => {
    const t = convexTest(schema, modules);
    const { licenseId } = await t.mutation(api.roster.addWorker, nurseC);
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    // T1 privilege_ok (single_state, CA==CA) ⇒ confirmed
    let snaps = await latest(t, licenseId);
    expect(snaps[0].disposition).toBe("confirmed");
    expect(snaps[0].privilege_result?.reason).toBe("single_state_matches_assignment");

    // T2 privilege_violation (multistate into non-compact CA)
    await t.run((ctx) => ctx.db.patch(licenseId, { board_profile_url: "fixture://privilege_violation" }));
    await t.action(internal.sweep.runSweep, {});
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    snaps = await latest(t, licenseId);
    const s2 = snaps[1];
    expect(s2.privilege_result?.valid).toBe(false);
    expect(s2.privilege_result?.reason).toBe("multistate_but_assignment_state_mismatch");
    expect(s2.privilege_result?.compact_member).toBe(false);
    // identity is clean — the signal is privilege only
    expect(s2.identity_result?.match_confidence).toBe("exact");
    expect(s2.identity_result?.mismatch_reason).toBe("none");
    expect(s2.disposition).toBe("conflict");
    const c = await t.run(async (ctx) => {
      const lic = await ctx.db.get(licenseId);
      return ctx.db.get(lic!.open_case_id!);
    });
    expect(c?.type).toBe("privilege");
    expect(c?.detail.detected_types).toContain("privilege");
    expect(c?.detail.detected_types).not.toContain("identity");
  });

  test("multi_conflict ⇒ status flag AND privilege flag on one snapshot, identity clean (D-10a setup)", async () => {
    const t = convexTest(schema, modules);
    const { licenseId } = await t.mutation(api.roster.addWorker, nurseMC);
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    // T1 mc_t1 (single_state active) ⇒ confirmed
    let snaps = await latest(t, licenseId);
    expect(snaps[0].disposition).toBe("confirmed");

    // T2 multi_conflict (expired + multistate-into-CA)
    await t.run((ctx) => ctx.db.patch(licenseId, { board_profile_url: "fixture://multi_conflict" }));
    await t.action(internal.sweep.runSweep, {});
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    snaps = await latest(t, licenseId);
    const s2 = snaps[1];
    // status kind (from the diff)
    expect(diffIsStatusConflict(s2.diff_result!)).toBe(true);
    expect(s2.diff_result?.conflicts.some((c) => c.field === "status_normalized")).toBe(true);
    // privilege kind
    expect(s2.privilege_result?.valid).toBe(false);
    // identity clean — NOT conflated
    expect(s2.identity_result?.match_confidence).toBe("exact");
    expect(s2.disposition).toBe("conflict");
    // ONE case, headline privilege (D-10a: privilege > status), detail keeps both
    const c = await t.run(async (ctx) => {
      const lic = await ctx.db.get(licenseId);
      return ctx.db.get(lic!.open_case_id!);
    });
    expect(c?.type).toBe("privilege");
    expect([...(c?.detail.detected_types ?? [])].sort()).toEqual(["privilege", "status"]);
  });
});

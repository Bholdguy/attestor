import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import schema from "../../convex/schema";
import { api, internal } from "../../convex/_generated/api";
import { modules } from "./setup";
import { pickHeadlineType } from "../../convex/gate";

// D-10a / AC15 — a single conflicting fetch that trips several kinds opens ONE
// case; its `type` is the highest-priority kind (identity > privilege > status);
// `detail.detected_types` keeps them all.

describe("case-type-priority — pickHeadlineType (unit)", () => {
  test("identity beats privilege beats status", () => {
    expect(pickHeadlineType(["status", "privilege"])).toBe("privilege");
    expect(pickHeadlineType(["status", "privilege", "identity"])).toBe("identity");
    expect(pickHeadlineType(["privilege", "identity"])).toBe("identity");
    expect(pickHeadlineType(["status"])).toBe("status");
  });
});

const KAREN = {
  name_registered: "Karen M. Blackwood",
  name_hired: "Karen Blackwood",
  license_number: "RN-6650391",
  issuing_state: "CA",
  assignment_state: "CA", // not an NLC member
  facility_name: "Bay Medical",
  board_profile_url: "fixture://mc_t1",
  license_type: "RN" as const,
  declared_privilege_type: "single_state" as const,
};

describe("case-type-priority — multi-conflict fixture (integration)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  test("expired + multistate-into-non-compact ⇒ ONE case, type privilege, detected [privilege,status]", async () => {
    const t = convexTest(schema, modules);
    const { licenseId } = await t.mutation(api.roster.addWorker, KAREN);
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    // T1 mc_t1 (single_state active, CA==CA) ⇒ confirmed
    await t.run(async (ctx) => {
      const s = await ctx.db
        .query("snapshots")
        .withIndex("by_license", (q) => q.eq("license_id", licenseId))
        .collect();
      expect(s[0].disposition).toBe("confirmed");
    });

    // T2 multi_conflict (expired + multistate, residence CA)
    await t.run((ctx) => ctx.db.patch(licenseId, { board_profile_url: "fixture://multi_conflict" }));
    await t.action(internal.sweep.runSweep, {});
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    await t.run(async (ctx) => {
      const cases = await ctx.db
        .query("mismatch_cases")
        .withIndex("by_license", (q) => q.eq("license_id", licenseId))
        .collect();
      expect(cases).toHaveLength(1); // exactly ONE case
      expect(cases[0].type).toBe("privilege"); // headline = highest priority present
      expect([...cases[0].detail.detected_types].sort()).toEqual(["privilege", "status"]);
      // both underlying conflicts are retained in detail
      expect(cases[0].detail.privilege_result?.valid).toBe(false);
      expect(cases[0].detail.conflicts.some((c) => c.field === "status_normalized")).toBe(true);
      expect(cases[0].reason).toMatch(/privilege/);
      expect(cases[0].reason).toMatch(/status/);
    });
  });

  test("identity AND privilege on the same fetch ⇒ ONE case, headline identity (outranks privilege)", async () => {
    const t = convexTest(schema, modules);
    // first fetch IS the multi-kind one: register under a different name so
    // bind_identity flags it, and point straight at multi_conflict (multistate
    // into non-compact CA ⇒ privilege invalid). No prior confirmed ⇒ no status
    // diff kind, so detected = [identity, privilege].
    const { licenseId } = await t.mutation(api.roster.addWorker, {
      ...KAREN,
      name_registered: "Karen Quezada-Ellison",
      board_profile_url: "fixture://multi_conflict",
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    await t.run(async (ctx) => {
      const cases = await ctx.db
        .query("mismatch_cases")
        .withIndex("by_license", (q) => q.eq("license_id", licenseId))
        .collect();
      expect(cases).toHaveLength(1);
      expect(cases[0].type).toBe("identity"); // identity outranks privilege (D-10a)
      expect([...cases[0].detail.detected_types].sort()).toEqual(["identity", "privilege"]);
      expect(cases[0].detail.identity_result?.mismatch_reason).not.toBe("none");
      expect(cases[0].detail.privilege_result?.valid).toBe(false);
      expect(cases[0].reason).toMatch(/identity/);
      expect(cases[0].reason).toMatch(/privilege/);
    });
  });
});

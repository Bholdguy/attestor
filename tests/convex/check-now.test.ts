import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import schema from "../../convex/schema";
import { api } from "../../convex/_generated/api";
import { modules } from "./setup";

// DEMO Beat 3 — a manual single-license re-fetch.

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

describe("roster.checkNow", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  test("schedules exactly one more runForLicense ⇒ one more snapshot", async () => {
    const t = convexTest(schema, modules);
    const { licenseId } = await t.mutation(api.roster.addWorker, WORKER);
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const before = await t.run((ctx) =>
      ctx.db.query("snapshots").withIndex("by_license", (q) => q.eq("license_id", licenseId)).collect(),
    );
    expect(before).toHaveLength(1);

    const r = await t.mutation(api.roster.checkNow, { licenseId });
    expect(r.scheduled).toBe(true);
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const after = await t.run((ctx) =>
      ctx.db.query("snapshots").withIndex("by_license", (q) => q.eq("license_id", licenseId)).collect(),
    );
    expect(after).toHaveLength(2);
  });

  test("rejects an unknown license id", async () => {
    const t = convexTest(schema, modules);
    const { licenseId } = await t.mutation(api.roster.addWorker, WORKER);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    await t.run((ctx) => ctx.db.delete(licenseId));
    await expect(t.mutation(api.roster.checkNow, { licenseId })).rejects.toThrow(/not found/);
  });
});

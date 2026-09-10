import { convexTest, type TestConvex } from "convex-test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import schema from "../../convex/schema";
import { api, internal } from "../../convex/_generated/api";
import { modules } from "./setup";

// I9 / AC11 / M8 — the snapshot db.insert and its gate outcome (pointer flip, or
// mismatch case + scheduled alert) are committed by ONE transaction. No query
// state exists where a conflicting snapshot is readable without its case.

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

/** M8: count committed snapshots whose gate consequence is missing. Must be 0. */
async function m8(t: TestConvex<typeof schema>): Promise<number> {
  return t.run(async (ctx) => {
    const snaps = await ctx.db.query("snapshots").collect();
    let bad = 0;
    for (const s of snaps) {
      if (s.disposition === "conflict") {
        // must have a mismatch_case referencing it as snapshot_b
        const cases = await ctx.db
          .query("mismatch_cases")
          .withIndex("by_license", (q) => q.eq("license_id", s.license_id))
          .collect();
        if (!cases.some((c) => c.snapshot_b_id === s._id)) bad++;
      }
      if (s.disposition === "confirmed") {
        // the license pointer must have been moved to it at some point:
        // either it is the current pointer, or a LATER confirmed/adopted snapshot exists
        const lic = await ctx.db.get(s.license_id);
        const isCurrent = lic?.current_confirmed_snapshot_id === s._id;
        const laterConfirmed = snaps.some(
          (o) =>
            o.license_id === s.license_id &&
            o._creationTime > s._creationTime &&
            o.disposition === "confirmed",
        );
        const adoptedByResolve = await ctx.db
          .query("mismatch_cases")
          .withIndex("by_license", (q) => q.eq("license_id", s.license_id))
          .collect()
          .then((cs) => cs.some((c) => c.resolution_state === "confirmed" && c.snapshot_b_id !== s._id));
        if (!isCurrent && !laterConfirmed && !adoptedByResolve) bad++;
      }
    }
    return bad;
  });
}

describe("atomic-gate (I9 / M8)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  test("a conflicting commit writes the snapshot AND its case in one txn; pointer unchanged", async () => {
    const t = convexTest(schema, modules);
    const { licenseId } = await t.mutation(api.roster.addWorker, WORKER);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const pointerBefore = (await t.run((ctx) => ctx.db.get(licenseId)))!
      .current_confirmed_snapshot_id;

    await t.run((ctx) => ctx.db.patch(licenseId, { board_profile_url: "fixture://flip_expired" }));
    await t.action(internal.sweep.runSweep, {});
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    await t.run(async (ctx) => {
      const snaps = await ctx.db
        .query("snapshots")
        .withIndex("by_license", (q) => q.eq("license_id", licenseId))
        .collect();
      const conflict = snaps.find((s) => s.disposition === "conflict")!;
      const cases = await ctx.db
        .query("mismatch_cases")
        .withIndex("by_license", (q) => q.eq("license_id", licenseId))
        .collect();
      // the case exists and points at the conflicting snapshot
      expect(cases).toHaveLength(1);
      expect(cases[0].snapshot_b_id).toEqual(conflict._id);
      // pointer byte-identical to before
      const lic = await ctx.db.get(licenseId);
      expect(lic?.current_confirmed_snapshot_id).toEqual(pointerBefore);
      expect(lic?.open_case_id).toEqual(cases[0]._id);
    });

    expect(await m8(t)).toBe(0);
  });

  test("M8 == 0 after a mixed battery (confirm, conflict, unconfirmed, resolve)", async () => {
    const t = convexTest(schema, modules);

    // license A: confirm → conflict → resolve(confirmed)
    const a = await t.mutation(api.roster.addWorker, WORKER);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    await t.run((ctx) => ctx.db.patch(a.licenseId, { board_profile_url: "fixture://flip_expired" }));
    await t.action(internal.sweep.runSweep, {});
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const caseA = (await t.run((ctx) => ctx.db.get(a.licenseId)))!.open_case_id!;
    await t.mutation(api.cases.resolveCase, {
      case_id: caseA,
      decision: "confirmed",
      actor: "ops",
      note: "confirmed by board phone",
    });

    // license B: stays confirmed
    await t.mutation(api.roster.addWorker, {
      ...WORKER,
      name_registered: "Linda K. Park",
      name_hired: "Linda Park",
      license_number: "RN-5540218",
      board_profile_url: "fixture://suspension_seq_1",
    });
    // license C: fetch failure → unconfirmed
    await t.mutation(api.roster.addWorker, {
      ...WORKER,
      name_registered: "Blocked Person",
      name_hired: "Blocked Person",
      license_number: "RN-9000001",
      board_profile_url: "fixture://blocked_page",
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    expect(await m8(t)).toBe(0);
  });

  test("commit.ts makes no ctx.runQuery/runMutation/runAction call (nothing can yield mid-gate)", () => {
    const src = readFileSync(join(process.cwd(), "convex", "commit.ts"), "utf8");
    expect(src).not.toMatch(/ctx\.runQuery\(/);
    expect(src).not.toMatch(/ctx\.runMutation\(/);
    expect(src).not.toMatch(/ctx\.runAction\(/);
    // the snapshot insert and the case creation are in the same function body
    expect(src).toMatch(/db\.insert\("snapshots"/);
    expect(src).toMatch(/create_mismatch_case\(ctx/);
  });
});

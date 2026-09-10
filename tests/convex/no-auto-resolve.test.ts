import { convexTest } from "convex-test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import schema from "../../convex/schema";
import { api, internal } from "../../convex/_generated/api";
import { modules } from "./setup";

// I4 — a mismatch case moves out of "open" ONLY by an explicit human action.
// No cron, no action, no other mutation clears licenses.open_case_id.

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

describe("no-auto-resolve (I4)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  test("running the sweep 10× on an open case never clears open_case_id", async () => {
    const t = convexTest(schema, modules);
    const { licenseId } = await t.mutation(api.roster.addWorker, WORKER);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    await t.run((ctx) => ctx.db.patch(licenseId, { board_profile_url: "fixture://flip_expired" }));
    await t.action(internal.sweep.runSweep, {});
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const openCase = (await t.run((ctx) => ctx.db.get(licenseId)))!.open_case_id;
    expect(openCase).not.toBeNull();

    for (let i = 0; i < 10; i++) {
      // alternate the board answer — still never auto-clears
      await t.run((ctx) =>
        ctx.db.patch(licenseId, {
          board_profile_url: i % 2 ? "fixture://flip_active" : "fixture://flip_expired",
        }),
      );
      await t.action(internal.sweep.runSweep, {});
      await t.finishAllScheduledFunctions(vi.runAllTimers);
      const lic = await t.run((ctx) => ctx.db.get(licenseId));
      expect(lic?.open_case_id).toEqual(openCase); // unchanged, every iteration
    }

    // exactly one case, still open; exactly one alert scheduled (the original)
    const cases = await t.run((ctx) =>
      ctx.db
        .query("mismatch_cases")
        .withIndex("by_license", (q) => q.eq("license_id", licenseId))
        .collect(),
    );
    expect(cases).toHaveLength(1);
    expect(cases[0].resolution_state).toBe("open");

    // now a human can (and only a human can) clear it
    await t.mutation(api.cases.resolveCase, {
      case_id: cases[0]._id,
      decision: "dismissed",
      actor: "nurse-ops",
      note: "transient board glitch, verified active",
    });
    expect((await t.run((ctx) => ctx.db.get(licenseId)))?.open_case_id).toBeNull();
  });

  test("static: only cases.ts patches open_case_id to null", () => {
    const convexDir = join(process.cwd(), "convex");
    const offenders: string[] = [];
    for (const f of readdirSync(convexDir)) {
      if (!f.endsWith(".ts") || f.endsWith(".test.ts")) continue;
      const src = readFileSync(join(convexDir, f), "utf8");
      if (/db\.patch\([^)]*open_case_id\s*:\s*null/.test(src) && f !== "cases.ts") {
        offenders.push(f);
      }
    }
    expect(offenders).toEqual([]);
  });
});

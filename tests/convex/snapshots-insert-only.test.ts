import { convexTest } from "convex-test";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test, vi } from "vitest";
import schema from "../../convex/schema";
import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { modules } from "./setup";

// I5 / M7 / AC7 / AC14 — snapshots are insert-only; no historical snapshot is
// ever overwritten. Full raw HTML lives in file storage and re-hashes equal.

const BASE = {
  issuing_state: "NY",
  assignment_state: "NY",
  facility_name: "Mercy General",
  license_type: "RN" as const,
  declared_privilege_type: "single_state" as const,
};

describe("snapshots-insert-only (I5 / M7 / AC14)", () => {
  test("static: no db.patch/replace/delete targets the snapshots table", () => {
    const convexDir = join(process.cwd(), "convex");
    const offenders: string[] = [];
    for (const f of readdirSync(convexDir)) {
      if (!f.endsWith(".ts") || f.endsWith(".test.ts")) continue;
      const src = readFileSync(join(convexDir, f), "utf8");
      if (/db\.(patch|replace|delete)\(\s*["'`]snapshots/.test(src)) offenders.push(f);
      // db.patch(<id>) where the id is a snapshot — heuristic: a var named *napshot*
      if (/db\.(patch|replace)\(\s*\w*[sS]napshot\w*Id/.test(src)) offenders.push(`${f} (id-var)`);
    }
    expect(offenders).toEqual([]);
  });

  test("re-hash every stored blob against raw_payload_sha256 (M7 = 0)", async () => {
    const t = convexTest(schema, modules);

    // run a battery through the loop: clean, flip, name-change, privilege, block
    const seeds = [
      { name: "Maria S. Gomez", num: "RN-4471102", url: "fixture://flip_active" },
      { name: "Sarah A. Jenkins", num: "RN-2298475", url: "fixture://name_ok" },
      { name: "David R. Okafor", num: "RN-7781340", url: "fixture://privilege_ok" },
      { name: "Blocked Person", num: "RN-9000001", url: "fixture://blocked_page" },
      { name: "Missing Person", num: "RN-9000002", url: "fixture://not_found" },
    ];
    vi.useFakeTimers();
    const ids: Id<"licenses">[] = [];
    for (const s of seeds) {
      const r = await t.mutation(api.roster.addWorker, {
        ...BASE,
        name_registered: s.name,
        name_hired: s.name,
        license_number: s.num,
        board_profile_url: s.url,
      });
      ids.push(r.licenseId);
    }
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    // second pass with a flip on the first license
    await t.run((ctx) => ctx.db.patch(ids[0], { board_profile_url: "fixture://flip_expired" }));
    await t.action(internal.sweep.runSweep, {});
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    vi.useRealTimers();

    const mismatches = await t.run(async (ctx) => {
      const snaps = await ctx.db.query("snapshots").collect();
      let checked = 0;
      const bad: string[] = [];
      for (const s of snaps) {
        if (!s.raw_payload_storage_id) continue;
        const blob = await ctx.storage.get(s.raw_payload_storage_id);
        if (!blob) {
          bad.push(`${s._id}: blob missing`);
          continue;
        }
        const text = await blob.text();
        const h = createHash("sha256").update(text, "utf8").digest("hex");
        checked++;
        if (h !== s.raw_payload_sha256) bad.push(`${s._id}: ${h} != ${s.raw_payload_sha256}`);
        // bytes recorded match the stored blob
        if (Buffer.byteLength(text, "utf8") !== s.raw_payload_bytes) {
          bad.push(`${s._id}: byte count mismatch`);
        }
      }
      return { checked, bad };
    });

    expect(mismatches.checked).toBeGreaterThan(3);
    expect(mismatches.bad).toEqual([]);
  });

  test("every fixture-mode snapshot is labelled source_mode:'fixture' with a stored blob", async () => {
    const t = convexTest(schema, modules);
    vi.useFakeTimers();
    await t.mutation(api.roster.addWorker, {
      ...BASE,
      name_registered: "Maria S. Gomez",
      name_hired: "Maria Gomez",
      license_number: "RN-4471102",
      board_profile_url: "fixture://flip_active",
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    vi.useRealTimers();

    await t.run(async (ctx) => {
      const snaps = await ctx.db.query("snapshots").collect();
      for (const s of snaps) {
        expect(s.source_mode).toBe("fixture");
        expect(s.raw_payload_storage_id).not.toBeNull();
        expect(s.source_url).toMatch(/^fixture:\/\//);
      }
    });
  });
});

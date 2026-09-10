import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import schema from "../../convex/schema";
import { api, internal } from "../../convex/_generated/api";
import { modules } from "./setup";
import { firecrawlOk, mockResponse } from "./helpers";

// Step 5 — OpenAI extraction + diff, wired inside commitFetchResult.
//  - the flip fixture pair ⇒ stored diff_result.agrees:false (never a silent pass)
//  - an identical re-fetch ⇒ agrees:true (never a false conflict)
//  - a refused extraction ⇒ unconfirmed snapshot, no throw

const FIXTURE_WORKER = {
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

describe("Step 5 — extraction + diff", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  test("flip fixture pair ⇒ diff_result.agrees:false stored; identical re-fetch ⇒ agrees:true", async () => {
    const t = convexTest(schema, modules);
    const { licenseId } = await t.mutation(api.roster.addWorker, FIXTURE_WORKER);
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    // T1 — flip_active ⇒ confirmed, pointer set, diff has no prior
    const s1 = await t.run(async (ctx) => {
      const s = await ctx.db
        .query("snapshots")
        .withIndex("by_license", (q) => q.eq("license_id", licenseId))
        .collect();
      expect(s).toHaveLength(1);
      expect(s[0].disposition).toBe("confirmed");
      expect(s[0].extracted_fields?.status_normalized).toBe("active");
      expect(s[0].extractor_model).toBe("fixture-golden");
      expect(s[0].diff_result).toEqual({ agrees: true, compared_snapshot_id: null, conflicts: [] });
      const lic = await ctx.db.get(licenseId);
      expect(lic?.current_confirmed_snapshot_id).toEqual(s[0]._id);
      return s[0]._id;
    });

    // T2 — the board now says Expired
    await t.run(async (ctx) => {
      await ctx.db.patch(licenseId, { board_profile_url: "fixture://flip_expired" });
    });
    await t.action(internal.sweep.runSweep, {});
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    await t.run(async (ctx) => {
      const s = (
        await ctx.db
          .query("snapshots")
          .withIndex("by_license", (q) => q.eq("license_id", licenseId))
          .collect()
      ).sort((a, b) => a._creationTime - b._creationTime);
      expect(s).toHaveLength(2);
      const s2 = s[1];
      expect(s2.extracted_fields?.status_normalized).toBe("expired");
      expect(s2.diff_result?.agrees).toBe(false);
      expect(s2.diff_result?.compared_snapshot_id).toEqual(s1);
      // flip_expired also carries a past expiry date, so both fields disagree
      expect(s2.diff_result?.conflicts).toEqual([
        { field: "status_normalized", prior: "active", current: "expired" },
        { field: "expire_date", prior: "2026-06-30", current: "2024-06-30" },
      ]);
      // Step 5: never a silent pass — disagreement does NOT confirm; pointer held.
      expect(s2.disposition).toBe("unconfirmed");
      const lic = await ctx.db.get(licenseId);
      expect(lic?.current_confirmed_snapshot_id).toEqual(s1);

      // a diff audit row records the conflict
      const diffAudit = (
        await ctx.db
          .query("audit_events")
          .withIndex("by_license", (q) => q.eq("license_id", licenseId))
          .collect()
      ).filter((a) => a.stage === "diff" && a.snapshot_id === s2._id);
      expect(diffAudit[0].outcome).toBe("conflict:status_normalized,expire_date");
    });

    // T3 — identical to T1 again ⇒ agrees:true, re-confirms
    await t.run(async (ctx) => {
      await ctx.db.patch(licenseId, { board_profile_url: "fixture://flip_active" });
    });
    await t.action(internal.sweep.runSweep, {});
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    await t.run(async (ctx) => {
      const s = (
        await ctx.db
          .query("snapshots")
          .withIndex("by_license", (q) => q.eq("license_id", licenseId))
          .collect()
      ).sort((a, b) => a._creationTime - b._creationTime);
      expect(s).toHaveLength(3);
      expect(s[2].diff_result?.agrees).toBe(true);
      expect(s[2].disposition).toBe("confirmed");
      const lic = await ctx.db.get(licenseId);
      expect(lic?.current_confirmed_snapshot_id).toEqual(s[2]._id);
    });
  });

  test("a refused extraction ⇒ unconfirmed snapshot, pointer untouched, no throw", async () => {
    vi.stubEnv("FIRECRAWL_API_KEY", "fc-test");
    vi.stubEnv("BOARD_HOST_ALLOWLIST", "search.dca.ca.gov");
    vi.stubEnv("OPENAI_API_KEY", "sk-test");

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const u = String(url);
        if (u.includes("/v2/scrape")) {
          return firecrawlOk(
            "<html><body><table><tr><th>License Status</th><td>Active</td></tr></table></body></html>",
          );
        }
        if (u.endsWith("/models")) {
          return mockResponse({ status: 200, json: { data: [{ id: "gpt-4.1-mini" }] } });
        }
        if (u.includes("/chat/completions")) {
          return mockResponse({
            status: 200,
            json: { choices: [{ message: { content: null, refusal: "Refusing." } }] },
          });
        }
        throw new Error(`unexpected fetch: ${u}`);
      }),
    );

    const t = convexTest(schema, modules);
    const { licenseId } = await t.mutation(api.roster.addWorker, {
      ...FIXTURE_WORKER,
      board_profile_url: "https://search.dca.ca.gov/license/RN-4471102",
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    await t.run(async (ctx) => {
      const s = await ctx.db
        .query("snapshots")
        .withIndex("by_license", (q) => q.eq("license_id", licenseId))
        .collect();
      expect(s).toHaveLength(1);
      expect(s[0].fetch_status).toBe("extraction_refused");
      expect(s[0].extracted_fields).toBeNull();
      expect(s[0].disposition).toBe("unconfirmed");
      const lic = await ctx.db.get(licenseId);
      expect(lic?.current_confirmed_snapshot_id).toBeNull();

      const extractAudit = (
        await ctx.db
          .query("audit_events")
          .withIndex("by_license", (q) => q.eq("license_id", licenseId))
          .collect()
      ).filter((a) => a.stage === "extract");
      expect(extractAudit[0].outcome).toBe("refused");
    });
  });

  test("low extraction_confidence ⇒ unconfirmed (I6), even with an agreeing diff", async () => {
    const t = convexTest(schema, modules);
    // active_clean fixture but we force low confidence via a live mock
    vi.stubEnv("FIRECRAWL_API_KEY", "fc-test");
    vi.stubEnv("BOARD_HOST_ALLOWLIST", "search.dca.ca.gov");
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const u = String(url);
        if (u.includes("/v2/scrape"))
          return firecrawlOk("<html><body>Maria S. Gomez RN-4471102 Active</body></html>");
        if (u.endsWith("/models"))
          return mockResponse({ status: 200, json: { data: [{ id: "gpt-4.1-mini" }] } });
        return mockResponse({
          status: 200,
          json: {
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    licensee_name: "Maria S. Gomez",
                    license_number: "RN-4471102",
                    status_word: "Active",
                    status_normalized: "active",
                    issue_date: null,
                    expire_date: null,
                    privilege_type: "single_state",
                    primary_state_of_residence: "NY",
                    extraction_confidence: "low",
                  }),
                  refusal: null,
                },
              },
            ],
          },
        });
      }),
    );

    const { licenseId } = await t.mutation(api.roster.addWorker, {
      ...FIXTURE_WORKER,
      board_profile_url: "https://search.dca.ca.gov/license/RN-4471102",
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    await t.run(async (ctx) => {
      const s = await ctx.db
        .query("snapshots")
        .withIndex("by_license", (q) => q.eq("license_id", licenseId))
        .collect();
      expect(s[0].fetch_status).toBe("ok");
      expect(s[0].extracted_fields?.extraction_confidence).toBe("low");
      expect(s[0].disposition).toBe("unconfirmed");
      expect((await ctx.db.get(licenseId))?.current_confirmed_snapshot_id).toBeNull();
    });
  });
});

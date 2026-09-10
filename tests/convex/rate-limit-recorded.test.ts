import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import schema from "../../convex/schema";
import { api, internal } from "../../convex/_generated/api";
import { modules } from "./setup";
import { mockResponse, firecrawlOk, stubFetchSequence } from "./helpers";

// D-7 / AC12 — a Firecrawl 429 (after one bounded Retry-After retry) is a stored
// `rate_limited` snapshot, NOT a silent skip; the next sweep retries it and the
// retry snapshot links back via retry_of_snapshot_id. M2 (snapshots / fetch
// attempts) stays 100%.

const LIVE_WORKER = {
  name_registered: "Maria S. Gomez",
  name_hired: "Maria Gomez",
  license_number: "RN-4471102",
  issuing_state: "NY",
  assignment_state: "NY",
  facility_name: "Mercy General",
  board_profile_url: "https://search.dca.ca.gov/license/RN-4471102",
  license_type: "RN" as const,
  declared_privilege_type: "single_state" as const,
};

describe("Step 4 — rate-limited fetch is recorded and retried (D-7 / AC12)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubEnv("FIRECRAWL_API_KEY", "fc-test-key");
    vi.stubEnv("BOARD_HOST_ALLOWLIST", "search.dca.ca.gov");
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  test("429 twice → one rate_limited snapshot, no exception, pointer untouched", async () => {
    const t = convexTest(schema, modules);
    const fetchSpy = stubFetchSequence([
      mockResponse({ status: 429, json: { error: "rate limited" } }), // first
      mockResponse({ status: 429, json: { error: "rate limited" } }), // bounded retry
    ]);

    const { licenseId } = await t.mutation(api.roster.addWorker, LIVE_WORKER);
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    // one in-action retry ⇒ exactly 2 Firecrawl calls for the one tick
    expect(fetchSpy).toHaveBeenCalledTimes(2);

    await t.run(async (ctx) => {
      const snaps = await ctx.db
        .query("snapshots")
        .withIndex("by_license", (q) => q.eq("license_id", licenseId))
        .collect();
      expect(snaps).toHaveLength(1);
      expect(snaps[0].fetch_status).toBe("rate_limited");
      expect(snaps[0].fetch_http_code).toBe(429);
      expect(snaps[0].disposition).toBe("unconfirmed");
      expect(snaps[0].retry_of_snapshot_id).toBeNull();

      const license = await ctx.db.get(licenseId);
      expect(license?.current_confirmed_snapshot_id).toBeNull();
      expect(license?.open_case_id).toBeNull();
    });
  });

  test("next sweep retries the rate_limited license; retry snapshot links back", async () => {
    const t = convexTest(schema, modules);

    // tick 1 — 429 (+ retry 429)
    stubFetchSequence([
      mockResponse({ status: 429, json: {} }),
      mockResponse({ status: 429, json: {} }),
    ]);
    const { licenseId } = await t.mutation(api.roster.addWorker, LIVE_WORKER);
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const firstSnapId = await t.run(async (ctx) => {
      const s = await ctx.db
        .query("snapshots")
        .withIndex("by_license", (q) => q.eq("license_id", licenseId))
        .collect();
      return s[0]._id;
    });

    // tick 2 — sweep; fetch now succeeds
    stubFetchSequence([
      firecrawlOk(
        "<html><body><table><tr><th>Licensee Name</th><td>Maria S. Gomez</td></tr><tr><th>License Status</th><td>Active</td></tr></table></body></html>",
      ),
    ]);
    await t.action(internal.sweep.runSweep, {});
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    await t.run(async (ctx) => {
      const snaps = (
        await ctx.db
          .query("snapshots")
          .withIndex("by_license", (q) => q.eq("license_id", licenseId))
          .collect()
      ).sort((a, b) => a._creationTime - b._creationTime);

      expect(snaps).toHaveLength(2);
      expect(snaps[0].fetch_status).toBe("rate_limited");
      expect(snaps[1].fetch_status).toBe("ok");
      // the retry links the dots (no gap in the timeline)
      expect(snaps[1].retry_of_snapshot_id).toEqual(firstSnapId);

      // M2 — snapshots == fetch-stage audit rows (every attempt recorded)
      const fetchAudits = (
        await ctx.db
          .query("audit_events")
          .withIndex("by_license", (q) => q.eq("license_id", licenseId))
          .collect()
      ).filter((a) => a.stage === "fetch");
      expect(fetchAudits).toHaveLength(snaps.length);
    });
  });

  test("429 then 200 on the bounded retry → ok on the first tick (no rate_limited row)", async () => {
    const t = convexTest(schema, modules);
    stubFetchSequence([
      mockResponse({ status: 429, headers: { "retry-after": "1" }, json: {} }),
      firecrawlOk("<html><body><table><tr><th>License Status</th><td>Active</td></tr></table></body></html>"),
    ]);

    const { licenseId } = await t.mutation(api.roster.addWorker, LIVE_WORKER);
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    await t.run(async (ctx) => {
      const snaps = await ctx.db
        .query("snapshots")
        .withIndex("by_license", (q) => q.eq("license_id", licenseId))
        .collect();
      expect(snaps).toHaveLength(1);
      expect(snaps[0].fetch_status).toBe("ok");
    });
  });
});

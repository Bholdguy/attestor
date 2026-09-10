import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import schema from "../../convex/schema";
import { api, internal } from "../../convex/_generated/api";
import { modules } from "./setup";
import { mockResponse, firecrawlOk, stubFetchSequence, abortError } from "./helpers";

// AC9 / ARCHITECTURE §8 — a blocked / 500 / timeout / thrown fetch each produces
// exactly ONE snapshot with the right fetch_status and disposition:"unconfirmed",
// never a crash and never a false "confirmed". A prior 🟢 license stays 🟢.

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

describe("Step 4 — blocked / timeout / error fetch is a recorded snapshot (AC9)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubEnv("FIRECRAWL_API_KEY", "fc-test-key");
    vi.stubEnv("BOARD_HOST_ALLOWLIST", "search.dca.ca.gov");
    vi.stubEnv("OPENAI_API_KEY", "sk-test-key");
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  const cases: Array<{
    name: string;
    behaviour: Parameters<typeof stubFetchSequence>[0];
    fetch_status: string;
    http_code: number | null;
  }> = [
    {
      name: "403 anti-bot → blocked",
      behaviour: [mockResponse({ status: 403, json: { error: "forbidden" } })],
      fetch_status: "blocked",
      http_code: 403,
    },
    {
      name: "500 → http_error",
      behaviour: [mockResponse({ status: 500, json: { error: "server" } })],
      fetch_status: "http_error",
      http_code: 500,
    },
    {
      // The 30s AbortController fires ⇒ fetch rejects with AbortError ⇒ timeout.
      // (Simulated directly; the AbortController wiring is trivial by inspection.)
      name: "aborted (timeout fired) → timeout",
      behaviour: [abortError()],
      fetch_status: "timeout",
      http_code: null,
    },
    {
      name: "thrown network error → http_error",
      behaviour: [new TypeError("network down")],
      fetch_status: "http_error",
      http_code: null,
    },
    {
      name: "2xx but body is a CAPTCHA wall → blocked",
      behaviour: [
        firecrawlOk(
          "<html><body><h1>Verify you are human</h1><div class='g-recaptcha'></div></body></html>",
        ),
      ],
      fetch_status: "blocked",
      http_code: 200,
    },
    {
      name: "404 target page → http_error",
      behaviour: [firecrawlOk("<html><body>404 Not Found</body></html>", 404)],
      fetch_status: "http_error",
      http_code: 404,
    },
  ];

  for (const c of cases) {
    test(c.name, async () => {
      const t = convexTest(schema, modules);
      stubFetchSequence(c.behaviour);

      const { licenseId } = await t.mutation(api.roster.addWorker, LIVE_WORKER);
      await t.finishAllScheduledFunctions(vi.runAllTimers);

      await t.run(async (ctx) => {
        const snaps = await ctx.db
          .query("snapshots")
          .withIndex("by_license", (q) => q.eq("license_id", licenseId))
          .collect();
        expect(snaps).toHaveLength(1);
        const [snap] = snaps;
        expect(snap.fetch_status).toBe(c.fetch_status);
        expect(snap.fetch_http_code).toBe(c.http_code);
        expect(snap.disposition).toBe("unconfirmed");
        expect(snap.source_mode).toBe("live");

        // fail-closed: pointer never moved, no case
        const license = await ctx.db.get(licenseId);
        expect(license?.current_confirmed_snapshot_id).toBeNull();
        expect(license?.open_case_id).toBeNull();

        // M2 — every fetch attempt has its own snapshot row
        const fetchAudits = (
          await ctx.db
            .query("audit_events")
            .withIndex("by_license", (q) => q.eq("license_id", licenseId))
            .collect()
        ).filter((a) => a.stage === "fetch");
        expect(fetchAudits).toHaveLength(snaps.length);
      });
    });
  }

  test("a prior 🟢 license stays 🟢 after a failed fetch (not downgraded, not re-confirmed)", async () => {
    const t = convexTest(schema, modules);

    // first tick: a good live fetch → confirmed 🟢
    stubFetchSequence([firecrawlOk("<html><body><table><tr><th>License Status</th><td>Active</td></tr></table></body></html>")]);
    const { licenseId } = await t.mutation(api.roster.addWorker, LIVE_WORKER);
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    let roster = await t.query(api.roster.listRoster, {});
    expect(roster[0].badge).toBe("verified");
    const confirmedBefore = roster[0].confirmedSnapshotId;
    expect(confirmedBefore).not.toBeNull();

    // next sweep: fetch is blocked
    stubFetchSequence([mockResponse({ status: 403, json: {} })]);
    await t.action(internal.sweep.runSweep, {});
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    roster = await t.query(api.roster.listRoster, {});
    expect(roster[0].badge).toBe("verified"); // still fresh + still has its pointer
    expect(roster[0].confirmedSnapshotId).toEqual(confirmedBefore); // pointer unchanged

    await t.run(async (ctx) => {
      const snaps = await ctx.db
        .query("snapshots")
        .withIndex("by_license", (q) => q.eq("license_id", licenseId))
        .collect();
      expect(snaps).toHaveLength(2);
      expect(snaps[1].fetch_status).toBe("blocked");
      expect(snaps[1].disposition).toBe("unconfirmed");
    });
  });
});

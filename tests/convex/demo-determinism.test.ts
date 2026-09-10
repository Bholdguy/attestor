import { convexTest, type TestConvex } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import schema from "../../convex/schema";
import { api } from "../../convex/_generated/api";
import { modules } from "./setup";
import { agentMailSendOk } from "./helpers";

// AC6 / AC13 — the full demo runs twice back-to-back with identical, correct
// outcomes on fixture data, independent of live board availability.

type Outcome = {
  snapshots: number;
  cases: number;
  alerts: number;
  dispositions: string[]; // sorted
  caseTypes: string[]; // sorted
  detectedTypes: string[]; // sorted, flattened
  sourceModes: string[]; // unique
  extractorModels: string[]; // unique
};

async function runOnce(): Promise<{ outcome: Outcome; firecrawl: number; openai: number; agentmail: number }> {
  let firecrawl = 0;
  let openai = 0;
  let agentmail = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) => {
      const u = String(url);
      if (u.includes("/v2/scrape") || u.includes("firecrawl")) firecrawl++;
      if (u.includes("/chat/completions") || u.endsWith("/models")) openai++;
      if (u.includes("/messages/send")) {
        agentmail++;
        return Promise.resolve(agentMailSendOk(`am-${agentmail}`));
      }
      return Promise.reject(new Error(`unexpected: ${u}`));
    }),
  );

  const t: TestConvex<typeof schema> = convexTest(schema, modules);
  await t.mutation(api.demo.runDemo, {});
  await t.finishAllScheduledFunctions(vi.runAllTimers);

  const outcome = await t.run(async (ctx) => {
    const snaps = await ctx.db.query("snapshots").collect();
    const cases = await ctx.db.query("mismatch_cases").collect();
    const alerts = await ctx.db.query("alerts").collect();
    return {
      snapshots: snaps.length,
      cases: cases.length,
      alerts: alerts.length,
      dispositions: snaps.map((s) => s.disposition).sort(),
      caseTypes: cases.map((c) => c.type).sort(),
      detectedTypes: cases.flatMap((c) => c.detail.detected_types).sort(),
      sourceModes: [...new Set(snaps.map((s) => s.source_mode))].sort(),
      extractorModels: [...new Set(snaps.map((s) => s.extractor_model).filter(Boolean) as string[])].sort(),
    } satisfies Outcome;
  });

  vi.unstubAllGlobals();
  return { outcome, firecrawl, openai, agentmail };
}

describe("demo-determinism (AC6)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubEnv("AGENTMAIL_API_KEY", "am-test");
    vi.stubEnv("AGENTMAIL_INBOX_ID", "attestor-alerts@agentmail.to");
    vi.stubEnv("ALERT_TO", "nurse-ops@example.test");
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  test("two back-to-back runs produce byte-identical outcomes; 0 Firecrawl, 0 OpenAI, real AgentMail", async () => {
    const a = await runOnce();
    const b = await runOnce();

    expect(b.outcome).toEqual(a.outcome);

    // the shape we expect from Nurses A–D:
    //  A flip_active→flip_expired : confirmed, conflict(status)
    //  B name_ok→name_changed     : confirmed, conflict(identity)
    //  C privilege_ok→violation   : confirmed, conflict(privilege)
    //  D susp ×3 active + suspended: confirmed ×3, conflict(status)
    expect(a.outcome.snapshots).toBe(10);
    expect(a.outcome.cases).toBe(4);
    expect(a.outcome.alerts).toBe(4);
    expect(a.outcome.dispositions).toEqual([
      "confirmed",
      "confirmed",
      "confirmed",
      "confirmed",
      "confirmed",
      "confirmed",
      "conflict",
      "conflict",
      "conflict",
      "conflict",
    ]);
    expect(a.outcome.caseTypes).toEqual(["identity", "privilege", "status", "status"]);
    expect(a.outcome.sourceModes).toEqual(["fixture"]);
    expect(a.outcome.extractorModels).toEqual(["fixture-golden"]);

    for (const r of [a, b]) {
      expect(r.firecrawl).toBe(0);
      expect(r.openai).toBe(0);
      expect(r.agentmail).toBeGreaterThan(0);
    }
    expect(b.agentmail).toBe(a.agentmail); // same number of real sends
  });
});

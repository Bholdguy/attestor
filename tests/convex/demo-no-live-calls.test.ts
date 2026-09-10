import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import schema from "../../convex/schema";
import { api, internal } from "../../convex/_generated/api";
import { modules } from "./setup";
import { agentMailSendOk } from "./helpers";

// I7 / AC13 — with demo_mode on, a full demo run makes ZERO Firecrawl and ZERO
// OpenAI calls, still sends real AgentMail alerts, and labels every snapshot
// source_mode:"fixture" / extractor_model:"fixture-golden".

describe("demo-no-live-calls (I7 / AC13)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubEnv("AGENTMAIL_API_KEY", "am-test");
    vi.stubEnv("AGENTMAIL_INBOX_ID", "attestor-alerts@agentmail.to");
    vi.stubEnv("ALERT_TO", "nurse-ops@example.test");
    // if any of these are set, a bug could still make a live call — make sure it can't
    vi.stubEnv("FIRECRAWL_API_KEY", "fc-should-not-be-used");
    vi.stubEnv("OPENAI_API_KEY", "sk-should-not-be-used");
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  test("runDemo ⇒ 0 Firecrawl, 0 OpenAI, >0 AgentMail; every snapshot is fixture-labelled", async () => {
    const t = convexTest(schema, modules);

    let firecrawl = 0;
    let openai = 0;
    let agentmail = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        const u = String(url);
        if (u.includes("firecrawl") || u.includes("/v2/scrape")) firecrawl++;
        if (u.includes("openai") || u.includes("/chat/completions") || u.endsWith("/models")) openai++;
        if (u.includes("/messages/send")) {
          agentmail++;
          return Promise.resolve(agentMailSendOk(`am-${agentmail}`, `thr-${agentmail}`));
        }
        return Promise.reject(new Error(`unexpected external call: ${u}`));
      }),
    );

    await t.mutation(api.demo.runDemo, {});
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    expect(firecrawl).toBe(0);
    expect(openai).toBe(0);
    expect(agentmail).toBeGreaterThan(0);

    await t.run(async (ctx) => {
      const snaps = await ctx.db.query("snapshots").collect();
      expect(snaps.length).toBeGreaterThan(0);
      for (const s of snaps) {
        expect(s.source_mode).toBe("fixture");
        expect(s.source_url).toMatch(/^fixture:\/\//);
        if (s.extracted_fields) expect(s.extractor_model).toBe("fixture-golden");
        expect(s.raw_payload_storage_id).not.toBeNull(); // blob still stored (D-8 path identical)
      }
      // demo_mode is on, so the live cron stands down
      const settings = await ctx.db.query("settings").first();
      expect(settings?.demo_mode).toBe(true);
    });
  });

  test("the live cron sweep no-ops while demo_mode is on", async () => {
    const t = convexTest(schema, modules);
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("no external call expected"))));
    await t.mutation(api.demo.setDemoMode, { demo_mode: true });
    const r = await t.action(internal.sweep.runSweep, {});
    expect(r.scheduled).toBe(0);
    expect(r.skipped).toBe("demo_mode");
  });
});

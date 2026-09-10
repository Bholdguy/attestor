import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import schema from "../../convex/schema";
import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { modules } from "./setup";
import { stubExternal, mockResponse } from "./helpers";

// An AgentMail 5xx ⇒ send_status:"failed", send_error populated, the case stays
// OPEN and visible in listOpenCases, an `alert` audit row records the failure.
// A manual retry after the API recovers ⇒ send succeeds, still ONE alerts row.

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

describe("agentmail-failure", () => {
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

  test("AgentMail 503 ⇒ send_status:'failed', case still open + visible; retry after recovery succeeds", async () => {
    const t = convexTest(schema, modules);
    // send #0 → 503, every send after → OK
    let sendCall = 0;
    const spy = stubExternal({
      send: () => (sendCall++ === 0 ? mockResponse({ status: 503, json: { error: "unavailable" } }) : mockResponse({ status: 200, json: { message_id: "am-msg-9", thread_id: "am-thr-9" } })),
    });

    const { licenseId } = await t.mutation(api.roster.addWorker, WORKER);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    await t.run((ctx) => ctx.db.patch(licenseId, { board_profile_url: "fixture://flip_expired" }));
    await t.action(internal.sweep.runSweep, {});
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const caseId = (await t.run((ctx) => ctx.db.get(licenseId)))!.open_case_id as Id<"mismatch_cases">;

    // first send failed
    let alerts = await t.run((ctx) =>
      ctx.db.query("alerts").withIndex("by_case", (q) => q.eq("mismatch_case_id", caseId)).collect(),
    );
    expect(alerts).toHaveLength(1);
    expect(alerts[0].send_status).toBe("failed");
    expect(alerts[0].send_error).toMatch(/503/);
    expect(spy.sends).toHaveLength(1);

    // case still open + visible
    const open = await t.query(api.cases.listOpenCases, {});
    expect(open.map((c) => c._id)).toContain(caseId);

    // an alert audit row records the failure
    let alertAudits = await t.run(async (ctx) =>
      (await ctx.db.query("audit_events").collect()).filter((a) => a.stage === "alert"),
    );
    expect(alertAudits.at(-1)?.outcome).toBe("alert_failed");

    // operator retries — AgentMail has recovered
    const r = await t.mutation(api.alert.retryAlert, { caseId });
    expect(r.scheduled).toBe(true);
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    alerts = await t.run((ctx) =>
      ctx.db.query("alerts").withIndex("by_case", (q) => q.eq("mismatch_case_id", caseId)).collect(),
    );
    expect(alerts).toHaveLength(1); // updated in place, NOT duplicated
    expect(alerts[0].send_status).toBe("sent");
    expect(alerts[0].agentmail_message_id).toBe("am-msg-9");
    expect(alerts[0].send_error).toBeNull();
    expect(spy.sends).toHaveLength(2);

    alertAudits = await t.run(async (ctx) =>
      (await ctx.db.query("audit_events").collect()).filter((a) => a.stage === "alert"),
    );
    expect(alertAudits.at(-1)?.outcome).toBe("alert_sent");
  });

  test("a thrown network error ⇒ failed, not a crash; runForLicense still resolves", async () => {
    const t = convexTest(schema, modules);
    stubExternal({ send: () => new TypeError("socket hang up") });

    const { licenseId } = await t.mutation(api.roster.addWorker, WORKER);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    await t.run((ctx) => ctx.db.patch(licenseId, { board_profile_url: "fixture://flip_expired" }));
    await expect(
      (async () => {
        await t.action(internal.sweep.runSweep, {});
        await t.finishAllScheduledFunctions(vi.runAllTimers);
      })(),
    ).resolves.toBeUndefined();

    const caseId = (await t.run((ctx) => ctx.db.get(licenseId)))!.open_case_id as Id<"mismatch_cases">;
    const alerts = await t.run((ctx) =>
      ctx.db.query("alerts").withIndex("by_case", (q) => q.eq("mismatch_case_id", caseId)).collect(),
    );
    expect(alerts[0].send_status).toBe("failed");
    expect(alerts[0].send_error).toMatch(/socket hang up|network error/);
  });
});

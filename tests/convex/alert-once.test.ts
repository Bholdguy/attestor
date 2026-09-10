import { convexTest, type TestConvex } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import schema from "../../convex/schema";
import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { modules } from "./setup";
import { stubExternal } from "./helpers";

// I8 / AC5 — exactly one AgentMail send per new case. The message carries both
// snapshots. A second conflicting re-fetch on the still-open case sends nothing
// more. recordAlert's check-then-insert returns proceed:false on collision.

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

function alertsFor(t: TestConvex<typeof schema>, caseId: Id<"mismatch_cases">) {
  return t.run((ctx) =>
    ctx.db
      .query("alerts")
      .withIndex("by_case", (q) => q.eq("mismatch_case_id", caseId))
      .collect(),
  );
}

describe("alert-once (I8 / AC5)", () => {
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

  test("one new case ⇒ exactly one alerts row + one AgentMail send with both snapshots", async () => {
    const t = convexTest(schema, modules);
    const fetchSpy = stubExternal();

    const { licenseId } = await t.mutation(api.roster.addWorker, WORKER);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    await t.run((ctx) => ctx.db.patch(licenseId, { board_profile_url: "fixture://flip_expired" }));
    await t.action(internal.sweep.runSweep, {});
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const caseId = (await t.run((ctx) => ctx.db.get(licenseId)))!.open_case_id as Id<"mismatch_cases">;
    const alerts = await alertsFor(t, caseId);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].send_status).toBe("sent");
    expect(alerts[0].agentmail_message_id).toBe("am-msg-1");
    expect(alerts[0].agentmail_thread_id).toBe("am-thr-1");

    // exactly one /messages/send call
    const sends = fetchSpy.sends as Array<{ subject: string; html: string; text: string; attachments: unknown[] }>;
    expect(sends).toHaveLength(1);
    // the message carries BOTH snapshots
    const caseRow = await t.run((ctx) => ctx.db.get(caseId));
    expect(sends[0].html).toContain(String(caseRow!.snapshot_a_id));
    expect(sends[0].html).toContain(String(caseRow!.snapshot_b_id));
    expect(sends[0].text).toContain(String(caseRow!.snapshot_a_id));
    expect(sends[0].text).toContain(String(caseRow!.snapshot_b_id));
    // + a case.json attachment
    expect(sends[0].attachments).toHaveLength(1);
    expect((sends[0].attachments[0] as { filename: string }).filename).toBe("case.json");
    expect(sends[0].subject).toMatch(/\[Attestor\] status mismatch/);

    // one alert audit row
    const alertAudits = await t.run(async (ctx) =>
      (await ctx.db.query("audit_events").collect()).filter((a) => a.stage === "alert"),
    );
    expect(alertAudits).toHaveLength(1);
    expect(alertAudits[0].outcome).toBe("alert_sent");
  });

  test("a second conflicting re-fetch on the still-open case sends nothing more", async () => {
    const t = convexTest(schema, modules);
    const fetchSpy = stubExternal();
    const { licenseId } = await t.mutation(api.roster.addWorker, WORKER);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    await t.run((ctx) => ctx.db.patch(licenseId, { board_profile_url: "fixture://flip_expired" }));
    await t.action(internal.sweep.runSweep, {});
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const caseId = (await t.run((ctx) => ctx.db.get(licenseId)))!.open_case_id as Id<"mismatch_cases">;
    expect(fetchSpy.sends).toHaveLength(1);

    // re-sweep twice more — still conflicting, case still open
    await t.action(internal.sweep.runSweep, {});
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    await t.action(internal.sweep.runSweep, {});
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    expect(fetchSpy.sends).toHaveLength(1); // no additional sends
    expect(await alertsFor(t, caseId)).toHaveLength(1);
    const alertAudits = await t.run(async (ctx) =>
      (await ctx.db.query("audit_events").collect()).filter((a) => a.stage === "alert"),
    );
    expect(alertAudits).toHaveLength(1);
  });

  test("recordAlert returns proceed:false on a second call for the same case (scheduler double-fire)", async () => {
    const t = convexTest(schema, modules);
    stubExternal();
    const { licenseId } = await t.mutation(api.roster.addWorker, WORKER);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    await t.run((ctx) => ctx.db.patch(licenseId, { board_profile_url: "fixture://flip_expired" }));
    await t.action(internal.sweep.runSweep, {});
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const caseId = (await t.run((ctx) => ctx.db.get(licenseId)))!.open_case_id as Id<"mismatch_cases">;

    const second = await t.mutation(internal.alert.recordAlert, { caseId, to: "x@example.test" });
    expect(second.proceed).toBe(false);

    // a direct re-run of sendAlert also does nothing (proceed:false)
    const res = await t.action(internal.alert.sendAlert, { caseId });
    expect(res.sent).toBe(false);
    expect(await alertsFor(t, caseId)).toHaveLength(1);
  });
});

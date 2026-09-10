// ─────────────────────────────────────────────────────────────────────────────
// alert.ts — sendAlert (internalAction), scheduled transactionally by
// commitFetchResult when a NEW mismatch case is created (I9). Exactly one send
// per case (I8): recordAlert does a check-then-insert on the unique
// alerts.by_case row and claims a "pending" slot BEFORE the send; a scheduler
// double-fire (or a re-fetch that re-hits the same open case) gets proceed:false.
//
// A failed send leaves send_status:"failed" and the case OPEN and visible; an
// operator can re-trigger via alert.retryAlert (which re-claims the same row).
// ─────────────────────────────────────────────────────────────────────────────
import { internalAction, internalMutation, internalQuery, mutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { v, ConvexError } from "convex/values";
import { buildEvidence, sendAgentMail, type CaseBundle } from "./agentmail";

export const getCaseBundle = internalQuery({
  args: { caseId: v.id("mismatch_cases") },
  handler: async (ctx, { caseId }): Promise<CaseBundle | null> => {
    const c = await ctx.db.get(caseId);
    if (!c) return null;
    const [worker, license, snapshot_a, snapshot_b] = await Promise.all([
      ctx.db.get(c.worker_id),
      ctx.db.get(c.license_id),
      ctx.db.get(c.snapshot_a_id),
      ctx.db.get(c.snapshot_b_id),
    ]);
    return { case: c, worker, license, snapshot_a, snapshot_b };
  },
});

export const recordAlert = internalMutation({
  args: { caseId: v.id("mismatch_cases"), to: v.string() },
  returns: v.object({
    proceed: v.boolean(),
    alertId: v.union(v.id("alerts"), v.null()),
  }),
  handler: async (ctx, { caseId, to }) => {
    const c = await ctx.db.get(caseId);
    if (!c) return { proceed: false, alertId: null };

    const existing = await ctx.db
      .query("alerts")
      .withIndex("by_case", (q) => q.eq("mismatch_case_id", caseId))
      .first();

    if (existing) {
      if (existing.send_status === "failed") {
        // operator-initiated retry — reclaim the SAME row, never a second one
        await ctx.db.patch(existing._id, {
          send_status: "pending",
          send_error: null,
          sent_at: Date.now(),
        });
        return { proceed: true, alertId: existing._id };
      }
      // sent, or pending (a send already in flight) — do not send again (I8)
      return { proceed: false, alertId: existing._id };
    }

    const alertId = await ctx.db.insert("alerts", {
      mismatch_case_id: caseId,
      sent_at: Date.now(),
      agentmail_message_id: null,
      agentmail_thread_id: null,
      to,
      send_status: "pending",
      send_error: null,
    });
    return { proceed: true, alertId };
  },
});

export const finalizeAlert = internalMutation({
  args: {
    alertId: v.id("alerts"),
    send_status: v.union(v.literal("sent"), v.literal("failed")),
    agentmail_message_id: v.union(v.string(), v.null()),
    agentmail_thread_id: v.union(v.string(), v.null()),
    send_error: v.union(v.string(), v.null()),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const a = await ctx.db.get(args.alertId);
    if (!a) return null;
    await ctx.db.patch(args.alertId, {
      send_status: args.send_status,
      agentmail_message_id: args.agentmail_message_id,
      agentmail_thread_id: args.agentmail_thread_id,
      send_error: args.send_error,
      sent_at: Date.now(),
    });
    const c = await ctx.db.get(a.mismatch_case_id);
    await ctx.db.insert("audit_events", {
      at: Date.now(),
      license_id: c?.license_id ?? null,
      snapshot_id: c?.snapshot_b_id ?? null,
      case_id: a.mismatch_case_id,
      stage: "alert",
      outcome: args.send_status === "sent" ? "alert_sent" : "alert_failed",
      message:
        args.send_status === "sent"
          ? `AgentMail message ${args.agentmail_message_id} sent to ${a.to}` +
            (args.agentmail_thread_id ? ` (thread ${args.agentmail_thread_id})` : "")
          : `AgentMail send failed: ${args.send_error}`,
      actor: "system",
    });
    return null;
  },
});

export const sendAlert = internalAction({
  args: { caseId: v.id("mismatch_cases") },
  returns: v.object({
    sent: v.boolean(),
    agentmail_message_id: v.union(v.string(), v.null()),
    agentmail_thread_id: v.union(v.string(), v.null()),
  }),
  handler: async (ctx, { caseId }) => {
    const to = process.env.ALERT_TO ?? "";
    const cc = process.env.ALERT_CC || null;

    // 1) claim the slot (I8). proceed:false ⇒ already sent / in flight.
    const claim = await ctx.runMutation(internal.alert.recordAlert, { caseId, to });
    if (!claim.proceed || claim.alertId == null) {
      return { sent: false, agentmail_message_id: null, agentmail_thread_id: null };
    }

    // 2) gather evidence
    const bundle = await ctx.runQuery(internal.alert.getCaseBundle, { caseId });
    if (!bundle) {
      await ctx.runMutation(internal.alert.finalizeAlert, {
        alertId: claim.alertId,
        send_status: "failed",
        agentmail_message_id: null,
        agentmail_thread_id: null,
        send_error: "case bundle not found",
      });
      return { sent: false, agentmail_message_id: null, agentmail_thread_id: null };
    }

    // 3) build + send (both snapshots + case.json attachment)
    const message = buildEvidence(bundle);
    const res = await sendAgentMail({ to, cc, message });

    // 4) finalize (records the alert audit row)
    await ctx.runMutation(internal.alert.finalizeAlert, {
      alertId: claim.alertId,
      send_status: res.ok ? "sent" : "failed",
      agentmail_message_id: res.ok ? res.message_id : null,
      agentmail_thread_id: res.ok ? res.thread_id : null,
      send_error: res.ok ? null : res.error,
    });

    return {
      sent: res.ok,
      agentmail_message_id: res.ok ? res.message_id : null,
      agentmail_thread_id: res.ok ? res.thread_id : null,
    };
  },
});

/** Operator-initiated retry of a FAILED alert (from the case UI). Not the loop. */
export const retryAlert = mutation({
  args: { caseId: v.id("mismatch_cases") },
  returns: v.object({ scheduled: v.boolean() }),
  handler: async (ctx, { caseId }) => {
    const c = await ctx.db.get(caseId);
    if (!c) throw new ConvexError(`retryAlert: case ${caseId} not found`);
    const existing = await ctx.db
      .query("alerts")
      .withIndex("by_case", (q) => q.eq("mismatch_case_id", caseId))
      .first();
    if (existing && existing.send_status !== "failed") {
      // already sent or in flight — nothing to retry
      return { scheduled: false };
    }
    await ctx.scheduler.runAfter(0, internal.alert.sendAlert, { caseId });
    return { scheduled: true };
  },
});

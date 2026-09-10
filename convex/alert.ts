// alert.ts — sendAlert (internalAction). Scheduled transactionally by
// commitFetchResult when a NEW mismatch case is created (I8/I9). Step 8 fills in
// the real AgentMail send + recordAlert/finalizeAlert (check-then-insert on the
// unique alerts.by_case row → exactly one send per case).
//
// Step 7 stub: it just records intent in an audit row so the atomic-gate tests
// can see the alert was scheduled. It performs no external call yet.
import { internalAction, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";

export const sendAlert = internalAction({
  args: { caseId: v.id("mismatch_cases") },
  returns: v.null(),
  handler: async (ctx, { caseId }): Promise<null> => {
    // Step 8: getCaseBundle → recordAlert (unique by_case) → AgentMail send →
    // finalizeAlert. For now, log a scheduled-alert audit row (idempotent-ish:
    // Step 8's recordAlert makes it truly exactly-once).
    await ctx.runMutation(internal.alert.noteAlertScheduled, { caseId });
    return null;
  },
});

export const noteAlertScheduled = internalMutation({
  args: { caseId: v.id("mismatch_cases") },
  returns: v.null(),
  handler: async (ctx, { caseId }): Promise<null> => {
    const c = await ctx.db.get(caseId);
    if (!c) return null;
    await ctx.db.insert("audit_events", {
      at: Date.now(),
      license_id: c.license_id,
      snapshot_id: c.snapshot_b_id,
      case_id: caseId,
      stage: "alert",
      outcome: "scheduled",
      message: `alert scheduled for case ${caseId} (type ${c.type}) — AgentMail send wired in Step 8`,
      actor: "system",
    });
    return null;
  },
});

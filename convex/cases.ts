// ─────────────────────────────────────────────────────────────────────────────
// cases.ts — human-only resolution (I4). resolveCase is the ONLY function
// anywhere that writes `licenses.open_case_id: null`. It requires a non-empty
// actor + note so every resolution is attributable to a named human, and writes
// a `resolve` audit row. On a "confirmed" decision it adopts snapshot_b as the
// new confirmed pointer (the board's new reality is now the accepted one).
// ─────────────────────────────────────────────────────────────────────────────
import { mutation, query } from "./_generated/server";
import { v, ConvexError } from "convex/values";

export const resolveCase = mutation({
  args: {
    case_id: v.id("mismatch_cases"),
    decision: v.union(v.literal("confirmed"), v.literal("dismissed")),
    actor: v.string(),
    note: v.string(),
  },
  returns: v.object({ resolution_state: v.union(v.literal("confirmed"), v.literal("dismissed")) }),
  handler: async (ctx, args) => {
    const actor = args.actor.trim();
    const note = args.note.trim();
    if (!actor) throw new ConvexError("resolveCase: a non-empty actor is required");
    if (!note) throw new ConvexError("resolveCase: a non-empty note is required");

    const c = await ctx.db.get(args.case_id);
    if (!c) throw new ConvexError(`resolveCase: case ${args.case_id} not found`);
    if (c.resolution_state !== "open") {
      throw new ConvexError(`resolveCase: case ${args.case_id} is already ${c.resolution_state}`);
    }

    const now = Date.now();
    await ctx.db.patch(args.case_id, {
      resolution_state: args.decision,
      resolved_by: actor,
      resolved_at: now,
      resolution_note: note,
    });

    const license = await ctx.db.get(c.license_id);
    if (license) {
      if (args.decision === "confirmed") {
        // adopt the snapshot that triggered the case as the new confirmed reality
        await ctx.db.patch(c.license_id, {
          current_confirmed_snapshot_id: c.snapshot_b_id,
          open_case_id: null, // the ONLY place open_case_id is cleared (I4)
        });
      } else {
        await ctx.db.patch(c.license_id, { open_case_id: null }); // the ONLY place (I4)
      }
    }

    await ctx.db.insert("audit_events", {
      at: now,
      license_id: c.license_id,
      snapshot_id: c.snapshot_b_id,
      case_id: args.case_id,
      stage: "resolve",
      outcome: args.decision === "confirmed" ? "case_confirmed" : "case_dismissed",
      message:
        `case ${args.case_id} resolved ${args.decision} by ${actor}` +
        (args.decision === "confirmed" ? ` — adopted snapshot ${c.snapshot_b_id} as confirmed` : "") +
        ` — note: ${note}`,
      actor,
    });

    return { resolution_state: args.decision };
  },
});

export const getCase = query({
  args: { caseId: v.id("mismatch_cases") },
  handler: async (ctx, { caseId }) => {
    const c = await ctx.db.get(caseId);
    if (!c) return null;
    const [worker, license, snapshotA, snapshotB, alert] = await Promise.all([
      ctx.db.get(c.worker_id),
      ctx.db.get(c.license_id),
      ctx.db.get(c.snapshot_a_id),
      ctx.db.get(c.snapshot_b_id),
      ctx.db
        .query("alerts")
        .withIndex("by_case", (q) => q.eq("mismatch_case_id", caseId))
        .first(),
    ]);
    return {
      ...c,
      worker_name_hired: worker?.name_hired ?? null,
      worker_name_registered: worker?.name_registered ?? null,
      license_number: license?.license_number ?? null,
      snapshot_a: snapshotA,
      snapshot_b: snapshotB,
      alert,
    };
  },
});

export const listOpenCases = query({
  args: {},
  handler: async (ctx) => {
    const open = await ctx.db
      .query("mismatch_cases")
      .withIndex("by_state", (q) => q.eq("resolution_state", "open"))
      .collect();
    return Promise.all(
      open.map(async (c) => {
        const worker = await ctx.db.get(c.worker_id);
        return {
          _id: c._id,
          _creationTime: c._creationTime,
          license_id: c.license_id,
          worker_id: c.worker_id,
          worker_name_hired: worker?.name_hired ?? "(unknown)",
          type: c.type,
          reason: c.reason,
          detected_types: c.detail.detected_types,
          snapshot_a_id: c.snapshot_a_id,
          snapshot_b_id: c.snapshot_b_id,
        };
      }),
    );
  },
});

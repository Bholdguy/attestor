// ─────────────────────────────────────────────────────────────────────────────
// demo.ts — deterministic demo mode (D-9). `demo_mode` on ⇒ fetch_board_page +
// extract_license_fields use fixtures (zero Firecrawl / zero OpenAI); AgentMail
// sends stay real. Everything downstream is the live code path.
//
// "Run demo" resets + seeds Nurses A–D with their fixture sequences and starts a
// compressed scheduler chain. Runs back-to-back are byte-identical (AC6).
// ─────────────────────────────────────────────────────────────────────────────
import {
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { DEMO_SEQUENCES } from "./fixtures/index";

const DEMO_TAG = "demo-seed";
export const DEMO_STALENESS_MS = 20_000; // D-5 — 20 s so a badge can visibly go stale

// Personas — chosen so each nurse's registered identity + assignment match the
// golden ExtractedFields of the FIRST fixture in its sequence (so T1 confirms
// cleanly), and a later fixture trips exactly one kind of conflict.
const NURSES: Array<{
  key: keyof typeof DEMO_SEQUENCES;
  name_registered: string;
  name_hired: string;
  license_number: string;
  issuing_state: string;
  assignment_state: string;
  declared_privilege_type: "single_state" | "multistate" | "unknown";
  facility_name: string;
}> = [
  {
    key: "nurse_a",
    name_registered: "Maria S. Gomez",
    name_hired: "Maria Gomez",
    license_number: "RN-4471102",
    issuing_state: "NY",
    assignment_state: "NY",
    declared_privilege_type: "single_state",
    facility_name: "Mercy General",
  },
  {
    key: "nurse_b",
    name_registered: "Sarah A. Jenkins",
    name_hired: "Sarah Jenkins",
    license_number: "RN-2298475",
    issuing_state: "NY",
    assignment_state: "NY",
    declared_privilege_type: "single_state",
    facility_name: "St. Anne's",
  },
  {
    key: "nurse_c",
    name_registered: "David R. Okafor",
    name_hired: "David Okafor",
    license_number: "RN-7781340",
    issuing_state: "CA",
    assignment_state: "CA", // not an NLC member — a multistate license can't reach it
    declared_privilege_type: "multistate",
    facility_name: "Bay Medical",
  },
  {
    key: "nurse_d",
    name_registered: "Linda K. Park",
    name_hired: "Linda Park",
    license_number: "RN-5540218",
    issuing_state: "NY",
    assignment_state: "NY",
    declared_privilege_type: "single_state",
    facility_name: "Northside Rehab",
  },
];

// ── seed / reset ───────────────────────────────────────────────────────────
async function deleteDemoData(ctx: MutationCtx): Promise<void> {
  const workers = await ctx.db.query("workers").collect();
  for (const w of workers) {
    if (w.created_by !== DEMO_TAG) continue;
    const licenses = await ctx.db
      .query("licenses")
      .withIndex("by_worker", (q) => q.eq("worker_id", w._id))
      .collect();
    for (const lic of licenses) {
      for (const s of await ctx.db
        .query("snapshots")
        .withIndex("by_license", (q) => q.eq("license_id", lic._id))
        .collect()) {
        if (s.raw_payload_storage_id) await ctx.storage.delete(s.raw_payload_storage_id);
        await ctx.db.delete(s._id);
      }
      for (const c of await ctx.db
        .query("mismatch_cases")
        .withIndex("by_license", (q) => q.eq("license_id", lic._id))
        .collect()) {
        for (const a of await ctx.db
          .query("alerts")
          .withIndex("by_case", (q) => q.eq("mismatch_case_id", c._id))
          .collect()) {
          await ctx.db.delete(a._id);
        }
        await ctx.db.delete(c._id);
      }
      for (const e of await ctx.db
        .query("audit_events")
        .withIndex("by_license", (q) => q.eq("license_id", lic._id))
        .collect()) {
        await ctx.db.delete(e._id);
      }
      await ctx.db.delete(lic._id);
    }
    for (const asg of await ctx.db
      .query("assignments")
      .withIndex("by_worker", (q) => q.eq("worker_id", w._id))
      .collect()) {
      await ctx.db.delete(asg._id);
    }
    await ctx.db.delete(w._id);
  }
}

async function upsertSettings(ctx: MutationCtx, demo_mode: boolean): Promise<void> {
  const existing = await ctx.db.query("settings").first();
  const patch = {
    demo_mode,
    staleness_threshold_ms: demo_mode ? DEMO_STALENESS_MS : 7 * 24 * 60 * 60 * 1000,
    updated_at: Date.now(),
  };
  if (existing) await ctx.db.patch(existing._id, patch);
  else await ctx.db.insert("settings", patch);
}

async function doSeedDemo(ctx: MutationCtx): Promise<Id<"licenses">[]> {
  await deleteDemoData(ctx);
  await upsertSettings(ctx, true);

  const licenseIds: Id<"licenses">[] = [];
  for (const n of NURSES) {
    const sequence = DEMO_SEQUENCES[n.key];
    const workerId = await ctx.db.insert("workers", {
      name_registered: n.name_registered,
      name_hired: n.name_hired,
      license_number: n.license_number,
      issuing_state: n.issuing_state,
      created_by: DEMO_TAG,
    });
    await ctx.db.insert("assignments", {
      worker_id: workerId,
      facility_name: n.facility_name,
      assignment_state: n.assignment_state,
      start_date: "2026-08-01",
      active: true,
    });
    const licenseId = await ctx.db.insert("licenses", {
      worker_id: workerId,
      license_number: n.license_number,
      issuing_state: n.issuing_state,
      board_profile_url: `fixture://${sequence[0]}`,
      license_type: "RN",
      declared_privilege_type: n.declared_privilege_type,
      watch_enabled: true,
      watch_interval_minutes: 5,
      current_confirmed_snapshot_id: null,
      open_case_id: null,
      last_fetch_at: null,
      fixture_sequence: [...sequence],
      fixture_cursor: 0,
    });
    licenseIds.push(licenseId);
  }
  return licenseIds;
}

// ── public surface ────────────────────────────────────────────────────────
export const getSettings = query({
  args: {},
  handler: async (ctx) => {
    const s = await ctx.db.query("settings").first();
    return {
      demo_mode: s?.demo_mode ?? false,
      staleness_threshold_ms: s?.staleness_threshold_ms ?? 7 * 24 * 60 * 60 * 1000,
      updated_at: s?.updated_at ?? null,
    };
  },
});

export const setDemoMode = mutation({
  args: { demo_mode: v.boolean() },
  returns: v.null(),
  handler: async (ctx, { demo_mode }): Promise<null> => {
    await upsertSettings(ctx, demo_mode);
    return null;
  },
});

/** "Run demo" — reset + seed Nurses A–D, demo_mode on, start the compressed chain. */
export const runDemo = mutation({
  args: {},
  returns: v.object({ licenseIds: v.array(v.id("licenses")) }),
  handler: async (ctx) => {
    const licenseIds = await doSeedDemo(ctx);
    await ctx.scheduler.runAfter(0, internal.demo.runDemoSequence, {});
    return { licenseIds };
  },
});

/** "Clear demo" — delete the demo nurses and turn demo_mode off. */
export const clearDemo = mutation({
  args: {},
  returns: v.null(),
  handler: async (ctx): Promise<null> => {
    await deleteDemoData(ctx);
    await upsertSettings(ctx, false);
    return null;
  },
});

/** internal — seed only (tests call this then runDemoSequence explicitly). */
export const seedDemo = internalMutation({
  args: {},
  returns: v.object({ licenseIds: v.array(v.id("licenses")) }),
  handler: async (ctx) => ({ licenseIds: await doSeedDemo(ctx) }),
});

export const demoLicenses = internalQuery({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("licenses").collect();
    return rows
      .filter((r) => r.fixture_sequence.length > 0)
      .map((r) => ({ licenseId: r._id, seqLen: r.fixture_sequence.length }));
  },
});

/**
 * The compressed sweep: fire each demo license once per fixture in its sequence,
 * round by round. Each runForLicense is AWAITED before the next starts, so
 * round N's fixture_cursor advance is committed before round N+1 reads it —
 * fully deterministic, identical on every run (AC6). No in-action sleeps (D-13);
 * on the real deployment the dots still appear as a visible sequence.
 */
export const runDemoSequence = internalAction({
  args: {},
  returns: v.object({ ran: v.number() }),
  handler: async (ctx): Promise<{ ran: number }> => {
    const licenses = await ctx.runQuery(internal.demo.demoLicenses, {});
    const maxRounds = licenses.reduce((m, l) => Math.max(m, l.seqLen), 0);
    let ran = 0;
    for (let round = 0; round < maxRounds; round++) {
      for (const l of licenses) {
        if (round >= l.seqLen) continue; // this nurse's sequence is done
        await ctx.runAction(internal.loop.runForLicense, { licenseId: l.licenseId });
        ran++;
      }
    }
    return { ran };
  },
});

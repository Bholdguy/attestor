// Plane 1 — the reference workload. Displays data and starts a watch. It NEVER
// decides validity and NEVER mutates a stored status (PRD §3). Add-worker input
// is validated here; bad input throws ConvexError and writes no row (SECURITY §3).
import { mutation, query, type MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { v, ConvexError } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { deriveBadge, STALENESS_THRESHOLD_MS_DEFAULT, type Badge } from "./badge";

const STATE_RE = /^[A-Z]{2}$/;
const licenseTypeV = v.union(v.literal("RN"), v.literal("LPN"), v.literal("CNA"));
const privilegeV = v.union(
  v.literal("single_state"),
  v.literal("multistate"),
  v.literal("unknown"),
);

function normState(raw: string, field: string): string {
  const s = raw.trim().toUpperCase();
  if (!STATE_RE.test(s)) {
    throw new ConvexError(`${field} must be a 2-letter state code (got ${JSON.stringify(raw)})`);
  }
  return s;
}

function assertLicenseNumber(raw: string): string {
  const s = raw.trim();
  if (s.length < 3) throw new ConvexError("license_number must be non-empty");
  return s;
}

function assertProfileUrl(raw: string): string {
  const s = raw.trim();
  if (s.startsWith("fixture://")) return s;
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    throw new ConvexError(`board_profile_url is not a valid URL: ${JSON.stringify(raw)}`);
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new ConvexError("board_profile_url must be http(s) or fixture://");
  }
  return s;
}

const workerInput = {
  name_registered: v.string(),
  name_hired: v.string(),
  license_number: v.string(),
  issuing_state: v.string(),
  assignment_state: v.string(),
  facility_name: v.string(),
  license_type: licenseTypeV,
  declared_privilege_type: privilegeV,
  board_profile_url: v.string(),
  start_date: v.optional(v.string()),
  watch_interval_minutes: v.optional(v.number()),
  created_by: v.optional(v.string()),
};

async function insertLicenseForWorker(
  ctx: MutationCtx,
  workerId: Id<"workers">,
  args: {
    license_number: string;
    issuing_state: string;
    board_profile_url: string;
    license_type: "RN" | "LPN" | "CNA";
    declared_privilege_type: "single_state" | "multistate" | "unknown";
    watch_interval_minutes?: number;
  },
): Promise<Id<"licenses">> {
  const licenseId: Id<"licenses"> = await ctx.db.insert("licenses", {
    worker_id: workerId,
    license_number: assertLicenseNumber(args.license_number),
    issuing_state: normState(args.issuing_state, "issuing_state"),
    board_profile_url: assertProfileUrl(args.board_profile_url),
    license_type: args.license_type,
    declared_privilege_type: args.declared_privilege_type,
    watch_enabled: true,
    watch_interval_minutes: args.watch_interval_minutes ?? 5,
    current_confirmed_snapshot_id: null,
    open_case_id: null,
    last_fetch_at: null,
    fixture_sequence: [],
    fixture_cursor: 0,
  });
  // scheduling is transactional with the inserts (ARCHITECTURE §4 step 1)
  await ctx.scheduler.runAfter(0, internal.loop.runForLicense, { licenseId });
  return licenseId;
}

/** All-in-one: worker + assignment + license + first watch tick (DEMO Beat 2). */
export const addWorker = mutation({
  args: workerInput,
  handler: async (ctx, args) => {
    const issuing = normState(args.issuing_state, "issuing_state");
    const assignment = normState(args.assignment_state, "assignment_state");
    const licenseNumber = assertLicenseNumber(args.license_number);
    if (!args.name_registered.trim()) throw new ConvexError("name_registered is required");
    if (!args.name_hired.trim()) throw new ConvexError("name_hired is required");
    if (!args.facility_name.trim()) throw new ConvexError("facility_name is required");

    const workerId = await ctx.db.insert("workers", {
      name_registered: args.name_registered.trim(),
      name_hired: args.name_hired.trim(),
      license_number: licenseNumber,
      issuing_state: issuing,
      created_by: args.created_by?.trim() || "demo-coordinator",
    });

    await ctx.db.insert("assignments", {
      worker_id: workerId,
      facility_name: args.facility_name.trim(),
      assignment_state: assignment,
      start_date: args.start_date?.trim() || new Date().toISOString().slice(0, 10),
      active: true,
    });

    const licenseId = await insertLicenseForWorker(ctx, workerId, {
      license_number: licenseNumber,
      issuing_state: issuing,
      board_profile_url: args.board_profile_url,
      license_type: args.license_type,
      declared_privilege_type: args.declared_privilege_type,
      watch_interval_minutes: args.watch_interval_minutes,
    });

    return { workerId, licenseId };
  },
});

/** Lower-level: add another license to an existing worker (tests / multi-license). */
export const addLicense = mutation({
  args: {
    worker_id: v.id("workers"),
    license_number: v.string(),
    issuing_state: v.string(),
    board_profile_url: v.string(),
    license_type: licenseTypeV,
    declared_privilege_type: privilegeV,
    watch_interval_minutes: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const worker = await ctx.db.get(args.worker_id);
    if (!worker) throw new ConvexError(`addLicense: worker ${args.worker_id} not found`);
    const licenseId = await insertLicenseForWorker(ctx, args.worker_id, args);
    return { licenseId };
  },
});

export interface RosterRow {
  licenseId: Id<"licenses">;
  workerId: Id<"workers">;
  nameHired: string;
  nameRegistered: string;
  licenseNumber: string;
  issuingState: string;
  licenseType: "RN" | "LPN" | "CNA";
  badge: Badge;
  confirmedSnapshotId: Id<"snapshots"> | null; // I1 — always returned alongside the badge
  openCaseId: Id<"mismatch_cases"> | null;
  lastFetchAt: number | null;
  latestSnapshotId: Id<"snapshots"> | null;
  latestFetchStatus: string | null;
  latestDisposition: string | null;
}

export const listRoster = query({
  args: {},
  handler: async (ctx): Promise<RosterRow[]> => {
    const now = Date.now();
    const settings = await ctx.db.query("settings").first();
    const staleness = settings?.staleness_threshold_ms ?? STALENESS_THRESHOLD_MS_DEFAULT;

    const licenses = await ctx.db.query("licenses").collect();
    const rows: RosterRow[] = [];
    for (const license of licenses) {
      const worker = await ctx.db.get(license.worker_id);
      const latest = await ctx.db
        .query("snapshots")
        .withIndex("by_license", (q) => q.eq("license_id", license._id))
        .order("desc")
        .first();

      const badge = deriveBadge(
        {
          current_confirmed_snapshot_id: license.current_confirmed_snapshot_id,
          open_case_id: license.open_case_id,
          last_fetch_at: license.last_fetch_at,
        },
        latest ? { fetch_status: latest.fetch_status } : null,
        now,
        staleness,
      );

      rows.push({
        licenseId: license._id,
        workerId: license.worker_id,
        nameHired: worker?.name_hired ?? "(unknown)",
        nameRegistered: worker?.name_registered ?? "(unknown)",
        licenseNumber: license.license_number,
        issuingState: license.issuing_state,
        licenseType: license.license_type,
        badge,
        confirmedSnapshotId: license.current_confirmed_snapshot_id,
        openCaseId: license.open_case_id,
        lastFetchAt: license.last_fetch_at,
        latestSnapshotId: latest?._id ?? null,
        latestFetchStatus: latest?.fetch_status ?? null,
        latestDisposition: latest?.disposition ?? null,
      });
    }
    // newest license first
    rows.sort((a, b) => (a.lastFetchAt ?? 0) - (b.lastFetchAt ?? 0));
    return rows.reverse();
  },
});

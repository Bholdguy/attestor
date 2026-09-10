// ─────────────────────────────────────────────────────────────────────────────
// schema.ts — the 8 Attestor tables (PRD §4) + indexes (TASKS Step 3).
//
// snapshots is APPEND-ONLY (I5). "Current status" is the pointer
// licenses.current_confirmed_snapshot_id, never a field patched on a snapshot.
// ─────────────────────────────────────────────────────────────────────────────
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import {
  extractedFields,
  diffResult,
  identityResult,
  privilegeResult,
  caseDetail,
  disposition,
  fetchStatus,
  sourceMode,
  caseType,
  caseResolutionState,
  auditStage,
} from "./contract";

export default defineSchema({
  // ── reference workload (Plane 1) ──────────────────────────────────────────
  workers: defineTable({
    name_registered: v.string(), // legal name as on the board record (identity input, I2)
    name_hired: v.string(), // name the facility onboarded them under
    license_number: v.string(),
    issuing_state: v.string(), // 2-letter
    created_by: v.string(), // coordinator identifier (demo: static)
  }),

  assignments: defineTable({
    worker_id: v.id("workers"),
    facility_name: v.string(),
    assignment_state: v.string(), // 2-letter; where care is delivered — the F3 check input
    start_date: v.string(), // ISO date
    active: v.boolean(), // inactive assignments are not swept
  }).index("by_worker", ["worker_id"]),

  licenses: defineTable({
    worker_id: v.id("workers"),
    license_number: v.string(),
    issuing_state: v.string(),
    board_profile_url: v.string(), // resolved board URL, or "fixture://<id>" in demo mode
    license_type: v.union(v.literal("RN"), v.literal("LPN"), v.literal("CNA")),
    declared_privilege_type: v.union(
      v.literal("single_state"),
      v.literal("multistate"),
      v.literal("unknown"),
    ),
    watch_enabled: v.boolean(), // cron sweep skips false
    watch_interval_minutes: v.number(),
    current_confirmed_snapshot_id: v.union(v.id("snapshots"), v.null()), // THE pointer (I1/I5)
    open_case_id: v.union(v.id("mismatch_cases"), v.null()), // ≤1 open case per license
    last_fetch_at: v.union(v.number(), v.null()), // ms epoch; drives time_since_last_confirmation
    // demo mode only (D-9) — ordered fixture ids this license serves on successive fetches
    fixture_sequence: v.array(v.string()),
    fixture_cursor: v.number(),
  })
    .index("by_watch_enabled", ["watch_enabled"])
    .index("by_worker", ["worker_id"]),

  // ── singleton settings (D-11) ─────────────────────────────────────────────
  settings: defineTable({
    demo_mode: v.boolean(),
    staleness_threshold_ms: v.number(), // overrides deriveBadge default (D-5)
    updated_at: v.number(),
  }),

  // ── Attestor (Plane 2) ───────────────────────────────────────────────────
  snapshots: defineTable({
    license_id: v.id("licenses"),
    fetched_at: v.number(),
    source_url: v.string(), // exact URL hit, or "fixture://<id>"
    source_mode: sourceMode, // I7 — demo data is always labelled
    // D-8 — full verbatim payload in Convex file storage; excerpt/hash/bytes inline
    raw_payload_storage_id: v.union(v.id("_storage"), v.null()), // null only when no body at all
    raw_payload_excerpt: v.string(), // first ≤4096 chars
    raw_payload_sha256: v.string(), // hash of the FULL payload (M7)
    raw_payload_bytes: v.number(),
    fetch_status: fetchStatus, // I6 — anything but "ok" can't be confirmed
    fetch_http_code: v.union(v.number(), v.null()),
    retry_of_snapshot_id: v.union(v.id("snapshots"), v.null()), // links a next-sweep retry (D-7)
    extracted_fields: v.union(extractedFields, v.null()), // null when fetch_status != ok
    extractor_model: v.union(v.string(), v.null()),
    extractor_raw_response: v.union(v.string(), v.null()),
    diff_result: v.union(diffResult, v.null()), // null for the first-ever snapshot
    identity_result: v.union(identityResult, v.null()),
    privilege_result: v.union(privilegeResult, v.null()),
    disposition, // the GATE outcome for this snapshot
  })
    .index("by_license", ["license_id"])
    .index("by_license_and_disposition", ["license_id", "disposition"]),

  mismatch_cases: defineTable({
    license_id: v.id("licenses"),
    worker_id: v.id("workers"), // denormalized for the dashboard
    type: caseType, // single headline; D-10a priority identity > privilege > status
    snapshot_a_id: v.id("snapshots"), // prior confirmed (or first snapshot for privilege/identity-only)
    snapshot_b_id: v.id("snapshots"), // the snapshot that triggered the case
    reason: v.string(),
    detail: caseDetail, // conflicts + detected_types (ALL kinds) + optional identity/privilege results
    resolution_state: caseResolutionState,
    resolved_by: v.union(v.string(), v.null()), // null while open
    resolved_at: v.union(v.number(), v.null()),
    resolution_note: v.union(v.string(), v.null()),
  })
    .index("by_license", ["license_id"])
    .index("by_license_and_state", ["license_id", "resolution_state"])
    .index("by_state", ["resolution_state"]),

  alerts: defineTable({
    mismatch_case_id: v.id("mismatch_cases"), // unique — enforced by check-then-insert on by_case (I8)
    sent_at: v.number(),
    agentmail_message_id: v.union(v.string(), v.null()),
    agentmail_thread_id: v.union(v.string(), v.null()),
    to: v.string(),
    send_status: v.union(v.literal("sent"), v.literal("failed")),
    send_error: v.union(v.string(), v.null()),
  }).index("by_case", ["mismatch_case_id"]),

  audit_events: defineTable({
    at: v.number(),
    license_id: v.union(v.id("licenses"), v.null()),
    snapshot_id: v.union(v.id("snapshots"), v.null()),
    case_id: v.union(v.id("mismatch_cases"), v.null()),
    stage: auditStage, // fetch | extract | diff | gate | alert | resolve
    outcome: v.string(), // "ok", "conflict:status", "alert_sent", "case_confirmed", …
    message: v.string(), // human-readable line for the timeline UI
    actor: v.string(), // "system" for the loop; a coordinator id for resolve
  })
    .index("by_license", ["license_id"])
    .index("by_case", ["case_id"]),
});

// ─────────────────────────────────────────────────────────────────────────────
// contract.ts — the frozen product contract (TASKS Step 1 / PRD §4 / §5).
//
// Reusable Convex `v.object` validators for every cross-stage shape:
// ExtractedFields, diffResult, identityResult, privilegeResult, caseDetail.
// `convex/schema.ts` composes these; `src/lib/types.ts` mirrors the inferred
// TS types (imported, never re-validated — ARCHITECTURE §9).
//
// Nothing here decides anything. These are shapes only.
// ─────────────────────────────────────────────────────────────────────────────
import { v, type Infer } from "convex/values";

// ── enums ────────────────────────────────────────────────────────────────────

/** OpenAI maps the verbatim board word onto this closed set; `unknown` when unmappable. */
export const statusNormalized = v.union(
  v.literal("active"),
  v.literal("inactive"),
  v.literal("expired"),
  v.literal("pending"),
  v.literal("revoked"),
  v.literal("suspended"),
  v.literal("unknown"),
);

export const privilegeType = v.union(
  v.literal("single_state"),
  v.literal("multistate"),
  v.literal("unknown"),
);

/** `low` → the GATE treats the fetch as ambiguous and cannot confirm (I6). */
export const extractionConfidence = v.union(
  v.literal("high"),
  v.literal("medium"),
  v.literal("low"),
);

/**
 * Snapshot fetch outcome (I6 — anything but `ok` can never be confirmed).
 * `rate_limited` = Firecrawl 429 after one bounded Retry-After retry (D-7).
 * `extraction_failed` / `extraction_refused` are set when FETCH was ok but
 * EXTRACT failed (D-2: extraction is a separate stage).
 */
export const fetchStatus = v.union(
  v.literal("ok"),
  v.literal("http_error"),
  v.literal("blocked"),
  v.literal("rate_limited"),
  v.literal("timeout"),
  v.literal("extraction_failed"),
  v.literal("extraction_refused"),
);

/** GATE outcome for a snapshot. */
export const disposition = v.union(
  v.literal("confirmed"),
  v.literal("conflict"),
  v.literal("unconfirmed"),
);

/** I7 — demo data is always labelled. */
export const sourceMode = v.union(v.literal("live"), v.literal("fixture"));

/** The single headline `type` on a mismatch case (D-10a priority: identity > privilege > status). */
export const caseType = v.union(
  v.literal("identity"),
  v.literal("status"),
  v.literal("privilege"),
);

/** One conflict kind detected on a fetch; `detail.detected_types` keeps every one. */
export const conflictKind = v.union(
  v.literal("identity"),
  v.literal("privilege"),
  v.literal("status"),
);

export const matchConfidence = v.union(
  v.literal("exact"),
  v.literal("high"),
  v.literal("name_change_suspected"),
  v.literal("mismatch"),
);

/** I2 — `legal_name_change` is distinct from any status flag. */
export const identityMismatchReason = v.union(
  v.literal("none"),
  v.literal("legal_name_change"),
  v.literal("wrong_person"),
  v.literal("number_mismatch"),
);

/** I3 — `privilege_unknown` fails closed. */
export const privilegeReason = v.union(
  v.literal("single_state_matches_assignment"),
  v.literal("multistate_resident_compact"),
  v.literal("multistate_but_assignment_state_mismatch"),
  v.literal("multistate_resident_not_compact"),
  v.literal("privilege_unknown"),
);

export const caseResolutionState = v.union(
  v.literal("open"),
  v.literal("confirmed"),
  v.literal("dismissed"),
);

export const auditStage = v.union(
  v.literal("fetch"),
  v.literal("extract"),
  v.literal("diff"),
  v.literal("gate"),
  v.literal("alert"),
  v.literal("resolve"),
);

// ── composite shapes ─────────────────────────────────────────────────────────

/** Strict-JSON target for OpenAI (PRD §4 `extractedFields`). No SSN/DOB slot ever (SECURITY §1). */
export const extractedFields = v.object({
  licensee_name: v.string(),
  license_number: v.string(),
  status_word: v.string(),
  status_normalized: statusNormalized,
  issue_date: v.union(v.string(), v.null()),
  expire_date: v.union(v.string(), v.null()),
  privilege_type: privilegeType,
  primary_state_of_residence: v.union(v.string(), v.null()),
  extraction_confidence: extractionConfidence,
});

/** One field-level disagreement, human-readable. */
export const conflictEntry = v.object({
  field: v.string(),
  prior: v.string(),
  current: v.string(),
});

/** Output of the pure `diff_snapshot` — compared against the prior *confirmed* snapshot. */
export const diffResult = v.object({
  agrees: v.boolean(),
  compared_snapshot_id: v.union(v.id("snapshots"), v.null()),
  conflicts: v.array(conflictEntry),
});

/** Output of the pure `bind_identity` — number + registered name, never name-string alone (I2). */
export const identityResult = v.object({
  match_confidence: matchConfidence,
  number_matches: v.boolean(),
  registered_name_similarity: v.number(),
  mismatch_reason: identityMismatchReason,
});

/** Output of the pure `check_privilege` — checked against the worker's real assignment state (I3). */
export const privilegeResult = v.object({
  valid: v.boolean(),
  reason: privilegeReason,
  assignment_state: v.string(),
  compact_member: v.boolean(),
});

/**
 * `mismatch_cases.detail` — full machine detail for replay.
 * `detected_types` records EVERY conflict kind found on the triggering fetch
 * (D-10a); the case's single headline `type` is chosen from these by priority.
 */
export const caseDetail = v.object({
  conflicts: v.array(conflictEntry),
  detected_types: v.array(conflictKind),
  identity_result: v.optional(identityResult),
  privilege_result: v.optional(privilegeResult),
});

// ── inferred TS types (mirrored by src/lib/types.ts) ──────────────────────────

export type StatusNormalized = Infer<typeof statusNormalized>;
export type PrivilegeType = Infer<typeof privilegeType>;
export type ExtractionConfidence = Infer<typeof extractionConfidence>;
export type FetchStatus = Infer<typeof fetchStatus>;
export type Disposition = Infer<typeof disposition>;
export type SourceMode = Infer<typeof sourceMode>;
export type CaseType = Infer<typeof caseType>;
export type ConflictKind = Infer<typeof conflictKind>;
export type MatchConfidence = Infer<typeof matchConfidence>;
export type IdentityMismatchReason = Infer<typeof identityMismatchReason>;
export type PrivilegeReason = Infer<typeof privilegeReason>;
export type CaseResolutionState = Infer<typeof caseResolutionState>;
export type AuditStage = Infer<typeof auditStage>;

export type ExtractedFields = Infer<typeof extractedFields>;
export type ConflictEntry = Infer<typeof conflictEntry>;
export type DiffResult = Infer<typeof diffResult>;
export type IdentityResult = Infer<typeof identityResult>;
export type PrivilegeResult = Infer<typeof privilegeResult>;
export type CaseDetail = Infer<typeof caseDetail>;

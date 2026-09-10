// ─────────────────────────────────────────────────────────────────────────────
// diff.ts — diff_snapshot (PURE). No LLM. Compares the freshly extracted fields
// against the prior *confirmed* snapshot's fields, field by field. It reports
// disagreement; it never decides what to do about it (that's the gate).
//
// Called INSIDE commitFetchResult (D-6), against the prior confirmed snapshot
// read in the same transaction.
// ─────────────────────────────────────────────────────────────────────────────
import type { ExtractedFields, DiffResult, ConflictEntry } from "./contract";

/** collapse whitespace + case so a cosmetic re-render is never a conflict */
function normName(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

/** license numbers: ignore separators (space, hyphen, dot, slash) and case */
function normNumber(s: string): string {
  return s.replace(/[^a-z0-9]/gi, "").toUpperCase();
}

export function diff_snapshot(
  next: ExtractedFields,
  prior: ExtractedFields | null,
  prior_snapshot_id: string | null,
): DiffResult {
  // `Id<"snapshots">` is a branded string; this pure module stays id-type-agnostic.
  const comparedId = prior_snapshot_id as DiffResult["compared_snapshot_id"];

  // First-ever snapshot — nothing to disagree with.
  if (!prior) {
    return { agrees: true, compared_snapshot_id: null, conflicts: [] };
  }

  const conflicts: ConflictEntry[] = [];

  if (next.status_normalized !== prior.status_normalized) {
    conflicts.push({
      field: "status_normalized",
      prior: prior.status_normalized,
      current: next.status_normalized,
    });
  }

  if (normName(next.licensee_name) !== normName(prior.licensee_name)) {
    conflicts.push({
      field: "licensee_name",
      prior: prior.licensee_name,
      current: next.licensee_name,
    });
  }

  if (normNumber(next.license_number) !== normNumber(prior.license_number)) {
    conflicts.push({
      field: "license_number",
      prior: prior.license_number,
      current: next.license_number,
    });
  }

  if (next.privilege_type !== prior.privilege_type) {
    conflicts.push({
      field: "privilege_type",
      prior: prior.privilege_type,
      current: next.privilege_type,
    });
  }

  for (const field of ["issue_date", "expire_date"] as const) {
    const p = prior[field] ?? "";
    const n = next[field] ?? "";
    if (p !== n) {
      conflicts.push({ field, prior: p || "null", current: n || "null" });
    }
  }

  return {
    agrees: conflicts.length === 0,
    compared_snapshot_id: comparedId,
    conflicts,
  };
}

/**
 * Does this diff contribute a "status"-kind conflict for the gate (Step 7)?
 * A status-word flip or an expiry/issue-date change between confirmed snapshots.
 * Name / number changes are attributed to the identity kind (bind_identity vs
 * the registered worker), and privilege_type changes to the privilege kind —
 * both decided in gate.ts, not here.
 */
export function diffIsStatusConflict(diff: DiffResult): boolean {
  return diff.conflicts.some(
    (c) => c.field === "status_normalized" || c.field === "expire_date" || c.field === "issue_date",
  );
}

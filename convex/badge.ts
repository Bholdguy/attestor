// ─────────────────────────────────────────────────────────────────────────────
// badge.ts — deriveBadge (PURE). The displayed status is NEVER a stored mutable
// field; it is always derived from the license row + latest snapshot + now.
//
// Fixed precedence (D-10b / PRD §4 / AC16) — FIRST MATCH WINS, later clauses are
// not evaluated:
//   1. 🟠 needs_review  — open_case_id != null            (dominates staleness)
//   2. ⚪ unconfirmed    — no pointer, or (not-ok latest fetch & no pointer),
//                          or time_since_last_confirmation >= staleness_threshold
//   3. 🟢 verified       — pointer set & fresh & no open case
//
// This module is duplicated verbatim in src/lib/badge.ts for optimistic
// rendering; badge-parity.test.ts (Step 9) guards against drift. Keep it
// dependency-free so both copies stay identical.
// ─────────────────────────────────────────────────────────────────────────────

/** D-5: 7 days live. Demo mode overrides via `settings.staleness_threshold_ms` (20 s). */
export const STALENESS_THRESHOLD_MS_DEFAULT = 7 * 24 * 60 * 60 * 1000;

export type Badge = "needs_review" | "unconfirmed" | "verified";

export interface DeriveBadgeLicense {
  /** the pointer (I1/I5) — null until the first agreeing fetch */
  current_confirmed_snapshot_id: string | null;
  /** at most one open case per license; set only by the GATE, cleared only by resolveCase (I4) */
  open_case_id: string | null;
  /**
   * ms epoch of the last fetch. In the common path the pointer only moves on an
   * agreeing fetch and last_fetch_at is written in that same commit, so this
   * drives time_since_last_confirmation (PRD §4 `licenses.last_fetch_at` note).
   */
  last_fetch_at: number | null;
}

export interface DeriveBadgeSnapshot {
  fetch_status: string;
}

export function deriveBadge(
  license: DeriveBadgeLicense,
  latestSnapshot: DeriveBadgeSnapshot | null,
  now: number,
  stalenessThresholdMs: number = STALENESS_THRESHOLD_MS_DEFAULT,
): Badge {
  // 1 — Needs Review. An open case always renders amber, even if also stale.
  if (license.open_case_id !== null) return "needs_review";

  const hasPointer = license.current_confirmed_snapshot_id !== null;
  const lastFetchOk = (latestSnapshot?.fetch_status ?? "ok") === "ok";

  const timeSinceLastConfirmation =
    hasPointer && license.last_fetch_at !== null
      ? now - license.last_fetch_at
      : Number.POSITIVE_INFINITY;

  // 2 — Unconfirmed (only reached when open_case_id == null).
  if (!hasPointer) return "unconfirmed";
  if (!lastFetchOk && !hasPointer) return "unconfirmed"; // explicit per §4; subsumed by the line above
  if (timeSinceLastConfirmation >= stalenessThresholdMs) return "unconfirmed";

  // 3 — Verified.
  return "verified";
}

/** UI helper — emoji + label per badge. */
export function badgeDisplay(badge: Badge): { emoji: string; label: string } {
  switch (badge) {
    case "needs_review":
      return { emoji: "🟠", label: "Needs Review" };
    case "unconfirmed":
      return { emoji: "⚪", label: "Unconfirmed" };
    case "verified":
      return { emoji: "🟢", label: "Verified" };
  }
}

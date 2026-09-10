// ─────────────────────────────────────────────────────────────────────────────
// src/lib/badge.ts — a VERBATIM copy of convex/badge.ts's pure logic, for
// optimistic client-side rendering. The server value from listRoster is
// authoritative; badge-parity.test.ts fails if these two drift.
//
// Keep this file byte-identical to convex/badge.ts between the marker comments.
// ─────────────────────────────────────────────────────────────────────────────

/** D-5: 7 days live. Demo mode overrides via `settings.staleness_threshold_ms` (20 s). */
export const STALENESS_THRESHOLD_MS_DEFAULT = 7 * 24 * 60 * 60 * 1000;

export type Badge = "needs_review" | "unconfirmed" | "verified";

export interface DeriveBadgeLicense {
  current_confirmed_snapshot_id: string | null;
  open_case_id: string | null;
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

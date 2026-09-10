import { describe, it, expect } from "vitest";
import * as serverBadge from "../../convex/badge";
import * as clientBadge from "../../src/lib/badge";

// TESTING.md §5 — src/lib/badge.deriveBadge must stay identical to
// convex/badge.deriveBadge. Exhaustive over the same axes as
// badge-precedence.test.ts, plus the four experience end-states.

const THRESHOLD = 1_000;
const NOW = 10_000_000;
const POINTER = "snap_1";
const CASE = "case_1";

type L = clientBadge.DeriveBadgeLicense;
type S = clientBadge.DeriveBadgeSnapshot | null;

const combos: Array<{ l: L; s: S }> = [];
for (const caseSet of [true, false]) {
  for (const pointer of [true, false]) {
    for (const stale of [true, false]) {
      for (const fetchOk of [true, false]) {
        combos.push({
          l: {
            current_confirmed_snapshot_id: pointer ? POINTER : null,
            open_case_id: caseSet ? CASE : null,
            last_fetch_at: pointer ? (stale ? NOW - 5_000 : NOW - 100) : null,
          },
          s: { fetch_status: fetchOk ? "ok" : "blocked" },
        });
      }
    }
  }
}

describe("badge-parity — src/lib/badge vs convex/badge", () => {
  it("exports the same STALENESS_THRESHOLD_MS_DEFAULT", () => {
    expect(clientBadge.STALENESS_THRESHOLD_MS_DEFAULT).toBe(
      serverBadge.STALENESS_THRESHOLD_MS_DEFAULT,
    );
  });

  it.each(combos)("deriveBadge agrees for combo %#", ({ l, s }) => {
    expect(clientBadge.deriveBadge(l, s, NOW, THRESHOLD)).toBe(
      serverBadge.deriveBadge(l, s, NOW, THRESHOLD),
    );
  });

  it("agrees with the built-in default threshold too", () => {
    for (const { l, s } of combos) {
      expect(clientBadge.deriveBadge(l, s, NOW)).toBe(serverBadge.deriveBadge(l, s, NOW));
    }
  });

  it("badgeDisplay agrees for all three badges", () => {
    for (const b of ["needs_review", "unconfirmed", "verified"] as const) {
      expect(clientBadge.badgeDisplay(b)).toEqual(serverBadge.badgeDisplay(b));
    }
  });

  it("the four experience end-states match (A verified, B/C/D needs_review)", () => {
    const fresh = { current_confirmed_snapshot_id: POINTER, open_case_id: null, last_fetch_at: NOW - 100 };
    const withCase = { current_confirmed_snapshot_id: POINTER, open_case_id: CASE, last_fetch_at: NOW - 100 };
    for (const [l, expected] of [
      [fresh, "verified"],
      [withCase, "needs_review"],
      [{ ...withCase, last_fetch_at: NOW - 5_000 }, "needs_review"],
    ] as const) {
      expect(clientBadge.deriveBadge(l, { fetch_status: "ok" }, NOW, THRESHOLD)).toBe(expected);
      expect(serverBadge.deriveBadge(l, { fetch_status: "ok" }, NOW, THRESHOLD)).toBe(expected);
    }
  });
});

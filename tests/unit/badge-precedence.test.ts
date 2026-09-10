import { describe, it, expect } from "vitest";
import {
  deriveBadge,
  type Badge,
  type DeriveBadgeLicense,
  type DeriveBadgeSnapshot,
} from "../../convex/badge";

// D-10b / AC16 — deriveBadge fixed precedence: needs_review > unconfirmed > verified.
// First match wins. Exhaustive over:
//   open_case_id ∈ {set, null} × pointer ∈ {set, null}
//   × stale ∈ {yes, no}       × latest fetch_status ∈ {ok, not-ok}
// = 16 rows, plus the five named rows and the four experience end-states.

const THRESHOLD = 1_000; // ms, test-local
const NOW = 10_000_000;

const POINTER = "snap_confirmed_1";
const CASE = "case_open_1";

function lic(over: Partial<DeriveBadgeLicense>): DeriveBadgeLicense {
  return {
    current_confirmed_snapshot_id: null,
    open_case_id: null,
    last_fetch_at: null,
    ...over,
  };
}
const fresh = NOW - 100; // delta 100 < THRESHOLD
const staleTs = NOW - 5_000; // delta 5000 >= THRESHOLD
const snap = (s: string): DeriveBadgeSnapshot => ({ fetch_status: s });
const okSnap = snap("ok");
const badSnap = snap("blocked");

const B = (l: DeriveBadgeLicense, s: DeriveBadgeSnapshot | null): Badge =>
  deriveBadge(l, s, NOW, THRESHOLD);

describe("deriveBadge — 16-row exhaustive precedence table", () => {
  type Row = {
    name: string;
    caseSet: boolean;
    pointer: boolean;
    stale: boolean;
    fetchOk: boolean;
    expected: Badge;
  };

  // open case dominates everything → always needs_review (8 rows)
  const caseRows: Row[] = [true, false].flatMap((pointer) =>
    [true, false].flatMap((stale) =>
      [true, false].map((fetchOk) => ({
        name: `open case + pointer=${pointer} + stale=${stale} + fetchOk=${fetchOk}`,
        caseSet: true,
        pointer,
        stale,
        fetchOk,
        expected: "needs_review" as Badge,
      })),
    ),
  );

  // no open case, no pointer → never confirmed → unconfirmed (4 rows)
  const noPointerRows: Row[] = [true, false].flatMap((stale) =>
    [true, false].map((fetchOk) => ({
      name: `no case + no pointer + stale=${stale} + fetchOk=${fetchOk}`,
      caseSet: false,
      pointer: false,
      stale,
      fetchOk,
      expected: "unconfirmed" as Badge,
    })),
  );

  // no open case, pointer set, stale → unconfirmed (2 rows)
  const staleRows: Row[] = [true, false].map((fetchOk) => ({
    name: `no case + pointer + stale + fetchOk=${fetchOk}`,
    caseSet: false,
    pointer: true,
    stale: true,
    fetchOk,
    expected: "unconfirmed" as Badge,
  }));

  // no open case, pointer set, fresh → verified (2 rows)
  const verifiedRows: Row[] = [true, false].map((fetchOk) => ({
    name: `no case + pointer + fresh + fetchOk=${fetchOk}`,
    caseSet: false,
    pointer: true,
    stale: false,
    fetchOk,
    expected: "verified" as Badge,
  }));

  const rows = [...caseRows, ...noPointerRows, ...staleRows, ...verifiedRows];

  it("covers all 16 combinations exactly once", () => {
    expect(rows).toHaveLength(16);
  });

  for (const r of rows) {
    it(`${r.name} ⇒ ${r.expected}`, () => {
      const license = lic({
        current_confirmed_snapshot_id: r.pointer ? POINTER : null,
        open_case_id: r.caseSet ? CASE : null,
        last_fetch_at: r.pointer ? (r.stale ? staleTs : fresh) : null,
      });
      expect(B(license, r.fetchOk ? okSnap : badSnap)).toBe(r.expected);
    });
  }
});

describe("deriveBadge — named precedence rows (TASKS Step 1 DoD)", () => {
  it("open case + stale ⇒ 🟠 needs_review, NOT ⚪ (AC16 — the precedence row)", () => {
    const license = lic({
      current_confirmed_snapshot_id: POINTER,
      open_case_id: CASE,
      last_fetch_at: staleTs,
    });
    expect(B(license, okSnap)).toBe("needs_review");
  });

  it("no pointer + no case ⇒ ⚪ unconfirmed", () => {
    expect(B(lic({}), okSnap)).toBe("unconfirmed");
  });

  it("pointer + stale + no case ⇒ ⚪ unconfirmed", () => {
    const license = lic({ current_confirmed_snapshot_id: POINTER, last_fetch_at: staleTs });
    expect(B(license, okSnap)).toBe("unconfirmed");
  });

  it("pointer + fresh + no case ⇒ 🟢 verified", () => {
    const license = lic({ current_confirmed_snapshot_id: POINTER, last_fetch_at: fresh });
    expect(B(license, okSnap)).toBe("verified");
  });

  it("pointer + fresh + open case ⇒ 🟠 needs_review", () => {
    const license = lic({
      current_confirmed_snapshot_id: POINTER,
      open_case_id: CASE,
      last_fetch_at: fresh,
    });
    expect(B(license, okSnap)).toBe("needs_review");
  });
});

describe("deriveBadge — the four end-to-end experience end states (PRD §6)", () => {
  it("A — clean success: pointer set, fresh, no case ⇒ 🟢 verified", () => {
    expect(
      B(lic({ current_confirmed_snapshot_id: POINTER, last_fetch_at: fresh }), okSnap),
    ).toBe("verified");
  });

  it("B — live mismatch caught: pointer UNCHANGED, open case ⇒ 🟠 needs_review", () => {
    expect(
      B(
        lic({
          current_confirmed_snapshot_id: POINTER,
          open_case_id: CASE,
          last_fetch_at: fresh,
        }),
        snap("ok"),
      ),
    ).toBe("needs_review");
  });

  it("C — operator replay: case still open ⇒ 🟠 needs_review", () => {
    expect(
      B(
        lic({
          current_confirmed_snapshot_id: POINTER,
          open_case_id: CASE,
          last_fetch_at: staleTs,
        }),
        okSnap,
      ),
    ).toBe("needs_review");
  });

  it("D — six-week close: 4th check trips a case ⇒ 🟠 needs_review", () => {
    expect(
      B(
        lic({
          current_confirmed_snapshot_id: POINTER,
          open_case_id: CASE,
          last_fetch_at: fresh,
        }),
        snap("ok"),
      ),
    ).toBe("needs_review");
  });
});

describe("deriveBadge — staleness boundary + default threshold", () => {
  it("exactly at threshold ⇒ unconfirmed (>=)", () => {
    const license = lic({
      current_confirmed_snapshot_id: POINTER,
      last_fetch_at: NOW - THRESHOLD,
    });
    expect(B(license, okSnap)).toBe("unconfirmed");
  });

  it("one ms under threshold ⇒ verified", () => {
    const license = lic({
      current_confirmed_snapshot_id: POINTER,
      last_fetch_at: NOW - (THRESHOLD - 1),
    });
    expect(B(license, okSnap)).toBe("verified");
  });

  it("uses the 7-day default when no threshold is passed", () => {
    const license = lic({
      current_confirmed_snapshot_id: POINTER,
      last_fetch_at: NOW - 6 * 24 * 60 * 60 * 1000, // 6 days
    });
    expect(deriveBadge(license, okSnap, NOW)).toBe("verified");
    const staleLicense = lic({
      current_confirmed_snapshot_id: POINTER,
      last_fetch_at: NOW - 8 * 24 * 60 * 60 * 1000, // 8 days
    });
    expect(deriveBadge(staleLicense, okSnap, NOW)).toBe("unconfirmed");
  });
});

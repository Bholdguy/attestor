import { describe, it, expect } from "vitest";
import { diff_snapshot } from "../../convex/diff";
import type { ExtractedFields } from "../../convex/contract";

// TESTING.md §2 — diff.ts / diff_snapshot (pure). No LLM.

const BASE: ExtractedFields = {
  licensee_name: "Maria S. Gomez",
  license_number: "RN-4471102",
  status_word: "Active",
  status_normalized: "active",
  issue_date: "2019-06-14",
  expire_date: "2026-06-30",
  privilege_type: "single_state",
  primary_state_of_residence: "NY",
  extraction_confidence: "high",
};
const f = (o: Partial<ExtractedFields>): ExtractedFields => ({ ...BASE, ...o });

describe("diff_snapshot", () => {
  it("active → active (identical) ⇒ agrees:true, conflicts:[] — the false-flag guard (M4)", () => {
    const r = diff_snapshot(f({}), f({}), "S1");
    expect(r.agrees).toBe(true);
    expect(r.conflicts).toEqual([]);
    expect(r.compared_snapshot_id).toBe("S1");
  });

  it("active → expired ⇒ agrees:false, one status_normalized conflict", () => {
    const r = diff_snapshot(
      f({ status_word: "Expired", status_normalized: "expired" }),
      f({}),
      "S1",
    );
    expect(r.agrees).toBe(false);
    expect(r.conflicts).toEqual([
      { field: "status_normalized", prior: "active", current: "expired" },
    ]);
  });

  it("name whitespace / case-only difference ⇒ NOT a conflict (normalised first)", () => {
    const r = diff_snapshot(f({ licensee_name: "  maria   s.  gomez " }), f({}), "S1");
    expect(r.agrees).toBe(true);
    expect(r.conflicts).toEqual([]);
  });

  it("license-number spacing/case-only difference ⇒ NOT a conflict", () => {
    const r = diff_snapshot(f({ license_number: "rn 4471102" }), f({}), "S1");
    expect(r.agrees).toBe(true);
  });

  it("prior == null (first snapshot) ⇒ agrees:true, compared_snapshot_id:null", () => {
    const r = diff_snapshot(f({ status_normalized: "expired" }), null, null);
    expect(r).toEqual({ agrees: true, compared_snapshot_id: null, conflicts: [] });
  });

  it("expiry-date-only change with same status ⇒ conflict on expire_date, not a status flip", () => {
    const r = diff_snapshot(f({ expire_date: "2028-06-30" }), f({}), "S1");
    expect(r.agrees).toBe(false);
    expect(r.conflicts).toEqual([
      { field: "expire_date", prior: "2026-06-30", current: "2028-06-30" },
    ]);
    expect(r.conflicts.some((c) => c.field === "status_normalized")).toBe(false);
  });

  it("a genuine different surname ⇒ licensee_name conflict (identity kind, attributed by gate)", () => {
    const r = diff_snapshot(f({ licensee_name: "Maria S. Whitfield" }), f({}), "S1");
    expect(r.agrees).toBe(false);
    expect(r.conflicts).toEqual([
      { field: "licensee_name", prior: "Maria S. Gomez", current: "Maria S. Whitfield" },
    ]);
  });

  it("privilege_type change ⇒ its own conflict entry", () => {
    const r = diff_snapshot(f({ privilege_type: "multistate" }), f({}), "S1");
    expect(r.conflicts).toEqual([
      { field: "privilege_type", prior: "single_state", current: "multistate" },
    ]);
  });

  it("null → set date ⇒ conflict rendered with 'null' sentinel", () => {
    const r = diff_snapshot(f({ issue_date: "2020-01-01" }), f({ issue_date: null }), "S1");
    expect(r.conflicts).toEqual([
      { field: "issue_date", prior: "null", current: "2020-01-01" },
    ]);
  });

  it("multiple simultaneous changes ⇒ all listed", () => {
    const r = diff_snapshot(
      f({ status_normalized: "expired", expire_date: "2024-06-30" }),
      f({}),
      "S1",
    );
    expect(r.conflicts.map((c) => c.field).sort()).toEqual(["expire_date", "status_normalized"]);
  });
});

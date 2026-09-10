import { describe, it, expect } from "vitest";
import { bind_identity, nameSimilarity } from "../../convex/identity";
import type { ExtractedFields } from "../../convex/contract";

// TESTING.md §2 — bind_identity full table (I2: never a match on name alone).

const EF = (over: Partial<ExtractedFields>): ExtractedFields => ({
  licensee_name: "Maria S. Gomez",
  license_number: "RN-4471102",
  status_word: "Active",
  status_normalized: "active",
  issue_date: null,
  expire_date: null,
  privilege_type: "single_state",
  primary_state_of_residence: "NY",
  extraction_confidence: "high",
  ...over,
});

const WORKER = { license_number: "RN-4471102", name_registered: "Maria S. Gomez" };

describe("bind_identity — the TESTING.md §2 table", () => {
  it("exact name + number ⇒ exact / none", () => {
    const r = bind_identity(WORKER, EF({}));
    expect(r).toMatchObject({ match_confidence: "exact", number_matches: true, mismatch_reason: "none" });
    expect(r.registered_name_similarity).toBeGreaterThanOrEqual(0.97);
  });

  it("minor middle-initial / punctuation diff + number ⇒ high / none", () => {
    const r = bind_identity(WORKER, EF({ licensee_name: "Maria Gomez" }));
    expect(r).toMatchObject({ match_confidence: "high", number_matches: true, mismatch_reason: "none" });
    expect(r.registered_name_similarity).toBeGreaterThanOrEqual(0.8);
    expect(r.registered_name_similarity).toBeLessThan(0.97);
  });

  it("accent-only difference ⇒ exact (names are accent-folded before compare)", () => {
    const r = bind_identity(WORKER, EF({ licensee_name: "María S. Gómez" }));
    expect(r.match_confidence).toBe("exact");
  });

  it("clearly different surname + number ⇒ name_change_suspected / legal_name_change", () => {
    const r = bind_identity(
      { license_number: "RN-2298475", name_registered: "Sarah A. Jenkins" },
      EF({ licensee_name: "Sarah A. Whitfield", license_number: "RN-2298475" }),
    );
    expect(r).toMatchObject({
      match_confidence: "name_change_suspected",
      number_matches: true,
      mismatch_reason: "legal_name_change",
    });
    expect(r.registered_name_similarity).toBeGreaterThanOrEqual(0.45);
    expect(r.registered_name_similarity).toBeLessThan(0.8);
  });

  it("different person entirely + number ⇒ mismatch / wrong_person", () => {
    const r = bind_identity(
      { license_number: "RN-2298475", name_registered: "Sarah A. Jenkins" },
      EF({ licensee_name: "Michael J. Okonkwo", license_number: "RN-2298475" }),
    );
    expect(r).toMatchObject({
      match_confidence: "mismatch",
      number_matches: true,
      mismatch_reason: "wrong_person",
    });
    expect(r.registered_name_similarity).toBeLessThan(0.45);
  });

  it("right name, WRONG number ⇒ mismatch / number_mismatch (number is decisive)", () => {
    const r = bind_identity(WORKER, EF({ license_number: "RN-9999999" }));
    expect(r).toMatchObject({
      match_confidence: "mismatch",
      number_matches: false,
      mismatch_reason: "number_mismatch",
    });
    // name still perfectly matched — but that alone is never enough (I2)
    expect(r.registered_name_similarity).toBeGreaterThanOrEqual(0.97);
  });

  it("license-number separators/case ignored (RN-4471102 == rn 4471102)", () => {
    const r = bind_identity(WORKER, EF({ license_number: "rn 4471102" }));
    expect(r.number_matches).toBe(true);
    expect(r.match_confidence).toBe("exact");
  });
});

describe("nameSimilarity", () => {
  it("is symmetric and bounded 0..1", () => {
    expect(nameSimilarity("a", "a")).toBe(1);
    expect(nameSimilarity("Maria Gomez", "")).toBe(0);
    expect(nameSimilarity("Maria Gomez", "Maria Gomez")).toBe(1);
    const s1 = nameSimilarity("Maria Gomez", "Maria Gonzalez");
    const s2 = nameSimilarity("Maria Gonzalez", "Maria Gomez");
    expect(s1).toBe(s2);
    expect(s1).toBeGreaterThan(0);
    expect(s1).toBeLessThan(1);
  });
});

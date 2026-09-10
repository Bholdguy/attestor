import { describe, it, expect } from "vitest";
import { check_privilege, NLC_MEMBER_STATES, isCompactState } from "../../convex/privilege";

// TESTING.md §2 — check_privilege full table (I3: never assumed valid; unknown
// fails closed). Signature: (privilege_type, assignment_state, residence, issuing).

describe("check_privilege — the TESTING.md §2 table", () => {
  it("single_state, assignment == issuing ⇒ valid, single_state_matches_assignment", () => {
    expect(check_privilege("single_state", "NY", "NY", "NY")).toEqual({
      valid: true,
      reason: "single_state_matches_assignment",
      assignment_state: "NY",
      compact_member: false,
    });
  });

  it("single_state, assignment != issuing ⇒ invalid, multistate_but_assignment_state_mismatch", () => {
    const r = check_privilege("single_state", "TX", "NY", "NY");
    expect(r.valid).toBe(false);
    expect(r.reason).toBe("multistate_but_assignment_state_mismatch");
    expect(r.assignment_state).toBe("TX");
  });

  it("multistate, assignment ∈ NLC, residence ∈ NLC ⇒ valid, multistate_resident_compact", () => {
    expect(check_privilege("multistate", "TX", "TX", "TX")).toEqual({
      valid: true,
      reason: "multistate_resident_compact",
      assignment_state: "TX",
      compact_member: true,
    });
  });

  it("multistate, assignment ∉ NLC ⇒ invalid, multistate_but_assignment_state_mismatch", () => {
    const r = check_privilege("multistate", "CA", "CA", "TX");
    expect(r).toEqual({
      valid: false,
      reason: "multistate_but_assignment_state_mismatch",
      assignment_state: "CA",
      compact_member: false,
    });
  });

  it("multistate, assignment ∈ NLC but residence ∉ NLC ⇒ invalid, multistate_resident_not_compact", () => {
    const r = check_privilege("multistate", "TX", "CA", "TX");
    expect(r).toEqual({
      valid: false,
      reason: "multistate_resident_not_compact",
      assignment_state: "TX",
      compact_member: true,
    });
  });

  it("multistate, residence null ⇒ invalid, multistate_resident_not_compact", () => {
    const r = check_privilege("multistate", "TX", null, "TX");
    expect(r.valid).toBe(false);
    expect(r.reason).toBe("multistate_resident_not_compact");
  });

  it("unknown privilege ⇒ invalid, privilege_unknown (fail closed)", () => {
    expect(check_privilege("unknown", "NY", "NY", "NY")).toEqual({
      valid: false,
      reason: "privilege_unknown",
      assignment_state: "NY",
      compact_member: false,
    });
  });

  it("state codes are case/space-normalised", () => {
    expect(check_privilege("single_state", " ny ", null, "NY").valid).toBe(true);
  });
});

describe("NLC_MEMBER_STATES (static demo list)", () => {
  it("includes TX, excludes CA and NY (the demo-critical ones)", () => {
    expect(isCompactState("TX")).toBe(true);
    expect(isCompactState("CA")).toBe(false);
    expect(isCompactState("NY")).toBe(false);
    expect(NLC_MEMBER_STATES.has("TX")).toBe(true);
  });
});

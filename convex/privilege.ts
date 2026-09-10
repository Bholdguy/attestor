// ─────────────────────────────────────────────────────────────────────────────
// privilege.ts — check_privilege (PURE). I3: a privilege is NEVER assumed valid
// without checking it against the worker's ACTUAL assignment state. "Multistate"
// does not mean "usable anywhere" — a compact privilege is void once the
// assignment state or the holder's primary residence is outside the compact.
// An `unknown` privilege FAILS CLOSED.
//
// Called INSIDE commitFetchResult (same txn as diff + insert).
//
// Demo scope (PRD §10/§11): a STATIC bundled Nurse Licensure Compact member
// list — not a live 50-state compact-resolution engine.
// ─────────────────────────────────────────────────────────────────────────────
import type { ExtractedFields, PrivilegeResult } from "./contract";

/**
 * Nurse Licensure Compact (NLC) member jurisdictions — static snapshot for the
 * demo. Notably NOT members: CA, NY, CT, HI, MA, MI, MN, NV, OR, IL, DC, AK.
 */
export const NLC_MEMBER_STATES: ReadonlySet<string> = new Set([
  "AL", "AR", "AZ", "CO", "DE", "FL", "GA", "IA", "ID", "IN", "KS", "KY", "LA",
  "ME", "MD", "MO", "MS", "MT", "NC", "ND", "NE", "NH", "NJ", "NM", "OH", "OK",
  "PA", "SC", "SD", "TN", "TX", "UT", "VA", "VT", "WA", "WI", "WV", "WY", "GU",
]);

function st(s: string | null | undefined): string {
  return (s ?? "").trim().toUpperCase();
}

export function isCompactState(state: string | null | undefined): boolean {
  return NLC_MEMBER_STATES.has(st(state));
}

export function check_privilege(
  privilege_type: ExtractedFields["privilege_type"],
  assignment_state: string,
  primary_state_of_residence: string | null,
  issuing_state: string,
): PrivilegeResult {
  const assignment = st(assignment_state);
  const compact_member = NLC_MEMBER_STATES.has(assignment); // is the ASSIGNMENT state in the compact
  const base = { assignment_state: assignment, compact_member };

  // fail closed on an unknown privilege (I6/I3)
  if (privilege_type === "unknown") {
    return { valid: false, reason: "privilege_unknown", ...base };
  }

  if (privilege_type === "single_state") {
    if (assignment === st(issuing_state)) {
      return { valid: true, reason: "single_state_matches_assignment", ...base };
    }
    // a single-state license used outside its issuing state
    return { valid: false, reason: "multistate_but_assignment_state_mismatch", ...base };
  }

  // privilege_type === "multistate"
  if (!compact_member) {
    // the assignment state is not an NLC member — a compact privilege doesn't reach it
    return { valid: false, reason: "multistate_but_assignment_state_mismatch", ...base };
  }
  if (!isCompactState(primary_state_of_residence)) {
    // multistate privilege is void once primary residence isn't a compact state
    return { valid: false, reason: "multistate_resident_not_compact", ...base };
  }
  return { valid: true, reason: "multistate_resident_compact", ...base };
}

/** Does this privilege verdict block confirmation? */
export function privilegeBlocksConfirm(r: PrivilegeResult): boolean {
  return !r.valid;
}

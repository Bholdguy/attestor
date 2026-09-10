// ─────────────────────────────────────────────────────────────────────────────
// gate.ts — the GATE decision, PURE and MECHANICAL. No LLM. The model never
// decides "is this fine" — this does, from the diff / identity / privilege
// verdicts already computed.
//
// Used inside commitFetchResult (D-6 / I9).
// ─────────────────────────────────────────────────────────────────────────────
import type {
  Disposition,
  ConflictKind,
  ExtractionConfidence,
  FetchStatus,
} from "./contract";

// D-10a — a single conflicting fetch can trip several kinds at once. The case's
// one headline `type` is the HIGHEST-priority detected kind. A wrong-person
// match (identity) must never be masked by a lower-severity flag.
const PRIORITY: Record<ConflictKind, number> = {
  identity: 3,
  privilege: 2,
  status: 1,
};

/** Highest-priority detected conflict kind. `detected` must be non-empty
 *  (only called on a conflict). `detail.detected_types` keeps them all. */
export function pickHeadlineType(detected: readonly ConflictKind[]): ConflictKind {
  if (detected.length === 0) {
    throw new Error("pickHeadlineType called with no detected conflicts");
  }
  return [...detected].sort((a, b) => PRIORITY[b] - PRIORITY[a])[0];
}

export interface DispositionInputs {
  fetch_status: FetchStatus;
  /** ExtractedFields.extraction_confidence, or null when there was no extraction */
  confidence: ExtractionConfidence | null;
  /** conflict kinds contributed by the diff vs the prior confirmed snapshot */
  diffKinds: readonly ConflictKind[];
  /** false ⇒ identity verdict blocks confirmation (mismatch / name_change_suspected) */
  identityOk: boolean | null;
  /** false ⇒ privilege verdict is invalid */
  privilegeOk: boolean | null;
  /**
   * true ⇒ this license already has an open mismatch case. An open case gates
   * confirmation: nothing gets confirmed (and the pointer never advances) until
   * a human resolves it (I4). A would-be-`confirmed` fetch is recorded
   * `unconfirmed` instead; a would-be-`conflict` still reports `conflict` but
   * `create_mismatch_case` is idempotent so no second case / alert is raised.
   */
  caseAlreadyOpen: boolean;
}

export interface DispositionResult {
  disposition: Disposition;
  detected: ConflictKind[];
}

/**
 * Fail closed first (I6): a non-"ok" fetch, a missing extraction, or
 * low confidence ⇒ `unconfirmed` — pointer and open_case_id untouched, no case.
 * Otherwise union every detected conflict kind; any ⇒ `conflict`; none ⇒
 * `confirmed`.
 */
export function deriveDisposition(i: DispositionInputs): DispositionResult {
  if (
    i.fetch_status !== "ok" ||
    i.confidence == null ||
    i.confidence === "low"
  ) {
    return { disposition: "unconfirmed", detected: [] };
  }

  const detected = new Set<ConflictKind>(i.diffKinds);
  if (i.identityOk === false) detected.add("identity");
  if (i.privilegeOk === false) detected.add("privilege");

  if (detected.size > 0) {
    return { disposition: "conflict", detected: [...detected] };
  }
  // would confirm — unless an unresolved case is gating this license (I4)
  if (i.caseAlreadyOpen) {
    return { disposition: "unconfirmed", detected: [] };
  }
  return { disposition: "confirmed", detected: [] };
}

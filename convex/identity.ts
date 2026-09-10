// ─────────────────────────────────────────────────────────────────────────────
// identity.ts — bind_identity (PURE). I2: NEVER a match on name-string alone.
// The verdict considers the license NUMBER and the REGISTERED name together.
// A legal-name change is FLAGGED (name_change_suspected / legal_name_change),
// never silently reconciled.
//
// Called INSIDE commitFetchResult (same txn as diff + insert).
// ─────────────────────────────────────────────────────────────────────────────
import type { ExtractedFields, IdentityResult } from "./contract";

// ── normalisation ──────────────────────────────────────────────────────────
function foldAccents(s: string): string {
  // strip Unicode combining diacritical marks (U+0300–U+036F)
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
}
function normName(s: string): string {
  return foldAccents(s)
    .toLowerCase()
    .replace(/[.,'`-]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
function normNumber(s: string): string {
  return s.replace(/[^a-z0-9]/gi, "").toUpperCase();
}

// ── string similarity: normalised Levenshtein, 0..1 ────────────────────────
function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  let curr = new Array<number>(b.length + 1);
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[b.length];
}

/** 0 (no overlap) … 1 (identical), on the accent/punct/case-normalised names. */
export function nameSimilarity(a: string, b: string): number {
  const x = normName(a);
  const y = normName(b);
  if (!x && !y) return 1;
  if (!x || !y) return 0;
  const maxLen = Math.max(x.length, y.length);
  return 1 - levenshtein(x, y) / maxLen;
}

// thresholds (documented in CONTRACT.md via TESTING.md §2 table)
const EXACT_MIN = 0.97;
const HIGH_MIN = 0.8;
const NAME_CHANGE_MIN = 0.45;

export function bind_identity(
  worker: { license_number: string; name_registered: string },
  extracted: ExtractedFields,
): IdentityResult {
  const number_matches =
    normNumber(extracted.license_number) === normNumber(worker.license_number);
  const registered_name_similarity = Number(
    nameSimilarity(worker.name_registered, extracted.licensee_name).toFixed(4),
  );

  // A wrong number is decisive regardless of the name — this is the impostor /
  // transposed-digit case. Never "exact" without the number.
  if (!number_matches) {
    return {
      match_confidence: "mismatch",
      number_matches: false,
      registered_name_similarity,
      mismatch_reason: "number_mismatch",
    };
  }

  if (registered_name_similarity >= EXACT_MIN) {
    return { match_confidence: "exact", number_matches: true, registered_name_similarity, mismatch_reason: "none" };
  }
  if (registered_name_similarity >= HIGH_MIN) {
    return { match_confidence: "high", number_matches: true, registered_name_similarity, mismatch_reason: "none" };
  }
  if (registered_name_similarity >= NAME_CHANGE_MIN) {
    return {
      match_confidence: "name_change_suspected",
      number_matches: true,
      registered_name_similarity,
      mismatch_reason: "legal_name_change",
    };
  }
  return {
    match_confidence: "mismatch",
    number_matches: true,
    registered_name_similarity,
    mismatch_reason: "wrong_person",
  };
}

/** Does this identity verdict block confirmation? (exact / high are fine.) */
export function identityBlocksConfirm(r: IdentityResult): boolean {
  return r.match_confidence === "mismatch" || r.match_confidence === "name_change_suspected";
}

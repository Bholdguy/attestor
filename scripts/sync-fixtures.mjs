#!/usr/bin/env node
// Generates convex/fixtures/index.ts from the canonical convex/fixtures/*.html
// bodies and convex/fixtures/golden/*.json ExtractedFields.
//
// Why generated: the Convex bundler (esbuild) cannot `import "...html?raw"`, so
// the fixture HTML must be inlined as JS strings for `fetch_board_page`'s
// mode:"fixture" branch (D-9). The .html / .json files stay the human-editable
// source of truth; run `npm run fixtures:sync` after editing them.
// `tests/unit/fixtures-parse.test.ts` fails if index.ts is out of sync.
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FIX = join(ROOT, "convex", "fixtures");
const GOLDEN = join(FIX, "golden");
const OUT = join(FIX, "index.ts");

// ── per-fixture metadata (source of truth for intended loop outcome) ──────────
// `extractable:false` ⇒ no golden file, expected_fields is null (block / 404).
const META = {
  active_clean: { outcome: { disposition: "confirmed" } },
  flip_active: { outcome: { disposition: "confirmed" }, note: "T1 of the active→expired flip pair" },
  flip_expired: {
    outcome: { disposition: "conflict", case_type: "status", detected_types: ["status"] },
    note: "T2 of the flip; requires a prior confirmed `active` snapshot for the diff",
  },
  name_ok: { outcome: { disposition: "confirmed" }, note: "clean T1 for the name-change sequence" },
  name_changed: {
    outcome: { disposition: "conflict", case_type: "identity", detected_types: ["identity"], mismatch_reason: "legal_name_change" },
    note: "surname changed vs worker.name_registered; number still matches",
  },
  name_wrong_person: {
    outcome: { disposition: "conflict", case_type: "identity", detected_types: ["identity"], mismatch_reason: "wrong_person" },
    note: "different person entirely; number matches (impostor pattern, F2)",
  },
  privilege_ok: { outcome: { disposition: "confirmed" }, note: "clean single-state T1 for the privilege sequence" },
  privilege_violation: {
    outcome: { disposition: "conflict", case_type: "privilege", detected_types: ["privilege"], privilege_reason: "multistate_but_assignment_state_mismatch" },
    note: "multistate license; assignment state is not an NLC member",
  },
  mc_t1: { outcome: { disposition: "confirmed" }, note: "clean single-state T1 for the multi-conflict sequence" },
  multi_conflict: {
    outcome: { disposition: "conflict", case_type: "privilege", detected_types: ["privilege", "status"], privilege_reason: "multistate_but_assignment_state_mismatch" },
    note: "expired AND multistate-into-non-NLC on the same fetch; ONE case, type=privilege (D-10a), detail keeps both",
  },
  blocked_page: {
    outcome: { disposition: "unconfirmed", fetch_status: "blocked" },
    fetch_status: "blocked",
    fetch_http_code: 403,
    extractable: false,
  },
  not_found: {
    outcome: { disposition: "unconfirmed", fetch_status: "http_error" },
    fetch_status: "http_error",
    fetch_http_code: 404,
    extractable: false,
  },
  suspension_seq_1: { outcome: { disposition: "confirmed" } },
  suspension_seq_2: { outcome: { disposition: "confirmed" } },
  suspension_seq_3: { outcome: { disposition: "confirmed" } },
  suspension_seq_4: {
    outcome: { disposition: "conflict", case_type: "status", detected_types: ["status"] },
    note: "6-week suspension: 4th scheduled re-check; prior confirmed = active",
  },
};

// Named demo sequences (Step 10 seeds licenses with these fixture-id lists).
const DEMO_SEQUENCES = {
  nurse_a: ["flip_active", "flip_expired"],
  nurse_b: ["name_ok", "name_changed"],
  nurse_c: ["privilege_ok", "privilege_violation"],
  nurse_d: ["suspension_seq_1", "suspension_seq_2", "suspension_seq_3", "suspension_seq_4"],
};

// ── build ────────────────────────────────────────────────────────────────────
const htmlFiles = readdirSync(FIX).filter((f) => f.endsWith(".html")).sort();
const ids = htmlFiles.map((f) => f.replace(/\.html$/, ""));

const missingMeta = ids.filter((id) => !META[id]);
if (missingMeta.length) {
  console.error("sync-fixtures: no META entry for: " + missingMeta.join(", "));
  process.exit(1);
}

const entries = ids.map((id) => {
  const meta = META[id];
  const html = readFileSync(join(FIX, `${id}.html`), "utf8");
  const extractable = meta.extractable !== false;
  let golden = null;
  if (extractable) {
    golden = JSON.parse(readFileSync(join(GOLDEN, `${id}.json`), "utf8"));
  }
  return {
    id,
    html,
    expected_fields: golden,
    expected_outcome: meta.outcome,
    fetch_status: meta.fetch_status ?? "ok",
    fetch_http_code: meta.fetch_http_code ?? 200,
    note: meta.note,
  };
});

const goldenFiles = readdirSync(GOLDEN).filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, "")).sort();
const wantGolden = ids.filter((id) => META[id].extractable !== false).sort();
if (JSON.stringify(goldenFiles) !== JSON.stringify(wantGolden)) {
  console.error("sync-fixtures: golden/*.json set does not match extractable fixtures");
  console.error("  golden:   " + goldenFiles.join(", "));
  console.error("  expected: " + wantGolden.join(", "));
  process.exit(1);
}

const body = `// ─────────────────────────────────────────────────────────────────────────────
// GENERATED by scripts/sync-fixtures.mjs — DO NOT EDIT BY HAND.
// Edit convex/fixtures/*.html or convex/fixtures/golden/*.json, then run
//   npm run fixtures:sync
// tests/unit/fixtures-parse.test.ts fails if this file is stale.
// ─────────────────────────────────────────────────────────────────────────────
import type {
  ExtractedFields,
  CaseType,
  ConflictKind,
  FetchStatus,
  IdentityMismatchReason,
  PrivilegeReason,
} from "../contract";

export type FixtureExpectedOutcome =
  | { disposition: "confirmed" }
  | {
      disposition: "conflict";
      case_type: CaseType;
      detected_types: ConflictKind[];
      mismatch_reason?: IdentityMismatchReason;
      privilege_reason?: PrivilegeReason;
    }
  | { disposition: "unconfirmed"; fetch_status: FetchStatus };

export interface Fixture {
  id: string;
  /** verbatim board-page body served by fetch_board_page(mode:"fixture") */
  html: string;
  /** golden ExtractedFields; null when the page is not extractable (block / 404) */
  expected_fields: ExtractedFields | null;
  expected_outcome: FixtureExpectedOutcome;
  /** what fetch_board_page(mode:"fixture") reports for this fixture */
  fetch_status: FetchStatus;
  fetch_http_code: number;
  note?: string;
}

export const FIXTURES = ${JSON.stringify(
    Object.fromEntries(entries.map((e) => [e.id, e])),
    null,
    2,
  )} satisfies Record<string, Fixture>;

export type FixtureId = keyof typeof FIXTURES;

export const FIXTURE_LIST: readonly Fixture[] = Object.values(FIXTURES);

export function getFixture(id: string): Fixture {
  const f = (FIXTURES as Record<string, Fixture>)[id];
  if (!f) throw new Error(\`unknown fixture id: \${id}\`);
  return f;
}

/** Named demo sequences — Step 10 seeds licenses.fixture_sequence with these. */
export const DEMO_SEQUENCES = ${JSON.stringify(DEMO_SEQUENCES, null, 2)} satisfies Record<
  string,
  FixtureId[]
>;
`;

writeFileSync(OUT, body);
console.log(`sync-fixtures: wrote ${OUT} (${entries.length} fixtures, ${wantGolden.length} goldens)`);

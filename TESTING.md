# TESTING.md — Attestor

Companion to `PRD.md` / `ARCHITECTURE.md`. Test types used: **unit** (pure
functions), **fixture-based** (golden extraction per fixture), **integration**
(`convex-test` — real scheduler, real transactions, mocked external HTTP), and
**failure-injection** (mocked Firecrawl/OpenAI/AgentMail returning errors).

Runner: `vitest`. Convex logic under `convex-test`. External HTTP (`fetch`,
`openai`, AgentMail SDK) is replaced with spies/mocks in every test — **no test
hits a real sponsor API.**

---

## 1. Test matrix — invariant / decision → test

| Ref | Test file | Type | Asserts |
|---|---|---|---|
| I1 | `traceability.test.ts` | integration | `listRoster` / `getWorkerTimeline` rows always carry `confirmed_snapshot_id`; a `null` pointer renders ⚪ with no fake status |
| I2 | `identity-binding.test.ts` | unit | `bind_identity` on wrong-person fixture → `mismatch_reason:"wrong_person"`; on name-change fixture → `"legal_name_change"`; name-string equality alone never yields `exact` without number match |
| I3 | `privilege-check.test.ts` | unit | `check_privilege("multistate","TX",...)` where TX∉compact → `valid:false, reason:"multistate_but_assignment_state_mismatch"`; `("single_state","NY",...)` NY==issuing → `valid:true` |
| I4 | `no-auto-resolve.test.ts` | integration + static | running the sweep 10× on an open case never clears `open_case_id`; grep asserts only `cases.resolveCase` writes `open_case_id: null` |
| I5 | `snapshots-insert-only.test.ts` | static + integration | grep: no `db.patch("snapshots"` / `db.replace("snapshots"` in `convex/`; integration: re-hash every stored blob == `raw_payload_sha256` (M7) |
| I6 | `fail-closed.test.ts` | failure-injection | for each of `http_error / blocked / rate_limited / timeout / extraction_failed / extraction_refused` and for `confidence:"low"`: `disposition:"unconfirmed"`, pointer unchanged, no case, no alert |
| I7 | `demo-no-live-calls.test.ts` | integration (spies) | with `demo_mode=true`, run full A–D sequence: Firecrawl spy call count == 0, OpenAI spy call count == 0; every snapshot `source_mode:"fixture"`, `extractor_model:"fixture-golden"` |
| I8 | `alert-once.test.ts` | integration | one new case ⇒ exactly one `alerts` row + one AgentMail send; second conflicting re-fetch on the still-open case ⇒ 0 additional sends; `recordAlert` collision returns `proceed:false` |
| I9 | `atomic-gate.test.ts` | integration | during a conflicting `commitFetchResult`, a concurrent `getWorkerTimeline` / `listOpenCases` never sees the `conflict` snapshot without its `mismatch_cases` row; `confirmed` snapshot never visible without the pointer moved; M8 count == 0 |
| D-10a | `case-type-priority.test.ts` | unit + integration | `pickHeadlineType(["status","privilege"])` → `"privilege"`; `(["status","privilege","identity"])` → `"identity"`; multi-conflict fixture opens ONE case, `type` = highest, `detail.detected_types` lists all |
| D-10b | `badge-precedence.test.ts` | unit | `deriveBadge` truth table incl. **open case + stale ⇒ 🟠** (not ⚪); no pointer + no case ⇒ ⚪; pointer + stale + no case ⇒ ⚪; pointer + fresh + no case ⇒ 🟢; pointer + fresh + open case ⇒ 🟠 |
| D-3 | `model-check.test.ts` | failure-injection | `bootModelCheck` with `GET /v1/models` returning a list without `OPENAI_MODEL` → logs a warning and falls back to `gpt-4o-2024-08-06`; with it present → uses it |
| Sec | `no-secret-in-client.test.ts` | static | built `dist/` has no `sk-` / `fc-` / `AGENTMAIL` / env var name; `*_API_KEY` referenced only in the 3 action helpers |

---

## 2. Unit tests — pure functions

### `diff.ts` — `diff_snapshot`
- active→active (identical fields) ⇒ `agrees:true, conflicts:[]` — **false-flag guard (M4)**
- active→expired ⇒ `agrees:false, conflicts:[{field:"status_normalized",prior:"active",current:"expired"}]`
- name whitespace/case-only difference ⇒ not a conflict (normalised before compare)
- `prior == null` (first snapshot) ⇒ `agrees:true, compared_snapshot_id:null` (nothing to disagree with)
- expiry-date-only change with same status ⇒ conflict on `expire_date`, listed but not a status flip

### `identity.ts` — `bind_identity`
| Case | number_matches | name similarity | expected `match_confidence` / `mismatch_reason` |
|---|---|---|---|
| exact name + number | true | 1.0 | `exact` / `none` |
| minor punctuation/middle-initial diff + number | true | 0.9 | `high` / `none` |
| clearly different surname + number | true | 0.55 | `name_change_suspected` / `legal_name_change` |
| different person entirely + number | true | 0.2 | `mismatch` / `wrong_person` |
| right name, wrong number | false | 1.0 | `mismatch` / `number_mismatch` |

### `privilege.ts` — `check_privilege`
- `single_state`, assignment == issuing ⇒ `valid:true, single_state_matches_assignment`
- `single_state`, assignment ≠ issuing ⇒ `valid:false, multistate_but_assignment_state_mismatch` (single-state license used out of state)
- `multistate`, assignment ∈ NLC, residence ∈ NLC ⇒ `valid:true, multistate_resident_compact`
- `multistate`, assignment ∉ NLC ⇒ `valid:false, multistate_but_assignment_state_mismatch`
- `multistate`, residence ∉ NLC ⇒ `valid:false, multistate_resident_not_compact`
- `unknown` privilege ⇒ `valid:false, privilege_unknown` (fail closed)

### `gate.ts`
- `deriveDisposition`: full truth table over `fetch_status` × `agrees` × `identity ok` × `privilege ok` × `confidence`
- `pickHeadlineType`: every subset of `{identity,privilege,status}` → correct max; empty set is unreachable (only called on conflict)

### `badge.ts` — `deriveBadge` (D-10b, ≥10 rows)
Exhaustive over `open_case_id ∈ {set,null}` × `pointer ∈ {set,null}` ×
`stale ∈ {y,n}` × `last fetch_status ∈ {ok, not-ok}` — with the **first-match**
precedence asserted, especially `open_case_id set + stale ⇒ needs_review`.

---

## 3. Fixture-based tests — golden extraction (Step 2 + Step 5)

`fixtures/index.ts` manifest drives a parametrised test. For each fixture:

| Fixture | Intended `ExtractedFields` highlights | Intended loop outcome |
|---|---|---|
| `active_clean` | status `Active`→`active`, name+number match, `single_state` | `confirmed`, 🟢 |
| `flip_active` (T1) | `active` | `confirmed` (first) |
| `flip_expired` (T2) | `Expired`→`expired` | `conflict type:status`, 🟠, 1 alert |
| `name_wrong_person` | `licensee_name` a different person, number matches | `conflict type:identity`, `wrong_person` |
| `name_changed` | surname changed vs `name_registered`, number matches | `conflict type:identity`, `legal_name_change` |
| `privilege_violation` | `multistate`, residence in a non-NLC state, assignment non-NLC | `conflict type:privilege` |
| `multi_conflict` | `expired` **and** `multistate` into non-NLC state | ONE `conflict`, `type:privilege`, `detail.detected_types:["privilege","status"]` (D-10a) |
| `blocked_page` | CAPTCHA / "unusual traffic" body | fetch classified `blocked` → `unconfirmed`, no case |
| `not_found` | 404 body | `http_error` → `unconfirmed` |
| `suspension_seq` (6-week) | seq of 4: `active,active,active,suspended` | first 3 `confirmed`, 4th `conflict type:status` |

Assertions per fixture:
1. `extract_license_fields(html, "live")` with **mocked OpenAI returning the
   golden** ⇒ exact `ExtractedFields` deep-equal (locks the schema + prompt
   contract).
2. `extract_license_fields(html, "fixture", id)` ⇒ **same** golden, zero OpenAI
   calls (D-9).
3. Full `commitFetchResult` with that golden ⇒ the intended `disposition`, case
   `type`, `detail.detected_types`, pointer behaviour.

Goldens are checked-in JSON under `fixtures/golden/<id>.json` and regenerated
only by an explicit `npm run fixtures:regold` (never automatically).

---

## 4. Integration tests (`convex-test`)

### `loop-happy-path.test.ts`
`addWorker` → advance scheduler → exactly one `runForLicense` → one `snapshots`
row + 4 `audit_events` (fetch/extract/diff/gate) written by one
`commitFetchResult` → badge 🟢 with a non-null `confirmed_snapshot_id`.

### `conflict-never-silent.test.ts` (the headline integration test — AC2)
1. Seed license, run once with `active` golden ⇒ 🟢, capture
   `current_confirmed_snapshot_id = S1`.
2. Swap the fixture to `expired`, advance scheduler.
3. Assert: a new snapshot `S2` exists with `disposition:"conflict"`;
   `current_confirmed_snapshot_id` **still == S1** (byte-identical);
   `open_case_id` set; `listRoster().badge == "needs_review"`; exactly one
   `alerts` row; exactly one AgentMail send with both snapshots in the payload.
4. Advance scheduler again (re-fetch, still `expired`): **no** new case, **no**
   new alert, badge unchanged.
5. `resolveCase({decision:"confirmed", actor:"nurse-ops", note:"board confirms
   expiry, worker pulled"})` ⇒ `open_case_id` cleared,
   `current_confirmed_snapshot_id == S2`, `audit_events` gains a `resolve` row.

### `atomic-gate.test.ts` (I9 / AC11)
Interleave: start `commitFetchResult` for a conflicting fetch; from a second
context, run `getWorkerTimeline` + `listOpenCases` "concurrently" (convex-test
serialises, so instead assert the post-commit invariant + a code check that the
insert and case-creation share one mutation and there is no `await ctx.runX`
between them that could yield). Assert M8 == 0 across the whole suite.

### `rate-limit-recorded.test.ts` (D-7 / AC12)
Mock Firecrawl: first call → 429 (no `Retry-After`), retry → 429. Assert one
snapshot `fetch_status:"rate_limited"`, `fetch_http_code:429`,
`disposition:"unconfirmed"`, no exception escaped. Advance scheduler one sweep →
second snapshot with `retry_of_snapshot_id` == first. M2 (snapshots / fetch
attempts) == 100%.

### `blocked-timeout-inject.test.ts` (failure-injection / AC9)
Parametrised: Firecrawl mock returns 403 body / 500 / hangs (rejected timeout) /
throws. Each ⇒ exactly one snapshot with the right `fetch_status`,
`disposition:"unconfirmed"`, **no crash**, `runForLicense` resolves. A prior 🟢
license stays 🟢 (it has a confirmed pointer + not yet stale) — the failed fetch
does not downgrade it, but also never confirms.

### `demo-determinism.test.ts` (AC6 / AC13)
`seedDemo` + `runDemoSequence` twice in one test. Assert: identical count of
`snapshots`, `mismatch_cases`, `alerts`; identical ordered list of
`disposition`; identical case `type`s and `detail.detected_types`; Firecrawl spy
== 0, OpenAI spy == 0; AgentMail spy > 0 (real sends kept). Every snapshot
`source_mode:"fixture"`.

### `agentmail-failure.test.ts`
AgentMail mock → 503. Assert `alerts.send_status:"failed"`,
`alerts.send_error` populated, case still `open` and visible in `listOpenCases`,
`audit_events` has an `alert` row with a failure outcome. A manual
`sendAlert` re-trigger after the mock recovers ⇒ send succeeds, still one
`alerts` row (updated in place, not duplicated).

### `metrics.test.ts`
After running the full fixture battery: M2 == 100%, M3 == 0 (no adversarial
fixture confirmed), M4 == 0 (no unchanged fixture opened a case), M5 == 100%,
M6 == 100%, M7 == 0, M8 == 0. M1 reported (non-asserted magnitude, must be
finite and > 0).

---

## 5. Frontend tests

- `badge-parity.test.ts` — `src/lib/badge.deriveBadge` == `convex/badge.deriveBadge`
  for every fixture end-state (shared truth table).
- `no-dangerous-html.test.ts` — static grep: no `dangerouslySetInnerHTML` in `src/`.
- `snapshot-pill-requires-id.test.ts` — TS type test: `<StatusPill>` without
  `confirmedSnapshotId` fails to compile.
- Component smoke (React Testing Library): RosterTable renders a badge per
  license; CompareView highlights conflicting rows for the flip pair;
  DemoPanel shows the DEMO DATA banner when `demo_mode` is true.

---

## 6. Pre-submission gate (all must be green)

```
npm run test          # unit + fixture + integration + frontend
npm run test:static   # grep checks: insert-only, no-auto-resolve, no secrets, no dangerous html
npm run build         # vite build; then no-secret-in-client scan over dist/
npx convex deploy --dry-run
```

Every AC1–AC16 in `PRD.md` maps to at least one test above:

| AC | Covered by |
|---|---|
| AC1 | `loop-happy-path.test.ts` (live-mode variant, mocked Firecrawl 200) |
| AC2 | `conflict-never-silent.test.ts` |
| AC3 | fixture `name_wrong_person` + `identity-binding.test.ts` |
| AC4 | fixture `privilege_violation` + `privilege-check.test.ts` |
| AC5 | `alert-once.test.ts` |
| AC6 | `demo-determinism.test.ts` |
| AC7 | `snapshots-insert-only.test.ts` + M7 |
| AC8 | `traceability.test.ts` + `snapshot-pill-requires-id.test.ts` |
| AC9 | `blocked-timeout-inject.test.ts` |
| AC10 | manual: deployed `convex.site` URL opens; `convex deploy` single-command |
| AC11 | `atomic-gate.test.ts` + M8 |
| AC12 | `rate-limit-recorded.test.ts` + M2 |
| AC13 | `demo-no-live-calls.test.ts` / `demo-determinism.test.ts` |
| AC14 | `snapshots-insert-only.test.ts` (re-hash) + storage-URL open |
| AC15 | `case-type-priority.test.ts` + fixture `multi_conflict` |
| AC16 | `badge-precedence.test.ts` |

# CONTRACT.md — Attestor's frozen product contract

Locked at TASKS Step 1. Every downstream failure mode (F1–F5) depends on these
shapes being stable; ambiguity here becomes a silent-mutation bug later.

Source of truth: `convex/contract.ts` (Convex validators + inferred TS types).
`src/lib/types.ts` mirrors the **types only** — the frontend never re-validates.
Badge derivation: `convex/badge.ts` (pure), duplicated in `src/lib/badge.ts`.

---

## 1. The three badge states (derived, never a stored mutable field)

`deriveBadge(license, latestSnapshot, now, stalenessThresholdMs?)` evaluates a
**fixed precedence — first match wins, later clauses not evaluated** (D-10b, AC16):

| Order | Badge | Emoji | Condition |
|---|---|---|---|
| 1 | `needs_review` | 🟠 | `open_case_id != null` — **checked first; dominates staleness** |
| 2 | `unconfirmed` | ⚪ | `open_case_id == null` **and** ( `current_confirmed_snapshot_id == null` **or** (latest `fetch_status != "ok"` **and** no pointer) **or** `now - last_fetch_at >= staleness_threshold` ) |
| 3 | `verified` | 🟢 | `open_case_id == null` **and** pointer set **and** `now - last_fetch_at < staleness_threshold` |

- Staleness downgrades to ⚪ **only when there is no open case**. An open case is
  always 🟠 even if the license has also gone stale (the AC16 precedence row).
- `staleness_threshold`: 7 days live (`STALENESS_THRESHOLD_MS_DEFAULT`), 20 s in
  demo mode via `settings.staleness_threshold_ms` (D-5).
- `time_since_last_confirmation` is measured from `licenses.last_fetch_at`; the
  pointer only advances on an agreeing fetch, which writes `last_fetch_at` in the
  same commit (PRD §4).

Truth table + all four experience end-states + the open-case-plus-stale
precedence row: `tests/unit/badge-precedence.test.ts` (29 cases, green).

---

## 2. The snapshot shape (append-only — I5)

Written **only** by `db.insert("snapshots", …)` inside `commitFetchResult`; never
patched or replaced anywhere (M7 = 0). "Current status" is the pointer
`licenses.current_confirmed_snapshot_id`, not a field on any row.

| Group | Fields |
|---|---|
| identity | `license_id`, `fetched_at`, `source_url`, `source_mode` (`live` \| `fixture`) |
| raw payload (D-8) | `raw_payload_storage_id` (`v.id("_storage")` \| null), `raw_payload_excerpt` (≤4096 chars, inline), `raw_payload_sha256` (over the **full** payload), `raw_payload_bytes` |
| fetch outcome | `fetch_status` (7: `ok` \| `http_error` \| `blocked` \| `rate_limited` \| `timeout` \| `extraction_failed` \| `extraction_refused`), `fetch_http_code` (number \| null), `retry_of_snapshot_id` (`v.id("snapshots")` \| null) |
| extraction | `extracted_fields` (`ExtractedFields` \| null), `extractor_model` (string \| null), `extractor_raw_response` (string \| null) |
| reasoning (all run **inside** `commitFetchResult`) | `diff_result` (`DiffResult` \| null), `identity_result` (`IdentityResult` \| null), `privilege_result` (`PrivilegeResult` \| null) |
| gate | `disposition` (`confirmed` \| `conflict` \| `unconfirmed`) |

### `ExtractedFields` (strict-JSON target for OpenAI — the only LLM output)

`licensee_name`, `license_number`, `status_word` (verbatim), `status_normalized`
(closed enum: `active` \| `inactive` \| `expired` \| `pending` \| `revoked` \|
`suspended` \| `unknown`), `issue_date` (ISO \| null), `expire_date` (ISO \|
null), `privilege_type` (`single_state` \| `multistate` \| `unknown`),
`primary_state_of_residence` (string \| null), `extraction_confidence` (`high` \|
`medium` \| `low` — `low` ⇒ GATE cannot confirm, I6).

**No SSN / no DOB slot — ever** (SECURITY §1). If a board page contains a DOB, the
schema has nowhere to put it and it is dropped.

### `DiffResult` · `IdentityResult` · `PrivilegeResult`

| Shape | Fields |
|---|---|
| `DiffResult` | `agrees` (bool), `compared_snapshot_id` (prior *confirmed* \| null), `conflicts[]` of `{ field, prior, current }` |
| `IdentityResult` | `match_confidence` (`exact` \| `high` \| `name_change_suspected` \| `mismatch`), `number_matches` (bool), `registered_name_similarity` (0–1), `mismatch_reason` (`none` \| `legal_name_change` \| `wrong_person` \| `number_mismatch`) |
| `PrivilegeResult` | `valid` (bool), `reason` (`single_state_matches_assignment` \| `multistate_resident_compact` \| `multistate_but_assignment_state_mismatch` \| `multistate_resident_not_compact` \| `privilege_unknown`), `assignment_state` (echoed), `compact_member` (bool) |

---

## 3. The mismatch-case shape (resolution is human-only — I4)

| Field | Notes |
|---|---|
| `license_id`, `worker_id` | worker id denormalized for the dashboard |
| `type` | **single** headline value — `identity` \| `status` \| `privilege`, chosen by the fixed priority **`identity` > `privilege` > `status`** (D-10a). A wrong-person match must never be masked by a lower-severity flag. |
| `snapshot_a_id` | prior confirmed (or the first snapshot for a privilege/identity-only case) |
| `snapshot_b_id` | the snapshot that triggered the case |
| `reason` | rendered explanation, e.g. `"T2 status 'Expired' ≠ T1 confirmed 'Active'"` |
| `detail` | `CaseDetail`: `conflicts[]`, **`detected_types[]`** (EVERY kind found — the audit trail loses nothing), optional `identity_result`, optional `privilege_result` |
| `resolution_state` | `open` \| `confirmed` \| `dismissed` |
| `resolved_by` / `resolved_at` / `resolution_note` | all `null` while open; `resolveCase` requires non-empty `actor` + `note` |

`create_mismatch_case` is idempotent per `(license_id, open case)` — a re-fetch on
a still-open case returns `created:false` and sends no new alert (I8).

---

## 4. The alert shape (exactly-once — I8)

`mismatch_case_id` (**unique** via `alerts.by_case` + check-before-insert),
`sent_at`, `agentmail_message_id` (\| null), `agentmail_thread_id` (\| null),
`to`, `send_status` (`sent` \| `failed`), `send_error` (\| null).

## 5. The audit-event shape (append-only)

`at`, `license_id` (\| null), `snapshot_id` (\| null), `case_id` (\| null),
`stage` (`fetch` \| `extract` \| `diff` \| `gate` \| `alert` \| `resolve`),
`outcome` (string, e.g. `"ok"`, `"conflict:status"`, `"alert_sent"`),
`message` (human line), `actor` (`system` \| coordinator id).

---

## 6. Review checklist — the four experiences map onto the contract

- [x] **A — Clean success.** First fetch, no prior confirmed snapshot ⇒
  `diff_result = null`, identity + privilege pass ⇒ `disposition:"confirmed"` ⇒
  `current_confirmed_snapshot_id` points at the new row ⇒ `deriveBadge` returns
  `verified` (pointer set, fresh, no case). Snapshot carries the raw board HTML
  (`raw_payload_storage_id` + `raw_payload_excerpt` + `raw_payload_sha256`).
  *Covered:* `badge-precedence` experience-A row; snapshot shape §2.
- [x] **B — Live mismatch caught.** Re-fetch extracts `status_normalized:"expired"`
  vs confirmed `"active"` ⇒ `diff_result.agrees:false`,
  `conflicts:[{field:"status_normalized",prior:"active",current:"expired"}]` ⇒
  GATE writes `disposition:"conflict"`, `create_mismatch_case(type:"status")`,
  sets `open_case_id`, `current_confirmed_snapshot_id` **unchanged** ⇒
  `deriveBadge` returns `needs_review` *purely* from `open_case_id`. One alert.
  *Covered:* `badge-precedence` experience-B row + the pointer-unchanged assertion
  is enforced in Step 7; case shape §3; alert shape §4.
- [x] **C — Operator replay / compare.** Both snapshots persist (T1 `confirmed`,
  T2 `conflict`); `mismatch_cases.detail` holds `conflicts` + `detected_types`
  for the side-by-side compare; case still `open` ⇒ badge stays `needs_review`.
  *Covered:* `badge-precedence` experience-C row; `CaseDetail` in §3.
- [x] **D — Six-week audit trail.** Sequence `active, active, active, suspended`:
  the first three ⇒ `confirmed` (pointer advances, `last_fetch_at` fresh each
  time), the fourth ⇒ `conflict type:"status"` + case + alert ⇒ `needs_review`.
  A hire-time-only check would still read `active`. Every loop stage left an
  `audit_events` row.
  *Covered:* `badge-precedence` experience-D row; audit shape §5; snapshot
  append-only §2.

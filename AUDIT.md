# AUDIT.md — Attestor planning-artifact cross-check

Date: 2026-09-10 · Scope: `PRD.md`, `ARCHITECTURE.md`, `SECURITY.md`,
`TESTING.md`, `DEMO.md`, `DECISIONS.md`, `.env.example`, `TASKS.md`.
This is a consistency/readiness gate. Fixes applied in this pass are logged as
**D-11** in `DECISIONS.md`; nothing else was rewritten.

**Bottom line: READY TO BUILD.** Checks 1, 2, 3, 5, 6, 7 pass (four small fixes
applied, minor non-blocking flags noted). Check 4's two items are resolved as
**build-day verification steps, not closed unknowns**. Neither the OpenAI
`GET /v1/models` call nor a real Firecrawl `/v2/scrape` could be run in this
session (no API keys in this environment); both are handled by deferral:

- **D-3 — LOCKED (documentation-verified).** `gpt-4.1-mini` + strict `json_schema`
  Structured Outputs confirmed against official docs. The live `GET /v1/models`
  runs via `bootModelCheck()` on first deploy, with `gpt-4o-2024-08-06` fallback.
- **D-4 — LOCKED (reviewer-approved design decision).** Live-mode target =
  **California DCA — Board of Registered Nursing** (`search.dca.ca.gov`,
  `BOARD_HOST_ALLOWLIST=search.dca.ca.gov`). The real `POST /v2/scrape`
  verification is a **build-day step at Step 4** with live Firecrawl
  credentials; the guarded fixture fallback (D-9 / DEMO Beat 3) covers a Step-4
  failure. Not blocking the build.
- **B-2 (non-blocking).** OpenAI `gpt-4.1-mini` price shows $0.40/$1.60 across the
  model page + three aggregators, but one pricing-page read returned $0.80/$3.20
  — a build-day checklist item to confirm with console access; does not affect
  model choice.

---

## Check 1 — Cross-document consistency

| File | Item checked | Result | Notes |
|---|---|---|---|
| ARCHITECTURE.md | 7 tables vs PRD §4 | **FIXED** | PRD §4 enumerated 7 tables; Step 10 + ARCHITECTURE + TASKS all reference a `settings` table and `licenses.fixture_sequence` / `fixture_cursor`. Added `settings` block + the two fields to PRD §4; count 7→8 in PRD Step 3, ARCHITECTURE §5, TASKS Step 3. (D-11a) |
| ARCHITECTURE.md | table/field/signature names vs PRD §4/§5 | **PASS** | `snapshots` fields (`raw_payload_storage_id`, `raw_payload_excerpt`, `raw_payload_sha256`, `raw_payload_bytes`, `fetch_status` ×7, `fetch_http_code`, `retry_of_snapshot_id`, `disposition`), `licenses.current_confirmed_snapshot_id` / `open_case_id`, `mismatch_cases.detail.detected_types`, `alerts.by_case`, indexes — all match. Request-path calls (`commitFetchResult`, `create_mismatch_case(ctx,…)`, `resolveCase`, `runSweep`, `runForLicense`, `sendAlert`) match PRD §5. |
| SECURITY.md | function / table / var names vs PRD | **PASS** | `firecrawl.ts` / `openai.ts` / `agentmail.ts`, `addWorker` / `addLicense`, `resolveCase` (actor+note), `board_profile_url`, `checkPromptInjection`, `alerts.by_case`, `created_by` / `resolved_by` — all consistent. |
| TESTING.md | test targets vs PRD schema/signatures | **PASS** | `deriveBadge(license, latestSnapshot, now)`, `pickHeadlineType`, `diff_snapshot`, `bind_identity`, `check_privilege`, `commitFetchResult`, `retry_of_snapshot_id`, `detail.detected_types`, `extractor_model:"fixture-golden"` — all match PRD §4/§5. |
| TASKS.md | file/field/var names vs PRD + `.env.example` | **FIXED** | (i) `SWEEP_INTERVAL` → `SWEEP_INTERVAL_MINUTES` (matches `.env.example`). (ii) table count 7→8. (D-11b) |
| PRD.md Step 8 | AgentMail var names vs `.env.example` / SECURITY / TASKS | **FIXED** | `INBOX_ID` → `AGENTMAIL_INBOX_ID`, `COORDINATOR_EMAIL` → `ALERT_CC`. (D-11b) |
| PRD.md §5 | `send_alert` (brief snake_case) vs `sendAlert` (impl) | **PASS (note)** | Signature block keeps the brief's `send_alert(case_id)`; every implementation reference uses `sendAlert`. Params identical; cosmetic only. Not changed. |

---

## Check 2 — Invariant / decision coverage (test + code-anchor)

| Ref | Test in TESTING.md | Code-anchor in ARCHITECTURE.md | Result |
|---|---|---|---|
| I1 traceability | `traceability.test.ts` | §6 row + §9 | **PASS** |
| I2 identity binding | `identity-binding.test.ts` | §6 row + §5 `identity.ts` | **PASS** |
| I3 privilege binding | `privilege-check.test.ts` | §6 row + §5 `privilege.ts` | **PASS** |
| I4 human-only resolve | `no-auto-resolve.test.ts` | §6 row + §4 resolve path | **PASS** |
| I5 append-only | `snapshots-insert-only.test.ts` | §6 row + §5 `commit.ts` | **PASS** |
| I6 fail closed | `fail-closed.test.ts` | §6 row + §5 `gate.ts` + §8 matrix | **PASS** |
| I7 no live dep on stage | `demo-no-live-calls.test.ts` | §6 row + §5 demo branch | **PASS** |
| I8 alert exactly once | `alert-once.test.ts` | §6 row + §5 `alert.recordAlert` | **PASS** |
| I9 atomic snapshot+gate | `atomic-gate.test.ts` | §6 row + §4 step 3 + §7 | **PASS** |
| D-1 cron fan-out | *implicit only* — `loop-happy-path.test.ts` / `demo-determinism.test.ts` (one `runForLicense` per license) | §2 (static cron), §5 `sweep.ts` | **PASS (flag)** — no dedicated named test; structural decision, implicitly exercised. Not adding a test per audit rules. Suggested if wanted: `fanout-one-per-license.test.ts`. |
| D-2 own OpenAI call | *implicit only* — per-fixture golden tests treat extraction as a separate mocked stage | §3 plane table, §5 (`firecrawl.ts` rawHtml-only, `openai.ts` separate) | **PASS (flag)** — no dedicated assertion that Firecrawl `json` format is unused. Suggested: static assert `firecrawl.ts` sends only `formats:["rawHtml"]`. |
| D-3 model pin + boot check | `model-check.test.ts` | §5 module map `bootModelCheck` | **PASS** |
| D-4 live board target | none (build-day pick, not unit-testable) | §3 fetch plane + SECURITY host allowlist | **PASS (expected)** — not a testable item; see Check 4. |
| D-5 staleness threshold | `badge-precedence.test.ts` (staleness rows) | §10 + `badge.ts` anchor | **PASS** |
| D-6 atomic mutation | `atomic-gate.test.ts` | §4/§6/§7 (explicit "D-6") | **PASS** |
| D-7 rate-limit recorded | `rate-limit-recorded.test.ts` | §5/§8 (explicit "D-7") | **PASS** |
| D-8 file storage | `snapshots-insert-only.test.ts` (re-hash) | §3/§5 (explicit "D-8") | **PASS** |
| D-9 demo fully mocked | `demo-no-live-calls.test.ts` / `demo-determinism.test.ts` | §3/§5 (explicit "D-9") | **PASS** |
| D-10a case-type priority | `case-type-priority.test.ts` | §6 row `D-10a` + §4 step e | **PASS** |
| D-10b badge precedence | `badge-precedence.test.ts` | §6 row `D-10b` + §5 badge | **PASS** |

**Flags (not fixed, per instruction "flag, don't silently add"):** D-1 and D-2
have no dedicated named test — both are structural design decisions with implicit
coverage. Also: ARCHITECTURE.md §6's anchor table enumerates I1–I9 + D-10a/b;
D-1–D-9 appear inline throughout §2–§8 but not all as an explicit `D-N` token in
that one table. Mechanism coverage is complete.

---

## Check 3 — Acceptance-criteria traceability (AC1–AC16)

| AC | TASKS.md item(s) with observable DoD | TESTING.md test | Result |
|---|---|---|---|
| AC1 | Step 3 DoD + Step 4 DoD (stored timestamped snapshot) | `loop-happy-path.test.ts` (mocked Firecrawl 200) | **PASS** |
| AC2 | Step 7 DoD (`current_confirmed_snapshot_id` unchanged; 🟠 only via `open_case_id`) | `conflict-never-silent.test.ts` | **PASS** |
| AC3 | Step 6 DoD (identity-typed signal) | fixture `name_wrong_person` + `identity-binding.test.ts` | **PASS** |
| AC4 | Step 6 DoD (privilege-typed signal) | fixture `privilege_violation` + `privilege-check.test.ts` | **PASS** |
| AC5 | Step 8 DoD (one message, both snapshots) | `alert-once.test.ts` | **PASS** |
| AC6 | Step 10 DoD (twice, identical) | `demo-determinism.test.ts` | **PASS** |
| AC7 | Step 7 DoD (**now cites AC7/I5/M7**) + Final gate (M7=0) | `snapshots-insert-only.test.ts` | **FIXED** — was covered by test + final gate but not cited in a step DoD; added to Step 7. (D-11c) |
| AC8 | Step 9 DoD (every status shows `snapshot_id`) | `traceability.test.ts` + `snapshot-pill-requires-id.test.ts` | **PASS** |
| AC9 | Step 4 DoD (bad URL ⇒ stored `unconfirmed`) | `blocked-timeout-inject.test.ts` | **PASS** |
| AC10 | Step 0 DoD + Final gate (deployed `convex.site` URL) | manual (TESTING §6) | **PASS** |
| AC11 | Step 7 DoD (one transaction, M8=0) | `atomic-gate.test.ts` | **PASS** |
| AC12 | Step 4 DoD (429 ⇒ `rate_limited`, retried, linked) | `rate-limit-recorded.test.ts` | **PASS** |
| AC13 | Step 10 DoD (zero Firecrawl/OpenAI calls; real AgentMail) | `demo-no-live-calls.test.ts` | **PASS** |
| AC14 | Step 4 DoD (full HTML from storage; sha256 re-hash) | `snapshots-insert-only.test.ts` (re-hash) | **PASS** |
| AC15 | Step 7 DoD (one case, highest `type`, all `detected_types`) | `case-type-priority.test.ts` + fixture `multi_conflict` | **PASS** |
| AC16 | Step 1 DoD (open case + stale ⇒ 🟠) | `badge-precedence.test.ts` | **PASS** |

No AC is without both a task and a test.

---

## Check 4 — Build-day items — see narrative below

| Item | Result |
|---|---|
| D-3 OpenAI model verification | **LOCKED (doc-verified)** — live `GET /v1/models` not runnable here (no key); official docs confirm `gpt-4.1-mini` + strict `json_schema` Structured Outputs. Live call deferred to `bootModelCheck()` on first deploy. |
| D-4 real board target | **LOCKED (reviewer-approved design decision)** — target = California DCA Board of Registered Nursing (`search.dca.ca.gov`). Real `/v2/scrape` verification deferred to build day, Step 4; guarded fixture fallback covers failure. Not blocking. |
| B-2 OpenAI pricing discrepancy | **Non-blocking build-day checklist item** — confirm $0.40/$1.60 vs $0.80/$3.20 with console access. |

*(Full narrative in the "Check 4 — narrative" section below.)*

---

## Check 5 — Env-var completeness

| Direction | Result | Notes |
|---|---|---|
| Referenced somewhere → present in `.env.example` | **PASS** | Every var named in ARCHITECTURE / SECURITY / TASKS / PRD exists in `.env.example`: `CONVEX_DEPLOYMENT`, `VITE_CONVEX_URL`, `CONVEX_DEPLOY_KEY`, `FIRECRAWL_API_KEY`, `BOARD_HOST_ALLOWLIST`, `OPENAI_API_KEY`, `OPENAI_MODEL`, `OPENAI_MODEL_FALLBACK`, `OPENAI_MAX_OUTPUT_TOKENS`, `AGENTMAIL_API_KEY`, `AGENTMAIL_INBOX_ID`, `ALERT_TO`, `ALERT_CC`, `SWEEP_INTERVAL_MINUTES`, `FETCH_STAGGER_MS`, `STALENESS_THRESHOLD_MS`. |
| Name drift | **FIXED** | `SWEEP_INTERVAL` (TASKS) → `SWEEP_INTERVAL_MINUTES`; `INBOX_ID`/`COORDINATOR_EMAIL` (PRD Step 8) → `AGENTMAIL_INBOX_ID`/`ALERT_CC`. (D-11b) |
| In `.env.example` → referenced elsewhere | **PASS (note)** | `FIRECRAWL_BASE_URL`, `AGENTMAIL_BASE_URL`, `DEMO_MODE_DEFAULT` are not referenced *by name* in the other artifacts. They are legitimate knobs (self-host base-URL override; initial `settings.demo_mode` value on first deploy). Left in place; noted in D-11d. |

---

## Check 6 — Demo-script determinism sanity

| Beat | Touches a live API? | Consistent with D-9? | Result |
|---|---|---|---|
| 1 frame | no | — | **PASS** |
| 2 add worker | Convex mutation only | — | **PASS** |
| 3 one real fetch | **Firecrawl + OpenAI (live)** — the single designated live proof, guarded by pre-seeded fixture Nurse A | yes — this is the explicit exception | **PASS** |
| 4 toggle demo mode | Convex mutation only; DEMO DATA banner appears | yes | **PASS** |
| 5 mismatch caught | fixture flip on compressed schedule | yes — no Firecrawl/OpenAI | **PASS** |
| 6 append-only proof | reads stored snapshots | yes | **PASS** |
| 7 compare view | reads stored snapshots | yes | **PASS** |
| 8 AgentMail inbox | **real AgentMail send** | yes — D-9 explicitly keeps AgentMail real in demo mode; it is *not* Firecrawl/OpenAI | **PASS** |
| 9 identity flag | fixture (Nurse B) | yes | **PASS** |
| 10 privilege flag | fixture (Nurse C) | yes | **PASS** |
| 11 resolve | `resolveCase` mutation | yes | **PASS** |
| 12 six-week close | fixture (Nurse D) timeline | yes | **PASS** |

**Result: PASS.** Beat 3 is the only beat touching real Firecrawl/OpenAI. Beat 8
touches real AgentMail by design (D-9). Pre-roll checklist correctly starts with
`demo_mode` OFF for Beat 3, then Beat 4 turns it on — consistent with
`.env.example` `DEMO_MODE_DEFAULT=true` for the always-on judged URL.

---

## Check 7 — Priority-rule sanity (D-10a / D-10b)

| Rule | In PRD.md | In TESTING.md | Result |
|---|---|---|---|
| Case-type priority `identity` > `privilege` > `status` | §4 `mismatch_cases.type` note; §5 `create_mismatch_case` comment block; Step 7 "Case-`type` priority (D-10)"; §9 rule 10; §14 D-10 | §1 matrix row `D-10a` → `case-type-priority.test.ts`: `pickHeadlineType(["status","privilege"])→"privilege"`, `(["status","privilege","identity"])→"identity"`; §2 `gate.ts` section | **PASS** |
| Badge precedence: open case beats staleness (🟠 checked first) | §4 badge block (numbered 1/2/3, "Checked first", "`open_case_id` dominates staleness") + ordered table; Step 1 truth-table requirement (open case + stale ⇒ 🟠); §14 D-10 | §1 matrix row `D-10b` → `badge-precedence.test.ts` incl. "open case + stale ⇒ 🟠 (not ⚪)"; §2 `deriveBadge` section ("especially open_case_id set + stale ⇒ needs_review") | **PASS** |

Both late-addition rules landed correctly in every artifact that should carry
them. No stale pre-fix copy found.

---

## Check 4 — narrative

### D-3 — OpenAI model verification

**Could not run the live call.** There is no `OPENAI_API_KEY` in this
environment (only `.env.example` placeholders), and `GET
https://api.openai.com/v1/models` requires Bearer auth. Verified against
**official documentation** instead
(`https://developers.openai.com/api/docs/models/gpt-4.1-mini`, fetched
2026-09-10):

- **`gpt-4.1-mini` exists** as an API model id.
- **Structured Outputs: supported.** The model page lists `structured_outputs`
  among its features; corroborated by Artificial Analysis, OpenRouter, and
  Bifrost, which all describe `json_schema` structured output via
  `response_format` for this model. `strict: true` json_schema is the documented
  mechanism.
- **Context window** 1,047,576 tokens · **max output** 32,768 · **knowledge
  cutoff** 2024-06-01.
- **Price (standard):** **$0.40 / 1M input tokens, $1.60 / 1M output tokens**
  (model page + three independent price aggregators agree); cached input $0.10 /
  1M.
  - *Caveat:* one read of `developers.openai.com/api/docs/pricing` returned
    **$0.80 / $3.20** for `gpt-4.1-mini` — inconsistent with every other source,
    likely a priority-tier row or a summariser artefact. It does not change the
    model selection; eyeball the pricing page once with account access on build
    day.
- **Fallback `gpt-4o-2024-08-06`:** exists; Structured Outputs supported since
  that snapshot; ≈ $3.75 / 1M in, $15.00 / 1M out.

**Outcome:** D-3 moved from *CONFIRM ON BUILD DAY* to **LOCKED** on model id +
Structured Outputs capability (documentation-verified). `bootModelCheck()`
(`GET /v1/models` on first run, fallback to `gpt-4o-2024-08-06`) stays as the
runtime guard and is where the live models call finally executes. `.env.example`
already carries `OPENAI_MODEL=gpt-4.1-mini` and
`OPENAI_MODEL_FALLBACK=gpt-4o-2024-08-06`; no change needed. Logged as D-11(e).

### D-4 — real board target

**Could not run the live call.** There is no `FIRECRAWL_API_KEY` in this
environment, so a real `POST https://api.firecrawl.dev/v2/scrape` could not be
executed. Unauthenticated probes of candidate boards (a weaker proxy — it cannot
exercise `proxy:"auto"` or `waitFor`):

| Board | URL | Result of a plain unauthenticated GET |
|---|---|---|
| **California DCA license search** | `https://search.dca.ca.gov/` | Server-rendered search **form**, **no login**, includes **Board of Registered Nursing**; page text documents the status vocabulary (current / expired / suspended / revoked / disciplinary). **Results are rendered client-side (JS)** — a plain GET of `/results?...` returns the shell, so Firecrawl would need `proxy:"auto"` + `waitFor` (which is what those options are for). |
| NC Board of Nursing verification | `https://portal.ncbon.com/verification/search.aspx` | **HTTP 403 Forbidden** to a non-browser client (bot protection). |
| Illinois IDFPR license lookup | `https://online-dfpr.micropact.com/lookup/licenselookup.aspx` | **HTTP 405 Method Not Allowed** to a plain GET. |
| Washington DOH provider credential search | `https://fortress.wa.gov/doh/providercredentialsearch/` | DNS resolution timed out from this environment. |
| NY Office of the Professions verification | `https://www.op.nysed.gov/verification-search` | 301 redirect to `eservices.nysed.gov/professions/verification-search` (redirect chain; not chased). |

None can be confirmed as returning usable server-rendered result HTML without
actually running Firecrawl. **This is the expected situation** and is precisely
why the brief mandates fixture-driven demo mode (D-9) — the judged demo does not
depend on any of this.

**Recommended primary candidate:** **California DCA — Board of Registered
Nursing** (`search.dca.ca.gov`). Public, no login, nursing board present,
status vocabulary documented. To be confirmed on build day with **one real
Firecrawl `/v2/scrape` (`formats:["rawHtml"]`, `proxy:"auto"`, `waitFor:2500`)**
against a real results or licensee-detail URL, checking the response is rendered
license data and not a block page / CAPTCHA / empty shell. If it fails, try one
alternate (NC BON or a MyLicense-platform state such as NJ) before falling back.

**Fallback (already in the plan):** DEMO.md Beat 3 is guarded — the live pass is
optional, a pre-seeded fixture Nurse A carries the beat, and `source_mode:"live"`
snapshots from any successful dev run are left in the deployment as evidence.

**Outcome:** **B-1 cleared by the reviewer (2026-09-10).** D-4 is **LOCKED** to
**California DCA — Board of Registered Nursing** (`search.dca.ca.gov`,
`BOARD_HOST_ALLOWLIST=search.dca.ca.gov`) as a design decision. The real
`POST /v2/scrape` verification is deferred to **build day, Step 4**, run by the
reviewer with their own Firecrawl key in the implementation session, and its
outcome recorded in the DECISIONS.md *Running verification log* row
"D-4 live scrape — CA DCA BRN". A Step-4 failure is covered by the already-designed
guarded fixture fallback (D-9 / DEMO Beat 3), trying one alternate board first.
Logged as D-11(f) and in D-4's entry.

---

## Fixes applied in this pass (all logged as D-11 in DECISIONS.md)

1. **PRD §4** — added the `settings` table (`demo_mode`, `staleness_threshold_ms`,
   `updated_at`) and `licenses.fixture_sequence` / `licenses.fixture_cursor`;
   table count 7 → 8 in PRD Step 3, ARCHITECTURE §5, TASKS Step 3.
2. **PRD Step 8** — `INBOX_ID` → `AGENTMAIL_INBOX_ID`, `COORDINATOR_EMAIL` →
   `ALERT_CC`.
3. **TASKS Step 3** — `SWEEP_INTERVAL` → `SWEEP_INTERVAL_MINUTES`.
4. **TASKS Step 7** — cites AC7 / I5 / M7 and adds `snapshots-insert-only.test.ts`
   to its test list (coverage already existed; traceability closed).
5. **DECISIONS.md** — new **D-11**; D-3 header → LOCKED (doc-verified);
   D-4 header → LOCKED (CA DCA BRN; live scrape verified build-day at Step 4);
   `.env.example` `BOARD_HOST_ALLOWLIST` → `search.dca.ca.gov`; PRD §14 D-4
   updated; new rows added to the *Running verification log*.

No implementation code was written.

---

## Build-day verification steps (carried, not blocking)

These are **open verification steps**, not unresolved unknowns. Each has a
locked decision + a designed fallback; each gets a real check with live
credentials in the implementation session and its outcome logged in the
DECISIONS.md *Running verification log*.

- **BD-1 (D-4) — CA DCA BRN live scrape.** At Step 4, run one real Firecrawl
  `POST /v2/scrape` (`formats:["rawHtml"]`, `proxy:"auto"`, `waitFor:2500`)
  against a `search.dca.ca.gov` results/detail URL. Confirm it returns real
  license fields, not a block page / CAPTCHA / empty shell; note `statusCode`
  and whether `proxy:"auto"` was needed. On failure: try one alternate (NC BON,
  or a MyLicense-platform state), then fall back to fixture-only for DEMO Beat 3
  (already designed). Reviewer runs this with their own key.
- **BD-2 (D-3) — OpenAI model + price.** `bootModelCheck()` runs `GET /v1/models`
  on first deploy; if `gpt-4.1-mini` is absent it falls back to
  `gpt-4o-2024-08-06`. Separately, confirm the `gpt-4.1-mini` price
  ($0.40/$1.60 expected; one source showed $0.80/$3.20) against the OpenAI
  console before any cost claims in the submission. Non-blocking.

---

## Statement

**READY TO BUILD.** Checks 1, 2, 3, 5, 6, 7 pass (four small fixes applied, minor
non-blocking flags noted). Check 4 is resolved: D-3 is LOCKED by documentation
(live `GET /v1/models` deferred to `bootModelCheck()` on first deploy); D-4 is
LOCKED to California DCA — Board of Registered Nursing (`search.dca.ca.gov`),
reviewer-approved, with the real `/v2/scrape` verification carried as a build-day
step (BD-1) at Step 4 and a designed fixture fallback. B-2 is carried as a
non-blocking build-day price check (BD-2).

No blocking items remain. Implementation may begin at TASKS.md Step 0, with BD-1
and BD-2 to be executed and logged during the build (Step 4 and first deploy
respectively). No implementation code was written in this session.

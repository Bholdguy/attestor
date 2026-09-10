# DECISIONS.md — Attestor

Every place a sponsor capability did not work as the brief assumed, or a design
ambiguity was closed, and what we did instead. Numbered `D-N` to match `PRD.md`
§14. Add new entries at the bottom; never renumber.

Status legend: **LOCKED** (decided, build to it) · **CONFIRM ON BUILD DAY**
(re-verify against live docs/APIs, then lock).

---

## D-1 — Cron fan-out, not one cron per license — LOCKED

**Brief assumed:** "one scheduled function per watched license."

**Reality (Convex docs, 2026-09-10):** cron jobs must be **statically defined** in
`convex/crons.ts` at deploy time. Per-license dynamic cron registration is only
possible via the `@convex-dev/crons` component.

**Decision:** one static `crons.interval("sweep", { minutes: 5 }, …)` that reads
`watch_enabled` licenses and fans out one **scheduled action**
(`ctx.scheduler.runAfter(0, internal.loop.runForLicense, {licenseId})`) per
license. Scheduled functions *can* be created dynamically; crons cannot. The
runtime-cron component was rejected as unnecessary weight for a demo.

**Touches:** `convex/crons.ts`, `convex/sweep.ts`, PRD §0, §2, §5.

---

## D-2 — Extraction is our own OpenAI call, not Firecrawl's `json` format — LOCKED

**Brief assumed:** OpenAI extracts strict-JSON fields (implied: a separate step).

**Reality:** Firecrawl `/v2/scrape` *does* offer `formats:[{type:"json",schema,
prompt}]` that would return extracted fields in the same call.

**Decision:** keep extraction in a **separate** OpenAI Structured Outputs call.
Folding FETCH and EXTRACT into one Firecrawl call would collapse two independently
observable, independently testable stages into one opaque step, and would make
the "OpenAI does real work" claim weaker. Firecrawl returns `rawHtml` only; our
`openai.ts` turns it into `ExtractedFields`.

**Touches:** `convex/firecrawl.ts` (rawHtml only), `convex/openai.ts`, PRD §0, §5.

---

## D-3 — OpenAI model id is pinned + verified at boot — LOCKED (doc-verified in cross-check audit; see D-11(e))

**Brief asked:** "current model names and pricing tier."

**Reality:** web sources during research returned **implausible / poisoned** model
names ("GPT-6 Astra", "gpt-5.6-sol", "Terra") — not trustworthy. Structured
Outputs is documented as supported on `gpt-4o-2024-08-06` and later, the
`gpt-4.1` family, and the `gpt-5` family.

**Decision:**
- `OPENAI_MODEL` env var, default **`gpt-4.1-mini`**.
- On first extraction call, `bootModelCheck()` hits `GET /v1/models` once; if the
  configured id is absent, log a warning and fall back to **`gpt-4o-2024-08-06`**
  (known-good for Structured Outputs).
- **Cross-check audit (2026-09-10):** verified against
  `developers.openai.com/api/docs/models/gpt-4.1-mini` — `gpt-4.1-mini` exists,
  lists `structured_outputs` support, 1,047,576 ctx / 32,768 out / 2024-06-01
  cutoff; standard price $0.40/1M in, $1.60/1M out (multi-source). Live
  `GET /v1/models` could not be run in the audit environment (no key) — it
  remains the first-run `bootModelCheck()` guard. One pricing-page read showed a
  conflicting $0.80/$3.20; eyeball once with account access, does not change the
  choice. Full detail in **D-11(e)**.

**Touches:** `convex/openai.ts`, `.env.example`, PRD §0, §5, TESTING `model-check.test.ts`.

---

## D-4 — Live board target + fixture fallback — LOCKED (target chosen; live scrape verified on build day)

**Brief assumed:** Firecrawl reliably reaches a state board page.

**Risk:** many boards are JS-heavy, hard-blocked, or rate-limited; a live fetch
may not be reliable within the hackathon timeline.

**Decision (LOCKED, reviewer-approved 2026-09-10):**
- **Live-mode target: California DCA — Board of Registered Nursing**, via
  `https://search.dca.ca.gov/`. Chosen because it is public, requires **no
  login**, exposes a Registered Nursing board, and documents the status
  vocabulary Attestor extracts (current / expired / suspended / revoked /
  disciplinary).
- `BOARD_HOST_ALLOWLIST=search.dca.ca.gov` in `fetch_board_page`.
- `proxy:"auto"` + `waitFor:2500` — the DCA **results/detail pages render
  client-side**, so Firecrawl must execute JS; this is exactly what those
  options are for.
- This is a **design decision, not yet a verified live scrape.** The unauthenticated
  cross-check audit could not exercise `proxy:"auto"` / `waitFor` (no key). The
  real `POST /v2/scrape` verification happens **on build day at Step 4**, with
  real Firecrawl credentials, and its outcome is recorded in the *Running
  verification log* table below (row: "D-4 live scrape — CA DCA BRN").
- **Fallback (unchanged, already designed):** if the live scrape fails at Step 4
  (block page / CAPTCHA / empty shell / rate cap), the documented disclosed path
  is the seeded fixtures (D-9); DEMO.md Beat 3 is guarded (pre-seeded fixture
  Nurse A carries the beat, one spoken sentence acknowledges the skip). Try one
  alternate first (NC BON, or a MyLicense-platform state such as NJ) before
  committing to fixture-only.

**Build-day verification (fill in at Step 4):** target URL actually scraped,
whether `data.rawHtml` contained real license fields, `data.metadata.statusCode`,
whether `proxy:"auto"` was needed, and the pass/fail call. If fail → which
alternate was tried and the final decision.

**Touches:** `convex/firecrawl.ts` (allowlist = `search.dca.ca.gov`), `.env.example`
(`BOARD_HOST_ALLOWLIST`), `fixtures/`, DEMO.md Beat 3, PRD §0, TASKS Step 4.

---

## D-5 — Staleness threshold value — LOCKED (values tunable)

**Decision:** `staleness_threshold` drives ⚪ Unconfirmed-on-age. Default **7
days** in live mode, **20 seconds** in demo mode (so the compressed timeline can
show a badge going stale). Single constant in `convex/badge.ts`, overridable via
`settings`.

**Touches:** `convex/badge.ts`, `convex/demo.ts`, PRD §4.

---

## D-6 — Snapshot write + status gate are ONE atomic mutation — LOCKED

**Gap (final-review):** the earlier draft split `persistSnapshot` (Step 4) and
`applyGate` (Step 7) into two mutations. Between them, a query could read a
`conflict` snapshot **before** its `mismatch_case` existed — a race that silently
reproduces the exact failure mode Attestor exists to catch (a bad status visible
as if trusted).

**Decision:** one Convex mutation, **`commitFetchResult`**. In a single
serializable transaction it: reads the prior confirmed snapshot, runs the pure
`diff` / `bind_identity` / `check_privilege`, `db.insert`s the snapshot with its
final `disposition`, and applies the gate — either flip
`current_confirmed_snapshot_id`, or `create_mismatch_case` + set `open_case_id` +
`ctx.scheduler.runAfter(0, sendAlert)` — plus all four `audit_events` rows. The
action `runForLicense` performs only the non-deterministic edges (Firecrawl,
OpenAI, `ctx.storage.store`) and hands plain values to the mutation. Invariant
**I9**; metric **M8** (must be 0); **AC11**.

**Touches:** `convex/commit.ts`, `convex/loop.ts`, PRD §0/§2/§5, Steps 3–7,
ARCHITECTURE §4/§6/§7, TESTING `atomic-gate.test.ts`.

---

## D-7 — A rate-limited fetch is a recorded state, never a silent skip — LOCKED

**Gap (final-review):** Firecrawl free tier = 20 req/min. A fan-out wider than the
cap would 429 some licenses; silently skipping + retrying next sweep with no row
reproduces the "board outage treated as no change" failure.

**Decision:**
1. `runSweep` **staggers** the fan-out —
   `ctx.scheduler.runAfter(i * spacingMs, …)` — sized to ≤ ~15 fetches/min in
   live mode.
2. New `fetch_status` value **`rate_limited`**. A 429, after **one** bounded
   in-action retry honouring `Retry-After` (~3 s cap), writes its own snapshot:
   `fetch_status:"rate_limited"`, `fetch_http_code:429`,
   `disposition:"unconfirmed"`.
3. The license is retried on the **next sweep** (its latest snapshot ≠ `ok`); the
   retry snapshot carries **`retry_of_snapshot_id`** pointing at the 429 row, so
   the timeline links the dots.

Metric **M2** (snapshots / fetch attempts, incl. 429) must be 100%; **AC12**;
correctness rule 6.

**Touches:** `convex/sweep.ts`, `convex/firecrawl.ts`, `convex/schema.ts`
(`fetch_status`, `fetch_http_code`, `retry_of_snapshot_id`), PRD §0/§2/§4/§5,
Steps 3–4, TESTING `rate-limit-recorded.test.ts`.

---

## D-8 — Raw HTML lives in Convex file storage, not inline on the snapshot — LOCKED

**Gap (final-review):** Convex caps a single document at ~1 MiB. Untrusted,
unbounded board `rawHtml` inline on every snapshot risks the ceiling and bloats
reactive query payloads under the compressed demo schedule.

**Decision (option a):** `runForLicense` writes the full verbatim payload to
Convex **file storage** (`ctx.storage.store`). The snapshot document keeps:
`raw_payload_storage_id: v.id("_storage")`, `raw_payload_excerpt` (≤ 4096 chars,
inline, for instant timeline rendering), `raw_payload_sha256` (over the **full**
payload), `raw_payload_bytes`. Fixtures take the same path so live and demo code
are byte-identical. An orphan blob (action stored it, mutation then threw) is
unreferenced, invisible to every query, and swept — no invariant broken.

**Rejected — option b** (inline with a size cap): the ceiling risk is real, file
storage is the documented mechanism, and the excerpt already covers fast
rendering.

Metric **M7** re-defined (re-hash each stored blob); **AC14**.

**Touches:** `convex/loop.ts`, `convex/commit.ts`, `convex/schema.ts` (snapshot
fields), `src/components/SnapshotDrawer.tsx`, PRD §0/§4/§5, Step 4, TESTING
`snapshots-insert-only.test.ts`.

---

## D-9 — Demo mode fully mocks BOTH Firecrawl and OpenAI — LOCKED

**Gap (final-review):** the earlier draft mocked only Firecrawl and still
round-tripped **live OpenAI** on every compressed tick — an avoidable flakiness
risk in a judged run, with no upside, since the point of demo mode is
determinism.

**Decision:** `demo_mode` bypasses **both** non-deterministic edges:
- `fetch_board_page(mode:"fixture")` returns the fixture HTML directly — **no
  Firecrawl call** (blob still written to file storage, so that path is
  identical).
- `extract_license_fields(mode:"fixture", fixture_id)` returns the fixture's
  pre-computed **golden `ExtractedFields`** with `extractor_model:"fixture-golden"`
  — **no OpenAI call**.

Everything downstream (`commitFetchResult`, diff, identity, privilege, gate,
`create_mismatch_case`, audit rows, every query) is the live code path.
**AgentMail sends stay real** in demo mode — deterministic, safe, and it proves
the integration.

**Live-integration proof** is a **separate, guarded** DEMO.md **Beat 3**: one
genuine Firecrawl + OpenAI pass for Nurse A, with a pre-seeded fixture Nurse A as
a tested fallback; never a prerequisite for beats 4–12. Development also leaves
real `source_mode:"live"` snapshots in the deployment as standing evidence.

Tests spy-assert **zero** Firecrawl/OpenAI calls while `demo_mode` is on
(**AC13**); correctness rule 9; invariant **I7**.

**Touches:** `convex/demo.ts`, `convex/firecrawl.ts`, `convex/openai.ts`,
`src/components/DemoPanel.tsx`, PRD §2/§9/§12, Step 10, DEMO.md,
TESTING `demo-no-live-calls.test.ts` / `demo-determinism.test.ts`.

---

## D-10 — Two precedence rules (final-review, pre-build) — LOCKED

Neither changes the architecture; both close an ambiguity that could otherwise be
coded inconsistently between the roster list and the detail view.

### (a) Case-type priority when one fetch trips several conflicts

`mismatch_cases.type` holds a single value, but one conflicting fetch can trip
more than one kind at once (e.g. a status flip **and** a privilege violation on
the same snapshot). `create_mismatch_case` selects the headline `type` by the
**fixed order `identity` > `privilege` > `status`** — a wrong-person match is the
most severe failure mode and must never be masked by a lower-severity flag.
`detail.detected_types` records **all** detected conflict kinds, so the audit
trail loses nothing; only the headline `type` is chosen by priority.
`AC15`; helper `gate.pickHeadlineType`.

### (b) Badge evaluation order

A license can satisfy the staleness clause of ⚪ Unconfirmed **while also** having
`open_case_id` set. `deriveBadge` evaluates in a fixed precedence —
**🟠 Needs Review (`open_case_id != null`) is checked first**, before staleness.
An open case always renders amber even if the license has also gone stale;
staleness downgrades to ⚪ only when there is no open case. `AC16`; unit table in
`badge-precedence.test.ts` includes the explicit open-case-plus-stale ⇒ 🟠 row.

**Touches:** PRD §4 (badge block + table), §5 (`create_mismatch_case` +
`mismatch_cases.detail.detected_types`), §9 (correctness rule 10), Step 1
(`deriveBadge` truth table), Step 7 (What/Testing/DoD), AC15/AC16;
`convex/badge.ts`, `convex/gate.ts`, ARCHITECTURE §6.

---

## D-11 — Cross-check audit fixes + build-day-item outcomes — PARTLY LOCKED

Produced by the full artifact cross-check audit (`AUDIT.md`). Records the genuine
inconsistencies fixed and the outcome of the two build-day verification items.

### (a) Missing `settings` table + transient `licenses` fields — FIXED

`convex/settings` (a one-row singleton with `demo_mode`, `staleness_threshold_ms`,
`updated_at`) and `licenses.fixture_sequence` / `licenses.fixture_cursor` were
referenced by PRD Step 10, `ARCHITECTURE.md`, and `TASKS.md` but were **absent
from PRD §4's schema enumeration**, which listed 7 tables. This was a real schema
gap, not just wording.
**Fix:** added the `settings` table block and the two transient `licenses` fields
to PRD §4; updated the table count from **7 → 8** in PRD Step 3, `ARCHITECTURE.md`
§5 (module map), and `TASKS.md` Step 3. No behavioural change — the entities
already existed in the design, they were just unlisted.

### (b) Env-var name drift — FIXED

- PRD Step 8's AgentMail send sketch used `INBOX_ID` and `COORDINATOR_EMAIL`;
  every other artifact (`.env.example`, `SECURITY.md`, `TASKS.md`) uses
  `AGENTMAIL_INBOX_ID` and `ALERT_CC`. **Fix:** PRD Step 8 now uses
  `AGENTMAIL_INBOX_ID` / `ALERT_CC`.
- `TASKS.md` Step 3 pseudo-code used `SWEEP_INTERVAL`; `.env.example` defines
  `SWEEP_INTERVAL_MINUTES`. **Fix:** `TASKS.md` now uses `SWEEP_INTERVAL_MINUTES`.

### (c) AC7 traceability — FIXED

AC7 (append-only snapshots / M7 = 0) had test coverage
(`snapshots-insert-only.test.ts`) and a Final-gate task, but no step-level DoD
cited it. **Fix:** `TASKS.md` Step 7 now names AC7 / I5 / M7 in its task list and
DoD and adds `snapshots-insert-only.test.ts` to its test list. No new test added
— coverage already existed.

### (d) Flags left as-is (not contradictions — reported in `AUDIT.md`, not fixed)

- `D-1` (cron fan-out) and `D-2` (own OpenAI call vs Firecrawl `json`) have **no
  dedicated named test** — both are structural/design decisions. `D-1` is
  exercised implicitly by `loop-happy-path.test.ts` / `demo-determinism.test.ts`
  (exactly one `runForLicense` per license per sweep); `D-2` is exercised
  implicitly by the per-fixture golden tests (extraction is a separate,
  independently mocked stage). Left unaddressed per audit instruction ("flag,
  don't silently add a test"). If the reviewer wants explicit coverage, add
  `fanout-one-per-license.test.ts` and a static assert that `firecrawl.ts`
  requests only `formats:["rawHtml"]`.
- `ARCHITECTURE.md` §6 anchor table enumerates `I1–I9` + `D-10a/b`; `D-1`–`D-9`
  appear inline in §2–§8 as mechanisms but not all as an explicit `D-N` token in
  that table. Mechanism coverage is complete; tabular tagging is not. Left as-is.
- `.env.example` contains `FIRECRAWL_BASE_URL`, `AGENTMAIL_BASE_URL`, and
  `DEMO_MODE_DEFAULT`, which no other artifact references **by name** — they are
  legitimate config/bootstrap knobs (base-URL override for self-hosting; initial
  demo-mode state written into the `settings` singleton on first deploy). Not
  removed.
- PRD §5 keeps the brief's snake_case tool name `send_alert(case_id)` in the
  signature block while every implementation reference (PRD §5 orchestration
  list, §2 diagram, `ARCHITECTURE.md`, `TASKS.md`, `TESTING.md`) uses `sendAlert`.
  Cosmetic; the params match. Left as-is.

### (e) D-3 — OpenAI model verification — LOCKED (doc-verified; live `GET /v1/models` not runnable here)

The audit could **not** run `GET https://api.openai.com/v1/models` — there is no
`OPENAI_API_KEY` in this environment (only `.env.example` placeholders).
Verified instead against official docs
(`developers.openai.com/api/docs/models/gpt-4.1-mini`, retrieved 2026-09-10):

| Fact | Verified value |
|---|---|
| Model id `gpt-4.1-mini` exists as an API model | **yes** |
| Structured Outputs (`json_schema`, `strict:true`) | **supported** — `structured_outputs` listed among the model's features; corroborated by third-party sources (json_schema in `response_format`) |
| Context window | 1,047,576 tokens |
| Max output | 32,768 tokens |
| Knowledge cutoff | 2024-06-01 |
| Standard price | **$0.40 / 1M input, $1.60 / 1M output** (model page + Artificial Analysis + OpenRouter + Bifrost all agree); cached input $0.10 / 1M |
| Fallback `gpt-4o-2024-08-06` | exists; Structured Outputs supported since that snapshot; ~$3.75/1M in, ~$15.00/1M out |

**Caveat:** one read of the pricing page returned `$0.80 / $3.20` for
`gpt-4.1-mini` — inconsistent with every other source and likely a
priority/realtime-tier row or a summariser misread. Eyeball the pricing page once
with account access on build day; it does not change the model choice.

**Status:** `OPENAI_MODEL=gpt-4.1-mini` is **LOCKED** on model id + Structured
Outputs capability (doc-verified). `bootModelCheck()` (`GET /v1/models` on first
run, fallback to `gpt-4o-2024-08-06`) remains the runtime guard and is the point
at which the live call finally happens.

### (f) D-4 — Live board target — LOCKED to CA DCA BRN (reviewer-approved; live scrape verified build-day at Step 4)

The audit could **not** run a real Firecrawl `/v2/scrape` — no `FIRECRAWL_API_KEY`
in this environment. Unauthenticated probes of candidate boards:

| Board | URL | Unauthenticated GET result |
|---|---|---|
| California DCA license search | `https://search.dca.ca.gov/` | SSR search form, **no login**, includes Board of Registered Nursing; documents status words (current / expired / suspended / revoked). **Results page renders rows client-side (JS)** — needs Firecrawl `proxy:"auto"` + `waitFor` |
| NC Board of Nursing verification | `https://portal.ncbon.com/verification/search.aspx` | **403 Forbidden** to a plain client (bot protection) |
| Illinois IDFPR lookup | `https://online-dfpr.micropact.com/lookup/licenselookup.aspx` | **405** to a plain GET (expects a specific method/headers) |
| Washington DOH credential search | `https://fortress.wa.gov/doh/providercredentialsearch/` | DNS timeout from this environment |
| NY Office of the Professions | `https://www.op.nysed.gov/verification-search` | 301 → `eservices.nysed.gov` (redirect chain, not chased) |

None can be confirmed as clean server-rendered result HTML without running
Firecrawl. This is **expected** and is exactly why fixture-driven demo mode is
mandatory (D-9). Firecrawl's `proxy:"auto"` + `waitFor` is built for JS-rendered
and bot-blocked pages, but that can only be proven with a key.

**Recommended primary candidate:** **California DCA — Board of Registered
Nursing** via `search.dca.ca.gov` (public, no login, nursing board present,
status vocabulary documented). To be confirmed on build day with **one real
Firecrawl `/v2/scrape` (`formats:["rawHtml"]`, `proxy:"auto"`, `waitFor:2500`)**
against a real results/detail URL.

**Fallback (already designed):** if no board returns usable HTML via Firecrawl
within the timeline, DEMO.md Beat 3's guarded path stands — the live pass is
skipped with one spoken sentence and the pre-seeded fixture Nurse A carries the
beat. `source_mode:"live"` snapshots captured during any successful dev run are
left in the deployment as standing evidence.

**Status:** **LOCKED** (reviewer-approved 2026-09-10). Live-mode target =
**California DCA — Board of Registered Nursing** (`search.dca.ca.gov`),
`BOARD_HOST_ALLOWLIST=search.dca.ca.gov`. This is a design decision; the real
`POST /v2/scrape` verification is deferred to **build day, Step 4**, with real
Firecrawl credentials, and is recorded in the *Running verification log* row
"D-4 live scrape — CA DCA BRN". The guarded fixture fallback (D-9 / DEMO Beat 3)
covers a Step-4 scrape failure. Not a blocking item for starting the build.

---

## D-12 — `@convex-dev/static-hosting` 0.2.x deploy is its own command, not `npx convex deploy` — LOCKED (build reality)

**Planning assumed (ARCHITECTURE.md §2, TASKS Step 0 DoD, PRD §0/§12):** a
*single* `npx convex deploy` "builds `dist/`, pushes backend, uploads static
assets" and serves the frontend at `https://<deployment>.convex.site`.

**Build reality (2026-09-10, `@convex-dev/static-hosting@0.2.1` installed at
Step 0):** that one-command behaviour was the **0.1.x** integration. In 0.2.x the
component ships its own CLI and the single command is
**`npx @convex-dev/static-hosting deploy`**, which (1) builds the frontend with
the production `VITE_CONVEX_URL`, (2) runs `npx convex deploy` for the backend,
(3) uploads `dist/` through the Convex CLI's authenticated session. Plain
`npx convex deploy` alone pushes the backend but does **not** upload the
frontend. Registration also changed: component-owned root mode is
`defineApp({ httpPrefix: "/api" })` + `app.use(staticHosting, { httpPrefix: "/" })`.

**Decision:**
- `package.json` gains `"deploy": "npx @convex-dev/static-hosting deploy"` (the
  single command for a full deploy) and
  `"deploy:smoke": "npx @convex-dev/static-hosting upload --build"` (hosted smoke
  test against the dev deployment before a prod deploy).
- `convex/convex.config.ts` uses component-owned root mode. Attestor has no
  webhook/auth HTTP routes (AgentMail is send-only, SECURITY.md §3), so nothing
  needs to stay at `/`.
- Everywhere the plan says "single `npx convex deploy`", read "single
  `npm run deploy`". No architectural change: still one command, one deploy
  target, frontend + backend on `https://<deployment>.convex.site`, public repo,
  no localhost. AC10 is unaffected.

**Touches:** `package.json` (scripts), `convex/convex.config.ts`, ARCHITECTURE.md
§2 (command name), TASKS Step 0 + Final gate (`npm run deploy`), PRD §12 row.

---

## D-13 — 429 retry is immediate, not a wall-clock `Retry-After` sleep — LOCKED (build reality, Step 4)

**Planning wrote (D-7):** "a 429, after **one** bounded in-action retry honouring
`Retry-After` (**~3 s cap**), writes its own snapshot…". The implied mechanism
was `await sleep(min(3s, RetryAfter))` inside the `fetch_board_page` action.

**Build reality (Step 4):** a wall-clock `setTimeout` sleep *inside a running
Convex action* deadlocks `convex-test`'s fake-timer scheduler drain
(`finishAllScheduledFunctions(vi.runAllTimers)`): the timer is created after the
last `advanceTimers()` call, so the in-progress action never resumes and every
rate-limit / timeout test hangs to the 5 s vitest cap. This is a test-harness
interaction, but the sleep buys us nothing in production either.

**Decision:** on a 429, retry **once, immediately** (no in-action sleep).
`Retry-After` is still read from the header (kept on the internal attempt struct
for a future audit-line note). Rationale the guarantees still hold:
- D-7 mechanism #1 (staggered fan-out, ≤ ~15 fetches/min) already keeps the burst
  under the free-tier cap, so a same-tick retry rarely races a real limit;
- if `Retry-After` is more than sub-second, an immediate retry just 429s again and
  we **correctly record a `rate_limited` snapshot** (`disposition:"unconfirmed"`,
  `fetch_http_code:429`) that the **next sweep** picks up via
  `retry_of_snapshot_id` — behaviourally identical to sleeping, only faster to
  give up on the current tick;
- never a silent skip; M2 (snapshots / fetch attempts) stays 100%; AC12 holds.

**Touches:** `convex/firecrawl.ts` (`fetchLive` retry branch), D-7 (this refines
its "~3 s cap" detail; all its invariants unchanged), TESTING
`rate-limit-recorded.test.ts`.

---

## D-14 — AgentMail REST paths are versioned `/v0/...` — LOCKED (build reality)

**Planning wrote (PRD §0, TASKS Step 8):** create inbox at
`POST https://api.agentmail.to/inboxes`; send at
`POST https://api.agentmail.to/inboxes/{inbox_id}/messages/send`.

**Build reality (2026-09-10, verified against `docs.agentmail.to` + a real
`createAgentMailInbox` run):** the current AgentMail REST API is **version-prefixed**.
Inbox creation is `POST https://api.agentmail.to/v0/inboxes`; the response field
carrying the identifier is **`inbox_id`** (an email address, e.g.
`difficultkey38@agentmail.to`) alongside `email`, `pod_id`, timestamps. The
alert inbox was created this way and `AGENTMAIL_INBOX_ID` set to that value.

**Decision:** all AgentMail calls use the `/v0/` prefix off `AGENTMAIL_BASE_URL`
(`https://api.agentmail.to`). Step 8's `convex/agentmail.ts` wrapper builds
`${AGENTMAIL_BASE_URL}/v0/inboxes/${inboxId}/messages/send`. `client_id` is
accepted but AgentMail assigns its own random username — the returned `inbox_id`
is authoritative, not the `client_id`. No behavioural change to the alerting
design (I8, one send per case); only the URL path and the id field name.

**Touches:** `convex/setup.ts` (already `/v0/inboxes`), `convex/agentmail.ts`
(Step 8), PRD §0 + Step 8 (path), `.env.example` (`AGENTMAIL_INBOX_ID` real
value), SECURITY §6 (endpoint list).

---

## D-15 — BD-1: CA DCA live scrape blocked by Cloudflare Turnstile → fixture fallback for DEMO Beat 3 — LOCKED (build-day outcome)

**D-4 assumed:** "the real `POST /v2/scrape` (`formats:["rawHtml"]`, `proxy:"auto"`,
`waitFor:2500`) against a `search.dca.ca.gov` results/detail URL returns real
license fields" — i.e. the CA DCA Board of Registered Nursing page would be
scrapable with Firecrawl's JS-render + stealth-proxy options.

**BD-1 outcome (2026-09-10, real `FIRECRAWL_API_KEY` on `brazen-snail-826`, via
`setup:firecrawlProbe`):**
- Firecrawl **reaches the host fine**: `POST /v2/scrape` → HTTP 200, `data.rawHtml`
  ~320 KB, `data.metadata.statusCode:200`, not IP-blocked, with `proxy:"auto"`
  **and** `proxy:"stealth"`, `waitFor` up to 12 s.
- **But the DCA app is behind Cloudflare Turnstile.** The returned HTML contains
  `challenges.cloudflare.com/cdn-cgi/challenge-platform/.../turnstile/...` links,
  `<title>Search - DCA`, and the results container `div.searchContainer` with
  inline `style="display:none"` — the SPA never advances past the bot check, so
  no licensee record ever renders. Every results-URL variant (correct field names
  `boardCode` / `licenseType` / `lastName`, captured from the live form) returned
  the same gated shell.
- **Alternate tried (per D-4's instruction, "try one alternate first"):**
  NC Board of Nursing, `https://portal.ncbon.com/verification/search.aspx` —
  `proxy:"auto"` cleared the previously-seen 403 (HTTP 200) but returned an
  11.8 KB "continue session" interstitial, no license markers. Not pursued
  further.

**Decision:**
- **DEMO.md Beat 3's live-integration proof runs on the pre-seeded fixture
  Nurse A**, with the one-sentence spoken acknowledgement already scripted in
  DEMO.md ("Board's rate-limiting us live — here's the same thing on our seeded
  fixture"). Update that line to name the real reason (bot challenge) if desired;
  the beat structure is unchanged.
- **The Firecrawl integration is still demonstrably real:** BD-1 captured a live
  HTTP 200 `/v2/scrape` of a real `.gov` board host (logged in the verification
  table), and fixture mode runs the **identical** code path
  (`fetch_board_page → ctx.storage.store → commitFetchResult`), only the network
  edge is swapped (D-9). `source_mode:"live"` snapshots from BD-1 probe runs are
  *not* left in the roster (the probe is a raw diagnostic, not a `runForLicense`
  pass); if standing live evidence in the deployment is wanted, point one seeded
  license at `https://search.dca.ca.gov/` (it will store a real `ok` 320 KB
  `source_mode:"live"` snapshot whose extraction then yields low-confidence /
  `unknown` fields — honest, and still real Firecrawl+OpenAI work).
- `BOARD_HOST_ALLOWLIST=search.dca.ca.gov` stays as-is (the chosen live target);
  no code change — the guarded fallback was already built (D-9, Step 4 fixture
  branch). `convex/setup.ts:firecrawlProbe` kept as an env-only diagnostic.
- Not a blocker: AUDIT.md and D-4 both pre-authorised this exact path.

**Touches:** DECISIONS *Running verification log* (D-4 row), DEMO.md Beat 3
(reason wording, optional), PRD §12 "Firecrawl does real work" row (BD-1 live 200
scrape is the evidence, fixture path labelled). No implementation change.

---

## D-16 — OpenAI account has no credits; live extraction blocked (pending top-up) — OPEN

**Found (2026-09-11):** re-running the standing-evidence live scrape after the
HTML-size cap, the extraction still failed — but the cause is
`{"type":"insufficient_quota","code":"credit_balance_exhausted"}` from
`POST /v1/chat/completions`. `GET /v1/models` is free and still works
(`gpt-4.1-mini` resolves), so `bootModelCheck()` passes but no real extraction
can complete.

**Impact:**
- **None on the judged demo.** Demo mode (D-9) returns golden `ExtractedFields`
  with `extractor_model:"fixture-golden"` and makes **zero** OpenAI calls; the
  entire A–D story runs offline.
- **None on tests.** Every OpenAI path is mocked (`fixture-extraction.test.ts`,
  `model-check.test.ts`, `extraction-and-diff.test.ts`, …); 254 green.
- **Blocked:** (a) DEMO.md Beat 3's live-integration proof can show the real
  Firecrawl scrape but not a real OpenAI extraction; (b) no standing
  `source_mode:"live"` snapshot with real `extracted_fields` for the "OpenAI does
  real work" claim.

**Decision / action for the reviewer:** add credits at
`platform.openai.com/settings/organization/billing`. `gpt-4.1-mini` extraction is
~$0.02–0.05 per real board page (≈30k input tokens capped, 800 output); a few
dollars covers development + the demo. Once topped up:
- re-run one live pass (`roster:addWorker` with a real board URL, or unfreeze an
  evidence license) to capture a standing live snapshot with real extracted
  fields;
- Beat 3 can then do the full real Firecrawl + real OpenAI pass (still guarded by
  the pre-seeded fixture Nurse A per D-15, since the CA DCA *content* stays
  Turnstile-gated — a live pass would extract low-confidence/`unknown` from the
  search shell, which is honest but not a compelling demo; the fixture carries
  Beat 3).

**Status:** OPEN — no code change; a billing action on the reviewer's OpenAI
account. Not a blocker for Steps 8–10 (AgentMail + dashboard + demo mode don't
touch OpenAI).

**Touches:** DECISIONS *Running verification log* (D-3 live row), DEMO.md Beat 3
(same guardrail as D-15), PRD §12 "OpenAI does real work" row.

---

## D-17 — an open case gates confirmation (a later agreeing fetch does not auto-confirm) — LOCKED (Step 7)

**Ambiguity:** the plan (TASKS Step 7, PRD §2 gate) says "all agree/valid + ok +
confidence ≥ medium ⇒ confirmed, flip pointer" and separately I4 says a case
clears "only by an explicit human action". It does not spell out what happens
when a license **already has an open case** and a *new* fetch would otherwise
confirm (e.g. the board flipped to Expired → case opened → board flips back to
Active before a human resolves).

**Decision:** while `licenses.open_case_id != null`, the gate **cannot produce
`confirmed`**. `deriveDisposition` takes a `caseAlreadyOpen` input; a
would-be-`confirmed` fetch in that state is recorded `disposition:"unconfirmed"`
with the pointer **frozen** at its pre-case value until a human runs
`resolveCase`. A would-be-`conflict` fetch still reports `conflict`, but
`create_mismatch_case` is idempotent (returns `created:false`) so no second case
and no second alert (I8). Rationale: the open case means "a human has not yet
accepted the board's new reality"; silently re-confirming from the loop would be
a soft auto-resolution and could ping-pong the pointer. The snapshot is still
appended (I5) with its true `diff_result.agrees` (so "never a false conflict"
holds — an agreeing re-fetch shows `agrees:true`, just not `confirmed`).

**Touches:** `convex/gate.ts` (`caseAlreadyOpen`), `convex/commit.ts`,
`tests/unit/gate.test.ts`, `tests/convex/extraction-and-diff.test.ts`,
`tests/convex/no-auto-resolve.test.ts`. Consistent with I4 / I5 / D-6;
no schema change.

---

## Running verification log (fill in on build day)

| Item | Checked? | Result |
|---|---|---|
| Convex `crons.interval` signature + `crons.ts` default export | ☑ | Step 3 — `cronJobs()` from `convex/server`, `crons.interval("sweep", { minutes }, internal.sweep.runSweep, {})`, `export default crons`. Pushed clean to `brazen-snail-826` (Convex 1.45). |
| Convex `ctx.scheduler.runAfter` from mutation is transactional | ☑ | Step 3 — `addWorker` schedules `runForLicense` after its inserts; `loop-happy-path.test.ts` shows it fires exactly once, and the "bad state code" test shows the whole mutation (inserts + schedule) rolls back on a thrown `ConvexError` (no row, no scheduled fn). |
| `@convex-dev/static-hosting` serves SPA at `<deployment>.convex.site` | ◐ | Step 0/3 — component **installed** at push (`✔ Installed component staticHosting`), 0.2.x API (`defineApp({httpPrefix:"/api"})` + `app.use(staticHosting,{httpPrefix:"/"})`, see D-12). Actual serving at `.convex.site` verified on first `npm run deploy` (deferred, pending go-ahead). |
| Firecrawl `POST /v2/scrape` body: `formats:["rawHtml"]`, `proxy:"auto"`, `waitFor` | ☑ | **BD-1 (2026-09-10)** — real `POST /v2/scrape` with the exact production body ran against `https://search.dca.ca.gov/` and returned **HTTP 200, ~320 KB `data.rawHtml`, `metadata.statusCode:200`, not IP-blocked**. `proxy:"auto"` succeeded. Body shape + Bearer auth + `data.rawHtml` / `data.metadata.statusCode` response fields all confirmed against the live API. (The DCA *content* is a separate matter — see D-4 row.) |
| Firecrawl 429 shape + `Retry-After` header present | ◐ | Step 4 — `classify()` maps HTTP 429 → `rate_limited`/`fetch_http_code:429`; `Retry-After` header parsed. One **immediate** retry (D-13). No real 429 hit during BD-1 (free tier held); mapping is unit-covered (`rate-limit-recorded.test.ts`). |
| Convex file storage `ctx.storage.store` / `ctx.storage.getUrl` (D-8) | ☑ | Step 4 — `loop.ts` writes the full body via `ctx.storage.store(new Blob([...]))`; `timeline.getSnapshot` returns `ctx.storage.getUrl(...)`. `loop-happy-path` asserts `raw_payload_storage_id` non-null; pushed + integration-green on `brazen-snail-826`. |
| OpenAI Structured Outputs endpoint (`/v1/responses` `text.format` vs `/v1/chat/completions` `response_format`) + exact model id + price | ◐ | Step 5 — implemented against **`POST /v1/chat/completions`** with `response_format: { type:"json_schema", json_schema:{ name, strict:true, schema } }` (additionalProperties:false, all 9 keys required), `temperature:0`, `max_tokens` from `OPENAI_MAX_OUTPUT_TOKENS`. `refusal` handled. `bootModelCheck()` = `GET /v1/models`. Real round-trip + price eyeball = **BD-2**, pending `OPENAI_API_KEY` on the deployment. |
| AgentMail create-inbox + `messages/send` path, field names, attachment shape | ☐ | |
| Convex document size limit (confirm ~1 MiB) + `ctx.storage` API | ☐ | |
| **D-3 pricing** — `gpt-4.1-mini` input/output $/1M against `platform.openai.com` console (resolve $0.40/$1.60 vs $0.80/$3.20 — B-2, non-blocking) | ☐ | **BD-2 (2026-09-10)** — still needs the reviewer to eyeball the console. Public docs (`openai.com/api/pricing`, retrieved 2026-09-10) show **`gpt-4.1-mini` = $0.40 / 1M input, $1.60 / 1M output** (cached input $0.10). Use this in DEMO.md/pitch unless the console shows otherwise. The $0.80/$3.20 figure from one earlier read was not reproduced. |
| **D-3 live** — `GET /v1/models` returns `gpt-4.1-mini` (else `bootModelCheck` falls back to `gpt-4o-2024-08-06`) | ☑ / ⚠ | **BD-2 (2026-09-10)** — `boot:checkModel` on `brazen-snail-826`: `GET /v1/models` succeeded (free endpoint, no credits used), `gpt-4.1-mini` **present**, `resolved_model: "gpt-4.1-mini"` (no fallback). **⚠ (2026-09-11):** the actual extraction call (`POST /v1/chat/completions`) against the standing-evidence live scrape returned `insufficient_quota` / `credit_balance_exhausted` — **the OpenAI account has no credits.** Consequence: real OpenAI extraction can't run until credits are added; the mocked test suite is unaffected and demo mode (D-9, golden fixtures, zero OpenAI calls) is unaffected; DEMO Beat 3's OpenAI half + a standing "OpenAI does real work" snapshot are blocked pending credits. See D-16. |
| **D-4 live scrape — CA DCA BRN** — real `POST /v2/scrape` … returns real license fields, not a block/CAPTCHA/shell | ✗→fixture | **BD-1 (2026-09-10) — live scrape of DCA content FAILED; fixture fallback taken (as designed, D-9 / DEMO Beat 3).** Firecrawl reached `search.dca.ca.gov` fine (HTTP 200, ~320 KB, `proxy:"auto"` + `proxy:"stealth"`, `waitFor` up to 12 s), but the page carries a **Cloudflare Turnstile** challenge (`challenges.cloudflare.com/.../turnstile/...` in the body) and the SPA stays on the search form (`div.searchContainer style="display:none"`, `<title>Search - DCA`) — never renders results/detail. Real form field names captured (`boardCode`, `licenseType`, `licenseNumber`, `lastName`, …) but the data fetch is gated. **Alternate tried:** NC BON (`portal.ncbon.com/verification/search.aspx`) — `proxy:"auto"` got past the old 403 (HTTP 200) but returned an 11.8 KB session-interstitial, no license markers. **Final call:** DEMO Beat 3's live-integration proof runs on the **pre-seeded fixture Nurse A** with one spoken acknowledgement; the *Firecrawl integration itself is proven live* (200 scrape of a real .gov board host, evidence above) and demo/fixture mode exercises the identical `fetch_board_page → ctx.storage.store → commitFetchResult` path. See D-15. |

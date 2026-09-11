# TASKS.md — Attestor sequential build checklist

Ordered exactly by the ten build steps in `PRD.md` §7. Each task carries its
**Definition of Done (DoD)** — an observable behaviour, not "code compiles".
Do not start a step before the previous step's DoD is green. Do not start coding
until the planning artifacts are internally consistent (they are, as of D-10).

Legend: `[ ]` todo · `[~]` in progress · `[x]` done.
Refs point back to PRD invariants (I*), decisions (D*), metrics (M*), acceptance
criteria (AC*).

---

## Step 0 — Project scaffold (pre-req, not a PRD step)

- [ ] `npm create convex@latest` → React/Vite template; add `@convex-dev/static-hosting`.
- [ ] `npx convex dev` links a dev deployment; `.env.local` from `.env.example`.
- [ ] `vitest` + `convex-test` wired; `npm run test` runs an empty suite green.
- [ ] Public GitHub repo created; `.env.local` git-ignored; `.env.example` committed.
- **DoD:** `npx convex deploy` produces a reachable `https://<dep>.convex.site`
  serving the stock template; CI runs `npm run test` + `npm run build`.

---

## Step 1 — Lock the product contract

- [ ] `convex/contract.ts`: `extractedFields`, `diffResult`, `identityResult`,
      `privilegeResult`, `caseDetail` (incl. `detected_types`) as reusable
      `v.object` validators.
- [ ] `src/lib/types.ts` mirrors those types (imported, not re-validated).
- [ ] `convex/badge.ts`: `deriveBadge(license, latestSnapshot, now)` with the
      **fixed precedence** Needs Review → Unconfirmed → Verified (D-10b).
- [ ] `CONTRACT.md`: the three badge states, the snapshot shape, the case shape,
      mapped to experiences A–D.
- [ ] `badge-precedence.test.ts`: ≥10-row truth table incl. **open case + stale
      ⇒ 🟠** (AC16), plus the four other named rows.
- **DoD:** `deriveBadge` unit tests pass for all four experiences' end states
  **and** the open-case-plus-stale precedence row; `CONTRACT.md` checklist ticks
  A–D. (Refs: D-10b, AC16.)

---

## Step 2 — Seed fixture board pages

- [ ] `fixtures/*.html` — 8+ fixtures: `active_clean`, `flip_active`,
      `flip_expired`, `name_wrong_person`, `name_changed`, `privilege_violation`,
      `multi_conflict` (status+privilege, D-10a), `blocked_page`, `not_found`,
      `suspension_seq` (4-step).
- [ ] `fixtures/index.ts` manifest: `{ id, html, expected_fields,
      expected_outcome, sequence? }`.
- [ ] `fixtures/golden/<id>.json` — golden `ExtractedFields` per fixture.
- [ ] `fixtures-parse.test.ts` — each fixture non-empty, has sha256, parses as HTML.
- **DoD:** each fixture, run through `extract_license_fields` (mock returning the
      golden), yields its documented distinct `ExtractedFields`, recorded as the
      checked-in golden. (Refs: I7, Step 5 dependency.)

---

## Step 3 — Convex schema and scheduled watch

- [ ] `convex/schema.ts` — all 8 tables (`workers`, `assignments`, `licenses`,
      `snapshots`, `mismatch_cases`, `alerts`, `audit_events`, `settings`) +
      indexes: `licenses.by_watch_enabled`,
      `snapshots.by_license`, `snapshots.by_license_and_disposition`,
      `mismatch_cases.by_license_and_state`, `alerts.by_case` (unique),
      `audit_events.by_license`.
- [ ] `convex/crons.ts` — `crons.interval("sweep", { minutes: SWEEP_INTERVAL_MINUTES },
      internal.sweep.runSweep)`.
- [ ] `convex/sweep.ts` — `runSweep`: read `watch_enabled`, **staggered**
      `scheduler.runAfter(i * FETCH_STAGGER_MS, internal.loop.runForLicense)` (D-7).
- [ ] `convex/commit.ts` — `commitFetchResult` **skeleton** (single mutation
      entry point, D-6): insert snapshot + write audit rows; gate stubbed to
      "confirmed" for now.
- [ ] `convex/loop.ts` — `runForLicense` stub: synthesise a `fetch_status:"ok"`
      payload, call `commitFetchResult`.
- [ ] `convex/roster.ts` — `addWorker`, `addLicense` (input-validated), `listRoster`
      (calls `deriveBadge`).
- [ ] `src/` — minimal Add-worker form + roster list via `useQuery`.
- [ ] `loop-happy-path.test.ts` — `addLicense` + advance scheduler ⇒ exactly one
      `runForLicense` → one `commitFetchResult` → exactly one `snapshots` row.
- **DoD:** adding a worker in the deployed UI produces one `snapshots` row + an
      `audit_events` row with `stage:"gate"` within one sweep (≤5 min live / ≤5 s
      demo), written by a single `commitFetchResult` transaction. (Refs: F1, D-6,
      D-7, I9.)

---

## Step 4 — Firecrawl fetch integration

- [ ] `convex/firecrawl.ts` — `fetch_board_page` live path: `POST /v2/scrape`
      `{ url, formats:["rawHtml"], onlyMainContent:false, waitFor:2500,
      proxy:"auto", blockAds:true }`, Bearer auth, `BOARD_HOST_ALLOWLIST` check.
- [ ] `fetch_status` mapping: 2xx→`ok`; 429→**`rate_limited`** after one bounded
      `Retry-After` retry (~3 s cap, D-7); 403/anti-bot→`blocked`; other→`http_error`;
      hang→`timeout`.
- [ ] `convex/loop.ts` — write full `rawHtml` to `ctx.storage.store` (D-8),
      compute sha256 + ≤4 KB excerpt + bytes, pass storage id + meta to
      `commitFetchResult`.
- [ ] `schema.ts` — snapshot fields: `raw_payload_storage_id`,
      `raw_payload_excerpt`, `raw_payload_sha256`, `raw_payload_bytes`,
      `fetch_status` (7 values), `fetch_http_code`, `retry_of_snapshot_id`.
- [ ] Sweep re-picks a non-`ok` latest snapshot; retry sets `retry_of_snapshot_id`.
- [ ] `src/components/SnapshotDrawer.tsx` — excerpt + "view full raw HTML"
      (storage URL) + `source_url` / `source_mode` / `fetch_status` /
      `fetch_http_code` / `fetched_at` / "retry of …".
- [ ] `blocked-timeout-inject.test.ts` + `rate-limit-recorded.test.ts`.
- **DoD:** (1) a bad URL ⇒ stored `unconfirmed` snapshot with its HTTP code in
      the UI; (2) a simulated 429 ⇒ stored `rate_limited` snapshot retried next
      sweep as a linked dot, no gap; (3) a good URL ⇒ stored `ok` snapshot whose
      full raw HTML opens from file storage and whose sha256 re-hashes equal.
      (Refs: F5, D-7, D-8, M2, AC9, AC12, AC14.)

---

## Step 5 — OpenAI extraction and diff

- [ ] `convex/openai.ts` — `extract_license_fields` via Structured Outputs
      (`json_schema`, `strict:true`, `additionalProperties:false`, all keys
      `required`) → `ExtractedFields`; handle `refusal` → `extraction_refused`;
      invalid/other → `extraction_failed`.
- [ ] `bootModelCheck()` — one `GET /v1/models`; fall back to
      `OPENAI_MODEL_FALLBACK` if `OPENAI_MODEL` absent (D-3).
- [ ] `convex/diff.ts` — pure `diff_snapshot`; called **inside**
      `commitFetchResult` against the prior confirmed snapshot.
- [ ] `commitFetchResult` — populate `extracted_fields`, `extractor_model`,
      `extractor_raw_response`, `diff_result`; extraction failure ⇒
      `disposition:"unconfirmed"`.
- [ ] `SnapshotDrawer` — "Extracted fields" table + "Diff vs last confirmed" list.
- [ ] Per-fixture golden tests + `diff` unit tests (identical ⇒ `agrees:true`;
      flip ⇒ `agrees:false`); `model-check.test.ts`; refusal integration test.
- **DoD:** the flip fixture pair ⇒ stored `diff_result.agrees:false`; an
      identical re-fetch ⇒ `agrees:true` (never a silent pass, never a false
      conflict); a refused extraction ⇒ `unconfirmed`, no throw. (Refs: F1, D-2,
      D-3, M3, M4.)

---

## Step 6 — Identity binding and privilege check

- [ ] `convex/identity.ts` — pure `bind_identity`: number match + normalised name
      similarity on `name_registered`; thresholds → `exact` / `high` /
      `name_change_suspected` / `mismatch`; `mismatch_reason` incl.
      `legal_name_change`, `wrong_person`, `number_mismatch` (I2).
- [ ] `convex/privilege.ts` — pure `check_privilege` + bundled `NLC_MEMBER_STATES`;
      `unknown` privilege fails closed (I3).
- [ ] Both called **inside `commitFetchResult`** (same txn as diff + insert);
      populate `identity_result`, `privilege_result`.
- [ ] `SnapshotDrawer` — "Identity" + "Privilege" verdict rows.
- [ ] `identity-binding.test.ts` + `privilege-check.test.ts` (full tables).
- **DoD:** the name-change fixture ⇒ an **identity**-typed signal distinct from
      any status flag; the privilege fixture ⇒ a **privilege**-typed signal; the
      two are never conflated in the stored result or the UI. (Refs: F2, F3, I2,
      I3, M5, M6, AC3, AC4.)

---

## Step 7 — Mismatch case creation and gating (atomic)

- [ ] `convex/gate.ts` — pure `deriveDisposition(...)` and
      `pickHeadlineType(detected)` (**`identity` > `privilege` > `status`**, D-10a).
- [ ] `commitFetchResult` — complete gate branch in the **one transaction**:
      - all agree/valid + `ok` + confidence ≥ medium ⇒ `confirmed`, flip pointer;
      - any conflict/invalid ⇒ `conflict`, `create_mismatch_case` (idempotent),
        set `open_case_id`, `scheduler.runAfter(0, sendAlert)` **in-txn**;
      - `fetch_status!="ok"` / confidence `low` ⇒ `unconfirmed`, nothing moved.
- [ ] `create_mismatch_case` writes headline `type` by priority; `detail.detected_types`
      lists all detected kinds.
- [ ] `convex/cases.ts` — `resolveCase` (requires non-empty `actor` + `note`;
      **only** clearer of `open_case_id`; on `confirmed` adopts `snapshot_b` as
      the pointer; writes `resolve` audit row). `getCase`, `listOpenCases`.
- [ ] `src/` — case list + case detail + Resolve dialog.
- [ ] Static checks: no `patch("snapshots"`/`replace`; no mutation sets a
      badge/status field directly (this is the enforcement point for **AC7** —
      append-only snapshots / M7 = 0). Tests: `conflict-never-silent.test.ts`,
      `atomic-gate.test.ts`, `no-auto-resolve.test.ts`, `case-type-priority.test.ts`,
      `snapshots-insert-only.test.ts`.
- **DoD:** after a conflicting fetch, `current_confirmed_snapshot_id` is
      byte-identical to its pre-fetch value; snapshot row + open case written by
      one transaction (M8 = 0); badge 🟠 solely via `open_case_id`; only
      `resolveCase` (actor+note) flips it back; `alert_scheduled` true in that
      txn; a multi-conflict fetch ⇒ exactly one case, `type` = highest priority,
      `detail.detected_types` retains all; no `snapshots` row is ever patched or
      replaced (M7 = 0). (Refs: F4, D-6, D-10a, I4, I5, I9, M7, M8,
      AC2, AC7, AC11, AC15.)

---

## Step 8 — AgentMail alerting

- [ ] Create the alert inbox once (`POST /inboxes { client_id: "attestor-alerts" }`);
      set `AGENTMAIL_INBOX_ID`.
- [ ] `convex/agentmail.ts` — client wrapper + evidence builder (HTML table of
      `snapshot_a` vs `snapshot_b` + `case.json` attachment).
- [ ] `convex/alert.ts` — `sendAlert` (internalAction): `recordAlert`
      check-then-insert on unique `alerts.by_case` (I8) → returns `proceed:false`
      on collision; on proceed, `client.inboxes.messages.send(INBOX_ID,
      { to: ALERT_TO, cc: ALERT_CC, subject, text, html, attachments })`;
      `finalizeAlert` stores `agentmail_message_id` / `thread_id` /
      `send_status` / `send_error`; `audit_events` `stage:"alert"`.
- [ ] `src/` — case detail shows alert status + message id + sent timestamp.
- [ ] `alert-once.test.ts` + `agentmail-failure.test.ts`.
- **DoD:** one new case ⇒ exactly one AgentMail message containing both
      snapshots; re-running the sweep on the still-open case sends nothing more;
      an AgentMail 5xx ⇒ `send_status:"failed"`, case still open and visible.
      (Refs: F1/F2/F3, I8, M1, AC5.)

---

## Step 9 — Operator dashboard

- [ ] `convex/timeline.ts` — `getWorkerTimeline`, `getSnapshot`, `compareSnapshots`.
- [ ] `src/components/` — `RosterTable` (badge + `confirmed_snapshot_id`, I1),
      `WorkerTimeline` (dot per snapshot + audit event, retry links),
      `SnapshotDrawer` (raw excerpt + full-HTML link + extracted/diff/identity/
      privilege/disposition), `CompareView` (a vs b, conflicts highlighted),
      `CaseDetail` (+ `detail.detected_types`), `MetricsPanel` (M1–M8).
- [ ] `src/lib/badge.ts` parity with `convex/badge.ts` (`badge-parity.test.ts`).
- [ ] Reactivity test: scripted experience B flips the badge 🟢→🟠 in the
      `listRoster` query result with no reload.
- **DoD:** a fresh browser session walks A→B→C→D end to end using only UI
      controls; every displayed status shows its backing `snapshot_id`.
      (Refs: I1, AC8; experiences A–D.)

---

## Step 10 — Deterministic demo mode (fully mocked)

- [ ] `convex/demo.ts` — `settings` singleton (`demo_mode`); `seedDemo` (Nurses
      A–D with their fixture sequences); `runDemoSequence` (internalAction,
      compressed `scheduler.runAfter` chain, seconds).
- [ ] `fetch_board_page` `mode:"fixture"` branch — return fixture HTML, **no
      Firecrawl call**; still `ctx.storage.store` the blob.
- [ ] `extract_license_fields` `mode:"fixture"` branch — return the fixture
      golden, `extractor_model:"fixture-golden"`, **no OpenAI call** (D-9).
- [ ] `schema.ts` — `licenses.fixture_sequence` + `fixture_cursor`;
      `settings.demo_mode`, demo `staleness` (20 s).
- [ ] `src/components/DemoPanel.tsx` — "Run demo" button; **persistent
      "DEMO DATA" banner** at `App` root whenever `demo_mode` is on
      (correctness rules 7 & 9).
- [ ] Live proof stays available: `demo_mode` off + Beat 3 flow; fixture Nurse A
      pre-seeded as the tested fallback.
- [ ] `demo-no-live-calls.test.ts` + `demo-determinism.test.ts` (run sequence
      twice; identical `snapshots`/`cases`/`alerts` counts + dispositions;
      Firecrawl spy 0, OpenAI spy 0, AgentMail spy > 0).
- **DoD:** with `demo_mode` on, the full loop runs twice back-to-back with
      identical correct outcomes, **zero** Firecrawl and **zero** OpenAI calls,
      real AgentMail alerts still sent, DEMO DATA banner on every screen; the
      separate live proof pass works with a tested fixture fallback. (Refs: I7,
      D-9, AC6, AC13.)

---

## Final gate — before submission

- [x] `npm run test` + `npm run test:static` + `npm run build` all green.
      (288 tests / 25 files; CI green on every push.)
- [x] `no-secret-in-client` scan over `dist/` clean (part of `npm run build`).
- [x] Metrics panel on the deployed URL shows M2=100%, M3=0, M4=0, M5=100%,
      M6=100%, M7=0, M8=0; M1 finite. (Live on `brazen-snail-826`: M1≈0.9 s,
      M2 100, M3 0, M4 0, M5 100, M6 100, M7 0, M8 0.)
- [x] AC1–AC16 each demonstrated (TESTING §6 map) — see per-step tests; AC1 live
      half + Beat-3 OpenAI blocked by D-16 (credits), covered by mocked tests.
- [x] `DECISIONS.md` verification log filled in. D-3 LOCKED (models OK; extraction
      blocked by D-16 quota). D-4 → **D-15** (CA DCA Turnstile-gated → fixture
      fallback for Beat 3; Firecrawl live 200 scrape captured as evidence).
- [x] Deployed **https://brazen-snail-826.convex.site** opens for a stranger;
      "Run demo" reproduces A→D (verified by driving `demo.runDemo` on the live
      deployment: 10 snapshots, 4 cases [identity, privilege, status, status],
      4 real AgentMail sends, DEMO banner on; Nurse A A→B, Nurse D six-week
      close). Backend-driven, not a browser click — no browser in the build env.
- [ ] < 3-min video recorded to `DEMO.md`'s 12 beats; posted on X / LinkedIn;
      public repo link in the submission. **(reviewer)**

### Carried / open items (see DECISIONS.md)

- **D-16 (OPEN)** — OpenAI account has no credits; live extraction returns
  `insufficient_quota`. `GET /v1/models` (free) works. Zero impact on demo mode
  or tests; blocks Beat 3's OpenAI half + a standing real-extraction snapshot.
  Fix: add a few $ at `platform.openai.com` billing.
- Optional prod deploy: `npm run deploy` publishes a *prod* deployment (empty,
  needs the 8 env vars re-set). The dev deployment's `.convex.site` URL above is
  a real live URL and satisfies "no localhost".

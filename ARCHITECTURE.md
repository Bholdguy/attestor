# ARCHITECTURE.md — Attestor

Companion to `PRD.md`. This document fixes the request path, the
frontend / orchestrator / fetch / reasoning / storage split, and where every
sponsor call and every invariant lives in code. Nothing here overrides `PRD.md`;
where they could disagree, `PRD.md` wins.

---

## 1. One-paragraph shape

Attestor is a **Convex app** — Convex is the database, the scheduler, the file
store, and the HTTP/static host. A thin React/Vite frontend is a pure reactive
consumer of Convex queries. The supervisor loop is a **statically-defined cron**
that fans out one **scheduled action per watched license**; that action performs
the only three non-deterministic things in the system (Firecrawl scrape, OpenAI
extraction, file-storage write) and then calls **one mutation**,
`commitFetchResult`, which does every decision and every write in a single
serializable transaction. Alerts are a follow-on action scheduled transactionally
by that mutation. There is no server we run; there is no second deploy target.

---

## 2. Deployment topology

```
                         ┌───────────────────────────────────────────────┐
                         │           Convex deployment (cloud)           │
   Browser               │                                               │
 ┌──────────┐  HTTPS     │  ┌─────────────┐   ┌──────────────────────┐   │
 │ React /  │──────────▶ │  │ static-host │   │  Convex functions    │   │
 │ Vite SPA │  wss (live)│  │ (convex.site│   │  queries / mutations │   │
 │  (dist/) │◀──────────▶│  │  serves     │   │  actions / crons     │   │
 └──────────┘            │  │  dist/)     │   │                      │   │
      ▲                  │  └─────────────┘   │  ┌────────────────┐  │   │
      │ ConvexReactClient│                    │  │ Convex tables  │  │   │
      │ (useQuery/       │                    │  │ + file storage │  │   │
      │  useMutation)    │                    │  │ + scheduler    │  │   │
      └──────────────────┼────────────────────┴──┴────────────────┴──┘   │
                         │        outbound HTTPS (actions only)          │
                         │   Firecrawl /v2/scrape   OpenAI /v1/*         │
                         │   AgentMail /v0/*                             │
                         └───────────────────────────────────────────────┘
```

- **Single command:** `npx convex deploy` builds `dist/`, pushes backend, uploads
  static assets. Frontend + backend share `https://<deployment>.convex.site`.
- **No localhost in the submission.** Local dev uses `npx convex dev` + Vite; the
  judged URL is the Convex deployment.
- **Public repo.** Secrets are Convex environment variables, never committed
  (see `SECURITY.md`, `.env.example`).

---

## 3. The five planes (brief-scoped split)

| Plane | Runs as | Responsibilities | May NOT |
|---|---|---|---|
| **Frontend** | React/Vite SPA, `ConvexReactClient` | render roster, timeline, snapshot drawer, compare view, case detail + resolve dialog, metrics panel, demo control panel + DEMO DATA banner | call Firecrawl/OpenAI/AgentMail; hold any API key; mutate a status/badge field |
| **Orchestrator** | Convex `crons.ts` + internal actions `runSweep`, `runForLicense` | schedule the sweep, staggered fan-out, drive the per-license loop, catch every throw | make a decision (diff/gate/identity/privilege); write tables directly (all writes go through mutations) |
| **Fetch** | Convex action helper `firecrawl.ts` (`fetch_board_page`) | call `POST /v2/scrape`, classify HTTP outcome → `fetch_status`, one bounded 429 retry, produce `raw_html` + sha + excerpt + bytes | parse license fields; decide anything; write tables |
| **Reasoning** | Convex action helper `openai.ts` (`extract_license_fields`) **and** pure modules `diff.ts` / `identity.ts` / `privilege.ts` | OpenAI: raw HTML → strict-JSON `ExtractedFields` (only LLM call). Pure modules: compare / bind / classify | OpenAI: judge "is this fine", diff, or gate. Pure modules: perform I/O |
| **Storage / decision** | Convex mutation `commit.ts` (`commitFetchResult`), mutation `resolveCase`, file storage, tables | the atomic transaction: read prior confirmed snapshot, run pure reasoning, `db.insert` snapshot, apply gate, flip pointer OR open case + schedule alert, write audit rows | call any external API; run non-deterministic code |

Alerting (`agentmail.ts` → `sendAlert` action + `recordAlert` mutation) is a
sixth, follow-on unit triggered only by a transactional
`scheduler.runAfter` from `commitFetchResult`.

---

## 4. Request path — adding a worker to a live badge

```
1. Coordinator submits "Add worker" form
      └─ useMutation(api.roster.addWorker)  ──▶  mutation addWorker
                                                   • insert workers row
                                                   • insert assignments row
                                                   • insert licenses row (watch_enabled=true,
                                                     current_confirmed_snapshot_id=null,
                                                     open_case_id=null)
                                                   • ctx.scheduler.runAfter(0,
                                                       internal.loop.runForLicense,{licenseId})
                                                   (scheduling is transactional with the inserts)

2. runForLicense (ACTION)  — first run, and every sweep thereafter
      a. read license + worker + assignment via ctx.runQuery(internal.read.loopInputs)
      b. fetch_board_page({..., mode: settings.demo_mode ? "fixture" : "live"})
            live : POST https://api.firecrawl.dev/v2/scrape
            demo : return next fixture HTML (no network)
      c. storageId = ctx.storage.store(new Blob([raw_html]))   // skipped only if body==""
      d. extract_license_fields(raw_html, mode, fixtureId?)
            live : OpenAI Responses API, text.format=json_schema strict
            demo : return fixture golden ExtractedFields
      e. ctx.runMutation(internal.commit.commitFetchResult, { ...all of the above ... })
         — the action itself makes NO decision and writes NO table

3. commitFetchResult (MUTATION — ONE transaction)
      a. read licenses row + prior confirmed snapshot (if any)
      b. diff_snapshot(next, priorConfirmedFields, priorConfirmedId)      // pure
      c. bind_identity(worker, next)                                       // pure
      d. check_privilege(next.privilege_type, assignment_state, ...)       // pure
      e. detectedTypes = []  ; push "identity" | "privilege" | "status" as applicable
         headlineType = identity > privilege > status  (D-10)
      f. disposition =
           fetch_status!="ok" || confidence=="low"     -> "unconfirmed"
           any conflict/invalid                        -> "conflict"
           else                                        -> "confirmed"
      g. snapshotId = db.insert("snapshots", { ...payload..., diff_result, identity_result,
                                               privilege_result, disposition })
      h. gate:
           confirmed  -> db.patch(license, { current_confirmed_snapshot_id: snapshotId,
                                             last_fetch_at: now })
           conflict   -> { caseId, created } = create_mismatch_case(ctx, {
                            type: headlineType, snapshot_a_id: priorConfirmedId ?? snapshotId,
                            snapshot_b_id: snapshotId, reason, detail:{ conflicts, detected_types, ... } })
                         if created: db.patch(license,{ open_case_id: caseId })
                                     ctx.scheduler.runAfter(0, internal.alert.sendAlert,{caseId})
           unconfirmed-> db.patch(license, { last_fetch_at: now })   // pointer + open_case_id untouched
      i. db.insert("audit_events", …) x4  (fetch, extract, diff, gate)
      returns { snapshotId, disposition, caseId|null, alert_scheduled }

4. sendAlert (ACTION) — only if step 3 scheduled it
      a. ctx.runQuery(getCaseBundle) -> case + both snapshots + worker
      b. ctx.runMutation(recordAlert, {caseId})  — check-then-insert alerts.by_case;
         returns {proceed:false} if a row already exists  (I8, idempotent)
      c. if proceed: client.inboxes.messages.send(INBOX_ID, { to, cc, subject, text, html,
                       attachments:[{filename:"case.json", content: base64(JSON.stringify(detail))}] })
      d. ctx.runMutation(finalizeAlert, {caseId, messageId, threadId, send_status})
      e. db.insert("audit_events",{ stage:"alert", ... })

5. Frontend re-renders automatically
      useQuery(api.roster.listRoster) pushes the new badge over wss.
      deriveBadge(license, latestSnapshot, now):  NeedsReview → Unconfirmed → Verified  (D-10)
```

### Resolve path

```
Coordinator clicks Confirm/Dismiss + types a note
   └─ useMutation(api.cases.resolveCase, { caseId, decision, actor, note })
        mutation resolveCase (ONE transaction):
          • require actor.trim() && note.trim()   (else throw ConvexError)
          • db.patch(case, { resolution_state: decision, resolved_by: actor,
                             resolved_at: now, resolution_note: note })
          • if decision=="confirmed": db.patch(license,
               { current_confirmed_snapshot_id: case.snapshot_b_id })   // adopt the new reality
          • db.patch(license, { open_case_id: null })   // the ONLY clear of open_case_id
          • db.insert("audit_events", { stage:"resolve", actor, ... })
   No auto-resolution anywhere — no cron, no action, no other mutation clears open_case_id.  (I4)
```

---

## 5. Module map

```
convex/
  schema.ts            all 8 tables (workers, assignments, licenses, snapshots,
                        mismatch_cases, alerts, audit_events, settings) + indexes
  contract.ts          reusable v.object validators: extractedFields, diffResult,
                        identityResult, privilegeResult, caseDetail  (Step 1)
  crons.ts             crons.interval("sweep", { minutes: 5 }, internal.sweep.runSweep)
  sweep.ts             runSweep  (internalAction): read watch_enabled licenses,
                        staggered scheduler.runAfter(i*spacingMs, runForLicense)
  loop.ts              runForLicense (internalAction): fetch → storage.store → extract →
                        commitFetchResult ; try/catch wraps all — no throw escapes
  firecrawl.ts         fetch_board_page (helper, not a registered fn): live POST /v2/scrape
                        + 429 retry + fetch_status mapping ; demo returns fixture html
  openai.ts            extract_license_fields (helper): Responses API json_schema strict ;
                        bootModelCheck() -> GET /v1/models  (D-3) ; demo returns golden
  diff.ts              diff_snapshot  (PURE)
  identity.ts          bind_identity  (PURE)  + name normalisation / similarity
  privilege.ts         check_privilege (PURE) + bundled NLC_MEMBER_STATES constant
  gate.ts              pickHeadlineType(detected) , deriveDisposition(...)  (PURE helpers)
  commit.ts            commitFetchResult (internalMutation) — THE atomic core (I9/D-6)
  cases.ts             resolveCase (mutation) ; getCase, listOpenCases (queries)
  roster.ts            addWorker, addLicense (mutations) ; listRoster (query, calls deriveBadge)
  timeline.ts          getWorkerTimeline, getSnapshot, compareSnapshots (queries)
  alert.ts             sendAlert (internalAction) ; recordAlert, finalizeAlert (internalMutations)
  agentmail.ts         AgentMail client wrapper + HTML/JSON evidence builder
  metrics.ts           metricsPanel (query): M1–M8 computed from tables
  demo.ts              settings singleton ; seedDemo (mutation) ; runDemoSequence
                        (internalAction, compressed scheduler chain)
  badge.ts             deriveBadge(license, latestSnapshot, now)  (PURE, D-10 precedence)
  fixtures/
    index.ts           manifest: { id, html, expected_fields, expected_outcome, sequence? }
    *.html             8 fixtures (Step 2)

src/                    React/Vite frontend
  main.tsx             ConvexProvider
  App.tsx              routes
  components/
    RosterTable.tsx        useQuery(listRoster) ; Badge cell shows confirmed_snapshot_id (I1)
    WorkerTimeline.tsx     useQuery(getWorkerTimeline) ; dot per snapshot + audit_event
    SnapshotDrawer.tsx     raw excerpt + "view full raw HTML" (storage URL) + extracted /
                           diff / identity / privilege / disposition
    CompareView.tsx        snapshot_a vs snapshot_b, conflicting rows highlighted
    CaseDetail.tsx         reason, detail.detected_types, alert status, Resolve dialog
    MetricsPanel.tsx       M1–M8
    DemoPanel.tsx          Run demo button ; DEMO DATA banner when settings.demo_mode
  lib/badge.ts         mirror of convex/badge.ts (shared types from contract.ts)
```

---

## 6. Where each invariant is enforced (code anchor)

| Inv | Enforced by |
|---|---|
| I1 traceability | `roster.listRoster` / `timeline.*` always return `confirmed_snapshot_id`; `RosterTable` renders it; no query returns a bare status string |
| I2 identity binding | `identity.bind_identity` uses `license_number` **and** `name_registered`; `gate.pickHeadlineType` maps `mismatch_reason` to a `type:"identity"` case |
| I3 privilege binding | `privilege.check_privilege` called unconditionally in `commit.commitFetchResult` step (d) |
| I4 human-only resolve | only `cases.resolveCase` writes `open_case_id: null`; grep-asserted in test `no-auto-resolve.test.ts` |
| I5 append-only | `commit.ts` uses `db.insert("snapshots", …)` only; test `snapshots-insert-only.test.ts` greps for `patch("snapshots"`/`replace` |
| I6 fail closed | `gate.deriveDisposition` returns `"unconfirmed"` for `fetch_status!="ok"` or `confidence=="low"`; pointer never moved in that branch |
| I7 no live dep | `demo.settings.demo_mode` branch in `firecrawl.fetch_board_page` and `openai.extract_license_fields`; spy test asserts 0 external calls |
| I8 alert once | `alert.recordAlert` check-then-insert on unique index `alerts.by_case`; returns `proceed:false` on collision |
| I9 atomic gate | insert + gate + pointer/case + schedule + audit all inside the single `commit.commitFetchResult` mutation body; test asserts no mid-transaction observable state |
| D-10a type priority | `gate.pickHeadlineType(detected)` — `identity` > `privilege` > `status`; `detail.detected_types` keeps all |
| D-10b badge order | `badge.deriveBadge` — `if (open_case_id) return "needs_review"` before any staleness check |

---

## 7. Data-flow guarantees (why the race is closed)

1. The action (`runForLicense`) holds **no** DB transaction. Its outputs are
   plain values.
2. `commitFetchResult` is a Convex mutation = one serializable transaction. All
   of: read prior snapshot, insert new snapshot, patch the pointer *or* insert
   the case + patch `open_case_id` + `scheduler.runAfter`, insert audit rows —
   commit together or not at all.
3. Therefore any `useQuery` (roster, timeline, case list) observes the snapshot
   **and** its consequence atomically. A `conflict` snapshot is never visible
   without `open_case_id` set; a `confirmed` snapshot is never visible without the
   pointer moved.
4. `scheduler.runAfter` inside the mutation is itself transactional — the alert
   is scheduled **iff** the case commits. No case ⇒ no alert; case ⇒ exactly one
   scheduled `sendAlert`, which is then de-duped by `alerts.by_case` (I8).
5. Orphan file-storage blob (action stored the blob, mutation then threw) is
   unreferenced, invisible to every query, and swept — it breaks no invariant.

---

## 8. Failure handling matrix

| Failure | Detected in | `fetch_status` | `disposition` | Pointer | Case | Alert | Retried |
|---|---|---|---|---|---|---|---|
| Firecrawl 200 | fetch | `ok` | per gate | maybe | maybe | maybe | n/a |
| Firecrawl 429 (after 1 retry) | fetch | `rate_limited` | `unconfirmed` | untouched | no | no | next sweep, `retry_of_snapshot_id` set |
| Firecrawl 403 / anti-bot | fetch | `blocked` | `unconfirmed` | untouched | no | no | next sweep |
| Firecrawl 5xx / other 4xx | fetch | `http_error` | `unconfirmed` | untouched | no | no | next sweep |
| Network timeout | fetch | `timeout` | `unconfirmed` | untouched | no | no | next sweep |
| OpenAI refusal | extract | `extraction_refused` | `unconfirmed` | untouched | no | no | next sweep |
| OpenAI invalid JSON / error | extract | `extraction_failed` | `unconfirmed` | untouched | no | no | next sweep |
| OpenAI ok, `confidence:"low"` | gate | `ok` | `unconfirmed` | untouched | no | no | next sweep |
| Fields agree | gate | `ok` | `confirmed` | **moved** | no | no | n/a |
| Status / identity / privilege conflict | gate | `ok` | `conflict` | untouched | **opened** (idempotent) | **once** | n/a (case stays open until human) |
| AgentMail 5xx | sendAlert | — | — | — | stays open | `alerts.send_status="failed"`, visible | operator can re-trigger from case UI |
| `runForLicense` unexpected throw | loop.ts catch | `http_error` (synthetic) | `unconfirmed` | untouched | no | no | next sweep |

---

## 9. Frontend contract

- Frontend imports **types only** from `convex/contract.ts` (via
  `src/lib/types.ts`); it never re-implements validation.
- Every status pill component takes `{ badge, confirmedSnapshotId }` and links to
  the snapshot — a pill with no id is a compile error (prop is required).
- `deriveBadge` is duplicated in `src/lib/badge.ts` for optimistic rendering but
  the server value from `listRoster` is authoritative; a mismatch test compares
  the two on every fixture end-state.
- The DEMO DATA banner is rendered from `useQuery(api.demo.settings).demo_mode`
  at the `App` root, above the router, so it cannot be missed on any screen.

---

## 10. Scaling notes (demo-honest)

- Demo roster = 4–8 licenses. Live sweep interval 5 min, `spacingMs ≈ 4000` →
  ≤ 15 fetches/min, inside Firecrawl free tier.
- Compressed demo chain: `runDemoSequence` schedules the fixture sequence with
  2–4 s gaps; a full A–D run is ~2 min.
- `snapshots` rows are small (excerpt ≤ 4 KB + verdict objects); raw HTML lives
  in file storage. A 50-license, 5-min-interval deployment over a week is
  ~100 K rows — well within Convex limits, but out of demo scope.

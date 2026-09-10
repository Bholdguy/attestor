# Attestor — Product Requirements Document

**A License Trust Supervisor**
Convex All Gas Hackathon · Convex + Firecrawl + OpenAI + AgentMail
Document status: DRAFT for approval · Date: 2026-09-10

---

## 0. Documentation verification (done before design)

Every sponsor mechanism the brief assumes was checked against current official
documentation on 2026-09-10. Nothing the brief depends on is deprecated. Where a
web source returned an implausible or poisoned value it is flagged and a
build-time verification gate is specified instead of trusting the source.

| Capability | Assumed by brief | Verified current state | Verdict |
|---|---|---|---|
| **Convex cron jobs** | "one scheduled function per watched license" on a recurring schedule | Cron jobs are **statically defined** in `convex/crons.ts` (default export), via `crons.interval("id", { minutes: n }, internal.mod.fn, args)` or `crons.cron(...)`. "At most one run of each cron job executes at any moment." Runtime/dynamic cron registration is only available via the `@convex-dev/crons` component. | ✅ Works. **Design pivot:** we do **not** register one cron per license (can't be done statically, and the runtime component is overkill for a demo). We run **one** cron sweep every N minutes that fans out one scheduled action per active license via `ctx.scheduler.runAfter(0, internal.fetch.runForLicense, {licenseId})`. |
| **Convex scheduled functions** | durable fan-out / compressed demo schedule | `ctx.scheduler.runAfter(delayMs, ref, args)` and `ctx.scheduler.runAt(tsMs, ref, args)`. Callable from mutations (atomic with the transaction) and actions. One function may schedule up to 1000 functions, 8 MB total args. | ✅ Works exactly as the brief needs. Demo mode = schedule the fixture sequence with second-scale delays. |
| **Convex actions for external HTTP** | Firecrawl/OpenAI/AgentMail called "inside a Convex action" | Confirmed: `fetch` and third-party SDKs are only allowed in **actions**, never in queries/mutations. Actions are not transactional; results are persisted by calling a mutation via `ctx.runMutation`. Mutations **are** single-transaction, serializable, and atomic. | ✅ Works. All three sponsor calls live in actions; the non-deterministic outputs (raw HTML, extracted JSON) are handed to **one** mutation — `commitFetchResult` (D-6) — which reads the prior confirmed snapshot, runs the pure diff/identity/privilege logic, inserts the snapshot, and executes the confirm-or-open-case gate **in the same transaction**. There is no window where a snapshot row is readable before its gate outcome (pointer flip or mismatch case) exists. |
| **Convex document size / raw HTML storage** | "raw payload … stored verbatim" inline on every snapshot | Convex caps a single document at ~1 MiB. A board-page `rawHtml` is typically 50–250 KB but is untrusted and unbounded, and the compressed demo schedule creates many snapshots fast; large inline blobs also bloat reactive query payloads. Convex **file storage** (`ctx.storage.store` / `ctx.storage.getUrl`, referenced by `v.id("_storage")`) is the documented home for large blobs. | ⚠️ **Decision D-8:** the full raw payload goes to **Convex file storage**; the snapshot document stores `raw_payload_storage_id`, `raw_payload_sha256`, and a ≤4 KB `raw_payload_excerpt` for instant timeline rendering. Snapshot docs stay small and the size ceiling is removed. The blob is written in the action *before* `commitFetchResult`; an orphan blob (mutation never commits) is invisible and swept, and violates no invariant. |
| **Convex hosting on convex.site** | "deploy live on convex.site … no localhost" | The `@convex-dev/static-hosting` component builds the frontend and serves it at `https://<deployment>.convex.site` with SPA fallback, in the same `npx convex deploy` pass. HTTP actions also serve from `.convex.site`. | ✅ Works. No Vercel/Netlify needed. Satisfies the hackathon "live URL / no localhost" rule and the "Convex is the real backend" rule. |
| **Firecrawl scrape** | `fetch_board_page(...) -> raw_html` | `POST https://api.firecrawl.dev/v2/scrape`, `Authorization: Bearer <key>`. Body: `url`, `formats: ["rawHtml","html","markdown"]`, `onlyMainContent`, `waitFor` (ms), `actions[]`, `proxy: "auto"` (auto-retries with stealth proxy on block), `blockAds` (default true). Response `data.rawHtml`, `data.html`, `data.markdown`, `data.metadata.statusCode`, `data.metadata.*`. Errors: 402 (billing), 429 (rate limit), 5xx. | ✅ Works. `rawHtml` gives us the verbatim payload the audit log requires. Blocked/JS pages handled by `proxy:"auto"` + `waitFor`. |
| **Firecrawl JSON extraction** | (optional) structured extraction | `formats: [{ type: "json", prompt, schema }]` returns `data.json`. Costs more credits; includes `checkPromptInjection`. | ✅ Available, but **not** used as the primary extractor — see Decision D-2. We keep extraction in our own OpenAI call so the FETCH and EXTRACT stages stay separately observable and independently testable. |
| **Firecrawl rate limits** | scheduled re-checks | Free tier 20 req/min; free API key grants 1,000 credits + higher limits; paid tiers 60–200 req/min; **429** on exceed (may carry `Retry-After`). | ✅ Handled explicitly (D-7), **not** absorbed. (1) `runSweep` staggers the fan-out — per-license fetches are scheduled with `ctx.scheduler.runAfter(i * spacingMs, …)` so a sweep never bursts past ~15/min in live mode. (2) A 429 (after one in-action retry honoring `Retry-After`, capped at a few seconds) returns `fetch_status: "rate_limited"`; `commitFetchResult` **writes a snapshot row** with that status and `disposition: "unconfirmed"`. (3) The license is picked up again by the very next sweep (its latest snapshot is not `ok`), appearing in the timeline as its own dot. A rate-limited fetch is never a silent skip — that would reproduce the "board outage treated as no change" failure mode. Demo mode makes **zero** live calls (D-9), so a stage rate-limit cannot touch the judged run. |
| **OpenAI Structured Outputs** | "OpenAI extracts strict-JSON fields" | Structured Outputs supported on the Responses API (`text.format = { type: "json_schema", name, strict: true, schema }`) and Chat Completions (`response_format = { type: "json_schema", json_schema: {...} }`). Requires `strict: true`, every object `additionalProperties: false`, and all keys listed in `required`. Model may return a `refusal` instead of content — must be handled. | ✅ Works. We use it for `extract_license_fields`. Extraction is the **only** OpenAI job; it never decides "is this fine." |
| **OpenAI model names / pricing** | "current model names and pricing tier" | Web sources returned **implausible/poisoned** names ("GPT-6 Astra", "gpt-5.6-sol", "Terra") — **not trusted.** Structured Outputs is documented as supported on `gpt-4o-2024-08-06` and later, the `gpt-4.1` family, and the `gpt-5` family. | ⚠️ **Build-time gate (D-3):** pin `OPENAI_MODEL` in env; default `gpt-4.1-mini`; at boot the extractor action calls `GET /v1/models` once and logs whether the configured model is present, falling back to `gpt-4o-2024-08-06` if not. Exact ID + live price to be re-confirmed against `platform.openai.com/docs/pricing` on build day and recorded in DECISIONS.md. |
| **AgentMail send** | `send_alert(case_id) -> AgentMail message` | Create inbox: `POST https://api.agentmail.to/inboxes` (`client_id`, optional `username`/`domain`/`display_name`). Send: `POST https://api.agentmail.to/inboxes/{inbox_id}/messages/send` with `to`, `subject`, `text`, `html`, `cc`, `bcc`, `reply_to`, `attachments[]`. Node SDK: `new AgentMailClient({ apiKey }).inboxes.messages.send(inboxId, {...})`. Bearer auth. Sending creates a Thread and returns the Message. | ✅ Works. Alert carries both snapshots as an HTML table + a JSON attachment. Human-in-the-loop `cc` is a documented feature we use for the coordinator. |
| **AgentMail inbox/threads** | "AgentMail inbox … alert arrived with both snapshots attached" | Messages belong to Threads; replies are retrievable by listing thread messages; webhooks available for inbound. | ✅ Demo shows the sent message in the AgentMail inbox UI. Inbound reply handling is **out of scope** (documented non-goal); resolution happens in the Attestor dashboard. |

Full pivot rationale is duplicated into `DECISIONS.md` on approval.

---

## 1. Product summary

A hackathon demo scrapes a license page once, prints "Active," and stops.
Production breaks because **"Active" is not a fact — it is a claim made by a page
that can be wrong, stale, or answering about the wrong person.**

**Attestor is a reliability layer that sits between a state license board and a
staffing decision.** It catches the moment a board's answer is stale,
misidentified, or invalid for the assignment — *before* a human trusts it to
schedule, extend, or pull a healthcare worker.

Attestor is **not** a license-lookup app, **not** a compliance checklist, and
**not** a scraper dashboard. Coverage tools (Nursys, Certemy, MedTrainer) tell
you a license exists. Attestor tells you **whether to trust what you just saw**,
and proves when a prior answer would have lied.

It owns eight jobs:

1. **Fetch** the board page on a schedule (Firecrawl).
2. **Extract** structured identity / status / privilege fields (OpenAI, strict JSON).
3. **Diff** against the last *confirmed* snapshot.
4. **Bind identity** — license number + registered name, never name-string alone; a legal-name change is flagged, not reconciled.
5. **Classify privilege** — compact/multistate checked against the worker's actual assignment state.
6. **Decide** confirm-or-escalate — disagreement opens a mismatch case; it never overwrites status.
7. **Record** every fetch as an immutable, timestamped artifact (append-only).
8. **Alert** a human the instant something disagrees (AgentMail), with evidence attached.

**Buyer:** a staffing coordinator or hospital credentialing lead who opens a
real dashboard this week.

### Failure modes Attestor exists to prevent

| # | Failure mode | Real-world consequence | Attestor mechanism |
|---|---|---|---|
| F1 | **Stale status** — a hire-time screenshot has no expiry; a revocation mid-assignment is invisible for months | unlicensed patient care discovered by unrelated audit (one case ran 14 months) | scheduled re-fetch + diff + `time_since_last_confirmation` surfaced on every badge |
| F2 | **Wrong-identity match** — a real license number used by an impostor under a shared first name; or a name change silently converting a licensed nurse to "unlicensed" | 4,000+ patients treated by an impostor before a promotion review; false "unlicensed" flags | `bind_identity` requires number **and** registered name; legal-name change → identity case, not auto-reconcile |
| F3 | **Privilege / assignment mismatch** — "multistate" assumed usable anywhere; a compact license is void once the holder's primary residence isn't a compact state | unlicensed practice in the assignment state, audit failure, BON investigation | `check_privilege(privilege_type, assignment_state)` runs on every snapshot |
| F4 | **Silent status mutation** — a lookup overwrites a stored status with no lineage | no way to prove what was known when | append-only snapshots; displayed status is always a pointer to a snapshot id; no UI path mutates status |
| F5 | **Silently dropped fetch** — a 404 / block page / timeout leaves the last good status looking current | false confidence | every fetch attempt writes a snapshot with a `fetch_status`; a failed fetch is `unconfirmed`, never `confirmed` |

---

## 2. The dominant loop (must survive every layer)

```
        ┌──────────────────────────────────────────────────────────────────────┐
        │  CRON SWEEP  (Convex crons.ts, every N min)  ── staggered fan-out ──▶ │
        │  per license: ctx.scheduler.runAfter(i * spacingMs, runForLicense)    │
        └──────────────────────────────────────────────────────────────────────┘
                                        │
                                        ▼
   ╔══════════════ runForLicense  (ACTION — non-deterministic, NOT atomic) ═════════════╗
   ║  ┌─────────┐            ┌──────────┐                                               ║
   ║  │  FETCH  │──rawHtml──▶│ EXTRACT  │──▶ raw JSON + model id                        ║
   ║  └─────────┘            └──────────┘                                               ║
   ║   Firecrawl /v2/scrape   OpenAI strict-JSON      blob → ctx.storage.store()        ║
   ║   (or fixture in demo)   (or golden in demo)     → raw_payload_storage_id + sha    ║
   ╚═══════════════════════════════════ │ hands all outputs to ═════════════════════════╝
                                        ▼
   ╔═══════════ commitFetchResult  (MUTATION — ONE transaction, atomic — I9) ═══════════╗
   ║  read prior *confirmed* snapshot  ─▶  DIFF  +  BIND IDENTITY  +  CHECK PRIVILEGE   ║
   ║  (pure, deterministic, run inside the mutation)                                    ║
   ║                    ▼                                                               ║
   ║  INSERT snapshot row (disposition set here)   ── AND in the same txn ──▶  GATE:    ║
   ║    • all agree & confidence ≥ medium & fetch_status ok                             ║
   ║        → disposition="confirmed"; licenses.current_confirmed_snapshot_id = new id  ║
   ║    • any conflict / invalid                                                        ║
   ║        → disposition="conflict"; create_mismatch_case(); licenses.open_case_id set;║
   ║          ctx.scheduler.runAfter(0, sendAlert, {caseId})  (transactional schedule)  ║
   ║    • fetch_status != ok  OR  confidence low  OR  rate_limited                      ║
   ║        → disposition="unconfirmed"; pointer untouched; no case                     ║
   ║  + write audit_events rows for fetch / extract / diff / gate                       ║
   ╚══════════════════════════════════════════════════════════════════════════════════════╝
                                        │  (case committed ⇒ alert guaranteed scheduled)
                                        ▼
   ┌────────┐   the snapshot row and its gate outcome become readable together, never apart
   │ ALERT  │   sendAlert (ACTION): AgentMail send, guarded by a unique alerts.by_case row (I8)
   └────────┘
```

**Data-flow guarantee.** The action does only what must be non-deterministic —
the Firecrawl call, the OpenAI call, and the file-storage write. Every *decision*
(diff, identity, privilege, confirm-vs-open-case, pointer flip, case creation,
audit rows) happens inside the single mutation **`commitFetchResult`**. Because
Convex mutations are one serializable transaction, no query can ever observe a
snapshot row before its `disposition` and its consequence (pointer flip *or*
`open_case_id` + scheduled alert) exist. There is no millisecond window in which a
conflicting status is readable without its mismatch case.

**Non-negotiable invariants carried through all layers:**

- **I1 — Traceability:** no status is ever displayed without a snapshot id behind it. The API that returns a worker's badge returns `confirmed_snapshot_id` alongside it.
- **I2 — Identity binding:** no identity match on name-string alone. `bind_identity` considers license number **and** registered name; a legal-name change produces an `identity` case with `mismatch_reason = "legal_name_change"`, distinct from a status flag.
- **I3 — Privilege binding:** no privilege treated as valid without `check_privilege` against the worker's `assignment_state`.
- **I4 — No auto-resolution:** a `mismatch_case` moves to `confirmed` / `dismissed` **only** by an explicit human action recorded with actor + timestamp.
- **I5 — Append-only:** snapshots are insert-only. `commitFetchResult` only ever `db.insert`s into `snapshots`; the table has no update/patch call anywhere in the codebase. "Current status" = `licenses.current_confirmed_snapshot_id`, a pointer, updated only when a fetch *agrees*.
- **I6 — Fail closed:** an ambiguous, refused, rate-limited, or failed fetch/extraction is `fetch_status != "ok"` (or `extraction_confidence == "low"`) → `disposition = "unconfirmed"` and can never become the `current_confirmed_snapshot_id`.
- **I7 — No live dependency on stage:** demo mode (D-9) replaces **both** the Firecrawl call **and** the OpenAI call with pre-computed fixture data; only the two non-deterministic edges are swapped, every mutation, decision, table write, and UI path is byte-for-byte identical to live.
- **I8 — Alert exactly once per case:** `sendAlert` is guarded by a unique `alerts` row keyed on `mismatch_case_id` (checked-then-inserted inside a mutation); re-fetches that re-confirm the same still-open conflict never re-send.
- **I9 — Atomic snapshot + gate:** the snapshot `db.insert` and the gate outcome (pointer flip, or `create_mismatch_case` + `open_case_id` + `scheduler.runAfter(sendAlert)`) execute in the **same** `commitFetchResult` transaction. A conflicting or failed snapshot is never readable without its case (or its `unconfirmed` disposition) already present. A race here would silently reproduce the exact failure mode Attestor exists to catch — so it is closed structurally, not by convention.

---

## 3. The two-plane model

### Plane 1 — Reference workload (the roster)

A thin coordinator UI: add a worker (name as registered, name as hired, license
number, issuing state, assignment state), see the roster with badges, open a
worker's timeline. **This plane displays data and triggers a watch. It never
decides validity and never mutates a stored status.** It is deliberately
minimal — it exists only to give the supervisor something real to supervise.

### Plane 2 — Attestor (the supervisor)

Owns fetch scheduling, extraction, diffing, identity binding, privilege
checking, mismatch-case creation, alerting, and the audit log. It **writes new
snapshots and opens cases.** It **never overwrites a prior snapshot.** Every
fetch is append-only; "current status" is always a pointer to the latest
*confirmed* snapshot, never a mutation of history.

**Banned:** silent mutation of any status field without an unbroken lineage from
raw fetch → extracted fields → displayed word.

| Concern | Plane 1 (roster) | Plane 2 (Attestor) |
|---|---|---|
| Add / edit worker & assignment | ✅ | — |
| Trigger a watch | ✅ (on create) | ✅ (cron sweep) |
| Fetch board page | — | ✅ |
| Extract / diff / bind / classify | — | ✅ |
| Write a snapshot | — | ✅ (insert only) |
| Open a mismatch case | — | ✅ |
| Send an alert | — | ✅ |
| Resolve a mismatch case | ✅ (human action in UI) | records actor+ts, flips pointer |
| Mutate a stored status directly | 🚫 never | 🚫 never |

---

## 4. Critical entities — field-level schema

Convex tables (all `_id`, `_creationTime` are Convex built-ins). Types are
Convex validators.

### `workers`
| Field | Type | Notes |
|---|---|---|
| `name_registered` | `v.string()` | legal name as on the board record |
| `name_hired` | `v.string()` | name the facility onboarded them under |
| `license_number` | `v.string()` | as provided by the coordinator |
| `issuing_state` | `v.string()` | 2-letter; board that issued the license |
| `created_by` | `v.string()` | coordinator identifier (demo: static) |

### `assignments`
| Field | Type | Notes |
|---|---|---|
| `worker_id` | `v.id("workers")` | |
| `facility_name` | `v.string()` | |
| `assignment_state` | `v.string()` | 2-letter; where care is delivered — the F3 check input |
| `start_date` | `v.string()` | ISO date |
| `active` | `v.boolean()` | inactive assignments are not swept |

### `licenses`
| Field | Type | Notes |
|---|---|---|
| `worker_id` | `v.id("workers")` | |
| `license_number` | `v.string()` | |
| `issuing_state` | `v.string()` | |
| `board_profile_url` | `v.string()` | resolved board lookup URL (or fixture id in demo mode) |
| `license_type` | `v.union(v.literal("RN"), v.literal("LPN"), v.literal("CNA"))` | |
| `declared_privilege_type` | `v.union(v.literal("single_state"), v.literal("multistate"), v.literal("unknown"))` | coordinator's expectation; compared to extracted |
| `watch_enabled` | `v.boolean()` | cron sweep skips `false` |
| `watch_interval_minutes` | `v.number()` | live mode cadence |
| `current_confirmed_snapshot_id` | `v.union(v.id("snapshots"), v.null())` | **the pointer** — I1/I5; `null` until first agreeing fetch |
| `open_case_id` | `v.union(v.id("mismatch_cases"), v.null())` | at most one open case per license |
| `last_fetch_at` | `v.union(v.number(), v.null())` | ms epoch; drives `time_since_last_confirmation` |
| `fixture_sequence` | `v.array(v.string())` | demo mode only (D-9/D-10 audit → D-11): ordered fixture ids this license serves on successive fetches; `[]` in live mode |
| `fixture_cursor` | `v.number()` | demo mode only: index into `fixture_sequence` for the next fetch; `0` in live mode |

### `settings`  *(singleton — one row; added in cross-check audit, D-11)*
| Field | Type | Notes |
|---|---|---|
| `demo_mode` | `v.boolean()` | when `true`: `fetch_board_page` + `extract_license_fields` use fixtures, zero Firecrawl/OpenAI calls (D-9); UI shows the DEMO DATA banner |
| `staleness_threshold_ms` | `v.number()` | overrides the `deriveBadge` default (D-5): 7 days live, 20 s demo |
| `updated_at` | `v.number()` | ms epoch of the last toggle |

### `snapshots`  *(append-only — I5)*
| Field | Type | Notes |
|---|---|---|
| `license_id` | `v.id("licenses")` | |
| `fetched_at` | `v.number()` | ms epoch, set at fetch time |
| `source_url` | `v.string()` | exact URL hit (or `fixture://<id>`) |
| `source_mode` | `v.union(v.literal("live"), v.literal("fixture"))` | I7 — demo data is always labelled |
| `raw_payload_storage_id` | `v.union(v.id("_storage"), v.null())` | **D-8** — full verbatim `rawHtml` (or fixture HTML) in Convex file storage; `null` only when the fetch produced no body at all (e.g. DNS failure) |
| `raw_payload_excerpt` | `v.string()` | first ≤4096 chars of the raw payload, inline, for instant timeline rendering without a storage round-trip |
| `raw_payload_sha256` | `v.string()` | hash of the **full** payload; integrity check proving neither the blob nor the row was altered (M7) |
| `raw_payload_bytes` | `v.number()` | size of the stored blob |
| `fetch_status` | `v.union(v.literal("ok"), v.literal("http_error"), v.literal("blocked"), v.literal("rate_limited"), v.literal("timeout"), v.literal("extraction_failed"), v.literal("extraction_refused"))` | I6 — anything but `ok` can't be confirmed. **`rate_limited`** = Firecrawl 429 after one bounded in-action `Retry-After` retry (D-7) |
| `fetch_http_code` | `v.union(v.number(), v.null())` | from `data.metadata.statusCode`; `429` for `rate_limited` |
| `retry_of_snapshot_id` | `v.union(v.id("snapshots"), v.null())` | set when this fetch is the next-sweep retry of a prior `rate_limited`/`blocked`/`timeout` snapshot — lets the timeline link the dots |
| `extracted_fields` | `v.union(extractedFields, v.null())` | see below; `null` when `fetch_status != ok` |
| `extractor_model` | `v.union(v.string(), v.null())` | e.g. `gpt-4.1-mini` — provenance |
| `extractor_raw_response` | `v.union(v.string(), v.null())` | the model's raw JSON string, for replay |
| `diff_result` | `v.union(diffResult, v.null())` | see below; `null` for the first-ever snapshot |
| `identity_result` | `v.union(identityResult, v.null())` | see below |
| `privilege_result` | `v.union(privilegeResult, v.null())` | see below |
| `disposition` | `v.union(v.literal("confirmed"), v.literal("conflict"), v.literal("unconfirmed"))` | the GATE outcome for this snapshot |

`extractedFields` object (strict-JSON target for OpenAI):
| Field | Type | Notes |
|---|---|---|
| `licensee_name` | `v.string()` | name exactly as rendered on the board page |
| `license_number` | `v.string()` | as rendered |
| `status_word` | `v.string()` | verbatim board word: "Active", "Expired", "Pending", "Application Expired", … |
| `status_normalized` | `v.union(v.literal("active"), v.literal("inactive"), v.literal("expired"), v.literal("pending"), v.literal("revoked"), v.literal("suspended"), v.literal("unknown"))` | OpenAI maps the verbatim word; `unknown` when unmappable |
| `issue_date` | `v.union(v.string(), v.null())` | ISO or null |
| `expire_date` | `v.union(v.string(), v.null())` | ISO or null |
| `privilege_type` | `v.union(v.literal("single_state"), v.literal("multistate"), v.literal("unknown"))` | |
| `primary_state_of_residence` | `v.union(v.string(), v.null())` | needed for compact validity |
| `extraction_confidence` | `v.union(v.literal("high"), v.literal("medium"), v.literal("low"))` | `low` → treated as ambiguous by the GATE (I6) |

`diffResult` object:
| Field | Type | Notes |
|---|---|---|
| `agrees` | `v.boolean()` | true ⇢ candidate for confirmation |
| `compared_snapshot_id` | `v.union(v.id("snapshots"), v.null())` | the prior *confirmed* snapshot |
| `conflicts` | `v.array(v.object({ field: v.string(), prior: v.string(), current: v.string() }))` | field-level, human-readable |

`identityResult` object:
| Field | Type | Notes |
|---|---|---|
| `match_confidence` | `v.union(v.literal("exact"), v.literal("high"), v.literal("name_change_suspected"), v.literal("mismatch"))` | |
| `number_matches` | `v.boolean()` | extracted vs `licenses.license_number` |
| `registered_name_similarity` | `v.number()` | 0–1, normalized edit-distance on `name_registered` |
| `mismatch_reason` | `v.union(v.literal("none"), v.literal("legal_name_change"), v.literal("wrong_person"), v.literal("number_mismatch"))` | I2 — `legal_name_change` is distinct from a status flag |

`privilegeResult` object:
| Field | Type | Notes |
|---|---|---|
| `valid` | `v.boolean()` | |
| `reason` | `v.union(v.literal("single_state_matches_assignment"), v.literal("multistate_resident_compact"), v.literal("multistate_but_assignment_state_mismatch"), v.literal("multistate_resident_not_compact"), v.literal("privilege_unknown"))` | I3 |
| `assignment_state` | `v.string()` | echoed input |
| `compact_member` | `v.boolean()` | from a static bundled NLC member list (demo scope note §11) |

### `mismatch_cases`  *(resolution is human-only — I4)*
| Field | Type | Notes |
|---|---|---|
| `license_id` | `v.id("licenses")` | |
| `worker_id` | `v.id("workers")` | denormalized for the dashboard |
| `type` | `v.union(v.literal("identity"), v.literal("status"), v.literal("privilege"))` | |
| `snapshot_a_id` | `v.id("snapshots")` | prior confirmed (or first snapshot for a privilege/identity-only case) |
| `snapshot_b_id` | `v.id("snapshots")` | the snapshot that triggered the case |
| `reason` | `v.string()` | rendered explanation ("T2 status 'Expired' ≠ T1 confirmed 'Active'") |
| `detail` | `v.object({ conflicts: v.array(...), identity_result: v.optional(identityResult), privilege_result: v.optional(privilegeResult) })` | full machine detail for replay |
| `resolution_state` | `v.union(v.literal("open"), v.literal("confirmed"), v.literal("dismissed"))` | |
| `resolved_by` | `v.union(v.string(), v.null())` | actor; `null` while open |
| `resolved_at` | `v.union(v.number(), v.null())` | |
| `resolution_note` | `v.union(v.string(), v.null())` | required free text on human resolve |

### `alerts`  *(exactly-once guard — I8)*
| Field | Type | Notes |
|---|---|---|
| `mismatch_case_id` | `v.id("mismatch_cases")` | **unique** — enforced by a `by_case` index + check-before-insert in the mutation |
| `sent_at` | `v.number()` | |
| `agentmail_message_id` | `v.union(v.string(), v.null())` | from the send response |
| `agentmail_thread_id` | `v.union(v.string(), v.null())` | |
| `to` | `v.string()` | |
| `send_status` | `v.union(v.literal("sent"), v.literal("failed"))` | |
| `send_error` | `v.union(v.string(), v.null())` | |

### `audit_events`  *(append-only)*
| Field | Type | Notes |
|---|---|---|
| `at` | `v.number()` | |
| `license_id` | `v.union(v.id("licenses"), v.null())` | |
| `snapshot_id` | `v.union(v.id("snapshots"), v.null())` | |
| `case_id` | `v.union(v.id("mismatch_cases"), v.null())` | |
| `stage` | `v.union(v.literal("fetch"), v.literal("extract"), v.literal("diff"), v.literal("gate"), v.literal("alert"), v.literal("resolve"))` | one row per loop stage per run |
| `outcome` | `v.string()` | `"ok"`, `"conflict:status"`, `"blocked"`, `"alert_sent"`, `"case_confirmed"`, … |
| `message` | `v.string()` | human-readable line for the timeline UI |
| `actor` | `v.union(v.string(), v.literal("system"))` | `system` for the loop; a coordinator id for `resolve` |

### Badge states (derived, never stored as a mutable field)

`deriveBadge(license, latestSnapshot, now)` evaluates the three states in a
**fixed precedence order** — the first match wins, later clauses are not
evaluated (D-10):

1. 🟠 **Needs Review** — `open_case_id != null`. An open case **always** renders
   amber, even if the license has also gone stale. Checked first.
2. ⚪ **Unconfirmed** — (only reached when `open_case_id == null`)
   `current_confirmed_snapshot_id == null` (never confirmed) **or**
   (last fetch `fetch_status != "ok"` **and** no prior confirmation) **or**
   `time_since_last_confirmation >= staleness_threshold`.
3. 🟢 **Verified** — `current_confirmed_snapshot_id != null` **and**
   `time_since_last_confirmation < staleness_threshold` (with `open_case_id`
   already known null and staleness already ruled out by step 2).

Staleness only ever downgrades a license to ⚪ when there is **no** open case;
`open_case_id` dominates staleness.

| Order | Badge | Condition (first match wins) |
|---|---|---|
| 1 | 🟠 **Needs Review** | `open_case_id != null` |
| 2 | ⚪ **Unconfirmed** | `open_case_id == null` **and** ( `current_confirmed_snapshot_id == null` **or** (`fetch_status != "ok"` and no prior confirmation) **or** `time_since_last_confirmation >= staleness_threshold` ) |
| 3 | 🟢 **Verified** | `open_case_id == null` **and** `current_confirmed_snapshot_id != null` **and** `time_since_last_confirmation < staleness_threshold` |

---

## 5. Deterministic tools — typed signatures

All are pure/typed functions or thin Convex wrappers. OpenAI appears **only**
inside `extract_license_fields`, and only on the live path. No tool "decides"
validity — the GATE (the confirm-vs-open-case branch inside `commitFetchResult`)
is mechanical.

```ts
// ── FETCH ────────────────────────────────────────────────────────────────────
// Convex action helper. Live: Firecrawl POST /v2/scrape (formats:["rawHtml"],
// proxy:"auto", waitFor, blockAds). Demo: returns the license's next fixture
// HTML directly — NO Firecrawl call (D-9).
fetch_board_page(input: {
  license_number: string,
  state: string,
  board_profile_url: string,          // or "fixture://<id>"
  mode: "live" | "fixture",
}): Promise<{
  raw_html: string,                   // verbatim rawHtml / fixture HTML ("" if no body)
  raw_payload_sha256: string,
  raw_payload_excerpt: string,        // first ≤4096 chars
  raw_payload_bytes: number,
  source_url: string,
  source_mode: "live" | "fixture",
  fetched_at: number,                 // ms epoch
  fetch_status: "ok" | "http_error" | "blocked" | "rate_limited" | "timeout",
  fetch_http_code: number | null,     // 429 ⇒ rate_limited (after one bounded Retry-After retry, D-7)
}>

// ── EXTRACT ──────────────────────────────────────────────────────────────────
// Convex action helper. Live: OpenAI Structured Outputs (strict json_schema) —
// the ONLY LLM call in the system. Demo (D-9): returns the fixture's pre-computed
// golden ExtractedFields with model="fixture-golden" — NO OpenAI call.
extract_license_fields(raw_html: string, mode: "live" | "fixture", fixture_id?: string): Promise<{
  ok: true,  fields: ExtractedFields, model: string, raw_response: string
} | {
  ok: false, reason: "extraction_failed" | "extraction_refused", model: string, raw_response: string | null
}>

// ── DIFF ─────────────────────────────────────────────────────────────────────
// Pure function. No LLM.
diff_snapshot(
  next: ExtractedFields,
  prior: ExtractedFields | null,       // prior *confirmed* snapshot's fields
  prior_snapshot_id: string | null,
): { agrees: boolean, compared_snapshot_id: string | null,
     conflicts: { field: string, prior: string, current: string }[] }

// ── BIND IDENTITY ────────────────────────────────────────────────────────────
// Pure function. Number + registered name, never name-string alone (I2).
bind_identity(
  worker: { license_number: string, name_registered: string },
  extracted: ExtractedFields,
): { match_confidence: "exact" | "high" | "name_change_suspected" | "mismatch",
     number_matches: boolean,
     registered_name_similarity: number,
     mismatch_reason: "none" | "legal_name_change" | "wrong_person" | "number_mismatch" }

// ── CHECK PRIVILEGE ──────────────────────────────────────────────────────────
// Pure function. Compact/multistate vs the worker's real assignment state (I3).
check_privilege(
  privilege_type: "single_state" | "multistate" | "unknown",
  assignment_state: string,
  primary_state_of_residence: string | null,
  issuing_state: string,
): { valid: boolean, reason: PrivilegeReason,
     assignment_state: string, compact_member: boolean }

// ── CREATE MISMATCH CASE (the GATE) ──────────────────────────────────────────
// NOT a standalone mutation — an internal helper invoked *inside* the
// commitFetchResult transaction (I9). Idempotent per (license_id, open case).
// Never auto-resolves.
//
// TYPE PRIORITY (D-10): a single conflicting fetch can trip more than one kind
// of disagreement at once (e.g. a status flip AND a privilege violation on the
// same snapshot). The single `type` written to the case is the HIGHEST-priority
// detected conflict, in the order:  identity  >  privilege  >  status.
// Rationale: a wrong-person match is the most severe failure mode and must never
// be masked by a lower-severity flag. `detail` still records EVERY detected
// conflict (all types), so the audit trail loses nothing — only the headline
// `type` is chosen by priority.
create_mismatch_case(ctx, input: {
  license_id: Id<"licenses">,
  type: "identity" | "status" | "privilege",   // = max(detected, by identity>privilege>status)
  snapshot_a_id: Id<"snapshots">,
  snapshot_b_id: Id<"snapshots">,
  reason: string,
  detail: CaseDetail,                           // records ALL detected conflict types, not just `type`
}): { case_id: Id<"mismatch_cases">, created: boolean /* false if one already open */ }

// ── COMMIT FETCH RESULT (the atomic core — D-6 / I9) ─────────────────────────
// Convex mutation. ONE transaction. Called by runForLicense with the action's
// non-deterministic outputs. Runs diff/identity/privilege (pure), inserts the
// snapshot, and applies the gate — no partial state is ever observable.
commitFetchResult(input: {
  license_id: Id<"licenses">,
  fetched_at: number,
  source_url: string,
  source_mode: "live" | "fixture",
  raw_payload_storage_id: Id<"_storage"> | null,
  raw_payload_excerpt: string,
  raw_payload_sha256: string,
  raw_payload_bytes: number,
  fetch_status: "ok" | "http_error" | "blocked" | "rate_limited" | "timeout" | "extraction_failed" | "extraction_refused",
  fetch_http_code: number | null,
  extracted_fields: ExtractedFields | null,
  extractor_model: string | null,
  extractor_raw_response: string | null,
  retry_of_snapshot_id: Id<"snapshots"> | null,
}): Promise<{
  snapshot_id: Id<"snapshots">,
  disposition: "confirmed" | "conflict" | "unconfirmed",
  case_id: Id<"mismatch_cases"> | null,   // set iff a new case was created this txn
  alert_scheduled: boolean,               // true iff scheduler.runAfter(sendAlert) fired in this txn
}>

// ── RESOLVE CASE (human-only — I4) ──────────────────────────────────────────
// Convex mutation. The ONLY path that clears licenses.open_case_id.
resolveCase(input: {
  case_id: Id<"mismatch_cases">,
  decision: "confirmed" | "dismissed",
  actor: string,          // required, non-empty
  note: string,           // required, non-empty
}): Promise<{ resolution_state: "confirmed" | "dismissed" }>

// ── SEND ALERT ───────────────────────────────────────────────────────────────
// Convex action. AgentMail send. Exactly once per case (I8).
send_alert(case_id: Id<"mismatch_cases">): Promise<{
  sent: boolean,                       // false if an alerts row already exists
  agentmail_message_id: string | null,
  agentmail_thread_id: string | null,
}>
```

Supporting orchestration (Convex internal functions, not "tools"):
- `runSweep` — cron entry; reads `watch_enabled` licenses and staggers
  `ctx.scheduler.runAfter(i * spacingMs, internal.loop.runForLicense, {licenseId})`
  to stay under the Firecrawl rate limit (D-7).
- `runForLicense` — **action**; the only non-atomic step. Calls
  `fetch_board_page`, stores the raw blob via `ctx.storage.store`, calls
  `extract_license_fields`, then calls the **`commitFetchResult`** mutation with
  all results. Wraps everything so no throw escapes — a thrown fetch/extract
  still ends in a `commitFetchResult` call with the right non-`ok` `fetch_status`.
- `commitFetchResult` — **mutation**; the atomic core (above). Also writes the
  `audit_events` rows for fetch/extract/diff/gate in-transaction.
- `sendAlert` — **action**; scheduled transactionally by `commitFetchResult` when
  a case is created. AgentMail send + `recordAlert` mutation (unique `by_case`).
- `resolveCase` — **mutation**; human-triggered from the UI (above).

---

## 6. The four end-to-end experiences

### A — Clean success (proves the loop runs and confirms honestly)
Coordinator adds Nurse A (license #X, issuing NY, assignment NY). Attestor
fetches, extracts, finds no prior confirmed snapshot, runs identity + privilege
(both pass), sets `disposition = "confirmed"`, points
`current_confirmed_snapshot_id` at it. Badge: 🟢 **Verified**, with the fetch
timestamp. Clicking the snapshot shows the raw board HTML behind the extraction.

### B — Live mismatch caught and automatically flagged (F1 / F4)
The compressed re-check runs. New fetch extracts `status_normalized = "expired"`
where the confirmed snapshot said `"active"`. `diff_snapshot` returns
`agrees:false, conflicts:[{field:"status_normalized", prior:"active",
current:"expired"}]`. The GATE opens a `status` mismatch case, sets
`open_case_id`, leaves `current_confirmed_snapshot_id` **unchanged** (badge flips
to 🟠 **Needs Review** purely from `open_case_id`), and `send_alert` fires **once**
with both snapshots side-by-side. The system never auto-clears; a human must
resolve.

### C — Operator replay / compare (proves it's systemic, not a one-off claim)
The coordinator opens the case: full timeline — fetch T1 (`active`, raw board
text, extracted fields, `disposition:confirmed`), fetch T2 (`expired`, raw board
text, extracted fields, `diff_result`, `disposition:conflict`), and the plain
reason string for why T2 was flagged instead of silently accepted. A
side-by-side compare view renders `snapshot_a` vs `snapshot_b` field-by-field
with the conflicting rows highlighted.

### D — Six-week audit-trail proof (proves what a hire-time-only check misses, F1)
Dashboard shows Nurse D: verified 🟢 at hire six weeks ago, then four scheduled
re-checks. The fourth catches a `suspended` status → 🟠 case + alert. Caption:
**"A hire-time-only check would still show this worker Active today. Attestor
caught it on schedule, not by accident."** The timeline shows every
`audit_events` row from fetch to alert.

---

## 7. Sequential build steps

Each step: **What** · **Why (failure mode)** · **New coordinator capability** ·
**Backend/frontend changes** · **Data/API/UI changes (named)** · **Testing** ·
**Definition of Done (observable)**.

### Step 1 — Lock the product contract
- **What:** Freeze the JSON shapes for `ExtractedFields`, `diffResult`,
  `identityResult`, `privilegeResult`, `snapshots`, `mismatch_cases`, `alerts`,
  `audit_events`, and the three badge derivations, in a single
  `convex/contract.ts` of validators + a `CONTRACT.md`.
- **Why:** Every downstream failure mode (F1–F5) depends on a stable snapshot and
  case shape; ambiguity here becomes a silent-mutation bug later.
- **New capability:** none yet (internal).
- **Backend:** `convex/contract.ts` exporting reusable `v.object(...)` validators.
  **Frontend:** a TS types file generated/mirrored from the same shapes.
- **Data/API/UI:** all table validators drafted; badge function
  `deriveBadge(license, latestSnapshot, now)` signature fixed, with the **fixed
  precedence order** from §4 (Needs Review → Unconfirmed → Verified; first match
  wins) — D-10.
- **Testing:** unit — `deriveBadge` truth table (10+ cases) compiles and returns
  the expected badge for every combination of pointer / open-case / staleness /
  `fetch_status`. Table **must** include the precedence case explicitly:
  `open_case_id != null` **and** `time_since_last_confirmation >=
  staleness_threshold` **⇒ 🟠 Needs Review** (not ⚪ Unconfirmed). Also:
  no-pointer+no-case ⇒ ⚪; pointer+stale+no-case ⇒ ⚪; pointer+fresh+no-case ⇒ 🟢;
  pointer+fresh+open-case ⇒ 🟠.
- **DoD:** `deriveBadge` unit tests pass for all four experiences' end states
  **and** the open-case-plus-stale precedence case; `CONTRACT.md` review
  checklist ticks A–D.

### Step 2 — Seed fixture board pages
- **What:** 8 static HTML fixtures under `fixtures/` + a `fixtures/index.ts`
  manifest, each mapped to an intended extraction result and an expected loop
  outcome. Coverage: (1) active/clean, (2) active→expired flip pair [2a,2b],
  (3) name-mismatch / wrong-person, (4) legal-name-change, (5) privilege
  violation (multistate, assignment state ≠ compact), (6) blocked/CAPTCHA page,
  (7) 404 page, (8) six-week suspension sequence (multi-fetch).
- **Why:** I7 — the judge demo must not depend on a live board; also gives F1–F3
  deterministic adversarial inputs.
- **New capability:** none (enables demo mode later).
- **Backend:** fixtures bundled into the Convex deployment (imported by
  `fetch_board_page` in `mode:"fixture"`). **Frontend:** none.
- **Data/API/UI:** `fixtures/index.ts` → `{ id, html, expected_fields,
  expected_outcome, sequence?: string[] }`.
- **Testing:** fixture-based — a test iterates the manifest and asserts each
  fixture is non-empty, has a sha256, and parses as HTML.
- **DoD:** each fixture, run through `extract_license_fields` (Step 5), produces
  its documented distinct `ExtractedFields` — recorded as a golden file.

### Step 3 — Convex schema and scheduled watch
- **What:** `convex/schema.ts` with all 8 tables (`workers`, `assignments`, `licenses`, `snapshots`, `mismatch_cases`, `alerts`, `audit_events`, `settings`) + indexes; `convex/crons.ts`
  with one `crons.interval("sweep", { minutes: 5 }, internal.sweep.runSweep)`;
  `runSweep` **staggers** the fan-out —
  `ctx.scheduler.runAfter(i * spacingMs, internal.loop.runForLicense,
  {licenseId})` across `watch_enabled` licenses, `spacingMs` sized to keep the
  burst under ~15 fetches/min (D-7). Also `commitFetchResult` is scaffolded here
  as the single mutation entry point (D-6); `runForLicense` is stubbed to call it
  with a synthetic `fetch_status:"ok"` payload so the atomic write path exists
  from the start.
- **Why:** F1 — converts a one-shot scrape into a standing watch with memory;
  without the durable sweep, staleness is never detected. Staggering pre-empts
  the F5-adjacent "rate-limited fetch silently lost" failure.
- **New capability:** adding a worker + license persists it and it appears in the
  roster; within one sweep a snapshot row + audit rows appear via
  `commitFetchResult`.
- **Backend:** `schema.ts`, `crons.ts`, `sweep.ts`, `loop.ts`, `commit.ts`
  (`commitFetchResult` skeleton), mutations `addWorker`, `addLicense`, query
  `listRoster`. **Frontend:** minimal "Add worker" form + roster list (Convex
  `useQuery`).
- **Data/API/UI:** indexes `licenses.by_watch_enabled`, `snapshots.by_license`,
  `snapshots.by_license_and_disposition`, `mismatch_cases.by_license_and_state`,
  `alerts.by_case` (unique), `audit_events.by_license`. `addWorker(args)` /
  `addLicense(args)` / `commitFetchResult(args)` signatures from §5.
- **Testing:** integration (`convex-test`) — calling `addLicense` then advancing
  scheduler time causes `runForLicense` → `commitFetchResult` to execute exactly
  once per license and insert exactly one `snapshots` row per run.
- **DoD:** adding a worker in the deployed UI produces one `snapshots` row plus an
  `audit_events` row with `stage:"gate"` within one sweep interval (≤5 min live,
  ≤5 s demo), written by a single `commitFetchResult` transaction.

### Step 4 — Firecrawl fetch integration
- **What:** implement `fetch_board_page` live path: `POST
  https://api.firecrawl.dev/v2/scrape` with
  `{ url, formats:["rawHtml"], onlyMainContent:false, waitFor:2500,
  proxy:"auto", blockAds:true }`, `Authorization: Bearer FIRECRAWL_API_KEY`.
  In `runForLicense`: write the full `data.rawHtml` to **Convex file storage**
  (`ctx.storage.store`), compute sha256 over the full payload and a ≤4 KB
  excerpt (D-8), then hand `raw_payload_storage_id` + `raw_payload_excerpt` +
  `raw_payload_sha256` + `raw_payload_bytes` + `fetch_status` + `fetch_http_code`
  to **`commitFetchResult`**, which does the `snapshots` insert. `fetch_status`
  mapping: 2xx→`ok`; **429 → `rate_limited`** (after one in-action retry that
  honors `Retry-After`, capped ~3 s — D-7); 403/anti-bot→`blocked`; other 4xx/5xx
  →`http_error`; network timeout→`timeout`. A `rate_limited`/`blocked`/`timeout`
  snapshot is re-attempted by the next sweep with `retry_of_snapshot_id` set.
- **Why:** F5 — a 404 / block / **429** / timeout must store its **own** snapshot
  with a non-`ok` `fetch_status`, never be dropped — a silently skipped
  rate-limited fetch would leave a stale status looking current, the exact
  failure Attestor exists to catch.
- **New capability:** coordinator sees a real timestamped snapshot (raw HTML
  viewable via a storage URL) for a live board URL, and sees rate-limited /
  blocked fetches as their own timeline dots linked to their retry.
- **Backend:** `firecrawl.ts` action helper + `ctx.storage` write in
  `runForLicense` + `commitFetchResult` insert path. **Frontend:** snapshot
  detail drawer showing `raw_payload_excerpt`, a "view full raw HTML" link
  (storage URL), `source_url`, `source_mode`, `fetch_status`, `fetch_http_code`,
  `fetched_at`, and a "retry of …" link when set.
- **Data/API/UI:** `snapshots` rows populated for real; `source_mode:"live"`;
  `raw_payload_storage_id` non-null on any fetch that returned a body.
- **Testing:** failure-injection (mocked Firecrawl) — a **429** produces a
  `snapshots` row with `fetch_status:"rate_limited"`, `fetch_http_code:429`,
  `disposition:"unconfirmed"`; a block page → `fetch_status:"blocked"`; a 500 →
  `http_error`; a hang → `timeout`. In every case exactly one snapshot row is
  written and **no** exception escapes `runForLicense`. A follow-up sweep writes
  a second snapshot with `retry_of_snapshot_id` pointing at the first.
- **DoD:** (1) a deliberately bad URL yields a stored `unconfirmed` snapshot
  visible in the UI with its HTTP code; (2) a simulated 429 yields a stored
  `rate_limited` snapshot that the next sweep retries as a linked dot — never a
  gap; (3) a good URL yields a stored `ok` snapshot whose full raw HTML opens
  from file storage and whose sha256 matches a re-hash.

### Step 5 — OpenAI extraction and diff
- **What:** `extract_license_fields` via OpenAI Structured Outputs
  (`response_format`/`text.format` `json_schema`, `strict:true`,
  `additionalProperties:false`, all keys `required`) targeting `ExtractedFields`;
  handle a `refusal` → `{ ok:false, reason:"extraction_refused" }`. Then
  `diff_snapshot` (pure) comparing normalized status, name, number, dates,
  privilege against the prior **confirmed** snapshot.
- **Why:** F1 — a status word must become a structured, comparable field so a
  change is *flagged*, never a silent pass. OpenAI **extracts only**; the diff is
  a pure function inside `commitFetchResult` — the model never judges "is this
  fine."
- **New capability:** coordinator sees extracted fields + a field-level diff on
  each snapshot.
- **Backend:** `openai.ts` action helper, `diff.ts` **pure** module, boot-time
  `GET /v1/models` model check (D-3). `diff_snapshot` runs **inside**
  `commitFetchResult` (against the prior confirmed snapshot read in the same
  transaction), not in the action — extraction is the action's only new job here.
  **Frontend:** snapshot drawer adds an "Extracted fields" table and a "Diff vs
  last confirmed" list.
- **Data/API/UI:** `snapshots.extracted_fields`, `.extractor_model`,
  `.extractor_raw_response`, `.diff_result` now populated by `commitFetchResult`.
  An extraction failure/refusal → `fetch_status:"extraction_failed"` /
  `"extraction_refused"`, `extracted_fields:null`, `disposition:"unconfirmed"`.
- **Testing:** unit per fixture (Step 2 goldens) — each fixture → its exact
  `ExtractedFields`; unit for `diff_snapshot` (pure) — the active→expired pair
  yields `agrees:false` with the status conflict; an unchanged re-fetch yields
  `agrees:true, conflicts:[]`; integration — a mocked OpenAI refusal ends in an
  `unconfirmed` snapshot, not a throw.
- **DoD:** the flip fixture pair produces a stored `diff_result` with
  `agrees:false`; an identical re-fetch produces `agrees:true` — **never** a
  silent pass and never a false conflict; a refused extraction is `unconfirmed`.

### Step 6 — Identity binding and privilege check
- **What:** `bind_identity` (number match + normalized name similarity on
  `name_registered`; thresholds → `exact` / `high` / `name_change_suspected` /
  `mismatch`) and `check_privilege` (static bundled NLC member-state list;
  `multistate` + `assignment_state` non-member or `primary_state_of_residence`
  non-compact → `valid:false`).
- **Why:** F2 (name-only matching is banned; a legal-name change is *flagged*,
  not reconciled) and F3 (privilege never assumed valid without the
  assignment-state check).
- **New capability:** coordinator sees an identity verdict and a privilege
  verdict on every snapshot, with distinct reasons.
- **Backend:** `identity.ts`, `privilege.ts` **pure** modules; called **inside
  `commitFetchResult`** (same transaction as the diff and the insert), not in the
  action. **Frontend:** snapshot drawer adds "Identity" and "Privilege" verdict
  rows.
- **Data/API/UI:** `snapshots.identity_result`, `.privilege_result` populated.
- **Testing:** unit — the name-mismatch fixture → `mismatch_reason:"wrong_person"`;
  the legal-name-change fixture → `"legal_name_change"` (distinct from any status
  conflict); the privilege fixture →
  `reason:"multistate_but_assignment_state_mismatch", valid:false`.
- **DoD:** the name-change fixture produces an **identity**-typed signal separate
  from status; the privilege fixture produces a **privilege**-typed signal — the
  two are never conflated in the stored result or the UI.

### Step 7 — Mismatch case creation and gating (atomic — D-6 / I9)
- **What:** complete the gate branch **inside `commitFetchResult`** (one
  transaction): after the in-transaction diff/identity/privilege —
  - **all agree/valid** **and** `fetch_status=="ok"` **and**
    `extraction_confidence ≥ "medium"` → `disposition:"confirmed"` and flip
    `licenses.current_confirmed_snapshot_id` to the row just inserted;
  - **any conflict/invalid** → `disposition:"conflict"`,
    `create_mismatch_case(ctx, …)` (idempotent — returns `created:false` if
    `open_case_id` already set), set `licenses.open_case_id`, and
    `ctx.scheduler.runAfter(0, internal.alert.sendAlert, {caseId})` **in the same
    transaction** (so a committed case always has a scheduled alert);
  - **`fetch_status!="ok"` or confidence `"low"`** → `disposition:"unconfirmed"`,
    pointer and `open_case_id` untouched.

  **Case-`type` priority (D-10):** when a single run detects more than one
  conflict kind (e.g. a status flip **and** a privilege violation on the same
  snapshot), the case's single `type` is the **highest-priority** detected
  conflict in the order **`identity` > `privilege` > `status`** — a wrong-person
  match is the most severe failure and must never be masked by a lower-severity
  flag. `detail` still records **every** detected conflict type, so nothing is
  lost from the audit trail; only the headline `type` is chosen by priority.

  All `audit_events` (fetch/extract/diff/gate) are inserted here too.
  `resolveCase` is the **only** function that clears `open_case_id`; it requires
  non-empty `actor` + `note` and writes a `resolve` audit row.
- **Why:** F4 — stops silent overwrite of history; and I9 — because the insert
  and the gate share one transaction, no query can read a conflicting snapshot
  before its case exists (a race there would silently reproduce the failure
  Attestor catches).
- **New capability:** coordinator can open a case, see its detail, and resolve it
  (Confirm / Dismiss) with a required note; nothing else changes a badge.
- **Backend:** gate logic folded into `commit.ts` (`commitFetchResult`),
  `resolveCase` mutation. **Frontend:** case list + case detail view + resolve
  dialog.
- **Data/API/UI:** `mismatch_cases` + `licenses.open_case_id` +
  `licenses.current_confirmed_snapshot_id` writes, all from `commitFetchResult`;
  queries `getCase`, `listOpenCases`.
- **Testing:** integration — (1) a conflicting fetch: assert that within the
  single `commitFetchResult` call the `snapshots` row and its `mismatch_cases`
  row both exist and `current_confirmed_snapshot_id` is unchanged — there is no
  intermediate query state where the snapshot exists without the case; (2)
  `listRoster().badge` never goes from 🟢 to anything but 🟠 on a conflict; (3)
  static check + test that the `snapshots` table has no `patch`/`replace` call
  and no mutation sets a badge/status field directly; (4) **case-`type` priority
  (D-10)** — a fixture that trips a status flip **and** a privilege violation on
  the same fetch opens **one** case with `type:"identity"` if identity also
  mismatched, else `type:"privilege"`, and `detail` lists both `status` and
  `privilege` conflicts.
- **DoD:** after a conflicting fetch, `current_confirmed_snapshot_id` is
  byte-identical to its pre-fetch value; the new snapshot row and its open case
  were written by one transaction; the badge is 🟠 solely because `open_case_id`
  is set; only `resolveCase` with an actor+note flips it back; `alert_scheduled`
  was true in that same transaction; a multi-conflict fetch yields exactly one
  case whose `type` is the highest-priority conflict and whose `detail` retains
  all detected conflicts.

### Step 8 — AgentMail alerting
- **What:** `send_alert(case_id)` — check-then-insert on `alerts.by_case` (I8);
  build an HTML table of `snapshot_a` vs `snapshot_b` (status, name, number,
  privilege, timestamps, raw-text excerpt) + attach a JSON blob of the full case
  detail; `client.inboxes.messages.send(AGENTMAIL_INBOX_ID, { to: ALERT_TO, cc:
  ALERT_CC, subject, text, html, attachments })`; store
  `agentmail_message_id` / `thread_id` / `send_status`.
- **Why:** F1/F2/F3 — a human must be told the instant something disagrees, with
  the evidence, not a bare notice; and told **once** per case, not once per
  re-fetch.
- **New capability:** coordinator receives an email with both snapshots and can
  see it in the AgentMail inbox; the dashboard shows "alert sent" with the
  message id.
- **Backend:** `agentmail.ts` action (`sendAlert`) + `recordAlert` mutation;
  `sendAlert` is scheduled by `commitFetchResult` only when a case was newly
  created (`created:true`). It re-checks the unique `alerts.by_case` row before
  sending (idempotent even if the scheduler double-fires). **Frontend:** case
  detail shows alert status + message id + sent timestamp.
- **Data/API/UI:** `alerts` rows; `audit_events` `stage:"alert"`.
- **Testing:** integration — opening one case triggers exactly one `alerts` row
  and one send; a second conflicting re-fetch on the same still-open case
  triggers **zero** additional sends; a mocked AgentMail 5xx yields
  `send_status:"failed"` with the case still open and visible.
- **DoD:** one new case ⇒ exactly one AgentMail message containing both
  snapshots; re-running the sweep does not send a second.

### Step 9 — Operator dashboard
- **What:** the visual proof surface: roster with live badges (Convex reactive
  queries), per-worker snapshot timeline (every `audit_events` + `snapshots`
  row), snapshot detail drawer (raw HTML, extracted fields, diff, identity,
  privilege, disposition), side-by-side compare view, case list + resolve.
- **Why:** experiences A–D must be walkable by a judge without touching code;
  the timeline is the F1 "hire-time-only would have missed this" proof.
- **New capability:** coordinator does the entire job — add, watch, inspect,
  compare, resolve — from the browser.
- **Backend:** queries `getWorkerTimeline`, `getSnapshot`, `compareSnapshots`.
  **Frontend:** full React/Vite app, reactive to all Convex queries.
- **Data/API/UI:** no new tables; new read queries + the compare route.
- **Testing:** integration — a scripted run of experience B updates the badge in
  the UI query result from 🟢 to 🟠 without a page reload (reactivity);
  fixture-based snapshot of the compare view for the flip pair.
- **DoD:** a fresh browser session can walk A→B→C→D end to end using only UI
  controls; every displayed status shows its `confirmed_snapshot_id`.

### Step 10 — Deterministic demo mode (fully mocked — D-9)
- **What:** a `demo_mode` flag (Convex `settings` singleton) that makes the demo
  path **bypass both non-deterministic external calls**:
  (a) `fetch_board_page(mode:"fixture")` returns the license's next fixture HTML
  directly — **no Firecrawl call**; the blob is still written to file storage so
  the storage/sha path is identical to live;
  (b) `extract_license_fields(mode:"fixture", fixture_id)` returns that fixture's
  pre-computed golden `ExtractedFields` with `extractor_model:"fixture-golden"` —
  **no OpenAI call**;
  (c) the sweep cadence is replaced by a compressed `ctx.scheduler.runAfter`
  chain (seconds);
  (d) every snapshot is `source_mode:"fixture"` and every UI surface carries a
  persistent "DEMO DATA — fixtures, not a live board" banner (correctness rule 7).
  Everything downstream of those two edges — `commitFetchResult`, diff, identity,
  privilege, the gate, `create_mismatch_case`, `sendAlert` (a **real** AgentMail
  send, since that is deterministic and safe and proves the integration), the
  audit rows, every query — is byte-for-byte the live code path.
  A "Run demo" button seeds Nurses A–D and starts the sequence.
- **Why:** I7 / D-9 — the point of demo mode is determinism; a flaky OpenAI or
  Firecrawl call during a judged run is avoidable risk with no upside. Mocking
  both edges makes the judged story offline-safe and identical on every run.
- **Live-integration proof (separate, not on the critical path):** DEMO.md
  Beat 3 runs **one** genuine live pass for Nurse A — real Firecrawl `/v2/scrape`
  against a real board URL + real OpenAI extraction — to show judges the
  integrations do real work. It is guarded: a pre-seeded fixture Nurse A is
  already on the roster, so if either live call fails the demo proceeds on
  fixtures with a one-line spoken acknowledgement. The live pass is never a
  prerequisite for beats 4–12. Development also leaves real `source_mode:"live"`
  snapshots in the deployment as standing evidence.
- **New capability:** coordinator/judge clicks "Run demo" and the full A–D story
  plays out in ~2 minutes, labelled as fixture data, with zero dependence on
  Firecrawl or OpenAI uptime.
- **Backend:** `demo.ts` (seed + compressed sequence driver), `settings` table;
  `mode` branch in `fetch_board_page` and `extract_license_fields`.
  **Frontend:** demo control panel + persistent "DEMO DATA" banner when active.
- **Data/API/UI:** `settings.demo_mode`; `licenses` gains transient
  `fixture_sequence: v.array(v.string())` + `fixture_cursor: v.number()`.
- **Testing:** integration — (1) run the demo sequence twice in one test; assert
  `snapshots` / `mismatch_cases` / `alerts` counts + every `disposition` are
  identical across runs; (2) assert **zero** calls reach the Firecrawl or OpenAI
  client (spy asserts call count 0) while `demo_mode` is on; (3) assert every
  snapshot has `source_mode:"fixture"` and `extractor_model:"fixture-golden"`.
- **DoD:** with `demo_mode` on, the full loop runs twice back-to-back with
  identical, correct outcomes, makes **zero** Firecrawl and **zero** OpenAI
  calls, still sends real AgentMail alerts, and every screen shows the DEMO DATA
  banner; the separate live proof pass works and has a tested fixture fallback.

---

## 8. Reliability metrics (no vanity metrics)

Surfaced on an in-app `/metrics` panel, computed from `audit_events` /
`snapshots` / `alerts` / `mismatch_cases`.

| # | Metric | Definition | Target |
|---|---|---|---|
| M1 | **Fetch-to-alert latency** | `alerts.sent_at − snapshots.fetched_at` for the triggering snapshot | report actual (demo: single-digit seconds) |
| M2 | **Zero silent-drop rate** | `count(snapshots) / count(fetch attempts in audit_events stage:"fetch")` — includes 429/`rate_limited`, `blocked`, `timeout` attempts, each of which must have its own row | **100%** — every attempt (including rate-limited) writes a snapshot; none skipped |
| M3 | **False-accept rate** | adversarial fixtures (name-mismatch, expired flip, privilege violation) that were `disposition:"confirmed"` | **0** |
| M4 | **False-flag rate** | unchanged-status re-fetch fixtures that opened a `mismatch_case` | **0** |
| M5 | **Identity-mismatch catch rate** | name-change / wrong-person fixtures that produced an `identity` case | **100%** |
| M6 | **Privilege-violation catch rate** | compact-in-non-compact fixtures that produced a `privilege` case | **100%** |
| M7 | **Snapshot immutability** | count of snapshot rows ever updated in place — detected by re-hashing each stored file-storage blob against its `raw_payload_sha256` + a static check that no `patch`/`replace` targets `snapshots` | **0** |
| M8 | **Atomic-gate integrity** | count of committed snapshots with `disposition:"conflict"` whose `mismatch_cases` row is missing, OR with `disposition:"confirmed"` where the pointer was not moved in the same transaction | **0** |

---

## 9. Technical correctness rules (enforced, not aspirational)

1. **Fail closed** — ambiguous / failed / rate-limited fetch or low-confidence extraction is never `confirmed` (I6; Steps 4, 5, 7).
2. **Traceable status** — every displayed status carries a `snapshot_id` (I1; Steps 3, 9).
3. **OpenAI extracts only** — it never diffs and never decides "this is fine"; diff/identity/privilege/gate are pure and mechanical inside `commitFetchResult` (Steps 5, 6, 7).
4. **Append-only snapshots** — `snapshots` is insert-only; no `patch`/`replace` anywhere; full raw payload in file storage, hash-verifiable (I5; Steps 1, 4, 7; M7).
5. **Atomic snapshot + gate** — one `commitFetchResult` transaction inserts the snapshot and applies the gate; no partial state is observable (I9 / D-6; Steps 3, 7; M8).
6. **Recorded rate-limit** — a Firecrawl 429 writes a `rate_limited` snapshot and is retried on the next sweep; never a silent skip (D-7; Step 4; M2).
7. **Human-only resolution** — `resolveCase` requires non-empty actor + note; no auto-clear (I4; Step 7).
8. **Server-side keys** — Firecrawl / OpenAI / AgentMail keys live only in Convex action env; never shipped to the client (SECURITY.md; all action steps).
9. **Fully-mocked demo path** — `demo_mode` bypasses both Firecrawl and OpenAI (golden fixtures); real AgentMail sends kept; `source_mode:"fixture"` + a visible DEMO DATA banner whenever active; live-integration proof is a separate guarded beat (I7 / D-9; Step 10).

---

## 10. What Attestor is NOT (guardrails)

- ❌ A generic license-lookup search bar with no watch behind it.
- ❌ A DOB/SSN identity-proofing product (no real SSN/DOB is ever collected).
- ❌ A 50-state compact resolution engine — demo uses a **static bundled NLC
  member list** for one issuing state; full compact resolution is explicit
  non-scope.
- ❌ An "AI learns over time" claim — the only "learning" is the replayable
  append-only case history.
- ❌ Anything touching PHI or real patient data.
- ❌ Silent auto-resolution of mismatch cases.
- ❌ A compliance-checklist app or a developer scraper dashboard.

---

## 11. Demo scope boundaries (from the brief)

In scope: one issuing state board, RN/LPN/CNA, fixture-driven demo mode, one
compact member list bundled static. Out of scope: full 50-state compact
resolution, SSN/DOB identity proofing, real-time Nursys API, inbound AgentMail
reply parsing, any real PHI.

---

## 12. Hackathon compliance audit (Execution Gate)

| Requirement | How Attestor satisfies it |
|---|---|
| **Convex is the real backend** (not a thin frontend on hosted data) | All state in Convex tables; the entire supervisor loop is Convex crons + scheduled actions + the `commitFetchResult` transaction + reactive queries + file storage; the frontend is a pure `useQuery` consumer. |
| **Deploy live on convex.site / chatgpt.site, no localhost, no private repo** | `@convex-dev/static-hosting` serves the frontend at `https://<deployment>.convex.site` in the same `npx convex deploy`; public repo. |
| **Firecrawl does real work** | Live-path `fetch_board_page` calls `POST /v2/scrape` for `rawHtml` (DEMO.md Beat 3 + standing `source_mode:"live"` snapshots left from development); raw payload + source URL visible per snapshot. Demo path is mocked **by design** (D-9) and labelled. |
| **OpenAI does real work** | Live-path `extract_license_fields` is a strict-JSON Structured Outputs call (Beat 3 + standing live snapshots); extracted fields + raw model response stored and shown. Demo path uses golden fixtures (D-9), labelled `extractor_model:"fixture-golden"`. |
| **AgentMail does real work** | `sendAlert` sends a real message (both snapshots + JSON attachment) per new case **in both live and demo mode**; message id + thread id stored and shown; visible in the AgentMail inbox. |
| **Judges can open what you built** | Deployed URL + "Run demo" button reproduces experiences A–D in ~2 minutes with no live dependency. |
| **Video demo < 3 min** | DEMO.md is the 12-beat, timed script ending on the six-week closing line. |

---

## 13. Acceptance criteria

- [ ] AC1 — Adding a worker triggers a real Firecrawl fetch producing a stored, timestamped snapshot (live mode).
- [ ] AC2 — A status change between two fetches never silently updates the badge without a mismatch case (`current_confirmed_snapshot_id` unchanged; badge 🟠 only via `open_case_id`).
- [ ] AC3 — A name-mismatch fixture produces an identity-specific flag (`type:"identity"`), distinct from a status flag.
- [ ] AC4 — A privilege-violation fixture produces a privilege-specific flag (`type:"privilege"`).
- [ ] AC5 — An AgentMail alert fires exactly once per new case, with both snapshots attached.
- [ ] AC6 — The full demo runs twice back-to-back with identical, correct outcomes on fixture data, independent of live board availability.
- [ ] AC7 — No historical snapshot is ever overwritten in place (M7 = 0; no update mutation on `snapshots`).
- [ ] AC8 — Every displayed status in the UI shows its backing `snapshot_id`.
- [ ] AC9 — A blocked/timeout fetch produces an `unconfirmed` snapshot, not a crash and not a false `confirmed`.
- [ ] AC10 — Deployed and reachable at a `convex.site` URL with the frontend and backend from one deploy.
- [ ] AC11 — The snapshot `db.insert` and its gate outcome (pointer flip, or mismatch case + scheduled alert) are committed by a single `commitFetchResult` transaction; no query state exists where a conflicting snapshot is readable without its case (M8 = 0).
- [ ] AC12 — A Firecrawl 429 produces a stored `fetch_status:"rate_limited"` snapshot that is retried on the next sweep (linked via `retry_of_snapshot_id`); no fetch attempt is silently skipped (M2 = 100%).
- [ ] AC13 — With `demo_mode` on, a full demo run makes zero Firecrawl and zero OpenAI calls (spied), still sends real AgentMail alerts, and labels every snapshot `source_mode:"fixture"` / `extractor_model:"fixture-golden"`.
- [ ] AC14 — Full raw HTML for every `ok` snapshot is retrievable from Convex file storage and its re-hash matches the stored `raw_payload_sha256`; snapshot documents stay well under the Convex 1 MiB limit.

---

## 14. Open decisions to confirm on build day (tracked in DECISIONS.md)

- **D-1** — One static cron sweep + scheduler fan-out (chosen) vs `@convex-dev/crons` runtime component (rejected: complexity for demo).
- **D-2** — Extraction in our own OpenAI call (chosen) vs Firecrawl `json` format (rejected: collapses FETCH and EXTRACT into one opaque step, breaks per-stage observability/testing).
- **D-3** — `OPENAI_MODEL` pinned in env; default `gpt-4.1-mini`, boot-time `GET /v1/models` check, fallback `gpt-4o-2024-08-06`. Exact ID + price re-verified against official pricing docs on build day (web sources returned poisoned names).
- **D-4** — Live-mode board target **LOCKED: California DCA — Board of Registered Nursing** (`search.dca.ca.gov`; public, no login; `BOARD_HOST_ALLOWLIST=search.dca.ca.gov`). Results render client-side, so `proxy:"auto"` + `waitFor:2500` are required. This is a design decision; the real `POST /v2/scrape` is verified on build day at Step 4 with live credentials (logged in DECISIONS.md). If that scrape fails (block/CAPTCHA/shell/rate cap), the documented disclosed path is the seeded fixtures (D-9) and DEMO Beat 3's guarded fallback, after trying one alternate board.
- **D-5** — Staleness threshold value (drives ⚪ Unconfirmed on age) — default 7 days live / 20 s demo.
- **D-6** — **Atomic snapshot write + status gate.** *Gap raised in review.* Original draft split `persistSnapshot` (mutation, Step 4) and `applyGate` (mutation, Step 7), leaving a window where a conflicting snapshot row was readable before its mismatch case existed — silently reproducing the failure mode Attestor exists to catch. **Resolved:** merged into **one** mutation, `commitFetchResult`, that reads the prior confirmed snapshot, runs the pure diff/identity/privilege logic, `db.insert`s the snapshot, and applies the gate (pointer flip **or** `create_mismatch_case` + `open_case_id` + transactional `scheduler.runAfter(sendAlert)`) — all in a single Convex transaction (mutations are serializable and atomic). The action `runForLicense` now only performs the non-deterministic edges (Firecrawl, OpenAI, file-storage write) and hands raw results to `commitFetchResult`. Updated: §0 table, §2 diagram + data-flow + I5/I6/I9, §5 tool signatures + orchestration, Steps 3/4/5/6/7, metric M8, AC11, correctness rules 3/5.
- **D-7** — **Rate-limit produces a recorded state, not a silent drop.** *Gap raised in review.* Firecrawl free tier caps at 20 req/min; a fan-out wider than the cap would 429 some licenses. **Resolved:** (1) `runSweep` staggers the fan-out (`scheduler.runAfter(i * spacingMs, …)`) to stay under ~15/min; (2) added `fetch_status: "rate_limited"` (alongside `ok`/`blocked`/`http_error`/`timeout`/`extraction_failed`/`extraction_refused`); a 429, after one bounded in-action `Retry-After` retry (~3 s cap), writes its **own** snapshot with `fetch_status:"rate_limited"`, `fetch_http_code:429`, `disposition:"unconfirmed"`; (3) the license is retried on the next sweep, the retry snapshot carries `retry_of_snapshot_id` and shows as its own timeline dot. Never a silent skip. Updated: §0 Firecrawl-rate-limits row, §2 diagram, `snapshots` schema (`fetch_status`, `fetch_http_code`, `retry_of_snapshot_id`), §5 `fetch_board_page` return, Step 3 (staggering), Step 4 (mapping + retry + tests + DoD), metric M2, AC12, correctness rule 6.
- **D-8** — **Raw HTML stored in Convex file storage, not inline.** *Gap raised in review.* Convex caps a document at ~1 MiB; untrusted, unbounded `rawHtml` inline on every snapshot risks the ceiling and bloats reactive query payloads under the compressed demo schedule. **Resolved (option a):** the full verbatim payload is written to Convex file storage (`ctx.storage.store`) in `runForLicense`; the snapshot document keeps `raw_payload_storage_id: v.id("_storage")`, `raw_payload_excerpt` (≤4096 chars, inline, for instant timeline rendering), `raw_payload_sha256` (over the full payload), and `raw_payload_bytes`. Fixtures take the same path so live and demo code are identical. An orphan blob from a mutation that never commits is invisible and swept — no invariant broken. Updated: §0 new "Convex document size / raw HTML storage" row, `snapshots` schema (replaced `raw_payload` string with the storage fields), §5 `fetch_board_page` return, Step 4 (What/Backend/Frontend/Testing/DoD), metric M7, AC14. *(Rejected option b — inline with a size cap — because the ceiling risk is real and file storage is the documented mechanism; the excerpt still gives fast rendering.)*
- **D-9** — **Demo mode fully mocks both Firecrawl and OpenAI.** *Gap raised in review.* The earlier draft mocked only Firecrawl and still round-tripped live OpenAI on every compressed tick — an avoidable flakiness risk in a judged run. **Resolved:** `demo_mode` bypasses **both** non-deterministic edges — `fetch_board_page(mode:"fixture")` returns fixture HTML with no Firecrawl call; `extract_license_fields(mode:"fixture", fixture_id)` returns the fixture's pre-computed golden `ExtractedFields` with `extractor_model:"fixture-golden"` and no OpenAI call. Everything downstream (`commitFetchResult`, diff, identity, privilege, gate, `create_mismatch_case`, audit rows, queries) is the live code path, and **AgentMail sends stay real** (deterministic, safe, proves the integration). Live-integration proof is a **separate, guarded** DEMO.md Beat 3: one genuine Firecrawl + OpenAI pass for Nurse A, with a pre-seeded fixture Nurse A as a tested fallback, never a prerequisite for the rest of the demo. Tests spy-assert zero Firecrawl/OpenAI calls while `demo_mode` is on. Updated: §2 I7, Step 10 (full rewrite), §9 correctness rule 9, §12 compliance rows, AC13.
- **D-10** — **Two precedence rules caught in final review (pre-build).** Neither changes the architecture; both close an ambiguity that could otherwise be coded inconsistently across the roster list and the detail view. **(a) Case-type priority:** `mismatch_cases.type` holds a single value, but one conflicting fetch can trip several kinds at once (e.g. a status flip + a privilege violation). `create_mismatch_case` selects the headline `type` by the fixed order **`identity` > `privilege` > `status`** — a wrong-person match is the most severe failure and must never be masked by a lower-severity flag. `detail` still records **all** detected conflict types, so the audit trail loses nothing. **(b) Badge evaluation order:** a license can satisfy the staleness clause of ⚪ Unconfirmed while also having `open_case_id` set. `deriveBadge` evaluates in a fixed precedence — **🟠 Needs Review (`open_case_id != null`) is checked first**, before staleness; an open case always renders amber even if the license has also gone stale. Staleness downgrades to ⚪ only when there is no open case. Updated: §4 (badge-states block + table now precedence-ordered), §5 (`create_mismatch_case` description), Step 1 (`deriveBadge` truth table gains the explicit open-case-plus-stale ⇒ 🟠 case), Step 7 (What + Testing + DoD). Merged into DECISIONS.md.

---

*End of PRD. Awaiting approval before generating ARCHITECTURE.md, SECURITY.md,
TESTING.md, DEMO.md, DECISIONS.md, .env.example, and the sequential task
checklist.*

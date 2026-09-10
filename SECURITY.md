# SECURITY.md — Attestor

Companion to `PRD.md` / `ARCHITECTURE.md`. Scope: a hackathon demo that must be
safe to run live on a public URL from a public repo, touching no real patient
data. This is not a production threat model; it is the set of rules the build
must not break.

---

## 1. Non-negotiables (from the brief)

1. **API keys are server-side only.** Firecrawl, OpenAI, and AgentMail keys live
   exclusively as Convex environment variables, read only inside Convex
   **actions**. They are never imported into `src/`, never sent to the browser,
   never placed in a query/mutation return value, and never logged.
2. **No PHI, ever.** No real patient data, no real medical records, no real
   encounters. The roster holds nurse-level licensing facts only (name, license
   number, states, facility name). Fixtures are synthetic.
3. **No real SSN / DOB collection.** There is no input field, no table column,
   and no extracted field for SSN or date of birth. `bind_identity` uses license
   number + registered name only. If a fixture HTML happens to contain a DOB, the
   extraction schema has no slot for it and it is dropped.
4. **Demo data is labelled.** Every `source_mode:"fixture"` snapshot is marked as
   such in the data and behind a persistent "DEMO DATA — fixtures, not a live
   board" banner in the UI. Fixture data is never presented as a live board
   result without that disclosure (correctness rule 7 / rule 9).

---

## 2. Secret handling

| Secret | Stored as | Read by | Never |
|---|---|---|---|
| `FIRECRAWL_API_KEY` | Convex env var | `convex/firecrawl.ts` (action helper) | in `src/`, in a query/mutation, in logs, in a snapshot row |
| `OPENAI_API_KEY` | Convex env var | `convex/openai.ts` (action helper) | same |
| `AGENTMAIL_API_KEY` | Convex env var | `convex/agentmail.ts` (action helper) | same |
| `AGENTMAIL_INBOX_ID` | Convex env var | `convex/agentmail.ts` | (not secret, but kept server-side for consistency) |
| `ALERT_TO`, `ALERT_CC` | Convex env var | `convex/agentmail.ts` | contain real personal email only with that person's consent; use a team alias for the demo |

- Set with `npx convex env set FIRECRAWL_API_KEY sk-...` — values are stored by
  Convex, not in the repo.
- `.env.local` (git-ignored) is used only by `npx convex dev` to push env vars to
  the dev deployment; `.env.example` (committed) has placeholders only.
- CI / build: `npx convex deploy` needs `CONVEX_DEPLOY_KEY` — a deploy token, not
  a runtime secret; store it in the CI secret store, never in the repo.
- **Leak check:** a test (`no-secret-in-client.test.ts`) greps the built `dist/`
  bundle for `sk-`, `fc-`, `AGENTMAIL`, and each env var name; the build fails on
  a hit. A second grep asserts no `process.env.*_API_KEY` reference exists
  outside `convex/firecrawl.ts` / `convex/openai.ts` / `convex/agentmail.ts`.

---

## 3. Trust boundaries

```
 UNTRUSTED                         SEMI-TRUSTED                 TRUSTED
 ─────────                         ───────────                 ───────
 board page HTML (Firecrawl)  ──▶  OpenAI extraction     ──▶   Convex tables
 fixture HTML (still treated                                   (our writes only,
  as untrusted input)              coordinator form input      via mutations w/
 AgentMail inbound (OUT OF         (validated in mutation)     validators)
  SCOPE — not parsed)
```

- **Board / fixture HTML is untrusted.** It is stored verbatim in file storage
  (for audit) but never rendered as HTML in the app — the snapshot drawer shows
  it as **escaped text** (`<pre>`), and the "view full raw HTML" link opens the
  Convex storage URL in a new tab, off our origin. No `dangerouslySetInnerHTML`
  anywhere; a lint rule bans it.
- **Prompt injection:** the board page is passed to OpenAI for extraction. The
  extraction prompt is instruction-first, data-second, wrapped in an explicit
  delimiter, and the model is constrained by a strict JSON schema with a closed
  set of enums — it cannot emit anything but the declared fields. `status_word`
  is free text but is only ever displayed as escaped text and compared as a
  string; `status_normalized` is a closed enum. Optionally set Firecrawl
  `checkPromptInjection` and store its flag on the snapshot for the operator to
  see. Extraction **never** decides validity, so an injected "everything is fine"
  cannot confirm a license — the pure `diff`/`gate` do that.
- **Coordinator input** (add-worker form) is validated in the `addWorker` /
  `addLicense` mutations: 2-letter state codes, non-empty license number, enum
  `license_type`, URL shape for `board_profile_url`. Bad input throws
  `ConvexError`, no row written.
- **AgentMail inbound is not consumed.** We only send. No webhook handler, no
  thread-reply parser — so no untrusted inbound email reaches our logic. Case
  resolution is UI-only.

---

## 4. Authn / authz (demo scope)

- The demo runs as a **single implicit coordinator**. `created_by` /
  `resolved_by` are a static string (`"demo-coordinator"`) or a name typed into
  the resolve dialog — this is provenance for the audit trail, **not** an
  authentication claim, and the UI says so.
- No login, no user table, no roles. This is acceptable **only** because the app
  holds no PHI and no real secrets client-side. It is called out here so it is a
  conscious decision, not an oversight: a production deployment would put Convex
  Auth in front of every mutation and scope the roster per organisation.
- `resolveCase` still requires a non-empty `actor` + `note` so every resolution
  is attributable to a named human, even without real auth.

---

## 5. Data at rest

- Convex tables: licensing facts + synthetic fixture data only. No encryption
  beyond Convex's own — acceptable given no PHI.
- File storage: verbatim board/fixture HTML. Public via unguessable storage URL
  (Convex default). Board pages are already public web pages; fixtures are
  synthetic. No secret is ever written to storage.
- `extractor_raw_response` stores the model's JSON string for replay — it is the
  extracted licensing fields, no PHI, no secret.
- Audit rows (`audit_events`) are append-only and hold human-readable status
  lines only.

---

## 6. Data in transit

- Browser ⇄ Convex: HTTPS + WSS, Convex-managed TLS.
- Convex actions ⇄ sponsors: HTTPS to `api.firecrawl.dev`, `api.openai.com`
  (`GET /v1/models`, `POST /v1/responses`), `api.agentmail.to`. Bearer tokens in
  the `Authorization` header, never in a URL query string.
- `userEmail` (the operator's own address) is used only as an author/attribution
  string if configured; it is never sent to Firecrawl or OpenAI, and only goes to
  AgentMail if explicitly set as `ALERT_CC`.

---

## 7. Abuse / cost controls

- Firecrawl: staggered fan-out (~15 req/min) + one bounded 429 retry (D-7). Demo
  mode makes zero live calls. A runaway sweep is bounded by
  `watch_enabled` count × 1 fetch per interval.
- OpenAI: one extraction call per fetch, `max_output_tokens` capped, cheap model
  (`gpt-4.1-mini` default). Demo mode makes zero calls.
- AgentMail: exactly one send per new case (I8, unique `alerts.by_case`).
  Re-fetches on an open case send nothing. A `send_status:"failed"` case is
  re-triggerable only by explicit operator action, not by the loop.
- No user-supplied URL is fetched except the `board_profile_url` a coordinator
  typed for a license they added — there is no open "scrape this" endpoint, so
  the app cannot be used as an SSRF proxy by an anonymous visitor. (The field is
  still validated as an `http(s)` URL and, for the demo, constrained to the one
  target board's host via an allowlist constant.)

---

## 8. Logging

- Action logs may record: HTTP status codes, `fetch_status`, model id, latency,
  case ids. They must **not** record: any `Authorization` header, any env var
  value, full request bodies to OpenAI, or the raw HTML payload.
- A helper `redact()` is applied to any object before `console.*` in
  `firecrawl.ts` / `openai.ts` / `agentmail.ts`.

---

## 9. Dependency surface

- Runtime deps kept minimal: `convex`, `@convex-dev/static-hosting`, `openai`,
  `@agentmail/sdk` (or plain `fetch`), `react`, `react-dom`. Firecrawl via plain
  `fetch` (no SDK needed).
- No `dangerouslySetInnerHTML`, no `eval`, no dynamic `import()` of remote code.
- `npm audit` run before submission; no known-high vulns in the shipped tree.

---

## 10. Security checklist (must pass before submit)

- [ ] `dist/` bundle contains no `sk-`, `fc-`, `AGENTMAIL`, or env var name.
- [ ] `process.env.*_API_KEY` referenced only in the three action helpers.
- [ ] No `dangerouslySetInnerHTML` / no raw HTML render of board content.
- [ ] Add-worker mutations reject malformed state / URL / license number.
- [ ] No SSN/DOB field anywhere in schema, UI, or extraction JSON schema.
- [ ] Every fixture snapshot is `source_mode:"fixture"`; DEMO DATA banner shows whenever `demo_mode` is on.
- [ ] AgentMail: one send per case; no inbound handler.
- [ ] `board_profile_url` host allowlist enforced in `fetch_board_page`.
- [ ] Repo is public; no secret committed; `.env.example` has placeholders only.
- [ ] `CONVEX_DEPLOY_KEY` only in CI secret store.

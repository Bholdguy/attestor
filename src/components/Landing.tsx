import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Reveal } from "../lib/useReveal";

const REPO = "https://github.com/Bholdguy/attestor";

function goApp() {
  window.location.hash = "#/app";
}

function fmtBytes(n: number) {
  return n >= 1024 ? `${(n / 1024).toFixed(1)} KB` : `${n} B`;
}
function fmtDate(ts: number) {
  return new Date(ts).toISOString().replace("T", " ").slice(0, 16) + " UTC";
}

// ── pipeline schematic (Attestor's own — fetch → extract → bind → gate) ─────
function Pipeline() {
  const stages = [
    ["Fetch", "Firecrawl scrapes the board page"],
    ["Extract", "OpenAI → strict-JSON fields"],
    ["Bind", "number + registered name"],
    ["Gate", "confirm, or open a case"],
  ];
  return (
    <div className="card" style={{ padding: 18 }}>
      <div className="eyebrow" style={{ marginBottom: 14 }}>
        The loop
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {stages.map(([t, d], i) => (
          <div key={t}>
            <div
              style={{
                display: "flex",
                alignItems: "baseline",
                gap: 10,
                border: "1px solid var(--line)",
                borderRadius: 8,
                padding: "10px 12px",
                background: "var(--paper-2)",
              }}
            >
              <span className="mono muted" style={{ fontSize: "0.72rem" }}>
                0{i + 1}
              </span>
              <strong style={{ fontSize: "0.92rem" }}>{t}</strong>
              <span className="small muted">{d}</span>
            </div>
            {i < stages.length - 1 && (
              <div style={{ textAlign: "center", color: "var(--line-2)", lineHeight: 1 }}>↓</div>
            )}
          </div>
        ))}
      </div>
      <p className="small muted" style={{ margin: "12px 0 0" }}>
        Every decision runs inside one Convex transaction. The snapshot and its consequence become
        readable together, never apart.
      </p>
    </div>
  );
}

function EvidenceSection() {
  const ev = useQuery(api.landing.standingEvidence);

  return (
    <Reveal as="section" className="section" id="verify">
      <div className="wrap">
        <p className="eyebrow">Verify before you trust</p>
        <h2>Real snapshots from this deployment</h2>
        <p className="lead" style={{ marginBottom: 24 }}>
          Not screenshots. These are live rows from the running system — each with a SHA-256 over the
          full stored payload you can re-hash yourself.
        </p>

        {ev === undefined ? (
          <p className="muted">Loading…</p>
        ) : ev.rows.length === 0 ? (
          <div className="card-quiet">
            <p style={{ margin: 0 }}>
              No stored snapshots in this environment yet. Run the demo and this section fills with
              real, hash-verifiable rows.
            </p>
          </div>
        ) : (
          <div className="grid grid-3">
            {ev.rows.map((r) => (
              <div className="card" key={r._id}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                  <span className={`badge ${r.disposition === "confirmed" ? "verified" : r.disposition === "conflict" ? "needs_review" : "unconfirmed"}`}>
                    {r.disposition}
                  </span>
                  <span className="pill">{r.source_mode}</span>
                </div>
                <p className="small" style={{ margin: "12px 0 4px", color: "var(--ink)" }}>
                  {r.worker_name ?? "—"} · {r.license_number ?? "—"}
                </p>
                <p className="small muted" style={{ margin: "0 0 4px", overflowWrap: "anywhere" }}>
                  {r.source_url}
                </p>
                <p className="small muted" style={{ margin: "0 0 10px" }}>
                  {fmtDate(r.fetched_at)} · {r.fetch_status}
                  {r.fetch_http_code != null ? ` (${r.fetch_http_code})` : ""} ·{" "}
                  {fmtBytes(r.raw_payload_bytes)}
                </p>
                <div className="pre" style={{ maxHeight: "none", fontSize: "0.66rem" }}>
                  sha256 {r.raw_payload_sha256}
                </div>
                {r.raw_payload_url && (
                  <p style={{ margin: "10px 0 0" }}>
                    <a
                      className="small"
                      href={r.raw_payload_url}
                      target="_blank"
                      rel="noreferrer noopener"
                    >
                      View raw snapshot ↗
                    </a>
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </Reveal>
  );
}

const FEATURES: Array<[string, string]> = [
  ["Fetch", "A scheduled Firecrawl scrape pulls the verbatim board page. A 404, block page, rate-limit, or timeout is stored as its own snapshot — never a silent skip."],
  ["Extract", "One OpenAI structured-output call turns the raw HTML into typed fields: number, name, status, privilege. It extracts only — it never decides whether the record is fine."],
  ["Diff", "A pure function compares the fresh fields to the last confirmed snapshot, field by field. A changed status is flagged, never quietly accepted."],
  ["Identity Bind", "Match requires the license number and the registered name together — never a name string alone. A legal-name change is raised as an identity case, not silently reconciled."],
  ["Privilege Check", "Compact / multistate is checked against the worker's actual assignment state. “Multistate” does not mean “usable anywhere.” An unknown privilege fails closed."],
  ["Gate & Alert", "All agree and the fetch is clean → confirm. Anything disagrees → open one mismatch case and send one AgentMail alert with both snapshots attached."],
  ["Audit Trail", "Every fetch, extract, diff, gate, and alert writes an append-only event. The displayed status is always a pointer to a snapshot id — provable, not asserted."],
];

const STEPS: Array<[string, string]> = [
  ["Add a worker", "Name as registered, name as hired, license number, issuing state, assignment state. The roster starts a watch — it never decides validity."],
  ["Scheduled fetch runs", "A cron sweep fans out one staggered fetch per watched license, staying under the board's rate limit. Or click “Check now.”"],
  ["Extract, diff, bind, check", "Inside one transaction: OpenAI extracts, then pure diff + identity-bind + privilege-check compare against the last confirmed snapshot."],
  ["Confirm or alert", "Agreement moves the confirmed-status pointer forward. Disagreement opens a case, holds the pointer, and alerts a human with the evidence."],
];

export function Landing() {
  return (
    <>
      <header className="nav">
        <div className="nav-inner">
          <a href="#/" className="wordmark">
            Attestor
          </a>
          <nav className="nav-links">
            <a href="#features">What it does</a>
            <a href="#how">How it works</a>
            <a href="#verify">Verify</a>
            <a href="#faq">FAQ</a>
          </nav>
          <button className="btn btn-sm" onClick={goApp}>
            Run Demo
          </button>
        </div>
      </header>

      {/* 2 — hero */}
      <section className="section" style={{ paddingTop: 72, position: "relative", overflow: "hidden" }}>
        <div className="hero-wash" aria-hidden="true" />
        <div className="wrap hero-content">
          <div
            style={{
              display: "grid",
              gap: 40,
              gridTemplateColumns: "minmax(0, 1.15fr) minmax(0, 0.85fr)",
              alignItems: "center",
            }}
          >
            <div>
              <span className="pill" style={{ marginBottom: 20 }}>
                <span className="dot" /> Live · Convex + Firecrawl + OpenAI + AgentMail
              </span>
              <h1>&ldquo;Active&rdquo; is a claim, not a fact.</h1>
              <p className="lead">
                Attestor is a reliability layer between a state license board and a staffing decision.
                It catches the moment a board&rsquo;s answer is stale, misidentified, or invalid for
                the assignment &mdash; before a human trusts it to schedule, extend, or pull a
                healthcare worker.
              </p>
              <div style={{ display: "flex", gap: 12, marginTop: 26, flexWrap: "wrap" }}>
                <button className="btn" onClick={goApp}>
                  Run Demo
                </button>
                <a className="btn btn-outline" href={REPO} target="_blank" rel="noreferrer noopener">
                  View on GitHub
                </a>
              </div>
            </div>
            <Pipeline />
          </div>
        </div>
      </section>

      {/* 3 — ticker: slow marquee, pauses on hover, static row under reduced motion */}
      <div className="ticker">
        <div className="ticker-track">
          <div className="ticker-inner">
            <span>Fetches real board pages</span>
            <span>Append-only audit log</span>
            <span>Identity-bound, not name-matched</span>
            <span>Fails closed</span>
          </div>
          <div className="ticker-inner" aria-hidden="true">
            <span>Fetches real board pages</span>
            <span>Append-only audit log</span>
            <span>Identity-bound, not name-matched</span>
            <span>Fails closed</span>
          </div>
        </div>
      </div>

      {/* 4 — problem / mechanism */}
      <Reveal as="section" className="section">
        <div className="wrap">
          <div className="grid grid-2" style={{ alignItems: "start", gap: 32 }}>
            <div>
              <p className="eyebrow">The problem with a one-shot lookup</p>
              <h2>A scrape has no memory.</h2>
              <div style={{ display: "grid", gap: 16, marginTop: 18 }}>
                <div>
                  <strong>Stale status.</strong>
                  <p className="small" style={{ margin: "4px 0 0" }}>
                    A hire-time screenshot has no expiry. A revocation mid-assignment stays invisible
                    for months.
                  </p>
                </div>
                <div>
                  <strong>Wrong-person match.</strong>
                  <p className="small" style={{ margin: "4px 0 0" }}>
                    A real license number under a shared first name. A legal-name change that flips a
                    licensed nurse to &ldquo;unlicensed.&rdquo;
                  </p>
                </div>
                <div>
                  <strong>Silent overwrite.</strong>
                  <p className="small" style={{ margin: "4px 0 0" }}>
                    A lookup replaces a stored status with no lineage. No way to prove what was known
                    when.
                  </p>
                </div>
              </div>
            </div>

            <div className="card">
              <p className="eyebrow" style={{ marginBottom: 10 }}>
                Attestor catches this
              </p>
              <ul style={{ margin: 0, paddingLeft: 18, color: "var(--ink-2)", lineHeight: 1.7 }}>
                <li>
                  Every fetch is an <strong>append-only snapshot</strong> with a SHA-256 over the full
                  payload. History is never rewritten.
                </li>
                <li>
                  The displayed status is a <strong>pointer to a snapshot id</strong> that moves only
                  when a fresh fetch <em>agrees</em>.
                </li>
                <li>
                  Identity is bound by <strong>number + registered name</strong>, so a name string
                  alone can never confirm the wrong person.
                </li>
                <li>
                  A failed, blocked, or low-confidence fetch is <strong>unconfirmed</strong> and can
                  never become the trusted status &mdash; it fails closed.
                </li>
              </ul>
            </div>
          </div>
        </div>
      </Reveal>

      {/* 5 — feature grid (children stagger in together) */}
      <section className="section" id="features">
        <div className="wrap">
          <p className="eyebrow">What Attestor can do</p>
          <h2>Seven stages, each independently observable.</h2>
          <Reveal as="div" stagger className="grid grid-3" style={{ marginTop: 24 }}>
            {FEATURES.map(([t, d]) => (
              <div className="card" key={t}>
                <h3 style={{ marginBottom: 6 }}>{t}</h3>
                <p className="small" style={{ margin: 0 }}>
                  {d}
                </p>
              </div>
            ))}
          </Reveal>
        </div>
      </section>

      {/* 6 — how it works (children stagger in together) */}
      <section className="section" id="how">
        <div className="wrap">
          <p className="eyebrow">How Attestor works</p>
          <h2>From roster row to resolved case.</h2>
          <Reveal as="div" stagger className="grid grid-4" style={{ marginTop: 24 }}>
            {STEPS.map(([t, d], i) => (
              <div className="card-quiet" key={t}>
                <div className="step-num">0{i + 1}</div>
                <h3 style={{ margin: "6px 0 6px" }}>{t}</h3>
                <p className="small" style={{ margin: 0 }}>
                  {d}
                </p>
              </div>
            ))}
          </Reveal>
        </div>
      </section>

      {/* 7 — trust row */}
      <Reveal as="section" className="section">
        <div className="wrap">
          <div className="grid grid-3">
            {[
              ["Snapshots are append-only", "commitFetchResult only ever inserts. No code path patches or replaces a snapshot row."],
              ["Nothing overwrites history", "“Current status” is a pointer to the last confirmed snapshot. A conflict holds it in place until a named human resolves the case."],
              ["Every alert carries its evidence", "One AgentMail message per case — both snapshots as a table, the full case as a JSON attachment. Not a bare notice."],
            ].map(([t, d]) => (
              <div className="card" key={t}>
                <h3 style={{ marginBottom: 6 }}>{t}</h3>
                <p className="small" style={{ margin: 0 }}>
                  {d}
                </p>
              </div>
            ))}
          </div>
        </div>
      </Reveal>

      {/* 8 — verify (real data) */}
      <EvidenceSection />

      {/* 9 — FAQ */}
      <Reveal as="section" className="section" id="faq">
        <div className="wrap">
          <p className="eyebrow">FAQ</p>
          <h2>Questions</h2>
          <div className="faq" style={{ marginTop: 18 }}>
            {[
              [
                "Does Attestor store real board data?",
                "In live mode it fetches and stores the verbatim board page — these are already-public web pages — in Convex file storage, with a SHA-256 over the full payload for integrity. Demo mode uses synthetic fixtures, labelled as such on every row and behind a persistent banner. There is no field, column, or extraction slot for SSN or date of birth, anywhere.",
              ],
              [
                "What happens when a status changes between two fetches?",
                "The new fetch becomes its own append-only snapshot. A pure diff compares it to the last confirmed snapshot. If they disagree, Attestor opens one mismatch case, leaves the displayed status pointing at the last confirmed snapshot — it never overwrites — and sends one AgentMail alert with both snapshots attached. Only an explicit human action, recorded with actor and note, resolves it.",
              ],
              [
                "Why not just trust the board's website directly?",
                "A single visit has no memory. It can't tell you the status changed last month, that the record is a different person with the same first name, or that a “multistate” license isn't valid in the state where care is delivered. Attestor adds the scheduled re-check, the identity binding, the privilege check against the real assignment, and an immutable trail.",
              ],
              [
                "Is this connected to Nursys?",
                "No. Attestor is not a license-lookup API or a coverage database. It's the reliability layer on top of whatever board page you point it at. The demo covers one issuing state, RN/LPN/CNA, and a static bundled compact-member list — full 50-state compact resolution is explicitly out of scope.",
              ],
              [
                "What if Firecrawl or OpenAI is unavailable?",
                "It fails closed. A blocked, rate-limited, timed-out, or unparseable fetch is stored as its own snapshot with a non-“ok” status and marked unconfirmed — it can never become the confirmed status, and the prior confirmed snapshot stays exactly where it was. Nothing is silently accepted. Demo mode makes zero calls to either service.",
              ],
            ].map(([q, a]) => (
              <details key={q}>
                <summary>{q}</summary>
                <div className="faq-body">{a}</div>
              </details>
            ))}
          </div>
        </div>
      </Reveal>

      {/* 10 — closing band */}
      <Reveal as="div" className="band">
        <div className="wrap">
          <h2 style={{ maxWidth: "18ch", margin: "0 auto 20px" }}>
            See it catch a mismatch it never overwrites.
          </h2>
          <button className="btn" onClick={goApp}>
            Run Demo
          </button>
        </div>
      </Reveal>

      {/* 11 — footer */}
      <footer className="footer">
        <div className="wrap" style={{ display: "flex", gap: 20, flexWrap: "wrap", alignItems: "baseline" }}>
          <span className="wordmark" style={{ fontSize: "1rem" }}>
            Attestor
          </span>
          <span className="muted small" style={{ maxWidth: "42ch" }}>
            A license trust supervisor — it tells you whether to trust what the board page just said.
          </span>
          <span style={{ marginLeft: "auto", display: "flex", gap: 16 }}>
            <a href={REPO} target="_blank" rel="noreferrer noopener">
              GitHub
            </a>
            <a href="#/app">Dashboard</a>
          </span>
        </div>
        <div className="wrap muted small" style={{ marginTop: 12 }}>
          Convex All Gas Hackathon · Convex + Firecrawl + OpenAI + AgentMail
        </div>
      </footer>
    </>
  );
}

import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
// (badge helpers live in ../lib/badge — imported where badges render)

// Step 4 — raw excerpt (as ESCAPED text, never rendered HTML — SECURITY §3),
// "view full raw HTML" (off-origin storage URL), and fetch provenance. Steps 5–7
// add extracted fields / diff / identity / privilege / disposition rows.

function fmt(ts: number | null | undefined): string {
  return ts ? new Date(ts).toISOString().replace("T", " ").replace(/\..+/, " UTC") : "—";
}

export function SnapshotDrawer({
  snapshotId,
  onClose,
}: {
  snapshotId: Id<"snapshots">;
  onClose: () => void;
}) {
  const snap = useQuery(api.timeline.getSnapshot, { snapshotId });

  return (
    <aside className="drawer" style={{ width: "min(560px, 100vw)", zIndex: 50 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h3 style={{ margin: 0 }}>Snapshot</h3>
        <button className="btn btn-outline btn-sm" onClick={onClose}>
          Close
        </button>
      </div>

      {snap === undefined ? (
        <p className="muted">Loading…</p>
      ) : snap === null ? (
        <p className="muted">Snapshot not found.</p>
      ) : (
        <>
          <dl className="kv" style={{ marginTop: 12 }}>
            <dt>snapshot_id</dt>
            <dd className="mono">{snap._id}</dd>
            <dt>disposition</dt>
            <dd>
              <span className={`badge ${snap.disposition === "confirmed" ? "verified" : snap.disposition === "conflict" ? "needs_review" : "unconfirmed"}`}>
                {snap.disposition}
              </span>
            </dd>
            <dt>source_mode</dt>
            <dd>
              {snap.source_mode}
              {snap.source_mode === "fixture" ? " (DEMO DATA — not a live board)" : ""}
            </dd>
            <dt>source_url</dt>
            <dd>{snap.source_url}</dd>
            <dt>fetch_status</dt>
            <dd>
              {snap.fetch_status}
              {snap.fetch_http_code != null ? ` · HTTP ${snap.fetch_http_code}` : ""}
            </dd>
            <dt>fetched_at</dt>
            <dd>{fmt(snap.fetched_at)}</dd>
            <dt>raw bytes</dt>
            <dd>{snap.raw_payload_bytes.toLocaleString()}</dd>
            <dt>sha256</dt>
            <dd className="mono">{snap.raw_payload_sha256}</dd>
            {snap.retry_of ? (
              <>
                <dt>retry of</dt>
                <dd>
                  {snap.retry_of._id} ({snap.retry_of.fetch_status}, {fmt(snap.retry_of.fetched_at)})
                </dd>
              </>
            ) : null}
          </dl>

          <p style={{ marginBottom: 4 }}>
            {snap.raw_payload_url ? (
              <a href={snap.raw_payload_url} target="_blank" rel="noreferrer noopener">
                view full raw HTML ↗
              </a>
            ) : (
              <em>no body stored (empty response)</em>
            )}
          </p>

          {snap.extracted_fields && (
            <>
              <h4 style={{ marginBottom: 4 }}>Extracted fields (OpenAI, strict JSON)</h4>
              <table style={{ borderCollapse: "collapse", fontSize: 12, marginBottom: 12 }}>
                <tbody>
                  {Object.entries(snap.extracted_fields).map(([k, val]) => (
                    <tr key={k} style={{ borderBottom: "1px solid var(--line)" }}>
                      <td style={{ padding: "2px 8px", color: "var(--ink-3)" }}>{k}</td>
                      <td style={{ padding: "2px 8px" }}>{val === null ? "—" : String(val)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

          {snap.diff_result && (
            <>
              <h4 style={{ marginBottom: 4 }}>Diff vs last confirmed</h4>
              {snap.diff_result.compared_snapshot_id == null ? (
                <p style={{ fontSize: 12, color: "var(--ink-3)" }}>first snapshot — nothing to diff</p>
              ) : snap.diff_result.agrees ? (
                <p style={{ fontSize: 12, color: "var(--green)" }}>agrees with {snap.diff_result.compared_snapshot_id}</p>
              ) : (
                <table style={{ borderCollapse: "collapse", fontSize: 12, marginBottom: 12 }}>
                  <thead>
                    <tr style={{ textAlign: "left" }}>
                      <th style={{ padding: "2px 8px" }}>field</th>
                      <th style={{ padding: "2px 8px" }}>prior</th>
                      <th style={{ padding: "2px 8px" }}>current</th>
                    </tr>
                  </thead>
                  <tbody>
                    {snap.diff_result.conflicts.map((c) => (
                      <tr key={c.field} style={{ background: "var(--amber-bg)" }}>
                        <td style={{ padding: "2px 8px" }}>{c.field}</td>
                        <td style={{ padding: "2px 8px" }}>{c.prior}</td>
                        <td style={{ padding: "2px 8px" }}>{c.current}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </>
          )}

          {snap.identity_result && (
            <>
              <h4 style={{ marginBottom: 4 }}>Identity (number + registered name — never name alone)</h4>
              <table style={{ borderCollapse: "collapse", fontSize: 12, marginBottom: 12 }}>
                <tbody>
                  <tr>
                    <td style={{ padding: "2px 8px", color: "var(--ink-3)" }}>match_confidence</td>
                    <td style={{ padding: "2px 8px" }}>
                      <strong>{snap.identity_result.match_confidence}</strong>
                    </td>
                  </tr>
                  <tr>
                    <td style={{ padding: "2px 8px", color: "var(--ink-3)" }}>mismatch_reason</td>
                    <td style={{ padding: "2px 8px" }}>{snap.identity_result.mismatch_reason}</td>
                  </tr>
                  <tr>
                    <td style={{ padding: "2px 8px", color: "var(--ink-3)" }}>number_matches</td>
                    <td style={{ padding: "2px 8px" }}>{String(snap.identity_result.number_matches)}</td>
                  </tr>
                  <tr>
                    <td style={{ padding: "2px 8px", color: "var(--ink-3)" }}>name_similarity</td>
                    <td style={{ padding: "2px 8px" }}>
                      {snap.identity_result.registered_name_similarity.toFixed(2)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </>
          )}

          {snap.privilege_result && (
            <>
              <h4 style={{ marginBottom: 4 }}>Privilege (checked against the assignment state)</h4>
              <table style={{ borderCollapse: "collapse", fontSize: 12, marginBottom: 12 }}>
                <tbody>
                  <tr>
                    <td style={{ padding: "2px 8px", color: "var(--ink-3)" }}>valid</td>
                    <td style={{ padding: "2px 8px" }}>
                      <strong style={{ color: snap.privilege_result.valid ? "var(--green)" : "var(--amber)" }}>
                        {String(snap.privilege_result.valid)}
                      </strong>
                    </td>
                  </tr>
                  <tr>
                    <td style={{ padding: "2px 8px", color: "var(--ink-3)" }}>reason</td>
                    <td style={{ padding: "2px 8px" }}>{snap.privilege_result.reason}</td>
                  </tr>
                  <tr>
                    <td style={{ padding: "2px 8px", color: "var(--ink-3)" }}>assignment_state</td>
                    <td style={{ padding: "2px 8px" }}>{snap.privilege_result.assignment_state}</td>
                  </tr>
                  <tr>
                    <td style={{ padding: "2px 8px", color: "var(--ink-3)" }}>compact_member</td>
                    <td style={{ padding: "2px 8px" }}>{String(snap.privilege_result.compact_member)}</td>
                  </tr>
                </tbody>
              </table>
            </>
          )}

          <h4 style={{ marginBottom: 4 }}>Raw payload excerpt (first 4 KB, as text)</h4>
          <pre className="pre">{snap.raw_payload_excerpt || "(empty)"}</pre>
        </>
      )}
    </aside>
  );
}

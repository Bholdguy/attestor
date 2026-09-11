import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";

// Step 7 — case detail + Resolve dialog. The ONLY UI path that clears a case
// (via cases.resolveCase, which requires actor + note). Nothing else on any
// screen changes a badge.

function fmt(ts: number | null | undefined) {
  return ts ? new Date(ts).toISOString().replace("T", " ").slice(0, 19) + " UTC" : "—";
}

export function CaseDetail({
  caseId,
  onClose,
  onCompare,
}: {
  caseId: Id<"mismatch_cases">;
  onClose: () => void;
  onCompare?: (a: Id<"snapshots">, b: Id<"snapshots">) => void;
}) {
  const c = useQuery(api.cases.getCase, { caseId });
  const resolveCase = useMutation(api.cases.resolveCase);
  const retryAlert = useMutation(api.alert.retryAlert);
  const [decision, setDecision] = useState<"confirmed" | "dismissed">("confirmed");
  const [actor, setActor] = useState("");
  const [note, setNote] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setErr(null);
    setBusy(true);
    try {
      await resolveCase({ case_id: caseId, decision, actor, note });
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <aside className="drawer" style={{ width: "min(620px, 100vw)", zIndex: 60 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h3 style={{ margin: 0 }}>Mismatch case</h3>
        <button className="btn btn-outline btn-sm" onClick={onClose}>
          Close
        </button>
      </div>

      {c === undefined ? (
        <p className="muted">Loading…</p>
      ) : c === null ? (
        <p className="muted">Case not found.</p>
      ) : (
        <>
          <dl className="kv" style={{ marginTop: 12 }}>
            <dt>type</dt>
            <dd>
              <span className="badge needs_review">{c.type}</span>
            </dd>
            <dt>detected_types</dt>
            <dd>{c.detail.detected_types.join(", ")}</dd>
            <dt>state</dt>
            <dd>{c.resolution_state}</dd>
            <dt>worker</dt>
            <dd>
              {c.worker_name_hired} (registered: {c.worker_name_registered})
            </dd>
            <dt>license</dt>
            <dd>{c.license_number}</dd>
            <dt>reason</dt>
            <dd>{c.reason}</dd>
            <dt>snapshot_a</dt>
            <dd style={{ fontFamily: "ui-monospace, monospace", fontSize: 11 }}>{c.snapshot_a_id}</dd>
            <dt>snapshot_b</dt>
            <dd style={{ fontFamily: "ui-monospace, monospace", fontSize: 11 }}>{c.snapshot_b_id}</dd>
            <dt />
            <dd>
              {onCompare && (
                <button className="btn btn-outline btn-sm" onClick={() => onCompare(c.snapshot_a_id, c.snapshot_b_id)}>
                  Compare A vs B
                </button>
              )}
            </dd>
            {c.alert ? (
              <>
                <dt>alert</dt>
                <dd>
                  <strong>{c.alert.send_status}</strong>
                  {c.alert.agentmail_message_id ? ` · msg ${c.alert.agentmail_message_id}` : ""}
                  {c.alert.agentmail_thread_id ? ` · thread ${c.alert.agentmail_thread_id}` : ""} ·{" "}
                  {fmt(c.alert.sent_at)}
                  {c.alert.send_error ? (
                    <>
                      <br />
                      <span style={{ color: "var(--amber)" }}>{c.alert.send_error}</span>
                    </>
                  ) : null}
                  {c.alert.send_status === "failed" ? (
                    <>
                      {" "}
                      <button className="btn btn-outline btn-sm" onClick={() => retryAlert({ caseId })}>Retry send</button>
                    </>
                  ) : null}
                </dd>
              </>
            ) : null}
            {c.resolution_state !== "open" ? (
              <>
                <dt>resolved</dt>
                <dd>
                  {c.resolution_state} by {c.resolved_by} · {fmt(c.resolved_at)}
                  <br />
                  <em>{c.resolution_note}</em>
                </dd>
              </>
            ) : null}
          </dl>

          {c.detail.conflicts.length > 0 && (
            <>
              <h4>Field conflicts</h4>
              <table style={{ borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr style={{ textAlign: "left" }}>
                    <th style={{ padding: "2px 8px" }}>field</th>
                    <th style={{ padding: "2px 8px" }}>prior</th>
                    <th style={{ padding: "2px 8px" }}>current</th>
                  </tr>
                </thead>
                <tbody>
                  {c.detail.conflicts.map((x) => (
                    <tr key={x.field} style={{ background: "var(--amber-bg)" }}>
                      <td style={{ padding: "2px 8px" }}>{x.field}</td>
                      <td style={{ padding: "2px 8px" }}>{x.prior}</td>
                      <td style={{ padding: "2px 8px" }}>{x.current}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

          {c.resolution_state === "open" && (
            <>
              <h4 style={{ marginTop: 20 }}>Resolve</h4>
              <div style={{ display: "grid", gap: 8, maxWidth: 420 }}>
                <label>
                  Decision{" "}
                  <select value={decision} onChange={(e) => setDecision(e.target.value as typeof decision)}>
                    <option value="confirmed">Confirm — adopt the new snapshot as reality</option>
                    <option value="dismissed">Dismiss — board was wrong / transient</option>
                  </select>
                </label>
                <label>
                  Your name (recorded)
                  <input value={actor} onChange={(e) => setActor(e.target.value)} placeholder="nurse-ops" />
                </label>
                <label>
                  Note (required)
                  <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} />
                </label>
                <button className="btn" onClick={submit} disabled={busy}>
                  {busy ? "Resolving…" : "Resolve case"}
                </button>
                {err && <p style={{ color: "var(--amber)", whiteSpace: "pre-wrap" }}>{err}</p>}
              </div>
            </>
          )}
        </>
      )}
    </aside>
  );
}

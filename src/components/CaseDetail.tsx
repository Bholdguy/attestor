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
}: {
  caseId: Id<"mismatch_cases">;
  onClose: () => void;
}) {
  const c = useQuery(api.cases.getCase, { caseId });
  const resolveCase = useMutation(api.cases.resolveCase);
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
    <aside
      style={{
        position: "fixed",
        top: 0,
        right: 0,
        width: "min(620px, 100vw)",
        height: "100vh",
        background: "#fff",
        borderLeft: "1px solid #ccc",
        boxShadow: "-4px 0 16px rgba(0,0,0,0.08)",
        padding: 20,
        overflowY: "auto",
        zIndex: 60,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h3 style={{ margin: 0 }}>Mismatch case</h3>
        <button onClick={onClose}>Close</button>
      </div>

      {c === undefined ? (
        <p>Loading…</p>
      ) : c === null ? (
        <p>Case not found.</p>
      ) : (
        <>
          <dl style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "4px 12px", fontSize: 13 }}>
            <dt>type</dt>
            <dd>
              <strong>{c.type}</strong>
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
            {c.alert ? (
              <>
                <dt>alert</dt>
                <dd>
                  {c.alert.send_status}
                  {c.alert.agentmail_message_id ? ` · msg ${c.alert.agentmail_message_id}` : ""} ·{" "}
                  {fmt(c.alert.sent_at)}
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
                    <tr key={x.field} style={{ background: "#fff3cd" }}>
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
                <button onClick={submit} disabled={busy}>
                  {busy ? "Resolving…" : "Resolve case"}
                </button>
                {err && <p style={{ color: "#b00020", whiteSpace: "pre-wrap" }}>{err}</p>}
              </div>
            </>
          )}
        </>
      )}
    </aside>
  );
}

import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { badgeDisplay } from "../lib/badge";

// Step 9 — dot per snapshot + audit event, retry links. The F1 "a hire-time-only
// check would have missed this" proof surface.

function fmt(ts: number) {
  return new Date(ts).toISOString().replace("T", " ").slice(0, 19);
}

const DISPO_COLOR: Record<string, string> = {
  confirmed: "#0a7d28",
  conflict: "#c47f00",
  unconfirmed: "#888",
};

export function WorkerTimeline({
  licenseId,
  onOpenSnapshot,
  onClose,
}: {
  licenseId: Id<"licenses">;
  onOpenSnapshot: (id: Id<"snapshots">) => void;
  onClose: () => void;
}) {
  const t = useQuery(api.timeline.getLicenseTimeline, { licenseId });

  return (
    <aside
      style={{
        position: "fixed",
        top: 0,
        right: 0,
        width: "min(680px, 100vw)",
        height: "100vh",
        background: "#fff",
        borderLeft: "1px solid #ccc",
        boxShadow: "-4px 0 16px rgba(0,0,0,0.08)",
        padding: 20,
        overflowY: "auto",
        zIndex: 40,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h3 style={{ margin: 0 }}>Timeline</h3>
        <button onClick={onClose}>Close</button>
      </div>

      {t === undefined ? (
        <p>Loading…</p>
      ) : t === null ? (
        <p>Not found.</p>
      ) : (
        <>
          <p style={{ fontSize: 13 }}>
            {badgeDisplay(t.badge).emoji} <strong>{badgeDisplay(t.badge).label}</strong> ·{" "}
            {t.worker?.name_hired} ({t.license.license_number}, {t.license.issuing_state})
          </p>
          <p style={{ fontSize: 12, color: "#555" }}>
            confirmed snapshot:{" "}
            <span style={{ fontFamily: "ui-monospace, monospace" }}>
              {t.license.current_confirmed_snapshot_id ?? "— (never confirmed)"}
            </span>
            {t.license.open_case_id ? " · open case" : ""}
            {!t.license.watch_enabled ? " · watch disabled" : ""}
          </p>

          <h4 style={{ marginBottom: 4 }}>Snapshots</h4>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {t.snapshots.map((s, i) => (
              <button
                key={s._id}
                onClick={() => onOpenSnapshot(s._id)}
                style={{
                  textAlign: "left",
                  border: "1px solid #e0e0e0",
                  borderLeft: `4px solid ${DISPO_COLOR[s.disposition] ?? "#888"}`,
                  borderRadius: 4,
                  padding: "6px 8px",
                  fontSize: 12,
                  cursor: "pointer",
                  background: s.is_confirmed_pointer ? "#f1f8f2" : "#fff",
                }}
              >
                <strong>T{i + 1}</strong> · {fmt(s.fetched_at)} · {s.source_mode} ·{" "}
                {s.fetch_status}
                {s.fetch_http_code != null ? ` (${s.fetch_http_code})` : ""} ·{" "}
                <span style={{ color: DISPO_COLOR[s.disposition] }}>{s.disposition}</span>
                {s.status_normalized ? ` · status ${s.status_normalized}` : ""}
                {s.is_confirmed_pointer ? " · ← confirmed pointer" : ""}
                {s.retry_of_snapshot_id ? (
                  <div style={{ color: "#888" }}>↳ retry of {s.retry_of_snapshot_id}</div>
                ) : null}
                <div style={{ fontFamily: "ui-monospace, monospace", color: "#999", fontSize: 10 }}>
                  {s._id}
                </div>
              </button>
            ))}
          </div>

          <h4 style={{ marginBottom: 4, marginTop: 16 }}>Audit events</h4>
          <ol style={{ fontSize: 11, lineHeight: 1.5, paddingLeft: 18 }}>
            {t.audit_events.map((a) => (
              <li key={a._id}>
                <code>{a.stage}</code> · {a.outcome} · {a.message}{" "}
                <span style={{ color: "#999" }}>({a.actor})</span>
              </li>
            ))}
          </ol>
        </>
      )}
    </aside>
  );
}

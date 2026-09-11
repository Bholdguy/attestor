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
  confirmed: "var(--green)",
  conflict: "var(--amber)",
  unconfirmed: "var(--grey)",
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
    <aside className="drawer" style={{ width: "min(680px, 100vw)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h3 style={{ margin: 0 }}>Timeline</h3>
        <button className="btn btn-outline btn-sm" onClick={onClose}>
          Close
        </button>
      </div>

      {t === undefined ? (
        <p className="muted">Loading…</p>
      ) : t === null ? (
        <p className="muted">Not found.</p>
      ) : (
        <>
          <p style={{ fontSize: 13, marginTop: 12 }}>
            <span className={`badge ${t.badge}`}>
              {badgeDisplay(t.badge).emoji} {badgeDisplay(t.badge).label}
            </span>{" "}
            &nbsp;{t.worker?.name_hired} ({t.license.license_number}, {t.license.issuing_state})
          </p>
          <p className="small muted">
            confirmed snapshot:{" "}
            <span className="mono">
              {t.license.current_confirmed_snapshot_id ?? "— (never confirmed)"}
            </span>
            {t.license.open_case_id ? " · open case" : ""}
            {!t.license.watch_enabled ? " · watch disabled" : ""}
          </p>

          <h4 style={{ marginBottom: 6, fontFamily: "var(--sans)", fontSize: "0.72rem", letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--ink-3)" }}>
            Snapshots
          </h4>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {t.snapshots.map((s, i) => (
              <button
                key={s._id}
                className="row-enter"
                onClick={() => onOpenSnapshot(s._id)}
                style={{
                  textAlign: "left",
                  border: "1px solid var(--line)",
                  borderLeft: `3px solid ${DISPO_COLOR[s.disposition] ?? "var(--grey)"}`,
                  borderRadius: 8,
                  padding: "8px 10px",
                  fontSize: 12,
                  cursor: "pointer",
                  background: s.is_confirmed_pointer ? "var(--green-bg)" : "var(--card)",
                  color: "var(--ink)",
                }}
              >
                <strong>T{i + 1}</strong> · {fmt(s.fetched_at)} · {s.source_mode} · {s.fetch_status}
                {s.fetch_http_code != null ? ` (${s.fetch_http_code})` : ""} ·{" "}
                <span style={{ color: DISPO_COLOR[s.disposition] }}>{s.disposition}</span>
                {s.status_normalized ? ` · status ${s.status_normalized}` : ""}
                {s.is_confirmed_pointer ? " · ← confirmed pointer" : ""}
                {s.retry_of_snapshot_id ? (
                  <div className="muted">↳ retry of {s.retry_of_snapshot_id}</div>
                ) : null}
                <div className="mono muted" style={{ fontSize: 10 }}>
                  {s._id}
                </div>
              </button>
            ))}
          </div>

          <h4 style={{ marginBottom: 6, marginTop: 18, fontFamily: "var(--sans)", fontSize: "0.72rem", letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--ink-3)" }}>
            Audit events
          </h4>
          <ol style={{ fontSize: 11, lineHeight: 1.6, paddingLeft: 18, color: "var(--ink-2)" }}>
            {t.audit_events.map((a) => (
              <li key={a._id}>
                <code>{a.stage}</code> · {a.outcome} · {a.message}{" "}
                <span className="muted">({a.actor})</span>
              </li>
            ))}
          </ol>
        </>
      )}
    </aside>
  );
}

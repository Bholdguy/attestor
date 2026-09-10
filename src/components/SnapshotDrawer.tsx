import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";

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
    <aside
      style={{
        position: "fixed",
        top: 0,
        right: 0,
        width: "min(560px, 100vw)",
        height: "100vh",
        background: "#fff",
        borderLeft: "1px solid #ccc",
        boxShadow: "-4px 0 16px rgba(0,0,0,0.08)",
        padding: 20,
        overflowY: "auto",
        zIndex: 50,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h3 style={{ margin: 0 }}>Snapshot</h3>
        <button onClick={onClose}>Close</button>
      </div>

      {snap === undefined ? (
        <p>Loading…</p>
      ) : snap === null ? (
        <p>Snapshot not found.</p>
      ) : (
        <>
          <dl style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "4px 12px", fontSize: 13 }}>
            <dt>snapshot_id</dt>
            <dd style={{ fontFamily: "ui-monospace, monospace" }}>{snap._id}</dd>
            <dt>disposition</dt>
            <dd>
              <strong>{snap.disposition}</strong>
            </dd>
            <dt>source_mode</dt>
            <dd>
              {snap.source_mode}
              {snap.source_mode === "fixture" ? " (DEMO DATA — not a live board)" : ""}
            </dd>
            <dt>source_url</dt>
            <dd style={{ wordBreak: "break-all" }}>{snap.source_url}</dd>
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
            <dd style={{ fontFamily: "ui-monospace, monospace", wordBreak: "break-all" }}>
              {snap.raw_payload_sha256}
            </dd>
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

          <h4 style={{ marginBottom: 4 }}>Raw payload excerpt (first 4 KB, as text)</h4>
          <pre
            style={{
              background: "#f6f6f6",
              border: "1px solid #e0e0e0",
              padding: 10,
              fontSize: 11,
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              maxHeight: 360,
              overflow: "auto",
            }}
          >
            {snap.raw_payload_excerpt || "(empty)"}
          </pre>
        </>
      )}
    </aside>
  );
}

import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";

// PRD §8 — reliability metrics. Targets: M2=100, M3=0, M4=0, M5=100, M6=100,
// M7=0, M8=0; M1 finite.
const CELLS: Array<{
  key: string;
  label: string;
  ok: (v: number | null) => boolean;
  fmt: (v: number | null) => string;
}> = [
  { key: "M1_fetch_to_alert_ms", label: "M1 fetch→alert", ok: (v) => v == null || v >= 0, fmt: (v) => (v == null ? "—" : `${(v / 1000).toFixed(1)}s`) },
  { key: "M2_zero_silent_drop_pct", label: "M2 no silent drop", ok: (v) => v === 100, fmt: (v) => `${v}%` },
  { key: "M3_false_accept", label: "M3 false accept", ok: (v) => v === 0, fmt: (v) => `${v}` },
  { key: "M4_false_flag", label: "M4 false flag", ok: (v) => v === 0, fmt: (v) => `${v}` },
  { key: "M5_identity_catch_pct", label: "M5 identity catch", ok: (v) => v === 100, fmt: (v) => `${v}%` },
  { key: "M6_privilege_catch_pct", label: "M6 privilege catch", ok: (v) => v === 100, fmt: (v) => `${v}%` },
  { key: "M7_snapshot_immutability", label: "M7 immutable", ok: (v) => v === 0, fmt: (v) => `${v}` },
  { key: "M8_atomic_gate_integrity", label: "M8 atomic gate", ok: (v) => v === 0, fmt: (v) => `${v}` },
];

export function MetricsPanel() {
  const m = useQuery(api.metrics.metricsPanel);
  if (!m) return null;
  const row = m as unknown as Record<string, number | null>;
  return (
    <section style={{ margin: "0 0 20px" }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {CELLS.map((c) => {
          const v = row[c.key];
          const good = c.ok(v);
          return (
            <div
              key={c.key}
              style={{
                border: "1px solid",
                borderColor: good
                  ? "color-mix(in srgb, var(--green) 24%, transparent)"
                  : "color-mix(in srgb, var(--amber) 30%, transparent)",
                background: good ? "var(--green-bg)" : "var(--amber-bg)",
                color: good ? "var(--green)" : "var(--amber)",
                borderRadius: "var(--radius-sm)",
                padding: "8px 12px",
                minWidth: 104,
              }}
            >
              <div className="small" style={{ color: "var(--ink-3)" }}>
                {c.label}
              </div>
              <div style={{ fontWeight: 600, fontSize: "0.98rem", fontFamily: "var(--serif)" }}>
                {c.fmt(v)}
              </div>
            </div>
          );
        })}
      </div>
      <div className="small muted" style={{ marginTop: 6 }}>
        snapshots {m.counts.snapshots} · cases {m.counts.cases} ({m.counts.open_cases} open) · alerts
        sent {m.counts.alerts_sent}
      </div>
    </section>
  );
}

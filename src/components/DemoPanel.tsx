import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";

// Step 10 — "Run demo" control + the persistent DEMO DATA banner (correctness
// rules 7 & 9). The banner renders whenever settings.demo_mode is on, above the
// router, so it cannot be missed on any screen. Copy is fixed (D-9 / SECURITY §1);
// only the skin changed in the frontend pass.

export function DemoBanner() {
  const s = useQuery(api.demo.getSettings);
  if (!s?.demo_mode) return null;
  return (
    <div className="demo-banner">
      DEMO DATA — fixtures, not a live board. Zero Firecrawl / zero OpenAI calls. AgentMail alerts
      are real.
    </div>
  );
}

export function DemoPanel() {
  const s = useQuery(api.demo.getSettings);
  const runDemo = useMutation(api.demo.runDemo);
  const clearDemo = useMutation(api.demo.clearDemo);
  const setDemoMode = useMutation(api.demo.setDemoMode);
  const [busy, setBusy] = useState<string | null>(null);

  const wrap = (name: string, fn: () => Promise<unknown>) => async () => {
    setBusy(name);
    try {
      await fn();
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="card-quiet" style={{ margin: "0 0 16px", borderStyle: "dashed" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
        <strong>Demo panel</strong>
        <span className="pill">{s?.demo_mode ? "demo (fixtures)" : "live"}</span>
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
        <button className="btn btn-sm" disabled={busy != null} onClick={wrap("run", () => runDemo({}))}>
          {busy === "run" ? "Seeding…" : "Run demo (seed Nurses A–D + compressed sweep)"}
        </button>
        <button className="btn btn-outline btn-sm" disabled={busy != null} onClick={wrap("clear", () => clearDemo({}))}>
          Clear demo
        </button>
        <button
          className="btn btn-outline btn-sm"
          disabled={busy != null}
          onClick={wrap("toggle", () => setDemoMode({ demo_mode: !s?.demo_mode }))}
        >
          {s?.demo_mode ? "Switch to live mode" : "Switch to demo mode"}
        </button>
      </div>
      <p className="small muted" style={{ margin: "12px 0 0" }}>
        Live-integration proof (Beat 3): switch to live mode, add a worker with a real{" "}
        <code>https://…</code> board URL, then click “Check now” for one real Firecrawl + OpenAI pass.
      </p>
    </section>
  );
}

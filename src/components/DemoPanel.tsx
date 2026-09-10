import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";

// Step 10 — "Run demo" control + the persistent DEMO DATA banner (correctness
// rules 7 & 9). The banner renders whenever settings.demo_mode is on, above the
// router, so it cannot be missed on any screen.

export function DemoBanner() {
  const s = useQuery(api.demo.getSettings);
  if (!s?.demo_mode) return null;
  return (
    <div
      style={{
        background: "#ffe08a",
        color: "#5b4300",
        borderBottom: "2px solid #e0b93c",
        padding: "6px 16px",
        fontWeight: 600,
        fontSize: 13,
        position: "sticky",
        top: 0,
        zIndex: 100,
      }}
    >
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
    <section
      style={{
        border: "1px dashed #c9a227",
        borderRadius: 8,
        padding: "10px 14px",
        margin: "8px 0 16px",
        background: "#fffdf5",
        fontSize: 13,
      }}
    >
      <strong>Demo panel</strong> — mode:{" "}
      <code>{s?.demo_mode ? "demo (fixtures)" : "live"}</code>
      <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
        <button disabled={busy != null} onClick={wrap("run", () => runDemo({}))}>
          {busy === "run" ? "Seeding…" : "Run demo (seed Nurses A–D + compressed sweep)"}
        </button>
        <button disabled={busy != null} onClick={wrap("clear", () => clearDemo({}))}>
          Clear demo
        </button>
        <button
          disabled={busy != null}
          onClick={wrap("toggle", () => setDemoMode({ demo_mode: !s?.demo_mode }))}
        >
          {s?.demo_mode ? "Switch to live mode" : "Switch to demo mode"}
        </button>
      </div>
      <p style={{ color: "#8a7320", marginBottom: 0, marginTop: 8 }}>
        Live-integration proof (Beat 3): switch to live mode, add a worker with a real{" "}
        <code>https://…</code> board URL, and the loop runs one real Firecrawl + OpenAI pass.
      </p>
    </section>
  );
}

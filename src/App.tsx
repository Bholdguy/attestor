import { useState, type FormEvent } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { badgeDisplay } from "./lib/badge";
import { SnapshotDrawer } from "./components/SnapshotDrawer";
import { CaseDetail } from "./components/CaseDetail";
import { WorkerTimeline } from "./components/WorkerTimeline";
import { CompareView } from "./components/CompareView";
import { MetricsPanel } from "./components/MetricsPanel";

// Step 9 — operator dashboard. Roster (badge + confirmed_snapshot_id, I1) →
// timeline → snapshot drawer; open cases → case detail → compare + resolve;
// metrics panel. The DEMO DATA banner is added in Step 10.

type LicenseType = "RN" | "LPN" | "CNA";
type Privilege = "single_state" | "multistate" | "unknown";

const BLANK = {
  name_registered: "",
  name_hired: "",
  license_number: "",
  issuing_state: "",
  assignment_state: "",
  facility_name: "",
  board_profile_url: "fixture://active_clean",
  license_type: "RN" as LicenseType,
  declared_privilege_type: "single_state" as Privilege,
};

export default function App() {
  const roster = useQuery(api.roster.listRoster);
  const openCases = useQuery(api.cases.listOpenCases);
  const addWorker = useMutation(api.roster.addWorker);
  const [form, setForm] = useState({ ...BLANK });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [openSnapshot, setOpenSnapshot] = useState<Id<"snapshots"> | null>(null);
  const [openCase, setOpenCase] = useState<Id<"mismatch_cases"> | null>(null);
  const [openTimeline, setOpenTimeline] = useState<Id<"licenses"> | null>(null);
  const [compare, setCompare] = useState<{ a: Id<"snapshots">; b: Id<"snapshots"> } | null>(null);

  const set = (k: keyof typeof BLANK) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await addWorker(form);
      setForm({ ...BLANK });
      setShowForm(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: 24, maxWidth: 1040, margin: "0 auto" }}>
      <h1 style={{ marginBottom: 4 }}>Attestor</h1>
      <p style={{ marginTop: 0, color: "#555" }}>
        License Trust Supervisor — it tells you whether to trust what the board page just said.
      </p>

      <MetricsPanel />

      <section style={{ marginBottom: 16 }}>
        <button onClick={() => setShowForm((s) => !s)}>{showForm ? "Cancel" : "+ Add worker"}</button>
        {showForm && (
          <div style={{ border: "1px solid #ddd", borderRadius: 8, padding: 16, marginTop: 8 }}>
            <form onSubmit={onSubmit} style={{ display: "grid", gap: 8, gridTemplateColumns: "1fr 1fr" }}>
              <label>Name (registered)<input required value={form.name_registered} onChange={set("name_registered")} /></label>
              <label>Name (hired)<input required value={form.name_hired} onChange={set("name_hired")} /></label>
              <label>License number<input required value={form.license_number} onChange={set("license_number")} /></label>
              <label>Facility<input required value={form.facility_name} onChange={set("facility_name")} /></label>
              <label>Issuing state<input required maxLength={2} placeholder="NY" value={form.issuing_state} onChange={set("issuing_state")} /></label>
              <label>Assignment state<input required maxLength={2} placeholder="NY" value={form.assignment_state} onChange={set("assignment_state")} /></label>
              <label>License type
                <select value={form.license_type} onChange={set("license_type")}>
                  <option>RN</option><option>LPN</option><option>CNA</option>
                </select>
              </label>
              <label>Declared privilege
                <select value={form.declared_privilege_type} onChange={set("declared_privilege_type")}>
                  <option value="single_state">single_state</option>
                  <option value="multistate">multistate</option>
                  <option value="unknown">unknown</option>
                </select>
              </label>
              <label style={{ gridColumn: "1 / -1" }}>Board profile URL (or fixture://&lt;id&gt;)
                <input required value={form.board_profile_url} onChange={set("board_profile_url")} />
              </label>
              <button type="submit" disabled={busy} style={{ gridColumn: "1 / -1", padding: "8px 0" }}>
                {busy ? "Adding…" : "Add worker"}
              </button>
            </form>
            {error && <p style={{ color: "#b00020", whiteSpace: "pre-wrap" }}>{error}</p>}
          </div>
        )}
      </section>

      <section>
        <h2 style={{ fontSize: 16 }}>Roster</h2>
        {roster === undefined ? (
          <p>Loading…</p>
        ) : roster.length === 0 ? (
          <p style={{ color: "#777" }}>No workers yet. Add one above.</p>
        ) : (
          <table style={{ borderCollapse: "collapse", width: "100%" }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "2px solid #ccc" }}>
                <th style={{ padding: "6px 8px" }}>Badge</th>
                <th style={{ padding: "6px 8px" }}>Worker (hired)</th>
                <th style={{ padding: "6px 8px" }}>Registered</th>
                <th style={{ padding: "6px 8px" }}>License</th>
                <th style={{ padding: "6px 8px" }}>State</th>
                <th style={{ padding: "6px 8px" }}>Confirmed snapshot (I1)</th>
                <th style={{ padding: "6px 8px" }}>Latest</th>
              </tr>
            </thead>
            <tbody>
              {roster.map((r) => {
                const b = badgeDisplay(r.badge);
                return (
                  <tr key={r.licenseId} style={{ borderBottom: "1px solid #eee" }}>
                    <td style={{ padding: "6px 8px", whiteSpace: "nowrap" }}>
                      {b.emoji} {b.label}
                    </td>
                    <td style={{ padding: "6px 8px" }}>
                      <button
                        onClick={() => setOpenTimeline(r.licenseId)}
                        style={{ font: "inherit", cursor: "pointer", textAlign: "left" }}
                      >
                        {r.nameHired}
                      </button>
                    </td>
                    <td style={{ padding: "6px 8px" }}>{r.nameRegistered}</td>
                    <td style={{ padding: "6px 8px" }}>
                      {r.licenseType} {r.licenseNumber}
                    </td>
                    <td style={{ padding: "6px 8px" }}>{r.issuingState}</td>
                    <td
                      style={{
                        padding: "6px 8px",
                        fontFamily: "ui-monospace, monospace",
                        fontSize: 11,
                      }}
                    >
                      {/* I1 — every displayed status carries its backing snapshot id */}
                      {r.confirmedSnapshotId ?? "— (never confirmed)"}
                    </td>
                    <td style={{ padding: "6px 8px" }}>
                      {r.latestSnapshotId ? (
                        <button
                          onClick={() => setOpenSnapshot(r.latestSnapshotId)}
                          style={{ font: "inherit", cursor: "pointer" }}
                        >
                          {r.latestFetchStatus ?? "—"}
                          {r.latestDisposition ? ` · ${r.latestDisposition}` : ""}
                        </button>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      <section style={{ marginTop: 24 }}>
        <h2 style={{ fontSize: 16 }}>Open mismatch cases</h2>
        {openCases === undefined ? (
          <p>Loading…</p>
        ) : openCases.length === 0 ? (
          <p style={{ color: "#777" }}>None open.</p>
        ) : (
          <table style={{ borderCollapse: "collapse", width: "100%" }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "2px solid #ccc" }}>
                <th style={{ padding: "6px 8px" }}>Type</th>
                <th style={{ padding: "6px 8px" }}>Worker</th>
                <th style={{ padding: "6px 8px" }}>Detected</th>
                <th style={{ padding: "6px 8px" }}>Reason</th>
              </tr>
            </thead>
            <tbody>
              {openCases.map((c) => (
                <tr
                  key={c._id}
                  onClick={() => setOpenCase(c._id)}
                  style={{ borderBottom: "1px solid #eee", cursor: "pointer" }}
                >
                  <td style={{ padding: "6px 8px" }}>🟠 {c.type}</td>
                  <td style={{ padding: "6px 8px" }}>{c.worker_name_hired}</td>
                  <td style={{ padding: "6px 8px" }}>{c.detected_types.join(", ")}</td>
                  <td style={{ padding: "6px 8px", fontSize: 12 }}>{c.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {openTimeline && (
        <WorkerTimeline
          licenseId={openTimeline}
          onOpenSnapshot={(id) => setOpenSnapshot(id)}
          onClose={() => setOpenTimeline(null)}
        />
      )}
      {openSnapshot && (
        <SnapshotDrawer snapshotId={openSnapshot} onClose={() => setOpenSnapshot(null)} />
      )}
      {openCase && (
        <CaseDetail
          caseId={openCase}
          onClose={() => setOpenCase(null)}
          onCompare={(a, b) => setCompare({ a, b })}
        />
      )}
      {compare && (
        <CompareView aId={compare.a} bId={compare.b} onClose={() => setCompare(null)} />
      )}
    </main>
  );
}

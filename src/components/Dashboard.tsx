import { useState, type FormEvent } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { badgeDisplay } from "../lib/badge";
import { SnapshotDrawer } from "./SnapshotDrawer";
import { CaseDetail } from "./CaseDetail";
import { WorkerTimeline } from "./WorkerTimeline";
import { CompareView } from "./CompareView";
import { MetricsPanel } from "./MetricsPanel";
import { DemoBanner, DemoPanel } from "./DemoPanel";

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

export function Dashboard() {
  const roster = useQuery(api.roster.listRoster);
  const openCases = useQuery(api.cases.listOpenCases);
  const addWorker = useMutation(api.roster.addWorker);
  const checkNow = useMutation(api.roster.checkNow);
  const [checking, setChecking] = useState<string | null>(null);
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
    <>
      <div className="dash-ground" aria-hidden="true" />
      <DemoBanner />

      <header className="nav">
        <div className="nav-inner">
          <a href="#/" className="wordmark">
            Attestor
          </a>
          <span className="muted small" style={{ marginLeft: 4 }}>
            operator dashboard
          </span>
          <nav className="nav-links">
            <a href="#/">Landing</a>
            <a
              href="https://github.com/Bholdguy/attestor"
              target="_blank"
              rel="noreferrer noopener"
            >
              GitHub
            </a>
          </nav>
        </div>
      </header>

      <main className="wrap" style={{ paddingTop: 28, paddingBottom: 80 }}>
        <DemoPanel />
        <MetricsPanel />

        <section style={{ margin: "8px 0 20px" }}>
          <button className="btn btn-outline btn-sm" onClick={() => setShowForm((s) => !s)}>
            {showForm ? "Cancel" : "+ Add worker"}
          </button>
          {showForm && (
            <div className="card" style={{ marginTop: 12 }}>
              <form onSubmit={onSubmit} className="grid grid-2" style={{ gap: 10 }}>
                <label className="small">
                  Name (registered)
                  <input required value={form.name_registered} onChange={set("name_registered")} />
                </label>
                <label className="small">
                  Name (hired)
                  <input required value={form.name_hired} onChange={set("name_hired")} />
                </label>
                <label className="small">
                  License number
                  <input required value={form.license_number} onChange={set("license_number")} />
                </label>
                <label className="small">
                  Facility
                  <input required value={form.facility_name} onChange={set("facility_name")} />
                </label>
                <label className="small">
                  Issuing state
                  <input required maxLength={2} placeholder="NY" value={form.issuing_state} onChange={set("issuing_state")} />
                </label>
                <label className="small">
                  Assignment state
                  <input required maxLength={2} placeholder="NY" value={form.assignment_state} onChange={set("assignment_state")} />
                </label>
                <label className="small">
                  License type
                  <select value={form.license_type} onChange={set("license_type")}>
                    <option>RN</option>
                    <option>LPN</option>
                    <option>CNA</option>
                  </select>
                </label>
                <label className="small">
                  Declared privilege
                  <select value={form.declared_privilege_type} onChange={set("declared_privilege_type")}>
                    <option value="single_state">single_state</option>
                    <option value="multistate">multistate</option>
                    <option value="unknown">unknown</option>
                  </select>
                </label>
                <label className="small" style={{ gridColumn: "1 / -1" }}>
                  Board profile URL (or fixture://&lt;id&gt;)
                  <input required value={form.board_profile_url} onChange={set("board_profile_url")} />
                </label>
                <button className="btn" type="submit" disabled={busy} style={{ gridColumn: "1 / -1" }}>
                  {busy ? "Adding…" : "Add worker"}
                </button>
              </form>
              {error && (
                <p className="small" style={{ color: "#b00020", whiteSpace: "pre-wrap", marginTop: 8 }}>
                  {error}
                </p>
              )}
            </div>
          )}
        </section>

        <section style={{ marginBottom: 28 }}>
          <h3 style={{ fontFamily: "var(--sans)", fontSize: "0.8rem", textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--ink-3)" }}>
            Roster
          </h3>
          {roster === undefined ? (
            <p className="muted">Loading…</p>
          ) : roster.length === 0 ? (
            <p className="muted">No workers yet. Add one above.</p>
          ) : (
            <div className="card" style={{ padding: 0, overflowX: "auto" }}>
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Badge</th>
                    <th>Worker (hired)</th>
                    <th>Registered</th>
                    <th>License</th>
                    <th>State</th>
                    <th>Confirmed snapshot&nbsp;(I1)</th>
                    <th>Latest</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {roster.map((r) => {
                    const b = badgeDisplay(r.badge);
                    return (
                      <tr key={r.licenseId} className="row-enter">
                        <td>
                          <span className={`badge ${r.badge}`}>
                            {b.emoji} {b.label}
                          </span>
                        </td>
                        <td>
                          <button
                            className="btn-outline btn-sm"
                            style={{ border: 0, background: "none", padding: 0, textDecoration: "underline", textDecorationColor: "var(--line-2)" }}
                            onClick={() => setOpenTimeline(r.licenseId)}
                          >
                            {r.nameHired}
                          </button>
                        </td>
                        <td>{r.nameRegistered}</td>
                        <td>
                          {r.licenseType} {r.licenseNumber}
                        </td>
                        <td>{r.issuingState}</td>
                        <td className="mono" style={{ fontSize: "0.68rem", color: "var(--ink-2)" }}>
                          {r.confirmedSnapshotId ?? "— (never confirmed)"}
                        </td>
                        <td>
                          {r.latestSnapshotId ? (
                            <button
                              className="btn-sm"
                              style={{ border: 0, background: "none", padding: 0, textDecoration: "underline", textDecorationColor: "var(--line-2)", cursor: "pointer" }}
                              onClick={() => setOpenSnapshot(r.latestSnapshotId)}
                            >
                              {r.latestFetchStatus ?? "—"}
                              {r.latestDisposition ? ` · ${r.latestDisposition}` : ""}
                            </button>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td>
                          <button
                            className="btn btn-outline btn-sm"
                            disabled={checking === r.licenseId}
                            onClick={async () => {
                              setChecking(r.licenseId);
                              try {
                                await checkNow({ licenseId: r.licenseId });
                              } finally {
                                setTimeout(() => setChecking(null), 1500);
                              }
                            }}
                          >
                            {checking === r.licenseId ? "Checking…" : "Check now"}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section>
          <h3 style={{ fontFamily: "var(--sans)", fontSize: "0.8rem", textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--ink-3)" }}>
            Open mismatch cases
          </h3>
          {openCases === undefined ? (
            <p className="muted">Loading…</p>
          ) : openCases.length === 0 ? (
            <p className="muted">None open.</p>
          ) : (
            <div className="card" style={{ padding: 0, overflowX: "auto" }}>
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Type</th>
                    <th>Worker</th>
                    <th>Detected</th>
                    <th>Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {openCases.map((c) => (
                    <tr
                      key={c._id}
                      className="row-enter"
                      onClick={() => setOpenCase(c._id)}
                      style={{ cursor: "pointer" }}
                    >
                      <td>
                        <span className="badge needs_review">{c.type}</span>
                      </td>
                      <td>{c.worker_name_hired}</td>
                      <td className="small muted">{c.detected_types.join(", ")}</td>
                      <td className="small">{c.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>

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
      {compare && <CompareView aId={compare.a} bId={compare.b} onClose={() => setCompare(null)} />}
    </>
  );
}

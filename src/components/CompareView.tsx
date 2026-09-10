import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";

// Step 9 — snapshot_a vs snapshot_b, conflicting rows highlighted (experience C).

export function CompareView({
  aId,
  bId,
  onClose,
}: {
  aId: Id<"snapshots">;
  bId: Id<"snapshots">;
  onClose: () => void;
}) {
  const cmp = useQuery(api.timeline.compareSnapshots, { aId, bId });

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.35)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 70,
      }}
      onClick={onClose}
    >
      <div
        style={{ background: "#fff", borderRadius: 8, padding: 20, maxWidth: 720, width: "90%" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3 style={{ margin: 0 }}>Compare snapshots</h3>
          <button onClick={onClose}>Close</button>
        </div>
        {cmp === undefined ? (
          <p>Loading…</p>
        ) : cmp === null ? (
          <p>Not found.</p>
        ) : (
          <>
            <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 13, marginTop: 8 }}>
              <thead>
                <tr style={{ textAlign: "left", borderBottom: "2px solid #ccc" }}>
                  <th style={{ padding: "4px 8px" }}>field</th>
                  <th style={{ padding: "4px 8px" }}>
                    A · {cmp.a.disposition}
                    <div style={{ fontFamily: "ui-monospace, monospace", fontSize: 10, color: "#999" }}>
                      {cmp.a._id}
                    </div>
                  </th>
                  <th style={{ padding: "4px 8px" }}>
                    B · {cmp.b.disposition}
                    <div style={{ fontFamily: "ui-monospace, monospace", fontSize: 10, color: "#999" }}>
                      {cmp.b._id}
                    </div>
                  </th>
                </tr>
              </thead>
              <tbody>
                {cmp.rows.map((r) => (
                  <tr key={r.field} style={{ background: r.differs ? "#fff3cd" : undefined }}>
                    <td style={{ padding: "4px 8px", color: "#666" }}>{r.field}</td>
                    <td style={{ padding: "4px 8px" }}>{r.a}</td>
                    <td style={{ padding: "4px 8px" }}>{r.b}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {cmp.diff_b && !cmp.diff_b.agrees && (
              <p style={{ fontSize: 12, marginTop: 8 }}>
                <strong>Why B was flagged:</strong>{" "}
                {cmp.diff_b.conflicts.map((c) => `${c.field} ${c.prior}→${c.current}`).join("; ")}
                {cmp.identity_b && cmp.identity_b.mismatch_reason !== "none"
                  ? ` · identity ${cmp.identity_b.mismatch_reason}`
                  : ""}
                {cmp.privilege_b && !cmp.privilege_b.valid
                  ? ` · privilege ${cmp.privilege_b.reason}`
                  : ""}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// agentmail.ts — AgentMail client wrapper (plain fetch) + the alert evidence
// builder. The ONLY module that reads AGENTMAIL_API_KEY / AGENTMAIL_INBOX_ID.
// It sends only — no inbound handler anywhere (SECURITY §3).
//
// Send: POST {AGENTMAIL_BASE_URL}/v0/inboxes/{inbox_id}/messages/send  (D-14)
//   body: { to, cc?, subject, text, html, attachments[] }
//   attachment: { filename, content_type, content(base64), content_disposition }
//   response: { message_id, thread_id }
// ─────────────────────────────────────────────────────────────────────────────
import type { Doc } from "./_generated/dataModel";

const AGENTMAIL_BASE_URL = (process.env.AGENTMAIL_BASE_URL || "https://api.agentmail.to").replace(
  /\/$/,
  "",
);
const REQUEST_TIMEOUT_MS = 20_000;

export type SendResult =
  | { ok: true; message_id: string | null; thread_id: string | null }
  | { ok: false; status: number | null; error: string };

export interface OutboundMessage {
  subject: string;
  text: string;
  html: string;
  attachments: Array<{
    filename: string;
    content_type: string;
    content: string; // base64
    content_disposition: "attachment" | "inline";
  }>;
}

// ── base64 for UTF-8 strings (Convex default runtime: btoa only, no Buffer) ──
function base64Utf8(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmtTs(ts: number | null | undefined): string {
  return ts ? new Date(ts).toISOString().replace("T", " ").slice(0, 19) + " UTC" : "—";
}

// ── evidence builder ───────────────────────────────────────────────────────
export interface CaseBundle {
  case: Doc<"mismatch_cases">;
  worker: Doc<"workers"> | null;
  license: Doc<"licenses"> | null;
  snapshot_a: Doc<"snapshots"> | null;
  snapshot_b: Doc<"snapshots"> | null;
}

const SNAPSHOT_ROWS: Array<{ label: string; get: (s: Doc<"snapshots"> | null) => string }> = [
  { label: "disposition", get: (s) => s?.disposition ?? "—" },
  { label: "fetch_status", get: (s) => (s ? `${s.fetch_status}${s.fetch_http_code != null ? ` (${s.fetch_http_code})` : ""}` : "—") },
  { label: "fetched_at", get: (s) => fmtTs(s?.fetched_at) },
  { label: "source", get: (s) => (s ? `${s.source_mode} · ${s.source_url}` : "—") },
  { label: "status_word", get: (s) => s?.extracted_fields?.status_word ?? "—" },
  { label: "status_normalized", get: (s) => s?.extracted_fields?.status_normalized ?? "—" },
  { label: "licensee_name", get: (s) => s?.extracted_fields?.licensee_name ?? "—" },
  { label: "license_number", get: (s) => s?.extracted_fields?.license_number ?? "—" },
  { label: "privilege_type", get: (s) => s?.extracted_fields?.privilege_type ?? "—" },
  { label: "primary_state_of_residence", get: (s) => s?.extracted_fields?.primary_state_of_residence ?? "—" },
  { label: "expire_date", get: (s) => s?.extracted_fields?.expire_date ?? "—" },
  { label: "identity", get: (s) => (s?.identity_result ? `${s.identity_result.match_confidence} / ${s.identity_result.mismatch_reason}` : "—") },
  { label: "privilege", get: (s) => (s?.privilege_result ? `${s.privilege_result.valid ? "valid" : "invalid"} / ${s.privilege_result.reason}` : "—") },
  { label: "raw excerpt", get: (s) => (s?.raw_payload_excerpt ?? "").replace(/\s+/g, " ").slice(0, 200) },
];

export function buildEvidence(b: CaseBundle): OutboundMessage {
  const c = b.case;
  const workerName = b.worker?.name_hired ?? "(unknown worker)";
  const licenseNo = b.license?.license_number ?? c.license_id;
  const changed = new Set(c.detail.conflicts.map((x) => x.field));

  const subject = `[Attestor] ${c.type} mismatch — ${workerName} (${licenseNo})`;

  const rowsHtml = SNAPSHOT_ROWS.map((r) => {
    const a = r.get(b.snapshot_a);
    const bb = r.get(b.snapshot_b);
    const hot =
      a !== bb ||
      changed.has(r.label) ||
      (r.label === "identity" && c.type === "identity") ||
      (r.label === "privilege" && c.type === "privilege");
    const bg = hot ? ' style="background:#fff3cd"' : "";
    return `<tr${bg}><th style="text-align:left;padding:2px 8px">${esc(r.label)}</th><td style="padding:2px 8px">${esc(a)}</td><td style="padding:2px 8px">${esc(bb)}</td></tr>`;
  }).join("");

  const html = `<div style="font-family:system-ui,sans-serif">
  <h2>Attestor — ${esc(c.type)} mismatch</h2>
  <p><strong>Worker:</strong> ${esc(workerName)} &nbsp; <strong>License:</strong> ${esc(String(licenseNo))}</p>
  <p><strong>Reason:</strong> ${esc(c.reason)}</p>
  <p><strong>Detected:</strong> ${esc(c.detail.detected_types.join(", "))}</p>
  <table style="border-collapse:collapse;font-size:13px" border="1">
    <thead><tr><th style="padding:2px 8px">field</th><th style="padding:2px 8px">snapshot A (${esc(String(c.snapshot_a_id))})</th><th style="padding:2px 8px">snapshot B (${esc(String(c.snapshot_b_id))})</th></tr></thead>
    <tbody>${rowsHtml}</tbody>
  </table>
  <p style="color:#666;font-size:12px">This is an automated alert. Resolve it in the Attestor dashboard — it is not cleared by replying to this email.</p>
</div>`;

  const text = [
    `Attestor — ${c.type} mismatch`,
    `Worker: ${workerName}   License: ${licenseNo}`,
    `Reason: ${c.reason}`,
    `Detected: ${c.detail.detected_types.join(", ")}`,
    ``,
    `snapshot A: ${c.snapshot_a_id}`,
    `snapshot B: ${c.snapshot_b_id}`,
    ...SNAPSHOT_ROWS.map((r) => `  ${r.label}: A=${r.get(b.snapshot_a)}  |  B=${r.get(b.snapshot_b)}`),
    ``,
    `Resolve this in the Attestor dashboard (not by replying).`,
  ].join("\n");

  const caseJson = JSON.stringify(
    {
      case: c,
      snapshot_a: b.snapshot_a,
      snapshot_b: b.snapshot_b,
      worker: b.worker ? { name_hired: b.worker.name_hired, name_registered: b.worker.name_registered } : null,
    },
    null,
    2,
  );

  return {
    subject,
    text,
    html,
    attachments: [
      {
        filename: "case.json",
        content_type: "application/json",
        content: base64Utf8(caseJson),
        content_disposition: "attachment",
      },
    ],
  };
}

// ── send ───────────────────────────────────────────────────────────────────
export async function sendAgentMail(input: {
  to: string;
  cc?: string | null;
  message: OutboundMessage;
}): Promise<SendResult> {
  const apiKey = process.env.AGENTMAIL_API_KEY;
  const inboxId = process.env.AGENTMAIL_INBOX_ID;
  if (!apiKey || !inboxId) {
    return { ok: false, status: null, error: "AGENTMAIL_API_KEY / AGENTMAIL_INBOX_ID not set" };
  }
  if (!input.to) {
    return { ok: false, status: null, error: "ALERT_TO not set" };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(
      `${AGENTMAIL_BASE_URL}/v0/inboxes/${encodeURIComponent(inboxId)}/messages/send`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          to: input.to,
          ...(input.cc ? { cc: input.cc } : {}),
          subject: input.message.subject,
          text: input.message.text,
          html: input.message.html,
          attachments: input.message.attachments,
        }),
      },
    );
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { ok: false, status: res.status, error: `${res.status} ${body.slice(0, 300)}` };
    }
    const json = (await res.json().catch(() => ({}))) as {
      message_id?: string;
      thread_id?: string;
      id?: string;
    };
    return {
      ok: true,
      message_id: json.message_id ?? json.id ?? null,
      thread_id: json.thread_id ?? null,
    };
  } catch (err) {
    const aborted = err instanceof Error && err.name === "AbortError";
    return { ok: false, status: null, error: aborted ? "timeout" : (err as Error)?.message || "network error" };
  } finally {
    clearTimeout(timer);
  }
}

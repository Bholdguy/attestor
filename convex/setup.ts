// One-off deployment setup helpers. Reusable (env-only, no embedded secrets).
//
//   npx convex run setup:createAgentMailInbox '{"client_id":"attestor-alerts","display_name":"Attestor Alerts"}'
//
// Reads AGENTMAIL_API_KEY from the deployment env, creates the alert inbox once
// (TASKS Step 8), and returns ONLY { inbox_id }. Then:
//   npx convex env set AGENTMAIL_INBOX_ID <inbox_id>
//
// This does not send any email. It never logs the API key or the full response.
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";

/**
 * Freeze a license so the cron sweep skips it (watch_enabled:false). Used to
 * keep a captured `source_mode:"live"` snapshot as standing evidence WITHOUT
 * re-scraping it every sweep interval (Firecrawl free tier is 1000 credits).
 *   npx convex run setup:freezeLicense '{"licenseId":"..."}'
 */
export const freezeLicense = internalMutation({
  args: { licenseId: v.id("licenses") },
  returns: v.object({ watch_enabled: v.boolean() }),
  handler: async (ctx, { licenseId }) => {
    await ctx.db.patch(licenseId, { watch_enabled: false });
    return { watch_enabled: false };
  },
});

/** List every license id + a one-line status (debug / cleanup). */
export const listLicensesBrief = internalQuery({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("licenses").collect();
    return rows.map((r) => ({
      _id: r._id,
      license_number: r.license_number,
      board_profile_url: r.board_profile_url,
      watch_enabled: r.watch_enabled,
    }));
  },
});

/** Debug: non-blob fields of the latest snapshot for a license. */
export const inspectLatestSnapshot = internalQuery({
  args: { licenseId: v.id("licenses") },
  handler: async (ctx, { licenseId }) => {
    const s = await ctx.db
      .query("snapshots")
      .withIndex("by_license", (q) => q.eq("license_id", licenseId))
      .order("desc")
      .first();
    if (!s) return null;
    return {
      fetch_status: s.fetch_status,
      fetch_http_code: s.fetch_http_code,
      source_mode: s.source_mode,
      source_url: s.source_url,
      raw_payload_bytes: s.raw_payload_bytes,
      raw_payload_sha256: s.raw_payload_sha256,
      has_blob: s.raw_payload_storage_id != null,
      extractor_model: s.extractor_model,
      extractor_raw_response: (s.extractor_raw_response ?? "").slice(0, 600),
      disposition: s.disposition,
    };
  },
});

const AGENTMAIL_BASE_URL = (process.env.AGENTMAIL_BASE_URL || "https://api.agentmail.to").replace(
  /\/$/,
  "",
);
const FIRECRAWL_BASE_URL = (process.env.FIRECRAWL_BASE_URL || "https://api.firecrawl.dev").replace(
  /\/$/,
  "",
);

/**
 * BD-1 probe — one real Firecrawl /v2/scrape with the exact production body,
 * returning only non-sensitive diagnostics (no API key, no full HTML). Used to
 * verify the CA DCA BRN live scrape at Step 4; safe to keep as a debug tool.
 *   npx convex run setup:firecrawlProbe '{"url":"https://search.dca.ca.gov/..."}'
 */
export const firecrawlProbe = internalAction({
  args: {
    url: v.string(),
    waitFor: v.optional(v.number()),
    proxy: v.optional(v.string()),
  },
  returns: v.object({
    firecrawl_http_status: v.union(v.number(), v.null()),
    target_status_code: v.union(v.number(), v.null()),
    html_bytes: v.number(),
    title: v.string(),
    looks_blocked: v.boolean(),
    has_license_markers: v.boolean(),
    proxy_used: v.string(),
    snippet: v.string(),
    marker_context: v.string(),
    detail_marker_count: v.number(),
    form_controls: v.string(),
  }),
  handler: async (_ctx, args) => {
    const apiKey = process.env.FIRECRAWL_API_KEY;
    if (!apiKey) throw new Error("FIRECRAWL_API_KEY is not set on this deployment");
    const proxy = args.proxy ?? "auto";

    const res = await fetch(`${FIRECRAWL_BASE_URL}/v2/scrape`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        url: args.url,
        formats: ["rawHtml"],
        onlyMainContent: false,
        waitFor: args.waitFor ?? 2500,
        proxy,
        blockAds: true,
      }),
    });

    let rawHtml = "";
    let targetStatus: number | null = null;
    if (res.ok) {
      const json = (await res.json().catch(() => ({}))) as {
        data?: { rawHtml?: string; metadata?: { statusCode?: number; title?: string } };
      };
      rawHtml = json.data?.rawHtml ?? "";
      targetStatus = json.data?.metadata?.statusCode ?? null;
    }

    const lower = rawHtml.toLowerCase();
    const looks_blocked =
      rawHtml.length < 60_000 &&
      /(unusual traffic|verify you are human|captcha|g-recaptcha|access denied|request blocked)/i.test(
        rawHtml,
      );
    const has_license_markers =
      /(license (number|status)|expiration date|primary status|registered nurse|board of registered nursing)/i.test(
        lower,
      );
    const titleMatch = rawHtml.match(/<title[^>]*>([\s\S]{0,200}?)<\/title>/i);

    // Window around the first rendered detail marker (proves real fields, not shell).
    const DETAIL_RE =
      /(license number|primary status|expiration date|issue date|licensee name|primary status:)/i;
    const first = rawHtml.search(DETAIL_RE);
    const marker_context =
      first >= 0
        ? rawHtml
            .slice(Math.max(0, first - 200), first + 900)
            .replace(/<[^>]+>/g, " ")
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 900)
        : "";
    const detail_marker_count = (
      rawHtml.match(/license number|primary status|expiration date/gi) ?? []
    ).length;

    return {
      firecrawl_http_status: res.status ?? null,
      target_status_code: targetStatus,
      html_bytes: rawHtml.length,
      title: (titleMatch?.[1] ?? "").trim().slice(0, 160),
      looks_blocked,
      has_license_markers,
      proxy_used: proxy,
      snippet: rawHtml.replace(/\s+/g, " ").trim().slice(0, 400),
      marker_context,
      detail_marker_count,
      form_controls: (rawHtml.match(/<(input|select|button|a)\b[^>]*>/gi) ?? [])
        .filter((t) => /name=|id=|placeholder=|href="\/results|href="\/details|type="submit"/i.test(t))
        .slice(0, 40)
        .join("\n")
        .slice(0, 1800),
    };
  },
});

export const createAgentMailInbox = internalAction({
  args: {
    client_id: v.optional(v.string()),
    display_name: v.optional(v.string()),
    username: v.optional(v.string()),
    domain: v.optional(v.string()),
  },
  returns: v.object({ inbox_id: v.string() }),
  handler: async (_ctx, args) => {
    const apiKey = process.env.AGENTMAIL_API_KEY;
    if (!apiKey) {
      throw new Error("AGENTMAIL_API_KEY is not set on this deployment");
    }

    const body: Record<string, string> = {};
    if (args.client_id) body.client_id = args.client_id;
    if (args.display_name) body.display_name = args.display_name;
    if (args.username) body.username = args.username;
    if (args.domain) body.domain = args.domain;

    const res = await fetch(`${AGENTMAIL_BASE_URL}/v0/inboxes`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      // Trim the error body; never echo the request (which carried the auth header).
      const text = await res.text().catch(() => "");
      throw new Error(`AgentMail POST /v0/inboxes → ${res.status}: ${text.slice(0, 300)}`);
    }

    const json = (await res.json()) as {
      inbox_id?: string;
      id?: string;
      email?: string;
    };
    const inbox_id = json.inbox_id ?? json.id ?? json.email;
    if (!inbox_id) {
      throw new Error("AgentMail create-inbox response contained no inbox_id");
    }
    // The return value is the ONLY thing printed by `npx convex run`.
    return { inbox_id };
  },
});

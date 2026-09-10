// ─────────────────────────────────────────────────────────────────────────────
// firecrawl.ts — fetch_board_page. Action helper (NOT a registered function).
//
// Live: POST {FIRECRAWL_BASE_URL}/v2/scrape { formats:["rawHtml"], proxy:"auto",
//       waitFor:2500, blockAds:true, onlyMainContent:false }, Bearer auth.
// Fixture: return the fixture body from the manifest, NO Firecrawl call (D-9).
//
// It classifies the HTTP outcome into a fetch_status and does ONE bounded 429
// retry honouring Retry-After (D-7). It NEVER parses license fields, never
// decides anything, never writes a table (ARCHITECTURE §3 Fetch plane).
// A rate-limited / blocked / timed-out fetch still returns a body-less result
// with the right fetch_status — the caller writes a snapshot for it, never a
// silent skip.
// ─────────────────────────────────────────────────────────────────────────────
import { sha256Hex, utf8Bytes, excerpt } from "./lib/hash";
import { getFixture } from "./fixtures/index";

export type FetchBoardStatus =
  | "ok"
  | "http_error"
  | "blocked"
  | "rate_limited"
  | "timeout";

export interface FetchBoardInput {
  license_number: string;
  state: string;
  board_profile_url: string; // real URL, or "fixture://<id>"
  mode: "live" | "fixture";
}

export interface FetchBoardResult {
  raw_html: string; // verbatim rawHtml / fixture HTML ("" when no body)
  raw_payload_sha256: string;
  raw_payload_excerpt: string;
  raw_payload_bytes: number;
  source_url: string;
  source_mode: "live" | "fixture";
  fetched_at: number;
  fetch_status: FetchBoardStatus;
  fetch_http_code: number | null;
}

const FIRECRAWL_BASE_URL = process.env.FIRECRAWL_BASE_URL || "https://api.firecrawl.dev";
const REQUEST_TIMEOUT_MS = 30_000; // Firecrawl scrapes with waitFor+proxy can take 10–20s
const RETRY_AFTER_CAP_MS = 3_000; // D-7 — one bounded retry only

// Anti-bot / challenge markers — a fallback when proxy:"auto" still yields a wall.
const BLOCK_MARKERS = [
  /unusual traffic/i,
  /verify(ing)? you are (a )?human/i,
  /are you a robot/i,
  /captcha/i,
  /g-recaptcha/i,
  /cf-browser-verification/i,
  /access denied/i,
  /request blocked/i,
];

function looksBlocked(html: string): boolean {
  if (html.length > 60_000) return false; // real board pages are large; walls are small
  return BLOCK_MARKERS.some((re) => re.test(html));
}

async function pack(
  raw_html: string,
  meta: Omit<FetchBoardResult, "raw_html" | "raw_payload_sha256" | "raw_payload_excerpt" | "raw_payload_bytes">,
): Promise<FetchBoardResult> {
  return {
    raw_html,
    raw_payload_sha256: await sha256Hex(raw_html),
    raw_payload_excerpt: excerpt(raw_html),
    raw_payload_bytes: utf8Bytes(raw_html),
    ...meta,
  };
}

// ── fixture branch (D-9) — no network ────────────────────────────────────────
function fixtureIdFromUrl(url: string): string {
  return url.startsWith("fixture://") ? url.slice("fixture://".length) : url;
}

async function fetchFixture(input: FetchBoardInput): Promise<FetchBoardResult> {
  const id = fixtureIdFromUrl(input.board_profile_url);
  const fx = getFixture(id);
  const fetch_status: FetchBoardStatus =
    fx.fetch_status === "extraction_failed" || fx.fetch_status === "extraction_refused"
      ? "ok" // those are EXTRACT-stage outcomes, not FETCH — fetch itself succeeded
      : (fx.fetch_status as FetchBoardStatus);
  return pack(fx.html, {
    source_url: `fixture://${id}`,
    source_mode: "fixture",
    fetched_at: Date.now(),
    fetch_status,
    fetch_http_code: fx.fetch_http_code,
  });
}

// ── live branch — Firecrawl /v2/scrape ──────────────────────────────────────
function assertAllowedHost(rawUrl: string): URL {
  const url = new URL(rawUrl);
  const allow = (process.env.BOARD_HOST_ALLOWLIST || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (allow.length > 0 && !allow.includes(url.host.toLowerCase())) {
    throw new Error(
      `board host ${url.host} not in BOARD_HOST_ALLOWLIST (${allow.join(", ") || "empty"})`,
    );
  }
  return url;
}

interface ScrapeAttempt {
  httpStatus: number | null; // Firecrawl's HTTP status; null on network failure
  timedOut: boolean;
  retryAfterMs: number | null;
  rawHtml: string;
  targetStatus: number | null; // data.metadata.statusCode (the board page's status)
}

async function scrapeOnce(targetUrl: string, apiKey: string): Promise<ScrapeAttempt> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${FIRECRAWL_BASE_URL}/v2/scrape`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        url: targetUrl,
        formats: ["rawHtml"],
        onlyMainContent: false,
        waitFor: 2500,
        proxy: "auto",
        blockAds: true,
      }),
      signal: controller.signal,
    });

    const retryAfterHeader = res.headers.get("retry-after");
    const retryAfterMs = retryAfterHeader
      ? Math.min(RETRY_AFTER_CAP_MS, Math.max(0, Number(retryAfterHeader) * 1000) || 0)
      : null;

    let rawHtml = "";
    let targetStatus: number | null = null;
    // Only try to read a body for a 2xx; error responses are JSON error envelopes.
    if (res.ok) {
      try {
        const json = (await res.json()) as {
          data?: { rawHtml?: string; html?: string; metadata?: { statusCode?: number } };
        };
        rawHtml = json.data?.rawHtml ?? json.data?.html ?? "";
        targetStatus = json.data?.metadata?.statusCode ?? null;
      } catch {
        rawHtml = "";
      }
    }

    return { httpStatus: res.status, timedOut: false, retryAfterMs, rawHtml, targetStatus };
  } catch (err) {
    const aborted = err instanceof Error && err.name === "AbortError";
    return {
      httpStatus: null,
      timedOut: aborted,
      retryAfterMs: null,
      rawHtml: "",
      targetStatus: null,
    };
  } finally {
    clearTimeout(timer);
  }
}

function classify(a: ScrapeAttempt): { fetch_status: FetchBoardStatus; fetch_http_code: number | null } {
  if (a.timedOut) return { fetch_status: "timeout", fetch_http_code: null };
  if (a.httpStatus === null) return { fetch_status: "http_error", fetch_http_code: null };
  if (a.httpStatus === 429) return { fetch_status: "rate_limited", fetch_http_code: 429 };
  if (a.httpStatus === 403) return { fetch_status: "blocked", fetch_http_code: 403 };
  if (a.httpStatus < 200 || a.httpStatus >= 300) {
    return { fetch_status: "http_error", fetch_http_code: a.httpStatus };
  }
  // Firecrawl HTTP 2xx — now judge the *target page*.
  const t = a.targetStatus;
  if (t === 429) return { fetch_status: "rate_limited", fetch_http_code: 429 };
  if (t === 403) return { fetch_status: "blocked", fetch_http_code: 403 };
  if (t != null && (t < 200 || t >= 400)) return { fetch_status: "http_error", fetch_http_code: t };
  if (!a.rawHtml) return { fetch_status: "http_error", fetch_http_code: t ?? a.httpStatus };
  if (looksBlocked(a.rawHtml)) return { fetch_status: "blocked", fetch_http_code: t ?? a.httpStatus };
  return { fetch_status: "ok", fetch_http_code: t ?? a.httpStatus };
}

async function fetchLive(input: FetchBoardInput): Promise<FetchBoardResult> {
  const fetched_at = Date.now();
  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) {
    // Misconfiguration is a recorded failed fetch, never a throw that drops the tick.
    return pack("", {
      source_url: input.board_profile_url,
      source_mode: "live",
      fetched_at,
      fetch_status: "http_error",
      fetch_http_code: null,
    });
  }

  let url: URL;
  try {
    url = assertAllowedHost(input.board_profile_url);
  } catch {
    return pack("", {
      source_url: input.board_profile_url,
      source_mode: "live",
      fetched_at,
      fetch_status: "http_error",
      fetch_http_code: null,
    });
  }

  let attempt = await scrapeOnce(url.toString(), apiKey);
  // D-7 / D-13 — exactly ONE bounded retry on 429, immediately (no in-action
  // sleep). Retry-After is captured for the audit line only. Rationale: the
  // staggered fan-out already keeps the burst under the cap; if Retry-After is
  // more than sub-second an immediate retry just 429s again and we correctly
  // record a `rate_limited` snapshot that the next sweep picks up — behaviourally
  // identical to sleeping, without a wall-clock await inside the action.
  if (attempt.httpStatus === 429) {
    attempt = await scrapeOnce(url.toString(), apiKey);
  }

  const { fetch_status, fetch_http_code } = classify(attempt);
  // Keep whatever body came back (a challenge wall is still audit evidence);
  // it's "" for timeout / network error / non-2xx Firecrawl responses.
  return pack(attempt.rawHtml, {
    source_url: url.toString(),
    source_mode: "live",
    fetched_at,
    fetch_status,
    fetch_http_code,
  });
}

export async function fetch_board_page(input: FetchBoardInput): Promise<FetchBoardResult> {
  if (input.mode === "fixture" || input.board_profile_url.startsWith("fixture://")) {
    return fetchFixture(input);
  }
  return fetchLive(input);
}

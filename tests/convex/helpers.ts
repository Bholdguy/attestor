import { vi } from "vitest";

/** Minimal Response-like object for stubbing global fetch in Convex actions. */
export function mockResponse(opts: {
  ok?: boolean;
  status: number;
  headers?: Record<string, string>;
  json?: unknown;
}): Response {
  const headers = new Headers(opts.headers ?? {});
  return {
    ok: opts.ok ?? (opts.status >= 200 && opts.status < 300),
    status: opts.status,
    headers,
    json: async () => opts.json ?? {},
    text: async () => JSON.stringify(opts.json ?? {}),
  } as unknown as Response;
}

/** A Firecrawl /v2/scrape 2xx success envelope. */
export function firecrawlOk(rawHtml: string, targetStatus = 200): Response {
  return mockResponse({
    status: 200,
    json: { success: true, data: { rawHtml, metadata: { statusCode: targetStatus } } },
  });
}

export function abortError(): Error {
  return Object.assign(new Error("The operation was aborted"), { name: "AbortError" });
}

const GENERIC_EXTRACTED_FIELDS = {
  licensee_name: "Maria S. Gomez",
  license_number: "RN-4471102",
  status_word: "Active",
  status_normalized: "active",
  issue_date: "2019-06-14",
  expire_date: "2026-06-30",
  privilege_type: "single_state",
  primary_state_of_residence: "NY",
  extraction_confidence: "high",
};

/** OpenAI GET /v1/models response listing the given ids (default: the configured model). */
export function openaiModelsList(ids: string[] = ["gpt-4.1-mini"]): Response {
  return mockResponse({ status: 200, json: { data: ids.map((id) => ({ id })) } });
}

/** OpenAI chat/completions response whose message.content is JSON.stringify(fields). */
export function openaiExtractOk(fields: unknown = GENERIC_EXTRACTED_FIELDS): Response {
  return mockResponse({
    status: 200,
    json: { choices: [{ message: { content: JSON.stringify(fields), refusal: null } }] },
  });
}

/**
 * Stub global fetch. OpenAI endpoints (`/v1/models`, `/chat/completions`) are
 * auto-answered with a valid model list + a successful generic extraction, so
 * FETCH-focused tests don't have to care about the EXTRACT stage. Every other
 * URL is served from `behaviours` (one entry per call, last entry repeats).
 */
export function stubFetchSequence(
  behaviours: Array<Response | Error | "hang">,
  openai?: { models?: string[]; extract?: unknown },
): ReturnType<typeof vi.fn> {
  let i = 0;
  const fn = vi.fn((url: string, init?: { signal?: AbortSignal }) => {
    const u = String(url);
    if (u.endsWith("/models")) return Promise.resolve(openaiModelsList(openai?.models));
    if (u.includes("/chat/completions")) return Promise.resolve(openaiExtractOk(openai?.extract));

    const b = behaviours[Math.min(i, behaviours.length - 1)];
    i++;
    if (b === "hang") {
      return new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener("abort", () => reject(abortError()));
      });
    }
    if (b instanceof Error) return Promise.reject(b);
    return Promise.resolve(b);
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

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

/** Stub global fetch with a queue of responses/behaviours, one per call. */
export function stubFetchSequence(
  behaviours: Array<Response | Error | "hang">,
): ReturnType<typeof vi.fn> {
  let i = 0;
  const fn = vi.fn((_url: string, init?: { signal?: AbortSignal }) => {
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

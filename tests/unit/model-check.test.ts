import { describe, it, expect, vi, afterEach } from "vitest";
import { bootModelCheck, __resetBootModelCheck } from "../../convex/openai";

// D-3 / TESTING.md — bootModelCheck: GET /v1/models once; if OPENAI_MODEL is
// absent, warn and fall back to gpt-4o-2024-08-06; if present, use it.

const CONFIGURED = "gpt-4.1-mini"; // env not set in tests ⇒ the built-in default
const FALLBACK = "gpt-4o-2024-08-06";

function jsonResponse(body: unknown, ok: boolean, status: number): Response {
  return { ok, status, json: async () => body, text: async () => JSON.stringify(body) } as unknown as Response;
}

function stubModelsResponse(ids: string[], status = 200) {
  const body = { data: ids.map((id) => ({ id })) };
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => jsonResponse(body, status >= 200 && status < 300, status)),
  );
}

afterEach(() => {
  __resetBootModelCheck();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("bootModelCheck", () => {
  it("uses OPENAI_MODEL when GET /v1/models lists it", async () => {
    stubModelsResponse([CONFIGURED, FALLBACK, "gpt-3.5-turbo"]);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await bootModelCheck("sk-test")).toBe(CONFIGURED);
    expect(warn).not.toHaveBeenCalled();
  });

  it("falls back to gpt-4o-2024-08-06 (with a warning) when OPENAI_MODEL is absent", async () => {
    stubModelsResponse([FALLBACK, "gpt-3.5-turbo", "o1-mini"]);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await bootModelCheck("sk-test")).toBe(FALLBACK);
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0][0]).toMatch(/falling back/i);
  });

  it("proceeds with the configured model (with a warning) when GET /v1/models errors", async () => {
    stubModelsResponse([], 401);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await bootModelCheck("sk-test")).toBe(CONFIGURED);
    expect(warn).toHaveBeenCalledOnce();
  });

  it("proceeds with the configured model when the request throws", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new TypeError("network down");
    }));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await bootModelCheck("sk-test")).toBe(CONFIGURED);
    expect(warn).toHaveBeenCalledOnce();
  });

  it("memoises — a second call makes no further request", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ data: [{ id: CONFIGURED }] }, true, 200));
    vi.stubGlobal("fetch", fetchMock);
    await bootModelCheck("sk-test");
    await bootModelCheck("sk-test");
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});

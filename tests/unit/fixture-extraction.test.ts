import { describe, it, expect, vi, afterEach } from "vitest";
import {
  extract_license_fields,
  __resetBootModelCheck,
} from "../../convex/openai";
import { FIXTURE_LIST } from "../../convex/fixtures/index";

// TESTING.md §3 — per-fixture golden extraction.
//  1. live path with a MOCKED OpenAI returning the golden ⇒ exact ExtractedFields
//     deep-equal (locks the json_schema + prompt contract).
//  2. fixture path ⇒ the SAME golden, ZERO OpenAI calls (D-9).

const extractable = FIXTURE_LIST.filter((f) => f.expected_fields !== null);
const nonExtractable = FIXTURE_LIST.filter((f) => f.expected_fields === null);

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

/** Route /v1/models to a model list and /chat/completions to a fixed message. */
function stubOpenAI(message: { content: string | null; refusal: string | null }, modelIds = ["gpt-4.1-mini"]) {
  const fetchMock = vi.fn(async (url: string) => {
    if (String(url).endsWith("/models")) return jsonResponse({ data: modelIds.map((id) => ({ id })) });
    return jsonResponse({ choices: [{ message }] });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  __resetBootModelCheck();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("extract_license_fields — fixture path (D-9, zero OpenAI calls)", () => {
  it.each(extractable)("$id ⇒ its golden, model 'fixture-golden'", async (fx) => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const out = await extract_license_fields(fx.html, "fixture", fx.id);
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.fields).toEqual(fx.expected_fields);
      expect(out.model).toBe("fixture-golden");
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(nonExtractable)("$id (block/404) ⇒ extraction_failed, no OpenAI call", async (fx) => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const out = await extract_license_fields(fx.html, "fixture", fx.id);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toBe("extraction_failed");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("extract_license_fields — live path with mocked OpenAI (schema contract)", () => {
  it.each(extractable)("$id: model returns the golden ⇒ exact ExtractedFields", async (fx) => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    stubOpenAI({ content: JSON.stringify(fx.expected_fields), refusal: null });
    const out = await extract_license_fields(fx.html, "live");
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.fields).toEqual(fx.expected_fields);
      expect(out.model).toBe("gpt-4.1-mini");
      expect(JSON.parse(out.raw_response)).toEqual(fx.expected_fields);
    }
  });

  it("a model `refusal` ⇒ ok:false, reason 'extraction_refused', no throw", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    stubOpenAI({ content: null, refusal: "I can't help with that." });
    const out = await extract_license_fields("<html>…</html>", "live");
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toBe("extraction_refused");
  });

  it("malformed JSON content ⇒ ok:false, reason 'extraction_failed'", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    stubOpenAI({ content: "{ not json", refusal: null });
    const out = await extract_license_fields("<html>…</html>", "live");
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toBe("extraction_failed");
  });

  it("no OPENAI_API_KEY ⇒ extraction_failed, no request", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const out = await extract_license_fields("<html>…</html>", "live");
    expect(out.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("wrong-shape content (bad enum) ⇒ extraction_failed", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    stubOpenAI({
      content: JSON.stringify({ licensee_name: "x", status_normalized: "banana" }),
      refusal: null,
    });
    const out = await extract_license_fields("<html>…</html>", "live");
    expect(out.ok).toBe(false);
  });
});

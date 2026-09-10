// runForLicense — the ONE non-atomic step (ACTION). It performs only the
// non-deterministic edges (Firecrawl scrape, file-storage write, OpenAI extract
// — wired in Steps 4–5) and hands plain values to commitFetchResult. It catches
// every throw: a failed fetch/extract still ends in a commitFetchResult call
// with the right non-"ok" fetch_status (ARCHITECTURE §8, last row) — never a
// silent drop.
//
// Step 3 stub: synthesise a fetch_status:"ok" payload so the atomic write path
// is exercised end-to-end from day one.
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { sha256Hex, utf8Bytes, excerpt } from "./lib/hash";
import type { FetchStatus } from "./contract";

interface FetchPayload {
  source_url: string;
  source_mode: "live" | "fixture";
  raw_html: string;
  fetch_status: FetchStatus;
  fetch_http_code: number | null;
}

export const runForLicense = internalAction({
  args: { licenseId: v.id("licenses") },
  returns: v.null(), // also breaks self-referential type inference (loop → internal.* → loop)
  handler: async (ctx, { licenseId }): Promise<null> => {
    const fetched_at = Date.now();

    let payload: FetchPayload;
    try {
      // Step 4 replaces this with fetch_board_page() + ctx.storage.store().
      payload = {
        source_url: `stub://${licenseId}`,
        source_mode: "live",
        raw_html: `<!doctype html><html><head><title>stub</title></head><body><p>stub fetch for ${licenseId} @ ${fetched_at}</p></body></html>`,
        fetch_status: "ok",
        fetch_http_code: 200,
      };
    } catch (err) {
      payload = {
        source_url: `stub://${licenseId}`,
        source_mode: "live",
        raw_html: "",
        fetch_status: "http_error",
        fetch_http_code: null,
      };
      console.error(`runForLicense ${licenseId} fetch threw:`, (err as Error)?.message);
    }

    const raw_payload_sha256 = await sha256Hex(payload.raw_html);

    await ctx.runMutation(internal.commit.commitFetchResult, {
      license_id: licenseId,
      fetched_at,
      source_url: payload.source_url,
      source_mode: payload.source_mode,
      raw_payload_storage_id: null, // Step 4: ctx.storage.store id
      raw_payload_excerpt: excerpt(payload.raw_html),
      raw_payload_sha256,
      raw_payload_bytes: utf8Bytes(payload.raw_html),
      fetch_status: payload.fetch_status,
      fetch_http_code: payload.fetch_http_code,
      extracted_fields: null, // Step 5: extract_license_fields
      extractor_model: null,
      extractor_raw_response: null,
      retry_of_snapshot_id: null, // Step 4: set on a next-sweep retry
    });
    return null;
  },
});

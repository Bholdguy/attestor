// runForLicense — the ONE non-atomic step (ACTION). It performs only the
// non-deterministic edges — Firecrawl scrape (fetch_board_page) and the
// file-storage write (ctx.storage.store, D-8) — and hands plain values to
// commitFetchResult. OpenAI extraction is added in Step 5.
//
// It catches every throw: a failed fetch still ends in a commitFetchResult call
// with the right non-"ok" fetch_status (ARCHITECTURE §8, last row) — never a
// silent drop (F5).
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { sha256Hex, utf8Bytes, excerpt } from "./lib/hash";
import { fetch_board_page, type FetchBoardResult } from "./firecrawl";
import { extract_license_fields } from "./openai";
import type { ExtractedFields, FetchStatus } from "./contract";

export const runForLicense = internalAction({
  args: { licenseId: v.id("licenses") },
  returns: v.null(), // also breaks self-referential type inference (loop → internal.* → loop)
  handler: async (ctx, { licenseId }): Promise<null> => {
    const fetched_at = Date.now();

    const inputs = await ctx.runQuery(internal.read.loopInputs, { licenseId });
    if (!inputs || !inputs.license) return null; // license removed between schedule and run
    const { license, demo_mode } = inputs;

    const mode: "live" | "fixture" =
      demo_mode || license.board_profile_url.startsWith("fixture://") ? "fixture" : "live";

    // link this snapshot to a prior FETCH-level failure, if any (D-7)
    const retry_of_snapshot_id = await ctx.runQuery(internal.read.retryTarget, { licenseId });

    let result: FetchBoardResult;
    try {
      result = await fetch_board_page({
        license_number: license.license_number,
        state: license.issuing_state,
        board_profile_url: license.board_profile_url,
        mode,
      });
    } catch (err) {
      // Any unexpected throw becomes a recorded http_error snapshot, not a drop.
      console.error(`runForLicense ${licenseId} fetch threw:`, (err as Error)?.message);
      const raw_html = "";
      result = {
        raw_html,
        raw_payload_sha256: await sha256Hex(raw_html),
        raw_payload_excerpt: excerpt(raw_html),
        raw_payload_bytes: utf8Bytes(raw_html),
        source_url: license.board_profile_url,
        source_mode: mode,
        fetched_at,
        fetch_status: "http_error",
        fetch_http_code: null,
      };
    }

    // D-8 — full verbatim payload → Convex file storage. Skip only when there is
    // no body at all (timeout / DNS failure / non-2xx error envelope).
    let raw_payload_storage_id: Id<"_storage"> | null = null;
    if (result.raw_html.length > 0) {
      const blob = new Blob([result.raw_html], { type: "text/html" });
      raw_payload_storage_id = await ctx.storage.store(blob);
    }

    // EXTRACT — the only OpenAI call (D-2). Only when the fetch itself succeeded.
    // A failed/refused extraction maps to a non-"ok" fetch_status so the gate
    // fails closed (I6); the FETCH stage is unaffected and still has its snapshot.
    let extracted_fields: ExtractedFields | null = null;
    let extractor_model: string | null = null;
    let extractor_raw_response: string | null = null;
    let fetch_status: FetchStatus = result.fetch_status;

    if (result.fetch_status === "ok") {
      const fixtureId =
        result.source_mode === "fixture"
          ? result.source_url.replace(/^fixture:\/\//, "")
          : undefined;
      const outcome = await extract_license_fields(
        result.raw_html,
        result.source_mode,
        fixtureId,
      );
      if (outcome.ok) {
        extracted_fields = outcome.fields;
        extractor_model = outcome.model;
        extractor_raw_response = outcome.raw_response;
      } else {
        extractor_model = outcome.model;
        extractor_raw_response = outcome.raw_response;
        fetch_status = outcome.reason; // "extraction_failed" | "extraction_refused"
      }
    }

    await ctx.runMutation(internal.commit.commitFetchResult, {
      license_id: licenseId,
      fetched_at: result.fetched_at,
      source_url: result.source_url,
      source_mode: result.source_mode,
      raw_payload_storage_id,
      raw_payload_excerpt: result.raw_payload_excerpt,
      raw_payload_sha256: result.raw_payload_sha256,
      raw_payload_bytes: result.raw_payload_bytes,
      fetch_status,
      fetch_http_code: result.fetch_http_code,
      extracted_fields,
      extractor_model,
      extractor_raw_response,
      retry_of_snapshot_id,
    });
    return null;
  },
});

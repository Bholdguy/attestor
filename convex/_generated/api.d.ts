/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as badge from "../badge.js";
import type * as commit from "../commit.js";
import type * as contract from "../contract.js";
import type * as crons from "../crons.js";
import type * as firecrawl from "../firecrawl.js";
import type * as fixtures_index from "../fixtures/index.js";
import type * as health from "../health.js";
import type * as lib_hash from "../lib/hash.js";
import type * as loop from "../loop.js";
import type * as read from "../read.js";
import type * as roster from "../roster.js";
import type * as sweep from "../sweep.js";
import type * as timeline from "../timeline.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  badge: typeof badge;
  commit: typeof commit;
  contract: typeof contract;
  crons: typeof crons;
  firecrawl: typeof firecrawl;
  "fixtures/index": typeof fixtures_index;
  health: typeof health;
  "lib/hash": typeof lib_hash;
  loop: typeof loop;
  read: typeof read;
  roster: typeof roster;
  sweep: typeof sweep;
  timeline: typeof timeline;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  staticHosting: import("@convex-dev/static-hosting/_generated/component.js").ComponentApi<"staticHosting">;
};

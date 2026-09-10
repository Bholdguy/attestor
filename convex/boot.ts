// One-shot boot check (BD-2 / D-3). Run once after the first deploy:
//   npx convex run boot:checkModel
// It hits GET /v1/models and reports which model extraction will use
// (OPENAI_MODEL, or OPENAI_MODEL_FALLBACK if the configured id is absent).
import { internalAction } from "./_generated/server";
import { v } from "convex/values";
import { bootModelCheck, __resetBootModelCheck } from "./openai";

export const checkModel = internalAction({
  args: {},
  returns: v.object({ resolved_model: v.string(), had_key: v.boolean() }),
  handler: async () => {
    __resetBootModelCheck();
    const key = process.env.OPENAI_API_KEY;
    if (!key) return { resolved_model: process.env.OPENAI_MODEL ?? "gpt-4.1-mini", had_key: false };
    const resolved_model = await bootModelCheck(key);
    return { resolved_model, had_key: true };
  },
});

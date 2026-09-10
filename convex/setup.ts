// One-off deployment setup helpers. Reusable (env-only, no embedded secrets).
//
//   npx convex run setup:createAgentMailInbox '{"client_id":"attestor-alerts","display_name":"Attestor Alerts"}'
//
// Reads AGENTMAIL_API_KEY from the deployment env, creates the alert inbox once
// (TASKS Step 8), and returns ONLY { inbox_id }. Then:
//   npx convex env set AGENTMAIL_INBOX_ID <inbox_id>
//
// This does not send any email. It never logs the API key or the full response.
import { internalAction } from "./_generated/server";
import { v } from "convex/values";

const AGENTMAIL_BASE_URL = (process.env.AGENTMAIL_BASE_URL || "https://api.agentmail.to").replace(
  /\/$/,
  "",
);

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

import { query } from "./_generated/server";

// Trivial liveness query — replaced/expanded by real queries from Step 3 on.
export const ping = query({
  args: {},
  handler: async () => ({ ok: true as const, service: "attestor" }),
});

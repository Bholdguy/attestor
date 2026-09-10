import { defineApp } from "convex/server";
import staticHosting from "@convex-dev/static-hosting/convex.config";

// Component-owned root mode (@convex-dev/static-hosting 0.2.x, fastest serving):
// the component owns "/" and serves the built dist/ at
// https://<deployment>.convex.site; any app HTTP routes (convex/http.ts) move
// under /api. Attestor has no webhooks/auth routes (AgentMail is send-only), so
// nothing needs to stay at the root. See DECISIONS.md D-12.
const app = defineApp({ httpPrefix: "/api" });
app.use(staticHosting, { httpPrefix: "/" });

export default app;

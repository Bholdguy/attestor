import { defineApp } from "convex/server";
import staticHosting from "@convex-dev/static-hosting/convex.config";

// Serves the built frontend (dist/) at https://<deployment>.convex.site in the
// same `npx convex deploy` pass — no second deploy target (ARCHITECTURE.md §2).
const app = defineApp();
app.use(staticHosting);

export default app;

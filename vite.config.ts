import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Frontend build only. Backend is Convex (`npx convex deploy` pushes it and,
// via @convex-dev/static-hosting, uploads this dist/ to <deployment>.convex.site).
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist",
    sourcemap: false,
  },
});

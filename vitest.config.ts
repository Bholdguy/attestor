import { defineConfig } from "vitest/config";

// Two projects:
//  - "convex": server logic under the edge-runtime VM (convex-test needs it)
//  - "node":  pure modules, fixtures, frontend helpers, static-ish unit tests
export default defineConfig({
  test: {
    globals: true,
    projects: [
      {
        extends: true,
        test: {
          name: "convex",
          environment: "edge-runtime",
          include: ["convex/**/*.test.ts", "tests/convex/**/*.test.ts"],
          server: { deps: { inline: ["convex-test"] } },
        },
      },
      {
        extends: true,
        test: {
          name: "node",
          environment: "node",
          include: ["tests/unit/**/*.test.ts", "fixtures/**/*.test.ts", "src/**/*.test.ts"],
        },
      },
    ],
  },
});

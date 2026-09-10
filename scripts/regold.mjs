#!/usr/bin/env node
// Regenerates convex/fixtures/golden/<id>.json from a real OpenAI extraction
// pass over each fixture HTML. Explicit-only (never runs in CI or a normal
// build) so goldens change only on a deliberate, reviewed action.
//
// Implemented at TASKS Step 5 (OpenAI extraction). Until then this is a guard.
console.error(
  "fixtures:regold is wired at Step 5 (OpenAI extraction). " +
    "Goldens are hand-authored and checked in until then; edit " +
    "convex/fixtures/golden/*.json directly and run `npm run fixtures:sync`.",
);
process.exit(1);

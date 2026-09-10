#!/usr/bin/env node
// SECURITY.md §2 / §10 — the built dist/ bundle must contain no secret material
// and no secret env-var name. Vite only inlines import.meta.env.VITE_* vars, so
// a hit here means a secret leaked into client code.
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";

const DIST = join(process.cwd(), "dist");
if (!existsSync(DIST)) {
  console.error("no-secret-in-client: dist/ not found — run `npm run build` first");
  process.exit(1);
}

const NEEDLES = [
  "sk-", // OpenAI
  "fc-", // Firecrawl
  "AGENTMAIL",
  "FIRECRAWL_API_KEY",
  "OPENAI_API_KEY",
  "AGENTMAIL_API_KEY",
  "CONVEX_DEPLOY_KEY",
];

function walk(dir, acc = []) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, acc);
    else acc.push(p);
  }
  return acc;
}

let hits = 0;
for (const file of walk(DIST)) {
  const src = readFileSync(file, "utf8");
  for (const needle of NEEDLES) {
    if (src.includes(needle)) {
      hits++;
      console.error(`  ✗ "${needle}" found in ${file}`);
    }
  }
}

console.log(`no-secret-in-client: ${hits} hit(s) across dist/`);
process.exit(hits > 0 ? 1 : 0);

#!/usr/bin/env node
// Static grep-style guards (TESTING.md §6 "npm run test:static").
// Rules are added as their steps land:
//   Step 4/7 — no db.patch("snapshots") / db.replace("snapshots")  (I5 / M7)
//   Step 7   — no mutation writes a badge/status field directly
//   Step 7   — only cases.resolveCase writes `open_case_id: null`   (I4)
//   Security — process.env.*_API_KEY only in the 3 action helpers
//   Security — no dangerouslySetInnerHTML in src/
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, extname } from "node:path";

const ROOT = process.cwd();
let failures = 0;
const fail = (msg) => {
  failures++;
  console.error(`  ✗ ${msg}`);
};

function walk(dir, acc = []) {
  for (const entry of readdirSync(dir)) {
    if (["node_modules", "_generated", "dist", ".git"].includes(entry)) continue;
    const p = join(dir, entry);
    const s = statSync(p);
    if (s.isDirectory()) walk(p, acc);
    else if ([".ts", ".tsx", ".mjs", ".js"].includes(extname(p))) acc.push(p);
  }
  return acc;
}

const rules = [
  {
    name: 'no db.patch/replace on "snapshots" (I5 / M7 — append-only)',
    test: (path, src) =>
      path.includes(`${join("convex", "")}`) &&
      /db\.(patch|replace)\(\s*["'`]snapshots/.test(src),
  },
  {
    name: "no dangerouslySetInnerHTML in src/ (SECURITY.md §3)",
    test: (path, src) =>
      path.includes(`${join("src", "")}`) && /dangerouslySetInnerHTML/.test(src),
  },
];

let scanned = 0;
try {
  for (const file of walk(ROOT)) {
    const src = readFileSync(file, "utf8");
    scanned++;
    for (const rule of rules) {
      if (rule.test(file, src)) fail(`${rule.name} — ${file}`);
    }
  }
} catch (err) {
  console.error(err);
  process.exit(1);
}

console.log(`static-checks: scanned ${scanned} files, ${failures} violation(s)`);
process.exit(failures > 0 ? 1 : 0);

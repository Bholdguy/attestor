# Attestor — a License Trust Supervisor

Convex All Gas Hackathon · Convex + Firecrawl + OpenAI + AgentMail

Attestor is a reliability layer between a state license board's web page and a
staffing coordinator's decision to schedule, extend, or pull a healthcare worker.
It catches the moment a board's answer is **stale, misidentified, or invalid for
the assignment** — before a human trusts it.

See `PRD.md`, `ARCHITECTURE.md`, `DECISIONS.md`, `TESTING.md`, `SECURITY.md`,
`DEMO.md`, `AUDIT.md` for the full, locked plan. Build order: `TASKS.md` Step 0→10.

## Stack

- **Convex** — database, scheduler, file storage, and static host (`convex.site`).
- **React + Vite** — a thin reactive frontend (`src/`), pure `useQuery` consumer.
- **Firecrawl / OpenAI / AgentMail** — called only from Convex actions; keys are
  Convex environment variables, never shipped to the client (`SECURITY.md`).

## Local development

```bash
npm install
cp .env.example .env.local        # then paste real keys (git-ignored)
npm run dev:backend               # npx convex dev — links a dev deployment
npm run dev                       # vite dev server
```

## Scripts

| Script | Purpose |
|---|---|
| `npm run test` | unit + fixture + integration (`vitest`, `convex-test`) |
| `npm run test:static` | grep guards (append-only snapshots, no dangerous HTML, …) |
| `npm run build` | `tsc -b` + `vite build` + no-secret-in-client scan over `dist/` |
| `npm run dev:backend` | `convex dev` |

## Deploy

`npx convex deploy` builds `dist/`, pushes the backend, and serves the frontend
at `https://<deployment>.convex.site` — one command, no second target.

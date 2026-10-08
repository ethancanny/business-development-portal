# Business Development Portal

Internal deal pipeline + operator sourcing portal for **Canny Capital Partners**.

- **Acquisitions** — kanban + table views of acquisition targets, with deal value, revenue, EBITDA, asking price, broker, source, contacts, touch history, file attachments, and operator pairings
- **Executive Sourcing** — kanban + table views of operator candidates with industry expertise tags
- **◈ Paired** — every deal↔operator pairing with industry-match fit indicators
- **Activity** — triage feed for fresh businesses for sale, operators on the market, and local market notes
- **Overview** — stats, pipeline by stage, target map, tasks & follow-ups, stale-deal alerts, analytics
- **Audit Trail** — chronological log of everything that happens in the portal

## Run it locally

Requires Node 18+.

```bash
npm install
npm run dev
```

Open http://localhost:3000 and log in.

## Environment

Copy `.env.example` to `.env.local` and fill in:

| Variable       | What it is                                          |
|----------------|-----------------------------------------------------|
| `DATABASE_URL` | Neon Postgres connection string (production data)   |
| `JWT_SECRET`   | Secret for signing session cookies (random string)  |

If `DATABASE_URL` is unset, the app falls back to local JSON files in `data/` (fine for local dev).

On first request with `DATABASE_URL` set, the schema (tables + columns) is created automatically.

## Deploying

Pushes to `main` auto-deploy via Vercel (project `business-development-portal`) once the repo is connected in the Vercel dashboard under Settings → Git.

## Project layout

- `app/` — Next.js App Router pages (`/`, `/overview`, `/activity`, `/audit-trail`, `/deals/[id]`, `/login`) and API routes (`app/api/*`)
- `components/` — UI: `Modals.tsx` (deal/executive editors), `KanbanBoard.tsx`, `DealTable.tsx`, `ExecTable.tsx`, `PairingTable.tsx`, `TaskList.tsx`, `TargetMap.tsx`, `SiteHeader.tsx`
- `lib/` — `db.ts` (Postgres-or-JSON router), `db-postgres.ts`, `db-json.ts`, `types.ts`, `auth.ts`, `format.ts`, `geo.ts`
- `scripts/seed-neon.mjs` — one-time seed of the Neon database

> **Brand assets note:** the logo, favicon, and desert imagery are loaded from
> `https://cannycapitalpartners.com/...` (the main Canny Capital website)
> rather than committed here, so this repo stays 100% text and clones cleanly.
> Download them from those URLs if you ever need local copies.

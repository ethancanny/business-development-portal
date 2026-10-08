// One-time seed: copies data/*.json into a fresh Neon database.
// Usage: DATABASE_URL="postgres://..." node scripts/seed-neon.mjs
// Only seeds tables that are currently empty.

import { neon } from "@neondatabase/serverless";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("Set DATABASE_URL first.");
  process.exit(1);
}
const sql = neon(url);

const load = (name) => {
  try {
    return JSON.parse(readFileSync(join(root, "data", name), "utf-8"));
  } catch {
    return [];
  }
};

async function main() {
  await sql`
    CREATE TABLE IF NOT EXISTS deals (
      id TEXT PRIMARY KEY,
      company_name TEXT NOT NULL DEFAULT '',
      industry TEXT NOT NULL DEFAULT '',
      stage TEXT NOT NULL DEFAULT 'Sourcing',
      deal_value DOUBLE PRECISION NOT NULL DEFAULT 0,
      contact_name TEXT NOT NULL DEFAULT '',
      contact_email TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      owner TEXT NOT NULL DEFAULT '',
      city TEXT NOT NULL DEFAULT '',
      lat DOUBLE PRECISION,
      lng DOUBLE PRECISION,
      links JSONB NOT NULL DEFAULT '[]',
      operator_ids JSONB NOT NULL DEFAULT '[]',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`;
  await sql`
    CREATE TABLE IF NOT EXISTS executives (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL DEFAULT '',
      current_title TEXT NOT NULL DEFAULT '',
      target_role TEXT NOT NULL DEFAULT '',
      stage TEXT NOT NULL DEFAULT 'Sourcing',
      background TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      owner TEXT NOT NULL DEFAULT '',
      industries JSONB NOT NULL DEFAULT '[]',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`;
  await sql`
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT '',
      due_date TEXT NOT NULL DEFAULT '',
      done BOOLEAN NOT NULL DEFAULT FALSE,
      owner TEXT NOT NULL DEFAULT '',
      related_kind TEXT,
      related_id TEXT,
      related_name TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`;
  await sql`
    CREATE TABLE IF NOT EXISTS contacts (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL DEFAULT '',
      role TEXT NOT NULL DEFAULT '',
      email TEXT NOT NULL DEFAULT '',
      phone TEXT NOT NULL DEFAULT '',
      linkedin TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      deal_id TEXT,
      exec_id TEXT,
      owner TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`;
  await sql`
    CREATE TABLE IF NOT EXISTS interactions (
      id TEXT PRIMARY KEY,
      deal_id TEXT,
      exec_id TEXT,
      kind TEXT NOT NULL DEFAULT 'note',
      occurred_at TEXT NOT NULL DEFAULT '',
      summary TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`;
  await sql`
    CREATE TABLE IF NOT EXISTS attachments (
      id TEXT PRIMARY KEY,
      deal_id TEXT NOT NULL DEFAULT '',
      filename TEXT NOT NULL DEFAULT '',
      mime_type TEXT NOT NULL DEFAULT '',
      size INTEGER NOT NULL DEFAULT 0,
      data TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`;
  await sql`
    CREATE TABLE IF NOT EXISTS deal_flow (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL DEFAULT 'business_for_sale',
      title TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL DEFAULT '',
      source_detail TEXT NOT NULL DEFAULT '',
      spotted_at TEXT NOT NULL DEFAULT '',
      why TEXT NOT NULL DEFAULT '',
      industry TEXT NOT NULL DEFAULT '',
      location TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'new',
      related_deal_id TEXT,
      related_exec_id TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`;
  await sql`
    ALTER TABLE deals ADD COLUMN IF NOT EXISTS revenue DOUBLE PRECISION`;
  await sql`
    ALTER TABLE deals ADD COLUMN IF NOT EXISTS ebitda DOUBLE PRECISION`;
  await sql`
    ALTER TABLE deals ADD COLUMN IF NOT EXISTS asking_price DOUBLE PRECISION`;
  await sql`
    ALTER TABLE deals ADD COLUMN IF NOT EXISTS broker TEXT NOT NULL DEFAULT ''`;
  await sql`
    ALTER TABLE deals ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT ''`;
  await sql`
    CREATE TABLE IF NOT EXISTS activity (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL DEFAULT '',
      actor TEXT NOT NULL DEFAULT '',
      message TEXT NOT NULL DEFAULT '',
      deal_id TEXT,
      exec_id TEXT,
      deal_name TEXT,
      exec_name TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`;

  const counts = await sql`
    SELECT 'deals' AS t, COUNT(*)::int AS c FROM deals
    UNION ALL SELECT 'executives', COUNT(*)::int FROM executives
    UNION ALL SELECT 'tasks', COUNT(*)::int FROM tasks
    UNION ALL SELECT 'activity', COUNT(*)::int FROM activity`;
  const empty = Object.fromEntries(counts.map((r) => [r.t, r.c === 0]));

  if (empty.deals) {
    const deals = load("deals.json");
    for (const d of deals) {
      await sql`
        INSERT INTO deals (
          id, company_name, industry, stage, deal_value, contact_name,
          contact_email, notes, owner, city, lat, lng, links, operator_ids,
          created_at, updated_at
        ) VALUES (
          ${d.id}, ${d.companyName ?? ""}, ${d.industry ?? ""},
          ${d.stage ?? "Sourcing"}, ${Number(d.dealValue) || 0},
          ${d.contactName ?? ""}, ${d.contactEmail ?? ""}, ${d.notes ?? ""},
          ${d.owner ?? ""}, ${d.city ?? ""}, ${d.lat ?? null}, ${d.lng ?? null},
          ${JSON.stringify(d.links ?? [])},
          ${JSON.stringify(d.operatorIds ?? [])},
          ${d.createdAt ?? new Date().toISOString()},
          ${d.updatedAt ?? new Date().toISOString()}
        ) ON CONFLICT (id) DO NOTHING`;
    }
    console.log(`seeded ${deals.length} deals`);
  } else console.log("deals: already has data, skipped");

  if (empty.executives) {
    const execs = load("executives.json");
    for (const e of execs) {
      await sql`
        INSERT INTO executives (
          id, name, current_title, target_role, stage, background,
          notes, owner, industries, created_at, updated_at
        ) VALUES (
          ${e.id}, ${e.name ?? ""}, ${e.currentTitle ?? ""},
          ${e.targetRole ?? ""}, ${e.stage ?? "Sourcing"},
          ${e.background ?? ""}, ${e.notes ?? ""}, ${e.owner ?? ""},
          ${JSON.stringify(e.industries ?? [])},
          ${e.createdAt ?? new Date().toISOString()},
          ${e.updatedAt ?? new Date().toISOString()}
        ) ON CONFLICT (id) DO NOTHING`;
    }
    console.log(`seeded ${execs.length} executives`);
  } else console.log("executives: already has data, skipped");

  if (empty.tasks) {
    const tasks = load("tasks.json");
    for (const t of tasks) {
      await sql`
        INSERT INTO tasks (
          id, title, due_date, done, owner, related_kind,
          related_id, related_name, created_at, updated_at
        ) VALUES (
          ${t.id}, ${t.title ?? ""}, ${t.dueDate ?? ""}, ${!!t.done},
          ${t.owner ?? ""}, ${t.relatedKind ?? null},
          ${t.relatedId ?? null}, ${t.relatedName ?? ""},
          ${t.createdAt ?? new Date().toISOString()},
          ${t.updatedAt ?? new Date().toISOString()}
        ) ON CONFLICT (id) DO NOTHING`;
    }
    console.log(`seeded ${tasks.length} tasks`);
  } else console.log("tasks: already has data, skipped");

  if (empty.activity) {
    const events = load("activity.json");
    for (const ev of events) {
      await sql`
        INSERT INTO activity (
          id, type, actor, message, deal_id, exec_id, deal_name, exec_name,
          created_at
        ) VALUES (
          ${ev.id}, ${ev.type ?? ""}, ${ev.actor ?? ""}, ${ev.message ?? ""},
          ${ev.dealId ?? null}, ${ev.execId ?? null},
          ${ev.dealName ?? null}, ${ev.execName ?? null},
          ${ev.createdAt ?? new Date().toISOString()}
        ) ON CONFLICT (id) DO NOTHING`;
    }
    console.log(`seeded ${events.length} activity events`);
  } else console.log("activity: already has data, skipped");

  console.log("done");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

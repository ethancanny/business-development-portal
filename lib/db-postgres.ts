import { neon } from "@neondatabase/serverless";
import type {
  ActivityEvent,
  Attachment,
  Contact,
  Deal,
  DealFlowItem,
  Executive,
  Interaction,
  Task,
} from "./types";

function sql() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  return neon(url);
}

let schemaReady: Promise<void> | null = null;

/** Idempotent schema setup — safe to call on every operation (serverless). */
export function ensureSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = (async () => {
      const db = sql();
      await db`
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
      await db`
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
      await db`
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
      await db`
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
      await db`
        CREATE INDEX IF NOT EXISTS activity_created_at_idx
        ON activity (created_at DESC)`;
      await db`
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
      await db`
        CREATE TABLE IF NOT EXISTS interactions (
          id TEXT PRIMARY KEY,
          deal_id TEXT,
          exec_id TEXT,
          kind TEXT NOT NULL DEFAULT 'note',
          occurred_at TEXT NOT NULL DEFAULT '',
          summary TEXT NOT NULL DEFAULT '',
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )`;
      await db`
        CREATE TABLE IF NOT EXISTS attachments (
          id TEXT PRIMARY KEY,
          deal_id TEXT NOT NULL DEFAULT '',
          filename TEXT NOT NULL DEFAULT '',
          mime_type TEXT NOT NULL DEFAULT '',
          size INTEGER NOT NULL DEFAULT 0,
          data TEXT NOT NULL DEFAULT '',
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )`;
      await db`
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
      await db`
        ALTER TABLE deals ADD COLUMN IF NOT EXISTS revenue DOUBLE PRECISION`;
      await db`
        ALTER TABLE deals ADD COLUMN IF NOT EXISTS ebitda DOUBLE PRECISION`;
      await db`
        ALTER TABLE deals ADD COLUMN IF NOT EXISTS asking_price DOUBLE PRECISION`;
      await db`
        ALTER TABLE deals ADD COLUMN IF NOT EXISTS broker TEXT NOT NULL DEFAULT ''`;
      await db`
        ALTER TABLE deals ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT ''`;
      /* ---- Market Intel tables ---- */
      await db`
        CREATE TABLE IF NOT EXISTS mi_indicators (
          id TEXT PRIMARY KEY,
          source TEXT NOT NULL DEFAULT 'fred',
          series_id TEXT NOT NULL DEFAULT '',
          title TEXT NOT NULL DEFAULT '',
          units TEXT NOT NULL DEFAULT '',
          frequency TEXT NOT NULL DEFAULT '',
          obs_date DATE NOT NULL,
          value DOUBLE PRECISION,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          UNIQUE (source, series_id, obs_date)
        )`;
      await db`
        CREATE INDEX IF NOT EXISTS mi_indicators_series_idx
        ON mi_indicators (series_id, obs_date DESC)`;
      await db`
        CREATE TABLE IF NOT EXISTS mi_listings (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL DEFAULT '',
          price DOUBLE PRECISION,
          revenue DOUBLE PRECISION,
          cash_flow DOUBLE PRECISION,
          industry TEXT NOT NULL DEFAULT '',
          location TEXT NOT NULL DEFAULT '',
          broker TEXT NOT NULL DEFAULT '',
          url TEXT NOT NULL DEFAULT '',
          source TEXT NOT NULL DEFAULT '',
          description TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT 'new',
          first_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          UNIQUE (url)
        )`;
      await db`
        CREATE TABLE IF NOT EXISTS mi_multiples (
          id TEXT PRIMARY KEY,
          source_report TEXT NOT NULL DEFAULT '',
          period TEXT NOT NULL DEFAULT '',
          industry TEXT NOT NULL DEFAULT '',
          size_band TEXT NOT NULL DEFAULT '',
          ev_ebitda_low DOUBLE PRECISION,
          ev_ebitda_high DOUBLE PRECISION,
          ev_ebitda_median DOUBLE PRECISION,
          ev_revenue_median DOUBLE PRECISION,
          notes TEXT NOT NULL DEFAULT '',
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )`;
      await db`
        CREATE TABLE IF NOT EXISTS mi_acquisitions (
          id TEXT PRIMARY KEY,
          acquirer TEXT NOT NULL DEFAULT '',
          target TEXT NOT NULL DEFAULT '',
          target_location TEXT NOT NULL DEFAULT '',
          industry TEXT NOT NULL DEFAULT '',
          deal_value DOUBLE PRECISION,
          announced_date TEXT NOT NULL DEFAULT '',
          source_url TEXT NOT NULL DEFAULT '',
          publisher TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT 'new',
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          UNIQUE (source_url)
        )`;
      await db`
        CREATE TABLE IF NOT EXISTS mi_filings (
          id TEXT PRIMARY KEY,
          form TEXT NOT NULL DEFAULT '',
          company TEXT NOT NULL DEFAULT '',
          cik TEXT NOT NULL DEFAULT '',
          filing_date TEXT NOT NULL DEFAULT '',
          accession TEXT NOT NULL DEFAULT '',
          category TEXT NOT NULL DEFAULT 'acquisition',
          summary TEXT NOT NULL DEFAULT '',
          url TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT 'new',
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          UNIQUE (accession)
        )`;
      await db`ALTER TABLE mi_filings ADD COLUMN IF NOT EXISTS az_company BOOLEAN NOT NULL DEFAULT FALSE`;
      await db`ALTER TABLE mi_filings ADD COLUMN IF NOT EXISTS major_event BOOLEAN NOT NULL DEFAULT FALSE`;
      await db`
        CREATE TABLE IF NOT EXISTS mi_warn (
          id TEXT PRIMARY KEY,
          employer TEXT NOT NULL DEFAULT '',
          location TEXT NOT NULL DEFAULT '',
          headcount INTEGER,
          notice_date TEXT NOT NULL DEFAULT '',
          effective_date TEXT NOT NULL DEFAULT '',
          source TEXT NOT NULL DEFAULT '',
          industry TEXT NOT NULL DEFAULT '',
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          UNIQUE (employer, location, notice_date)
        )`;
      await db`ALTER TABLE mi_warn ADD COLUMN IF NOT EXISTS industry TEXT NOT NULL DEFAULT ''`;
      await db`
        CREATE TABLE IF NOT EXISTS mi_entities (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL DEFAULT '',
          entity_type TEXT NOT NULL DEFAULT '',
          formation_date TEXT NOT NULL DEFAULT '',
          agent TEXT NOT NULL DEFAULT '',
          address TEXT NOT NULL DEFAULT '',
          source TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT 'new',
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          UNIQUE (name, formation_date)
        )`;
      await db`
        CREATE TABLE IF NOT EXISTS mi_sync_log (
          id TEXT PRIMARY KEY,
          job TEXT NOT NULL DEFAULT '',
          ran_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          status TEXT NOT NULL DEFAULT 'ok',
          added INTEGER NOT NULL DEFAULT 0,
          message TEXT NOT NULL DEFAULT ''
        )`;
    })().catch((err) => {
      schemaReady = null;
      throw err;
    });
  }
  return schemaReady;
}

export function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

const iso = (v: unknown): string =>
  v instanceof Date ? v.toISOString() : String(v ?? new Date().toISOString());

// --- Deals ---
function rowToDeal(r: Record<string, unknown>): Deal {
  return {
    id: String(r.id),
    companyName: String(r.company_name ?? ""),
    industry: String(r.industry ?? ""),
    stage: String(r.stage ?? "Sourcing") as Deal["stage"],
    dealValue: Number(r.deal_value ?? 0),
    contactName: String(r.contact_name ?? ""),
    contactEmail: String(r.contact_email ?? ""),
    notes: String(r.notes ?? ""),
    owner: String(r.owner ?? ""),
    city: String(r.city ?? ""),
    lat: r.lat === null || r.lat === undefined ? null : Number(r.lat),
    lng: r.lng === null || r.lng === undefined ? null : Number(r.lng),
    links: Array.isArray(r.links) ? (r.links as Deal["links"]) : [],
    operatorIds: Array.isArray(r.operator_ids)
      ? (r.operator_ids as string[])
      : [],
    revenue: r.revenue === null || r.revenue === undefined ? null : Number(r.revenue),
    ebitda: r.ebitda === null || r.ebitda === undefined ? null : Number(r.ebitda),
    askingPrice:
      r.asking_price === null || r.asking_price === undefined
        ? null
        : Number(r.asking_price),
    broker: String(r.broker ?? ""),
    source: String(r.source ?? ""),
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
  };
}

export async function getDeals(): Promise<Deal[]> {
  await ensureSchema();
  const rows = await sql()`SELECT * FROM deals ORDER BY updated_at DESC`;
  return rows.map(rowToDeal);
}

export async function saveDeals(deals: Deal[]): Promise<void> {
  await ensureSchema();
  const db = sql();
  await db.transaction((tx) => [
    tx`DELETE FROM deals`,
    ...deals.map(
      (d) => tx`
        INSERT INTO deals (
          id, company_name, industry, stage, deal_value, contact_name,
          contact_email, notes, owner, city, lat, lng, links, operator_ids,
          revenue, ebitda, asking_price, broker, source,
          created_at, updated_at
        ) VALUES (
          ${d.id}, ${d.companyName}, ${d.industry}, ${d.stage},
          ${d.dealValue || 0}, ${d.contactName}, ${d.contactEmail},
          ${d.notes}, ${d.owner}, ${d.city}, ${d.lat}, ${d.lng},
          ${JSON.stringify(d.links ?? [])},
          ${JSON.stringify(d.operatorIds ?? [])},
          ${d.revenue}, ${d.ebitda}, ${d.askingPrice},
          ${d.broker ?? ""}, ${d.source ?? ""},
          ${d.createdAt}, ${d.updatedAt}
        )`
    ),
  ]);
}

// --- Executives ---
function rowToExec(r: Record<string, unknown>): Executive {
  return {
    id: String(r.id),
    name: String(r.name ?? ""),
    currentTitle: String(r.current_title ?? ""),
    targetRole: String(r.target_role ?? ""),
    stage: String(r.stage ?? "Sourcing") as Executive["stage"],
    background: String(r.background ?? ""),
    notes: String(r.notes ?? ""),
    owner: String(r.owner ?? ""),
    industries: Array.isArray(r.industries)
      ? (r.industries as string[])
      : [],
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
  };
}

export async function getExecutives(): Promise<Executive[]> {
  await ensureSchema();
  const rows = await sql()`SELECT * FROM executives ORDER BY updated_at DESC`;
  return rows.map(rowToExec);
}

export async function saveExecutives(execs: Executive[]): Promise<void> {
  await ensureSchema();
  const db = sql();
  await db.transaction((tx) => [
    tx`DELETE FROM executives`,
    ...execs.map(
      (e) => tx`
        INSERT INTO executives (
          id, name, current_title, target_role, stage, background,
          notes, owner, industries, created_at, updated_at
        ) VALUES (
          ${e.id}, ${e.name}, ${e.currentTitle}, ${e.targetRole},
          ${e.stage}, ${e.background}, ${e.notes}, ${e.owner},
          ${JSON.stringify(e.industries ?? [])},
          ${e.createdAt}, ${e.updatedAt}
        )`
    ),
  ]);
}

// --- Tasks ---
function rowToTask(r: Record<string, unknown>): Task {
  return {
    id: String(r.id),
    title: String(r.title ?? ""),
    dueDate: String(r.due_date ?? ""),
    done: Boolean(r.done),
    owner: String(r.owner ?? ""),
    relatedKind:
      r.related_kind === "deal" || r.related_kind === "executive"
        ? r.related_kind
        : null,
    relatedId: r.related_id ? String(r.related_id) : null,
    relatedName: String(r.related_name ?? ""),
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
  };
}

export async function getTasks(): Promise<Task[]> {
  await ensureSchema();
  const rows = await sql()`SELECT * FROM tasks ORDER BY updated_at DESC`;
  return rows.map(rowToTask);
}

export async function saveTasks(tasks: Task[]): Promise<void> {
  await ensureSchema();
  const db = sql();
  await db.transaction((tx) => [
    tx`DELETE FROM tasks`,
    ...tasks.map(
      (t) => tx`
        INSERT INTO tasks (
          id, title, due_date, done, owner, related_kind,
          related_id, related_name, created_at, updated_at
        ) VALUES (
          ${t.id}, ${t.title}, ${t.dueDate}, ${t.done}, ${t.owner},
          ${t.relatedKind}, ${t.relatedId}, ${t.relatedName},
          ${t.createdAt}, ${t.updatedAt}
        )`
    ),
  ]);
}

// --- Activity ---
const ACTIVITY_CAP = 500;

function rowToEvent(r: Record<string, unknown>): ActivityEvent {
  return {
    id: String(r.id),
    type: String(r.type ?? "") as ActivityEvent["type"],
    actor: String(r.actor ?? ""),
    message: String(r.message ?? ""),
    dealId: r.deal_id ? String(r.deal_id) : null,
    execId: r.exec_id ? String(r.exec_id) : null,
    dealName: r.deal_name ? String(r.deal_name) : null,
    execName: r.exec_name ? String(r.exec_name) : null,
    createdAt: iso(r.created_at),
  };
}

export async function getActivity(): Promise<ActivityEvent[]> {
  await ensureSchema();
  const rows =
    await sql()`SELECT * FROM activity ORDER BY created_at DESC LIMIT ${ACTIVITY_CAP}`;
  return rows.map(rowToEvent);
}

export async function logActivity(
  event: Omit<ActivityEvent, "id" | "createdAt">
): Promise<void> {
  await ensureSchema();
  const db = sql();
  const id = newId();
  await db`
    INSERT INTO activity (
      id, type, actor, message, deal_id, exec_id, deal_name, exec_name
    ) VALUES (
      ${id}, ${event.type}, ${event.actor}, ${event.message},
      ${event.dealId}, ${event.execId}, ${event.dealName}, ${event.execName}
    )`;
  // Keep the table bounded.
  await db`
    DELETE FROM activity
    WHERE id NOT IN (
      SELECT id FROM activity ORDER BY created_at DESC LIMIT ${ACTIVITY_CAP}
    )`;
}

// --- Contacts ---
function rowToContact(r: Record<string, unknown>): Contact {
  return {
    id: String(r.id),
    name: String(r.name ?? ""),
    role: String(r.role ?? ""),
    email: String(r.email ?? ""),
    phone: String(r.phone ?? ""),
    linkedin: String(r.linkedin ?? ""),
    notes: String(r.notes ?? ""),
    dealId: r.deal_id ? String(r.deal_id) : null,
    execId: r.exec_id ? String(r.exec_id) : null,
    owner: String(r.owner ?? ""),
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
  };
}

export async function getContacts(): Promise<Contact[]> {
  await ensureSchema();
  const rows = await sql()`SELECT * FROM contacts ORDER BY updated_at DESC`;
  return rows.map(rowToContact);
}

export async function saveContacts(contacts: Contact[]): Promise<void> {
  await ensureSchema();
  const db = sql();
  await db.transaction((tx) => [
    tx`DELETE FROM contacts`,
    ...contacts.map(
      (c) => tx`
        INSERT INTO contacts (
          id, name, role, email, phone, linkedin, notes,
          deal_id, exec_id, owner, created_at, updated_at
        ) VALUES (
          ${c.id}, ${c.name}, ${c.role}, ${c.email}, ${c.phone},
          ${c.linkedin}, ${c.notes}, ${c.dealId}, ${c.execId},
          ${c.owner}, ${c.createdAt}, ${c.updatedAt}
        )`
    ),
  ]);
}

// --- Interactions ---
function rowToInteraction(r: Record<string, unknown>): Interaction {
  return {
    id: String(r.id),
    dealId: r.deal_id ? String(r.deal_id) : null,
    execId: r.exec_id ? String(r.exec_id) : null,
    kind: (String(r.kind ?? "note") || "note") as Interaction["kind"],
    occurredAt: String(r.occurred_at ?? ""),
    summary: String(r.summary ?? ""),
    createdAt: iso(r.created_at),
  };
}

export async function getInteractions(): Promise<Interaction[]> {
  await ensureSchema();
  const rows =
    await sql()`SELECT * FROM interactions ORDER BY occurred_at DESC, created_at DESC`;
  return rows.map(rowToInteraction);
}

export async function saveInteractions(
  items: Interaction[]
): Promise<void> {
  await ensureSchema();
  const db = sql();
  await db.transaction((tx) => [
    tx`DELETE FROM interactions`,
    ...items.map(
      (i) => tx`
        INSERT INTO interactions (
          id, deal_id, exec_id, kind, occurred_at, summary, created_at
        ) VALUES (
          ${i.id}, ${i.dealId}, ${i.execId}, ${i.kind},
          ${i.occurredAt}, ${i.summary}, ${i.createdAt}
        )`
    ),
  ]);
}

// --- Attachments ---
function rowToAttachment(r: Record<string, unknown>): Attachment {
  return {
    id: String(r.id),
    dealId: String(r.deal_id ?? ""),
    filename: String(r.filename ?? ""),
    mimeType: String(r.mime_type ?? ""),
    size: Number(r.size ?? 0),
    data: String(r.data ?? ""),
    createdAt: iso(r.created_at),
  };
}

export async function getAttachments(): Promise<Attachment[]> {
  await ensureSchema();
  const rows =
    await sql()`SELECT * FROM attachments ORDER BY created_at DESC`;
  return rows.map(rowToAttachment);
}

export async function saveAttachments(
  items: Attachment[]
): Promise<void> {
  await ensureSchema();
  const db = sql();
  await db.transaction((tx) => [
    tx`DELETE FROM attachments`,
    ...items.map(
      (a) => tx`
        INSERT INTO attachments (
          id, deal_id, filename, mime_type, size, data, created_at
        ) VALUES (
          ${a.id}, ${a.dealId}, ${a.filename}, ${a.mimeType},
          ${a.size}, ${a.data}, ${a.createdAt}
        )`
    ),
  ]);
}

// --- Deal flow ---
function rowToFlow(r: Record<string, unknown>): DealFlowItem {
  return {
    id: String(r.id),
    kind: String(r.kind ?? "business_for_sale") as DealFlowItem["kind"],
    title: String(r.title ?? ""),
    source: String(r.source ?? ""),
    sourceDetail: String(r.source_detail ?? ""),
    spottedAt: String(r.spotted_at ?? ""),
    why: String(r.why ?? ""),
    industry: String(r.industry ?? ""),
    location: String(r.location ?? ""),
    status: String(r.status ?? "new") as DealFlowItem["status"],
    relatedDealId: r.related_deal_id ? String(r.related_deal_id) : null,
    relatedExecId: r.related_exec_id ? String(r.related_exec_id) : null,
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
  };
}

export async function getDealFlow(): Promise<DealFlowItem[]> {
  await ensureSchema();
  const rows =
    await sql()`SELECT * FROM deal_flow ORDER BY created_at DESC`;
  return rows.map(rowToFlow);
}

export async function saveDealFlow(items: DealFlowItem[]): Promise<void> {
  await ensureSchema();
  const db = sql();
  await db.transaction((tx) => [
    tx`DELETE FROM deal_flow`,
    ...items.map(
      (f) => tx`
        INSERT INTO deal_flow (
          id, kind, title, source, source_detail, spotted_at, why,
          industry, location, status, related_deal_id, related_exec_id,
          created_at, updated_at
        ) VALUES (
          ${f.id}, ${f.kind}, ${f.title}, ${f.source}, ${f.sourceDetail},
          ${f.spottedAt}, ${f.why}, ${f.industry}, ${f.location},
          ${f.status}, ${f.relatedDealId}, ${f.relatedExecId},
          ${f.createdAt}, ${f.updatedAt}
        )`
    ),
  ]);
}

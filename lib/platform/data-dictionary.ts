import { sql, str } from "./db";

/**
 * Data dictionary (Settings → Data Dictionary; Navigation
 * Restructure): the platform's schemas/tables/columns read live
 * from information_schema, with a curated plain-language description
 * map for the core entities. Cached server-side in memory for ~15
 * minutes (module-level timestamp) per the data-transfer rules —
 * information_schema scans are not free and the schema changes
 * rarely.
 */

export const PLATFORM_SCHEMAS = [
  "public",
  "core",
  "bd",
  "directory",
  "dataroom",
  "financials",
  "finanalysis",
  "diligence",
  "valuecreation",
  "capital",
  "monitoring",
  "portmgmt",
  "calgen",
] as const;

/** Curated descriptions, keyed "schema.table". Anything not listed
 * here renders with an empty description — never an invented one. */
export const TABLE_DESCRIPTIONS: Record<string, string> = {
  "bd.type_config":
    "Investment Types (Step 1): one row per investment type (Platform LBO, Add-on, Early Stage, Minority Growth) — its label, whether it is enabled, and its stage list. Edited in Settings → Investment types; Minority Growth ships disabled here, not in code.",
  "bd.metric_definitions":
    "The configurable catalog of type- and sector-specific deal fields: which type or sector pack a field belongs to, its data kind (money, multiple, %, number, text, list), order, and options. New fields are added here, never as columns on the deals table.",
  "bd.deal_metrics":
    "Structured per-deal metric values (deal, metric key, value, period, source) for every field in bd.metric_definitions — Platform LBO leverage/FCF yield/ROIC/DSCR, Add-on multiples and synergies, Early Stage ARR/burn/runway, and the Aerospace & Defense pack.",
  "bd.sector_packs":
    "Industry field packs (Aerospace & Defense seeded): a pack applies automatically to deals whose industry matches, adding its metric definitions on top of the deal's type fields.",
  "bd.migration_reports":
    "The persistent Investment Types Step 1 migration report: deals scanned, per-type counts, per-stage from→to counts under Ethan's approved mapping, and anything unmapped. Also served at /api/platform/investment-types/migration-report.",
  "core.companies":
    "The central company record. Every module links to a company by ID; a fact is stored once, here, and referenced elsewhere.",
  "core.people":
    "Every person the firm tracks — operators, investors, contacts, advisors — linked to an organization and to deals they participate in.",
  "core.organizations":
    "Firms and organizations: investor firms, lenders, advisors, and the companies people belong to.",
  "core.deals":
    "The link between a company and its deal: which company a pipeline deal belongs to and its current stage.",
  "core.deal_participants":
    "Who is involved in a deal and in what role (operator, investor, advisor, seller…).",
  "core.documents":
    "Document metadata only — name, type, owner links. File bytes live in storage, never in the database.",
  "core.comments":
    "Comments and @mentions on any record (company, deal, person, document).",
  "core.activity_log":
    "The platform activity feed: what happened, on which record, by whom.",
  "core.audit_log":
    "Field-level change history for edits and merges — who changed what, and when.",
  "core.events":
    "The internal event bus: key actions (deal closed, financials posted, document uploaded…) publish events that handlers react to.",
  "core.jobs":
    "The background job queue: syncs, ingests, event handlers, and scheduled notifications.",
  "core.user_roles":
    "Platform access: one row per login email with its role (admin / internal / guest) and access scope.",
  "core.overview_summary":
    "Pre-aggregated Overview read model — the Overview page reads summaries, never raw tables.",
  "core.company_cards":
    "Pre-aggregated per-company card data powering company lists and previews.",
  "core.notifications":
    "In-portal notifications for a user (mentions and collaboration alerts).",
  "directory.type_tags":
    "Directory type taxonomy for people and organizations (operator, investor, lender, broker, attorney…).",
  "dataroom.rooms":
    "Data rooms — one active room per deal, holding its folders, checklist, guests, and documents.",
  "dataroom.guests":
    "External guest grants for a data room (hashed tokens only; the raw link is shown once).",
  "financials.statement_sets":
    "Extracted financial statement sets per company and period, in reported and adjusted layers, drafts until posted.",
  "finanalysis.analyses":
    "Automated financial analysis per company (ratios, anomalies, QoE suggestions) — drafts until approved.",
  "diligence.workspaces":
    "Due diligence workspaces, one per deal under review, with their checklists, findings, and closing items.",
  "capital.investors":
    "Investor capital profiles behind Investors & Capital: commitments, check sizes, and raise participation.",
  "monitoring.companies":
    "Portfolio companies in Portfolio Monitoring — the post-close home for a company, fed only by the deal_closed handoff.",
};

export interface DictionaryColumn {
  name: string;
  type: string;
  nullable: boolean;
}

export interface DictionaryTable {
  table: string;
  description: string;
  columns: DictionaryColumn[];
}

export interface DictionarySchema {
  schema: string;
  tables: DictionaryTable[];
}

export interface DataDictionary {
  schemas: DictionarySchema[];
  generatedAt: string;
}

const CACHE_TTL_MS = 15 * 60 * 1000;
let cache: { at: number; data: DataDictionary } | null = null;

export async function getDataDictionary(): Promise<DataDictionary> {
  const now = Date.now();
  if (cache && now - cache.at < CACHE_TTL_MS) return cache.data;

  const db = sql();
  const rows = await db`
    SELECT table_schema, table_name, column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_schema <> 'pg_catalog' AND table_schema <> 'information_schema'
    ORDER BY table_schema, table_name, ordinal_position`;

  const allow = new Set<string>(PLATFORM_SCHEMAS);
  const bySchema = new Map<string, Map<string, DictionaryTable>>();
  for (const r of rows) {
    const rec = r as Record<string, unknown>;
    const schema = str(rec.table_schema);
    if (!allow.has(schema)) continue;
    const table = str(rec.table_name);
    let tables = bySchema.get(schema);
    if (!tables) {
      tables = new Map();
      bySchema.set(schema, tables);
    }
    let entry = tables.get(table);
    if (!entry) {
      entry = {
        table,
        description: TABLE_DESCRIPTIONS[`${schema}.${table}`] ?? "",
        columns: [],
      };
      tables.set(table, entry);
    }
    entry.columns.push({
      name: str(rec.column_name),
      type: str(rec.data_type),
      nullable: str(rec.is_nullable) === "YES",
    });
  }

  const schemas: DictionarySchema[] = PLATFORM_SCHEMAS.filter((s) =>
    bySchema.has(s)
  ).map((s) => ({
    schema: s,
    tables: Array.from(bySchema.get(s)!.values()).sort((a, b) =>
      a.table.localeCompare(b.table)
    ),
  }));

  const data: DataDictionary = { schemas, generatedAt: new Date().toISOString() };
  cache = { at: now, data };
  return data;
}

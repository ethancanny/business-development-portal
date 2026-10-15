/**
 * News & Intelligence data layer (premium redesign Wave 2, Oct 14, 2026).
 * Split out of market-db.ts — that file is at the push-channel size cap.
 *
 * Licensing rules baked in (Ethan, Oct 14, 2026): summaries are written by
 * an agent in our own words (≤2 sentences) via /api/market/news/summary —
 * the server NEVER copies publisher text into `summary`. The publisher's
 * RSS snippet lives in `raw_snippet` for matching/debug only and is never
 * returned by the UI API. Article images are the publisher's link-preview
 * (og:image) with the source credited in `image_credit`.
 */
import { neon } from "@neondatabase/serverless";
import { ensureSchema, newId, getDeals, getExecutives } from "./db-postgres";
import { getInvestors } from "./investors-db";
import type { MiNewsItem, MiNewsMatch } from "./types";

function sql() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set (market intel requires Postgres)");
  return neon(url);
}

const str = (v: unknown): string => String(v ?? "");
const numOrNull = (v: unknown): number | null =>
  v === null || v === undefined || v === "" ? null : Number(v);

let newsSchemaReady: Promise<void> | null = null;
export function ensureNewsSchema(): Promise<void> {
  if (!newsSchemaReady) {
    newsSchemaReady = (async () => {
      const db = sql();
      await db`
        CREATE TABLE IF NOT EXISTS mi_news (
          id TEXT PRIMARY KEY,
          dedupe_key TEXT NOT NULL UNIQUE,
          headline TEXT NOT NULL DEFAULT '',
          url TEXT NOT NULL DEFAULT '',
          source_name TEXT NOT NULL DEFAULT '',
          published_at TIMESTAMPTZ,
          fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          sector TEXT,
          summary TEXT,
          summary_at TIMESTAMPTZ,
          relevance_score INTEGER NOT NULL DEFAULT 0,
          kind TEXT NOT NULL DEFAULT 'sector',
          matched JSONB NOT NULL DEFAULT '[]'::jsonb,
          image_url TEXT,
          image_credit TEXT,
          also_covered_by JSONB NOT NULL DEFAULT '[]'::jsonb,
          saved BOOLEAN NOT NULL DEFAULT FALSE,
          dismissed BOOLEAN NOT NULL DEFAULT FALSE,
          linked_company_id TEXT,
          raw_snippet TEXT NOT NULL DEFAULT ''
        )`;
      await db`CREATE INDEX IF NOT EXISTS mi_news_published_idx ON mi_news (published_at DESC)`;
      await db`CREATE INDEX IF NOT EXISTS mi_news_pending_idx ON mi_news (summary) WHERE summary IS NULL`;
      await db`
        CREATE TABLE IF NOT EXISTS mi_news_watchlist (
          term TEXT PRIMARY KEY,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )`;
    })();
  }
  return newsSchemaReady;
}

/* ---------------- row mapping ---------------- */

function parseJsonArray(v: unknown): unknown[] {
  if (Array.isArray(v)) return v;
  if (typeof v === "string" && v) {
    try {
      const p = JSON.parse(v) as unknown;
      return Array.isArray(p) ? p : [];
    } catch {
      return [];
    }
  }
  return [];
}

function rowToNews(r: Record<string, unknown>, includeSnippet: boolean): MiNewsItem & { rawSnippet?: string } {
  const matched = parseJsonArray(r.matched)
    .filter((m): m is Record<string, unknown> => !!m && typeof m === "object")
    .map((m) => ({
      type: str(m.type) as MiNewsMatch["type"],
      id: str(m.id),
      name: str(m.name),
    }));
  const also = parseJsonArray(r.also_covered_by).map((s) => str(s)).filter(Boolean);
  const item: MiNewsItem & { rawSnippet?: string } = {
    id: str(r.id),
    dedupeKey: str(r.dedupe_key),
    headline: str(r.headline),
    url: str(r.url),
    sourceName: str(r.source_name),
    publishedAt: r.published_at ? new Date(str(r.published_at)).toISOString() : "",
    fetchedAt: r.fetched_at ? new Date(str(r.fetched_at)).toISOString() : "",
    sector: r.sector === null || r.sector === undefined || r.sector === "" ? null : str(r.sector),
    summary: r.summary === null || r.summary === undefined ? null : str(r.summary),
    summaryAt: r.summary_at ? new Date(str(r.summary_at)).toISOString() : null,
    relevanceScore: Number(numOrNull(r.relevance_score) ?? 0),
    kind: (str(r.kind) || "sector") as MiNewsItem["kind"],
    matched,
    imageUrl: r.image_url ? str(r.image_url) : null,
    imageCredit: r.image_credit ? str(r.image_credit) : null,
    alsoCoveredBy: also,
    saved: Boolean(r.saved),
    dismissed: Boolean(r.dismissed),
    linkedCompanyId: r.linked_company_id ? str(r.linked_company_id) : null,
  };
  if (includeSnippet) item.rawSnippet = str(r.raw_snippet);
  return item;
}

/* ---------------- ingest-side writes ---------------- */

export interface NewsInsert {
  dedupeKey: string;
  headline: string;
  url: string;
  sourceName: string;
  publishedAt: string | null;
  sector: string | null;
  relevanceScore: number;
  kind: MiNewsItem["kind"];
  matched: MiNewsMatch[];
  imageUrl: string | null;
  imageCredit: string | null;
  rawSnippet: string;
}

/** Insert one story; returns the new row id, or null when the
 * dedupe_key already exists. */
export async function insertNewsItem(row: NewsInsert): Promise<string | null> {
  await ensureNewsSchema();
  const db = sql();
  const rows = (await db`
    INSERT INTO mi_news (id, dedupe_key, headline, url, source_name, published_at,
      sector, relevance_score, kind, matched, image_url, image_credit, raw_snippet)
    VALUES (${newId()}, ${row.dedupeKey}, ${row.headline}, ${row.url}, ${row.sourceName},
      ${row.publishedAt}, ${row.sector}, ${row.relevanceScore}, ${row.kind},
      ${JSON.stringify(row.matched)}::jsonb, ${row.imageUrl}, ${row.imageCredit}, ${row.rawSnippet})
    ON CONFLICT (dedupe_key) DO NOTHING
    RETURNING id`) as unknown as Record<string, unknown>[];
  return rows.length ? str(rows[0].id) : null;
}

export interface RecentNewsRow {
  id: string;
  headline: string;
  sourceName: string;
  matched: MiNewsMatch[];
  alsoCoveredBy: string[];
}

/** Recent rows for the multi-outlet dedupe pass (same story, other outlet). */
export async function getRecentNewsRows(hours = 72): Promise<RecentNewsRow[]> {
  await ensureNewsSchema();
  const cutoff = new Date(Date.now() - hours * 3600e3).toISOString();
  const rows = (await sql()`
    SELECT id, headline, source_name, matched, also_covered_by FROM mi_news
    WHERE fetched_at >= ${cutoff}
    ORDER BY fetched_at DESC LIMIT 500`) as unknown as Record<string, unknown>[];
  return rows.map((r) => ({
    id: str(r.id),
    headline: str(r.headline),
    sourceName: str(r.source_name),
    matched: parseJsonArray(r.matched)
      .filter((m): m is Record<string, unknown> => !!m && typeof m === "object")
      .map((m) => ({ type: str(m.type) as MiNewsMatch["type"], id: str(m.id), name: str(m.name) })),
    alsoCoveredBy: parseJsonArray(r.also_covered_by).map((s) => str(s)).filter(Boolean),
  }));
}

/** Record another outlet covering the same story on the existing row. */
export async function appendAlsoCoveredBy(id: string, sourceName: string): Promise<void> {
  await ensureNewsSchema();
  const db = sql();
  const rows = (await db`SELECT also_covered_by FROM mi_news WHERE id = ${id}`) as unknown as Record<string, unknown>[];
  if (!rows.length) return;
  const also = parseJsonArray(rows[0].also_covered_by).map((s) => str(s)).filter(Boolean);
  if (!also.includes(sourceName)) also.push(sourceName);
  await db`UPDATE mi_news SET also_covered_by = ${JSON.stringify(also)}::jsonb WHERE id = ${id}`;
}

/* ---------------- matchable entities ---------------- */

export interface MatchEntity extends MiNewsMatch {
  sector: string;
}

/** Every name the relevance screen can match a headline against: fit
 * companies, pipeline deals, Directory operators, investors (name + firm),
 * competing buyers (mi_acquisitions acquirers), and the news watchlist.
 * Sorted longest-name-first so the most specific match wins. */
export async function loadMatchEntities(): Promise<MatchEntity[]> {
  await ensureNewsSchema();
  await ensureSchema();
  const db = sql();
  const out: MatchEntity[] = [];
  const seen = new Set<string>();
  const push = (type: MiNewsMatch["type"], id: string, name: string, sector = "") => {
    const clean = (name ?? "").trim();
    if (clean.length < 4) return;
    const key = `${type}:${clean.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ type, id, name: clean, sector });
  };

  const companies = (await db`
    SELECT id, name, sector FROM mi_companies
    WHERE details LIKE '{%' AND (details::jsonb ->> 'fit') = 'true' LIMIT 30000`) as unknown as Record<string, unknown>[];
  for (const c of companies) push("company", str(c.id), str(c.name), str(c.sector));

  const buyers = (await db`
    SELECT DISTINCT acquirer FROM mi_acquisitions WHERE acquirer <> '' LIMIT 2000`) as unknown as Record<string, unknown>[];
  for (const b of buyers) push("company", str(b.acquirer), str(b.acquirer));

  try {
    const deals = await getDeals();
    for (const d of deals) push("deal", d.id, d.companyName);
  } catch { /* deals are an enhancement to the screen, not a dependency */ }
  try {
    const execs = await getExecutives();
    for (const e of execs) push("operator", e.id, e.name);
  } catch { /* same */ }
  try {
    const investors = await getInvestors();
    for (const inv of investors) {
      push("investor", inv.id, inv.name);
      if (inv.firm && inv.firm.toLowerCase() !== inv.name.toLowerCase()) push("investor", inv.id, inv.firm);
    }
  } catch { /* same */ }

  const watch = (await db`SELECT term FROM mi_news_watchlist ORDER BY term`) as unknown as Record<string, unknown>[];
  for (const w of watch) push("watchlist", str(w.term), str(w.term));

  out.sort((a, b) => b.name.length - a.name.length);
  return out;
}

/* ---------------- UI reads ---------------- */

export interface NewsQuery {
  sector?: string;
  type?: "entity" | "sector" | "event" | "watchlist";
  days?: number;
  savedOnly?: boolean;
  limit?: number;
}

export async function getNewsForUi(q: NewsQuery): Promise<{ items: MiNewsItem[]; lastFetchedAt: string | null }> {
  await ensureNewsSchema();
  const db = sql();
  const limit = Math.min(Math.max(q.limit ?? 50, 1), 200);
  const cutoff = q.days && q.days > 0 ? new Date(Date.now() - q.days * 864e5).toISOString() : null;
  const sector = q.sector && q.sector !== "all" ? q.sector : null;
  // Type lanes: watchlist = a watchlist entry inside matched; entity = a
  // company/deal/operator/investor entry; event/sector = the primary kind.
  const typeCond =
    q.type === "watchlist"
      ? `EXISTS (SELECT 1 FROM jsonb_array_elements(matched) m WHERE m ->> 'type' = 'watchlist')`
      : q.type === "entity"
        ? `EXISTS (SELECT 1 FROM jsonb_array_elements(matched) m WHERE m ->> 'type' IN ('company','deal','operator','investor'))`
        : q.type === "event"
          ? `kind = 'event'`
          : q.type === "sector"
            ? `kind = 'sector'`
            : `TRUE`;
  const savedCond = q.savedOnly ? `saved = TRUE` : `dismissed = FALSE`;
  const rows = (await db.query(
    `SELECT * FROM mi_news
     WHERE ${savedCond}
       AND (${typeCond})
       AND ($1::text IS NULL OR sector = $1)
       AND ($2::timestamptz IS NULL OR published_at >= $2)
     ORDER BY relevance_score DESC, published_at DESC NULLS LAST
     LIMIT $3`,
    [sector, cutoff, limit]
  )) as unknown as Record<string, unknown>[];
  const maxRows = (await db`SELECT MAX(fetched_at) AS m FROM mi_news`) as unknown as Record<string, unknown>[];
  const lastFetchedAt = maxRows[0]?.m ? new Date(str(maxRows[0].m)).toISOString() : null;
  // raw_snippet is internal only — rowToNews excludes it unless asked.
  return { items: rows.map((r) => rowToNews(r, false)), lastFetchedAt };
}

/* ---------------- summary pass (agent-written) ---------------- */

export interface PendingSummary {
  id: string;
  headline: string;
  source: string;
  url: string;
  snippet: string;
}

export async function getPendingSummaries(limit = 25): Promise<PendingSummary[]> {
  await ensureNewsSchema();
  const rows = (await sql()`
    SELECT id, headline, source_name, url, raw_snippet FROM mi_news
    WHERE summary IS NULL AND dismissed = FALSE
    ORDER BY relevance_score DESC, published_at DESC NULLS LAST
    LIMIT ${Math.min(Math.max(limit, 1), 100)}`) as unknown as Record<string, unknown>[];
  return rows.map((r) => ({
    id: str(r.id),
    headline: str(r.headline),
    source: str(r.source_name),
    url: str(r.url),
    snippet: str(r.raw_snippet),
  }));
}

export async function getNewsRawSnippet(id: string): Promise<string | null> {
  await ensureNewsSchema();
  const rows = (await sql()`SELECT raw_snippet FROM mi_news WHERE id = ${id}`) as unknown as Record<string, unknown>[];
  return rows.length ? str(rows[0].raw_snippet) : null;
}

export async function setNewsSummary(id: string, summary: string): Promise<boolean> {
  await ensureNewsSchema();
  const rows = (await sql()`
    UPDATE mi_news SET summary = ${summary}, summary_at = NOW()
    WHERE id = ${id} RETURNING id`) as unknown as Record<string, unknown>[];
  return rows.length > 0;
}

/* ---------------- user actions ---------------- */

export type NewsAction = "save" | "unsave" | "dismiss" | "link";

/** Apply a UI action. For "link", appends the story as a signal on the
 * target company (mirrors the filings Keep mechanism in market-db) and
 * records linked_company_id. Returns the linked company, when relevant. */
export async function applyNewsAction(
  id: string,
  action: NewsAction,
  companyId?: string
): Promise<{ ok: boolean; error?: string; companyId?: string; companyName?: string }> {
  await ensureNewsSchema();
  const db = sql();
  const rows = (await db`SELECT * FROM mi_news WHERE id = ${id}`) as unknown as Record<string, unknown>[];
  if (!rows.length) return { ok: false, error: "News item not found" };
  const item = rows[0];

  if (action === "save") {
    await db`UPDATE mi_news SET saved = TRUE WHERE id = ${id}`;
    return { ok: true };
  }
  if (action === "unsave") {
    await db`UPDATE mi_news SET saved = FALSE WHERE id = ${id}`;
    return { ok: true };
  }
  if (action === "dismiss") {
    await db`UPDATE mi_news SET dismissed = TRUE WHERE id = ${id}`;
    return { ok: true };
  }
  // link
  if (!companyId) return { ok: false, error: "companyId is required for link" };
  await ensureSchema();
  const crows = (await db`SELECT id, name, details FROM mi_companies WHERE id = ${companyId}`) as unknown as Record<string, unknown>[];
  if (!crows.length) return { ok: false, error: "Company not found" };
  const company = crows[0];
  let details: Record<string, unknown> = {};
  try {
    details = JSON.parse(str(company.details) || "{}") as Record<string, unknown>;
  } catch {
    details = {};
  }
  const signals = Array.isArray(details.signals) ? (details.signals as unknown[]) : [];
  const published = item.published_at ? new Date(str(item.published_at)).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);
  // Dedupe on write (Ethan, Oct 14, 2026): linking the same story to the
  // same company twice must not stack identical signals — identity is
  // the signal text (headline — source) plus its URL.
  const sigText = `${str(item.headline)} — ${str(item.source_name)}`;
  const sigUrl = str(item.url);
  const sigDupe = signals.some((sg) => {
    const o = (sg ?? {}) as Record<string, unknown>;
    return String(o.text ?? "") === sigText && String(o.url ?? "") === sigUrl;
  });
  if (!sigDupe) {
    signals.push({
      date: published,
      source: "News",
      text: sigText,
      url: sigUrl,
    });
  }
  details.signals = signals.slice(-20);
  await db`UPDATE mi_companies SET details = ${JSON.stringify(details).slice(0, 3900)} WHERE id = ${companyId}`;
  await db`UPDATE mi_news SET linked_company_id = ${companyId} WHERE id = ${id}`;
  return { ok: true, companyId, companyName: str(company.name) };
}

/* ---------------- watchlist ---------------- */

export async function getWatchlist(): Promise<string[]> {
  await ensureNewsSchema();
  const rows = (await sql()`SELECT term FROM mi_news_watchlist ORDER BY term`) as unknown as Record<string, unknown>[];
  return rows.map((r) => str(r.term)).filter(Boolean);
}

export async function addWatchTerm(term: string): Promise<void> {
  await ensureNewsSchema();
  const clean = term.trim().slice(0, 120);
  if (clean.length < 3) throw new Error("Watchlist term must be at least 3 characters");
  await sql()`INSERT INTO mi_news_watchlist (term) VALUES (${clean}) ON CONFLICT (term) DO NOTHING`;
}

export async function deleteWatchTerm(term: string): Promise<void> {
  await ensureNewsSchema();
  await sql()`DELETE FROM mi_news_watchlist WHERE term = ${term.trim()}`;
}

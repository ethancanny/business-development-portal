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
import { hospitalityMatchName, nameKey } from "./hospitality-screen";
import {
  NEWS_MIN_RELEVANCE,
  NEWS_SECTORS,
  classifySector,
  scoreRelevance,
  feedbackDelta,
  extractCorrectionTerms,
  distinctiveTokens,
  type SectorCorrection,
} from "./news-classify";
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
      // News overhaul (Oct 17, 2026): classifier + relevance columns.
      // sector_confidence/sector_tags come from lib/news-classify.ts;
      // sector_corrected pins a row Ethan fixed by hand so re-runs
      // never overwrite him; hard_excluded marks a story in a category
      // that must never reach the feed (school overrides & peers).
      await db`ALTER TABLE mi_news ADD COLUMN IF NOT EXISTS sector_confidence REAL NOT NULL DEFAULT 0`;
      await db`ALTER TABLE mi_news ADD COLUMN IF NOT EXISTS sector_tags JSONB NOT NULL DEFAULT '[]'::jsonb`;
      await db`ALTER TABLE mi_news ADD COLUMN IF NOT EXISTS sector_corrected BOOLEAN NOT NULL DEFAULT FALSE`;
      await db`ALTER TABLE mi_news ADD COLUMN IF NOT EXISTS relevance_reason TEXT`;
      await db`ALTER TABLE mi_news ADD COLUMN IF NOT EXISTS deal_signal BOOLEAN NOT NULL DEFAULT FALSE`;
      await db`ALTER TABLE mi_news ADD COLUMN IF NOT EXISTS hard_excluded BOOLEAN NOT NULL DEFAULT FALSE`;
      await db`ALTER TABLE mi_news ADD COLUMN IF NOT EXISTS hard_reason TEXT`;
      await db`
        CREATE TABLE IF NOT EXISTS mi_news_watchlist (
          term TEXT PRIMARY KEY,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )`;
      // Ethan's "Wrong sector?" corrections: the article is pinned, and
      // the correction's distinctive terms vote in future classifications.
      await db`
        CREATE TABLE IF NOT EXISTS mi_news_corrections (
          id TEXT PRIMARY KEY,
          news_id TEXT NOT NULL,
          from_sector TEXT,
          to_sector TEXT NOT NULL,
          terms JSONB NOT NULL DEFAULT '[]'::jsonb,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )`;
      // "Not relevant" feedback: accumulated score deltas keyed
      // source:<name> / topic:<token>, applied at classify time.
      await db`
        CREATE TABLE IF NOT EXISTS mi_news_adjustments (
          key TEXT PRIMARY KEY,
          delta INTEGER NOT NULL DEFAULT 0,
          hits INTEGER NOT NULL DEFAULT 0,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
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
    sectorConfidence: Number(numOrNull(r.sector_confidence) ?? 0),
    sectorTags: parseJsonArray(r.sector_tags).map((s) => str(s)).filter(Boolean),
    relevanceReason: r.relevance_reason ? str(r.relevance_reason) : null,
    dealSignal: Boolean(r.deal_signal),
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

/* ---------------- classifier state (learning) ---------------- */

export interface ClassifierState {
  corrections: SectorCorrection[];
  adjustments: Map<string, number>;
}

/** Everything the classifier has LEARNED from Ethan: his sector
 * corrections (as term votes) and the accumulated "Not relevant"
 * source/topic score adjustments. Loaded once per ingest / reclassify
 * run so a run sees a consistent snapshot. */
export async function loadClassifierState(): Promise<ClassifierState> {
  await ensureNewsSchema();
  const db = sql();
  const corrRows = (await db`
    SELECT to_sector, terms FROM mi_news_corrections ORDER BY created_at`) as unknown as Record<string, unknown>[];
  const corrections: SectorCorrection[] = corrRows.map((r) => ({
    sector: str(r.to_sector),
    terms: parseJsonArray(r.terms).map((t) => str(t)).filter(Boolean),
  }));
  const adjRows = (await db`SELECT key, delta FROM mi_news_adjustments`) as unknown as Record<string, unknown>[];
  const adjustments = new Map<string, number>();
  for (const r of adjRows) adjustments.set(str(r.key), Number(r.delta ?? 0));
  return { corrections, adjustments };
}

/** Record one "Not relevant" verdict as score adjustments: the source
 * takes −4 (keyed source:<name>) and up to three distinctive headline
 * tokens take −2 each (keyed topic:<token>). Stored deltas are floored
 * (−24 source, −12 topic) so feedback stays a nudge, not a ban; the
 * classifier additionally clamps the total applied delta at −32. */
async function recordNotRelevantFeedback(sourceName: string, headline: string): Promise<void> {
  await ensureNewsSchema();
  const db = sql();
  const bumps: { key: string; delta: number; floor: number }[] = [
    { key: `source:${sourceName}`, delta: -4, floor: -24 },
  ];
  for (const t of distinctiveTokens(headline, 3)) {
    bumps.push({ key: `topic:${t}`, delta: -2, floor: -12 });
  }
  for (const b of bumps) {
    await db`
      INSERT INTO mi_news_adjustments (key, delta, hits, updated_at)
      VALUES (${b.key}, ${b.delta}, 1, NOW())
      ON CONFLICT (key) DO UPDATE
        SET delta = GREATEST(mi_news_adjustments.delta + ${b.delta}, ${b.floor}),
            hits = mi_news_adjustments.hits + 1,
            updated_at = NOW()`;
  }
}

/* ---------------- ingest-side writes ---------------- */

export interface NewsInsert {
  dedupeKey: string;
  headline: string;
  url: string;
  sourceName: string;
  publishedAt: string | null;
  sector: string | null;
  sectorConfidence: number;
  sectorTags: string[];
  relevanceScore: number;
  relevanceReason: string | null;
  dealSignal: boolean;
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
      sector, sector_confidence, sector_tags, relevance_score, relevance_reason,
      deal_signal, kind, matched, image_url, image_credit, raw_snippet)
    VALUES (${newId()}, ${row.dedupeKey}, ${row.headline}, ${row.url}, ${row.sourceName},
      ${row.publishedAt}, ${row.sector}, ${row.sectorConfidence}, ${JSON.stringify(row.sectorTags)}::jsonb,
      ${row.relevanceScore}, ${row.relevanceReason}, ${row.dealSignal}, ${row.kind},
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

export interface MatchLoadStats {
  hospitalityTotal: number;
  hospitalityMatchable: number;
  hospitalityGenericSkipped: number;
}

/** Every name the relevance screen can match a headline against: fit
 * companies, pipeline deals, Directory operators, investors (name + firm),
 * competing buyers (mi_acquisitions acquirers), the news watchlist, and
 * tracked hospitality operator groups (Hospitality §5). Sorted
 * longest-name-first so the most specific match wins. */
export async function loadMatchEntities(stats?: MatchLoadStats): Promise<MatchEntity[]> {
  await ensureNewsSchema();
  await ensureSchema();
  const db = sql();
  const out: MatchEntity[] = [];
  const seen = new Set<string>();
  const nameSeen = new Set<string>();
  const push = (type: MiNewsMatch["type"], id: string, name: string, sector = "") => {
    const clean = (name ?? "").trim();
    if (clean.length < 4) return;
    const key = `${type}:${clean.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    nameSeen.add(clean.toLowerCase());
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

  // Tracked hospitality groups (Hospitality §5, Oct 17, 2026): every
  // operator group in the spine is a tracked name, but it enters the
  // screen ONLY under its distinctive match name (see
  // lib/hospitality-screen.ts) — generic group names are skipped so a
  // common word can never tag a story. The match id is the mirrored
  // company's id, so the story can be linked to the group. A group
  // whose name is already tracked as another entity type is not
  // duplicated (no-redundancy rule).
  try {
    const groups = (await db`
      SELECT g.name AS gname, g.group_key AS gk, c.id AS cid
      FROM mi_hospitality_groups g
      LEFT JOIN mi_companies c
        ON c.source = 'Hospitality Spine' AND c.dedup_key = g.group_key
      ORDER BY g.location_count DESC`) as unknown as Record<string, unknown>[];
    let matchable = 0;
    let skipped = 0;
    // The spine deliberately keeps name variants unmerged ("Filiberto's"
    // vs "FILIBERTOS"); for matching, one entry per normalized name is
    // enough — the largest-location variant wins (query order above).
    const hospKeys = new Set<string>();
    for (const g of groups) {
      const matchName = hospitalityMatchName(str(g.gname));
      if (!matchName) {
        skipped++;
        continue;
      }
      if (nameSeen.has(matchName.toLowerCase())) continue;
      const key = nameKey(matchName);
      if (hospKeys.has(key)) continue;
      hospKeys.add(key);
      const before = out.length;
      push("hospitality", str(g.cid) || str(g.gk), matchName, "Hospitality");
      if (out.length > before) matchable++;
    }
    if (stats) {
      stats.hospitalityTotal = groups.length;
      stats.hospitalityMatchable = matchable;
      stats.hospitalityGenericSkipped = skipped;
    }
  } catch {
    // The groups table is an enhancement to the screen, not a dependency.
  }

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
  offset?: number;
  /** "relevance" (default) or "recent" — the carousel's two rows. */
  sort?: "relevance" | "recent";
  /** Only stories carrying an acquisition/investment signal — the
   * ⭐ Top Market Events pool. */
  dealOnly?: boolean;
}

export async function getNewsForUi(q: NewsQuery): Promise<{ items: MiNewsItem[]; lastFetchedAt: string | null }> {
  await ensureNewsSchema();
  const db = sql();
  const limit = Math.min(Math.max(q.limit ?? 50, 1), 200);
  const offset = Math.min(Math.max(q.offset ?? 0, 0), 1000);
  const cutoff = q.days && q.days > 0 ? new Date(Date.now() - q.days * 864e5).toISOString() : null;
  const sector = q.sector && q.sector !== "all" ? q.sector : null;
  // Type lanes: watchlist = a watchlist entry inside matched; entity = a
  // company/deal/operator/investor entry; event/sector = the primary kind.
  const typeCond =
    q.type === "watchlist"
      ? `EXISTS (SELECT 1 FROM jsonb_array_elements(matched) m WHERE m ->> 'type' = 'watchlist')`
      : q.type === "entity"
        ? `EXISTS (SELECT 1 FROM jsonb_array_elements(matched) m WHERE m ->> 'type' IN ('company','deal','operator','investor','hospitality'))`
        : q.type === "event"
          ? `kind = 'event'`
          : q.type === "sector"
            ? `kind = 'sector'`
            : `TRUE`;
  // Dismissed always wins: a story that is both saved and dismissed
  // must not resurface in the Saved view (dismissal is permanent).
  const savedCond = q.savedOnly
    ? `saved = TRUE AND dismissed = FALSE`
    : `dismissed = FALSE`;
  // Display gates (News overhaul, Oct 17, 2026): hard-excluded
  // categories never reach the feed; a story without a working source
  // link never displays; the main feed shows only stories at or above
  // NEWS_MIN_RELEVANCE. The Saved view bypasses the relevance bar only
  // (Ethan saved those deliberately) — never the other two gates.
  const gateCond = `hard_excluded = FALSE AND url <> ''`;
  const relevanceCond = q.savedOnly ? `TRUE` : `relevance_score >= ${NEWS_MIN_RELEVANCE}`;
  const dealCond = q.dealOnly ? `deal_signal = TRUE` : `TRUE`;
  const orderBy =
    q.sort === "recent"
      ? `published_at DESC NULLS LAST, relevance_score DESC`
      : `relevance_score DESC, published_at DESC NULLS LAST`;
  const rows = (await db.query(
    `SELECT * FROM mi_news
     WHERE ${savedCond}
       AND ${gateCond}
       AND ${relevanceCond}
       AND ${dealCond}
       AND (${typeCond})
       AND ($1::text IS NULL OR sector = $1)
       AND ($2::timestamptz IS NULL OR published_at >= $2)
     ORDER BY ${orderBy}
     LIMIT $3 OFFSET $4`,
    [sector, cutoff, limit, offset]
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

export type NewsAction = "save" | "unsave" | "dismiss" | "link" | "sector" | "not-relevant";

/** Apply a UI action. For "link", appends the story as a signal on the
 * target company (mirrors the filings Keep mechanism in market-db) and
 * records linked_company_id. Returns the linked company, when relevant. */
export async function applyNewsAction(
  id: string,
  action: NewsAction,
  companyId?: string,
  newSector?: string
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
  if (action === "not-relevant") {
    // Hides the story (same permanence as dismiss) AND teaches the
    // scorer: source −4, up to three distinctive headline topics −2.
    await db`UPDATE mi_news SET dismissed = TRUE WHERE id = ${id}`;
    await recordNotRelevantFeedback(str(item.source_name), str(item.headline));
    return { ok: true };
  }
  if (action === "sector") {
    // "Wrong sector?" — Ethan's correction pins this article (the
    // reclassify pass never overwrites a corrected row) and is stored
    // with the story's distinctive terms so the same vocabulary votes
    // for the corrected sector in future classifications.
    const target = String(newSector ?? "");
    if (!(NEWS_SECTORS as readonly string[]).includes(target)) {
      return { ok: false, error: `Unknown sector "${target}"` };
    }
    const terms = extractCorrectionTerms(str(item.headline), str(item.summary));
    await db`
      UPDATE mi_news
      SET sector = ${target}, sector_corrected = TRUE, sector_confidence = 1
      WHERE id = ${id}`;
    await db`
      INSERT INTO mi_news_corrections (id, news_id, from_sector, to_sector, terms)
      VALUES (${newId()}, ${id}, ${item.sector ? str(item.sector) : null}, ${target}, ${JSON.stringify(terms)}::jsonb)`;
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

/* ---------------- reclassify pass (News overhaul, Oct 17, 2026) ------ */

export interface ReclassifyReport {
  total: number;
  updated: number;
  sectorBefore: Record<string, number>;
  sectorAfter: Record<string, number>;
  sectorChanged: number;
  hardExcluded: number;
  hardByCategory: Record<string, number>;
  belowThreshold: number;
  noUrl: number;
  lowConfidence: number;
  scoreBuckets: Record<string, number>;
  korea: {
    id: string;
    headline: string;
    from: string | null;
    to: string | null;
    confidence: number;
    score: number;
  } | null;
}

/** Re-run the sector classifier + relevance model over EVERY stored
 * story (headline + stored summary + raw snippet — the text the
 * original ingest held, plus the agent summary written since). Rows
 * Ethan corrected by hand keep their sector (sector_corrected) but are
 * still re-scored. Returns a full before/after report for the
 * checkpoint; the route logs a one-line verdict to mi_sync_log. */
export async function reclassifyAllNews(): Promise<ReclassifyReport> {
  await ensureNewsSchema();
  const db = sql();
  const state = await loadClassifierState();
  const rows = (await db`
    SELECT id, headline, summary, raw_snippet, source_name, url, sector,
           sector_corrected, matched, published_at, relevance_score,
           hard_excluded
    FROM mi_news ORDER BY fetched_at DESC`) as unknown as Record<string, unknown>[];

  const report: ReclassifyReport = {
    total: rows.length,
    updated: 0,
    sectorBefore: {},
    sectorAfter: {},
    sectorChanged: 0,
    hardExcluded: 0,
    hardByCategory: {},
    belowThreshold: 0,
    noUrl: 0,
    lowConfidence: 0,
    scoreBuckets: {},
    korea: null,
  };

  for (const r of rows) {
    const id = str(r.id);
    const headline = str(r.headline);
    const summary = r.summary ? str(r.summary) : "";
    const snippet = str(r.raw_snippet);
    const sourceName = str(r.source_name);
    const beforeSector = r.sector ? str(r.sector) : null;
    const corrected = Boolean(r.sector_corrected);
    const matchedTypes = parseJsonArray(r.matched)
      .filter((m): m is Record<string, unknown> => !!m && typeof m === "object")
      .map((m) => str(m.type));
    const publishedAt = r.published_at ? new Date(str(r.published_at)).toISOString() : null;

    report.sectorBefore[beforeSector ?? "(null)"] = (report.sectorBefore[beforeSector ?? "(null)"] ?? 0) + 1;
    if (!str(r.url)) report.noUrl++;

    const verdict = classifySector(headline, summary, snippet, state.corrections);
    const sector = corrected && beforeSector ? beforeSector : verdict.sector;
    const confidence = corrected ? 1 : verdict.confidence;
    if (verdict.lowConfidence && !corrected) report.lowConfidence++;

    const rel = scoreRelevance({
      headline,
      summary,
      snippet,
      sector,
      matchedTypes,
      publishedAt,
    });
    let score = rel.score;
    let reason = rel.reason;
    let dealSignal = rel.dealSignal;
    const hard = rel.hardExclude;
    if (!hard) {
      const delta = feedbackDelta(sourceName, headline, state.adjustments);
      if (delta !== 0) {
        score = Math.max(0, Math.min(100, score + delta));
        reason = `${reason} · Feedback ${delta}`;
      }
    } else {
      score = 0;
      dealSignal = false;
      report.hardExcluded++;
      report.hardByCategory[hard.category] = (report.hardByCategory[hard.category] ?? 0) + 1;
    }
    if (!hard && score < NEWS_MIN_RELEVANCE) report.belowThreshold++;
    const bucket = score >= 80 ? "80-100" : score >= 60 ? "60-79" : score >= NEWS_MIN_RELEVANCE ? "35-59" : "0-34";
    report.scoreBuckets[bucket] = (report.scoreBuckets[bucket] ?? 0) + 1;
    report.sectorAfter[sector] = (report.sectorAfter[sector] ?? 0) + 1;
    if (sector !== beforeSector) report.sectorChanged++;
    if (/korea/i.test(headline) && !report.korea) {
      report.korea = { id, headline, from: beforeSector, to: sector, confidence, score };
    }

    const tagsJson = JSON.stringify(verdict.tags);
    const oldScore = Number(r.relevance_score ?? 0);
    const wasHard = Boolean(r.hard_excluded);
    if (
      sector !== beforeSector ||
      score !== oldScore ||
      !!hard !== wasHard
    ) {
      await db`
        UPDATE mi_news SET
          sector = ${sector},
          sector_confidence = ${confidence},
          sector_tags = ${tagsJson}::jsonb,
          relevance_score = ${score},
          relevance_reason = ${reason},
          deal_signal = ${dealSignal},
          hard_excluded = ${!!hard},
          hard_reason = ${hard ? hard.label : null}
        WHERE id = ${id}`;
      report.updated++;
    }
  }
  return report;
}

/**
 * Business Development hub summaries (navigation restructure).
 *
 * Compact, pre-aggregated read models for the /business-development
 * hub sections. Every function returns ONLY the small fields the hub
 * renders — no notes, no summaries, no raw payloads — and aggregates
 * in SQL (or via the existing summary services) instead of loading
 * whole tables into memory:
 *
 * - Pipeline: deals are read with an explicit column list (the value
 *   inputs only) and valued with resolveDealValue — the same
 *   resolution /api/deals consumers (Pipeline, Overview) use.
 * - Market: fits reuse getFitCompanies (its own SQL ordering + cap),
 *   multiples reuse getMultiples, tailwind reuses getTailwindReport.
 * - Activity: deal_flow counts + latest rows via targeted SQL.
 *
 * Staleness: STALE_DEAL_DAYS mirrors evalStalled in lib/push-evals.ts
 * — an open deal (stage not "Closed Won" / "Passed") whose updatedAt
 * is 30+ days old is stalled. This module re-declares the threshold
 * (push-evals does not export it) rather than inventing a new one;
 * if the evaluator's threshold changes, change this one with it.
 */

import { neon } from "@neondatabase/serverless";
import { DEAL_STAGES, type Deal, type DealFlowKind } from "../types";
import { resolveDealValue, type MarketRates } from "../valuation";
import {
  getFitCompanies,
  getIndicatorSeries,
  getMultiples,
} from "../market-db";
import { getTailwindReport } from "../tailwind";
import { FOCUS_SECTOR_NAMES } from "../sector-colors";

/** Stalled-deal threshold in days — see evalStalled (lib/push-evals). */
export const STALE_DEAL_DAYS = 30;

const DAY_MS = 864e5;

function sql() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  return neon(url);
}

const hasDb = () => Boolean(process.env.DATABASE_URL);
const str = (v: unknown): string => String(v ?? "");
const numOrNull = (v: unknown): number | null =>
  v === null || v === undefined || v === "" ? null : Number(v);
const iso = (v: unknown): string => {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString();
  return String(v);
};

/* ---------------- Pipeline ---------------- */

export interface BdPipelineStage {
  stage: string;
  count: number;
  value: number;
}

export interface BdStaleDeal {
  id: string;
  name: string;
  stage: string;
  daysStale: number;
}

export interface BdPipelineSummary {
  stages: BdPipelineStage[];
  staleDeals: BdStaleDeal[];
  totals: { openDeals: number; staleCount: number };
}

/** The deal columns resolveDealValue + the hub actually need — never
 * notes / contact details / synthesis text. */
function rowToDealLite(r: Record<string, unknown>): Deal {
  return {
    id: str(r.id),
    companyName: str(r.company_name),
    industry: str(r.industry),
    stage: (str(r.stage) || "Sourcing") as Deal["stage"],
    dealValue: Number(r.deal_value ?? 0),
    drivers:
      r.drivers && typeof r.drivers === "object"
        ? (r.drivers as Deal["drivers"])
        : {},
    structure:
      r.structure && typeof r.structure === "object"
        ? (r.structure as Deal["structure"])
        : {},
    metrics:
      r.metrics && typeof r.metrics === "object"
        ? (r.metrics as Deal["metrics"])
        : {},
    synthesis: null,
    revenue: numOrNull(r.revenue),
    ebitda: numOrNull(r.ebitda),
    askingPrice: numOrNull(r.asking_price),
    growthPct: numOrNull(r.growth_pct),
    broker: "",
    source: "",
    contactName: "",
    contactEmail: "",
    notes: "",
    owner: "",
    city: str(r.city),
    lat: null,
    lng: null,
    links: [],
    operatorIds: [],
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
  };
}

async function loadDealsLite(): Promise<Deal[]> {
  if (hasDb()) {
    const db = sql();
    const rows = await db`
      SELECT id, company_name, industry, stage, deal_value, revenue,
             ebitda, asking_price, growth_pct, drivers, structure,
             metrics, city, created_at, updated_at
      FROM deals ORDER BY updated_at DESC`;
    return (rows as unknown as Record<string, unknown>[]).map(rowToDealLite);
  }
  // Local JSON fallback (no DATABASE_URL): the router's getDeals is
  // the only read path in that mode.
  const { getDeals } = await import("../db");
  return getDeals();
}

async function loadRates(): Promise<MarketRates | undefined> {
  try {
    const rows = await getIndicatorSeries(["DPRIME"]);
    const valid = rows
      .filter((o) => o.seriesId === "DPRIME" && o.value !== null)
      .sort((a, b) => a.obsDate.localeCompare(b.obsDate));
    const prime = valid.length ? valid[valid.length - 1].value : null;
    if (prime === null || prime === undefined) return undefined;
    return { prime, sba: Math.round((prime + 3) * 100) / 100 };
  } catch {
    return undefined;
  }
}

export async function getBdPipelineSummary(): Promise<BdPipelineSummary> {
  const [deals, multiples, rates] = await Promise.all([
    loadDealsLite(),
    getMultiples().catch(() => [] as Awaited<ReturnType<typeof getMultiples>>),
    loadRates(),
  ]);

  const byStage = new Map<string, BdPipelineStage>();
  for (const stage of DEAL_STAGES) {
    byStage.set(stage, { stage, count: 0, value: 0 });
  }
  const now = Date.now();
  const stale: BdStaleDeal[] = [];
  let openDeals = 0;

  for (const d of deals) {
    const bucket = byStage.get(d.stage);
    if (bucket) {
      bucket.count += 1;
      bucket.value += resolveDealValue(d, multiples, rates).value ?? 0;
    }
    const isOpen = d.stage !== "Closed Won" && d.stage !== "Passed";
    if (!isOpen) continue;
    openDeals += 1;
    // evalStalled: open deal, updatedAt at or before now − 30 days.
    const updated = Date.parse(d.updatedAt);
    if (isFinite(updated) && updated <= now - STALE_DEAL_DAYS * DAY_MS) {
      stale.push({
        id: d.id,
        name: d.companyName,
        stage: d.stage,
        daysStale: Math.floor((now - updated) / DAY_MS),
      });
    }
  }
  stale.sort((a, b) => b.daysStale - a.daysStale);

  return {
    stages: DEAL_STAGES.map((s) => byStage.get(s) as BdPipelineStage),
    staleDeals: stale.slice(0, 8),
    totals: { openDeals, staleCount: stale.length },
  };
}

/* ---------------- Market Intel ---------------- */

export interface BdFitItem {
  id: string;
  name: string;
  sector: string;
  city: string;
}

export interface BdMultipleRow {
  sector: string;
  evEbitda: number | null;
  period: string;
}

export interface BdTailwindRow {
  sector: string;
  score: number | null;
}

export interface BdUpcomingEvent {
  title: string;
  date: string;
}

export interface BdMarketSummary {
  fitTotal: number;
  topFits: BdFitItem[];
  multiples: BdMultipleRow[];
  tailwind: BdTailwindRow[];
  upcomingEvents: BdUpcomingEvent[];
}

function splitIndustry(ind: string): [string, string] {
  const marker = " — ";
  const i = ind.indexOf(marker);
  if (i < 0) return [ind.trim(), ""];
  return [ind.slice(0, i).trim(), ind.slice(i + marker.length).trim()];
}

function median(vals: number[]): number | null {
  if (!vals.length) return null;
  const s = vals.slice().sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Compact multiples snapshot: one EV/EBITDA median per focus sector
 * from the ExitValue rows (the Market Intel base series), using the
 * same group-median the Industries explorer chart shows. Hospitality
 * deals sit in the "Consumer & Retail" multiples group. */
function multiplesSnapshot(
  multiples: Awaited<ReturnType<typeof getMultiples>>
): BdMultipleRow[] {
  const groupFor: Record<string, string> = {
    "Aerospace & Defense": "Aerospace & Defense",
    Healthcare: "Healthcare",
    "Advanced Manufacturing": "Advanced Manufacturing",
    "Specialty Trades & Construction": "Specialty Trades & Construction",
    Hospitality: "Consumer & Retail",
  };
  const evRows = multiples.filter((m) => m.sourceReport.includes("ExitValue"));
  const pool = evRows.length ? evRows : multiples;
  return FOCUS_SECTOR_NAMES.map((sector) => {
    const group = groupFor[sector] ?? sector;
    const vals: number[] = [];
    let period = "";
    for (const m of pool) {
      const [g] = splitIndustry(m.industry);
      if (g !== group) continue;
      if (m.evEbitdaMedian !== null && m.evEbitdaMedian !== undefined) {
        vals.push(m.evEbitdaMedian);
        if ((m.period || "") > period) period = m.period || "";
      }
    }
    const med = median(vals);
    return {
      sector,
      evEbitda: med === null ? null : Math.round(med * 10) / 10,
      period,
    };
  }).slice(0, 5);
}

/** Next market events from the econ-events source: mi_acquisitions
 * rows written by the econ_events ingest (expansions, contracts,
 * relocations, IPOs, policy, investments) plus acquisitions — the
 * most recently announced first, headline as the title. Selected
 * columns only. */
async function upcomingEvents(): Promise<BdUpcomingEvent[]> {
  if (!hasDb()) return [];
  try {
    const db = sql();
    const rows = await db`
      SELECT headline, target, announced_date FROM mi_acquisitions
      WHERE status <> 'dismissed' AND announced_date <> ''
      ORDER BY announced_date DESC, created_at DESC LIMIT 5`;
    return (rows as unknown as Record<string, unknown>[]).map((r) => ({
      title: str(r.headline) || str(r.target),
      date: str(r.announced_date),
    }));
  } catch {
    return [];
  }
}

export async function getBdMarketSummary(): Promise<BdMarketSummary> {
  const [fits, multiples, tailwindReport, events] = await Promise.all([
    getFitCompanies().catch(() => ({ companies: [], fitTotal: 0 })),
    getMultiples().catch(
      () => [] as Awaited<ReturnType<typeof getMultiples>>
    ),
    getTailwindReport().catch(() => null),
    upcomingEvents(),
  ]);

  const tailwindBySector = new Map<string, number | null>();
  for (const s of tailwindReport?.sectors ?? []) {
    tailwindBySector.set(s.sector, s.score);
  }

  return {
    fitTotal: fits.fitTotal,
    // getFitCompanies already orders by date_added DESC (the fits
    // view ordering) and caps at FITS_DISPLAY_LIMIT — take the top 8.
    topFits: fits.companies.slice(0, 8).map((c) => ({
      id: c.id,
      name: c.name,
      sector: c.sector,
      city: c.city,
    })),
    multiples: multiplesSnapshot(multiples),
    tailwind: FOCUS_SECTOR_NAMES.map((sector) => ({
      sector,
      score: tailwindBySector.has(sector)
        ? (tailwindBySector.get(sector) as number | null)
        : null,
    })),
    upcomingEvents: events,
  };
}

/* ---------------- Activity ---------------- */

export interface BdActivityItem {
  id: string;
  kind: DealFlowKind;
  title: string;
  createdAt: string;
  isNew: boolean;
}

export interface BdActivitySummary {
  counts: {
    businessesForSale: number;
    operatorsAvailable: number;
    marketNotes: number;
  };
  items: BdActivityItem[];
}

/**
 * Counts + latest items from the deal-flow store. The Activity page's
 * unread definition drives both: an item is "new" while it is still
 * in status 'new' AND has never been seen (read_at IS NULL) — the
 * same predicate behind the app-icon badge.
 */
export async function getBdActivitySummary(): Promise<BdActivitySummary> {
  if (hasDb()) {
    const db = sql();
    const countRows = (await db`
      SELECT kind, COUNT(*)::int AS c FROM deal_flow
      WHERE status = 'new' AND read_at IS NULL
      GROUP BY kind`) as unknown as Record<string, unknown>[];
    const counts = {
      businessesForSale: 0,
      operatorsAvailable: 0,
      marketNotes: 0,
    };
    for (const r of countRows) {
      const c = Number(r.c ?? 0);
      if (r.kind === "business_for_sale") counts.businessesForSale = c;
      else if (r.kind === "operator_available") counts.operatorsAvailable = c;
      else if (r.kind === "market_note") counts.marketNotes = c;
    }
    const itemRows = (await db`
      SELECT id, kind, title, created_at, status, read_at FROM deal_flow
      WHERE status <> 'dismissed'
      ORDER BY created_at DESC LIMIT 8`) as unknown as Record<
      string,
      unknown
    >[];
    const items: BdActivityItem[] = itemRows.map((r) => ({
      id: str(r.id),
      kind: str(r.kind) as DealFlowKind,
      title: str(r.title),
      createdAt: iso(r.created_at),
      isNew: str(r.status) === "new" && (r.read_at === null || r.read_at === undefined),
    }));
    return { counts, items };
  }

  const { getDealFlow } = await import("../db");
  const all = await getDealFlow();
  const isUnreadNew = (i: { status: string; readAt: string | null }) =>
    i.status === "new" && !i.readAt;
  return {
    counts: {
      businessesForSale: all.filter(
        (i) => i.kind === "business_for_sale" && isUnreadNew(i)
      ).length,
      operatorsAvailable: all.filter(
        (i) => i.kind === "operator_available" && isUnreadNew(i)
      ).length,
      marketNotes: all.filter(
        (i) => i.kind === "market_note" && isUnreadNew(i)
      ).length,
    },
    items: all
      .filter((i) => i.status !== "dismissed")
      .slice(0, 8)
      .map((i) => ({
        id: i.id,
        kind: i.kind,
        title: i.title,
        createdAt: i.createdAt,
        isNew: isUnreadNew(i),
      })),
  };
}

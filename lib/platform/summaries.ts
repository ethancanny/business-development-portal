import { sql, str, num, isoOrNull } from "./db";
import { cacheInvalidate, cached } from "./cache";
import { CACHE_TTLS } from "./config";
import { logUsage } from "./usage";
import { DEAL_STAGES } from "../types";
import {
  emptyOverviewSummary,
  type CapitalStack,
  type CompanyCard,
  type NeedsAttentionItem,
  type OverviewSummary,
  type RagStatus,
} from "./types";

/**
 * Overview summary builder. refreshOverviewSummary() recomputes the
 * core.overview_summary row + core.company_cards rollup from legacy +
 * core tables; getOverview() only READS those summary tables (rules:
 * never recompute on page load). Refresh runs from the
 * 'refresh_overview_summary' job, enqueued by platform events.
 */

/** YYYY-MM-DD in America/Phoenix (portal times are Arizona time). */
export function phoenixToday(d: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Phoenix",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

function addDays(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

interface DealStructureShape {
  cashAmt?: number | null;
  sellerAmt?: number | null;
  earnoutAmt?: number | null;
  rolloverAmt?: number | null;
  cashPct?: number | null;
  sellerPct?: number | null;
  earnoutPct?: number | null;
  rolloverPct?: number | null;
}

/**
 * Capital stack for one deal from its structure JSONB. Mapping (Phase 1):
 * equity = cashAmt (+ earnoutAmt folded into equity), sellerNote =
 * sellerAmt, rollover = rolloverAmt, debt = 0 (senior debt is not modeled
 * in the legacy structure shape). When no amounts are present but percents
 * are, percents apply to deal_value (fallback asking_price).
 */
function stackFor(
  dealValue: number,
  askingPrice: number | null,
  structure: unknown
): { debt: number; equity: number; sellerNote: number; rollover: number; total: number } {
  const s: DealStructureShape =
    structure && typeof structure === "object"
      ? (structure as DealStructureShape)
      : {};
  const amt = (v: number | null | undefined): number =>
    typeof v === "number" && isFinite(v) ? v : 0;
  let equity = amt(s.cashAmt);
  let sellerNote = amt(s.sellerAmt);
  let rollover = amt(s.rolloverAmt);
  const earnout = amt(s.earnoutAmt);
  const hasAmounts = equity > 0 || sellerNote > 0 || rollover > 0 || earnout > 0;
  if (!hasAmounts) {
    const base = dealValue > 0 ? dealValue : askingPrice ?? 0;
    equity = (base * amt(s.cashPct)) / 100;
    sellerNote = (base * amt(s.sellerPct)) / 100;
    rollover = (base * amt(s.rolloverPct)) / 100;
    equity += (base * amt(s.earnoutPct)) / 100;
  } else {
    equity += earnout;
  }
  const debt = 0;
  return { debt, equity, sellerNote, rollover, total: debt + equity + sellerNote + rollover };
}

export async function refreshOverviewSummary(): Promise<OverviewSummary> {
  const db = sql();
  const today = phoenixToday();
  const in7 = addDays(today, 7);

  /* ---- deal counts ---- */
  const stageRows = await db`
    SELECT stage, count(*)::int AS n FROM deals GROUP BY stage`;
  const dealsByStage: Record<string, number> = {};
  let totalDeals = 0;
  for (const r of stageRows) {
    const rec = r as Record<string, unknown>;
    dealsByStage[str(rec.stage)] = num(rec.n);
    totalDeals += num(rec.n);
  }

  /* ---- tasks ---- */
  const taskRows = await db`
    SELECT
      count(*)::int AS open,
      count(*) FILTER (
        WHERE due_date <> '' AND due_date >= ${today} AND due_date <= ${in7}
      )::int AS upcoming
    FROM tasks WHERE done = false`;
  const openTasks = taskRows.length ? num(taskRows[0].open) : 0;
  const upcomingFollowUps = taskRows.length ? num(taskRows[0].upcoming) : 0;

  /* ---- capital ---- */
  const capRows = await db`
    SELECT
      coalesce(sum(CASE
        WHEN stage IN ('Sourcing', 'Initial Contact', 'Diligence', 'Negotiation', 'Closing')
        THEN coalesce(NULLIF(deal_value, 0), asking_price, 0) ELSE 0 END), 0) AS needed,
      coalesce(sum(CASE
        WHEN stage = 'Closed Won'
        THEN coalesce(NULLIF(deal_value, 0), asking_price, 0) ELSE 0 END), 0) AS committed
    FROM deals WHERE stage <> 'Passed'`;
  const capitalNeeded = capRows.length ? num(capRows[0].needed) : 0;
  const capitalCommitted = capRows.length ? num(capRows[0].committed) : 0;

  const stackRows = await db`
    SELECT d.id AS deal_id, d.company_name, d.deal_value, d.asking_price,
      d.structure, cd.company_id AS company_id
    FROM deals d
    LEFT JOIN core.deals cd ON cd.id = d.id
    WHERE d.stage <> 'Passed'
    ORDER BY d.updated_at DESC
    LIMIT 12`;
  const capitalStacks: CapitalStack[] = stackRows.map((r) => {
    const rec = r as Record<string, unknown>;
    const stack = stackFor(
      num(rec.deal_value),
      rec.asking_price === null || rec.asking_price === undefined
        ? null
        : num(rec.asking_price),
      rec.structure
    );
    return {
      dealId: str(rec.deal_id),
      companyId: rec.company_id ? str(rec.company_id) : null,
      companyName: str(rec.company_name),
      ...stack,
    };
  });

  /* ---- heatmap: vertical (industry) × stage ---- */
  const heatRows = await db`
    SELECT industry, stage, count(*)::int AS n
    FROM deals GROUP BY industry, stage`;
  const verticalSet = new Set<string>();
  const cells: Record<string, number> = {};
  for (const r of heatRows) {
    const rec = r as Record<string, unknown>;
    const vertical = str(rec.industry) || "Unspecified";
    verticalSet.add(vertical);
    cells[`${vertical}|${str(rec.stage)}`] = num(rec.n);
  }
  const heatmap = {
    verticals: Array.from(verticalSet).sort(),
    stages: [...DEAL_STAGES],
    cells,
  };

  /* ---- portfolio RAG ----
   * Phase 1 heuristic ONLY (real KPI-based RAG arrives with Portfolio
   * Monitoring in Phase 8): a portfolio company is green when its latest
   * activity (core.activity_log, falling back to the company row's
   * updated_at) is < 14 days old, amber < 30 days, red otherwise. */
  const portfolioRows = await db`
    SELECT c.id, c.updated_at,
      (SELECT max(a.created_at) FROM core.activity_log a
        WHERE a.entity_id = c.id) AS last_act
    FROM core.companies c
    WHERE c.stage = 'portfolio' AND c.deleted_at IS NULL`;
  const ragCounts = { green: 0, amber: 0, red: 0 };
  const nowMs = Date.now();
  for (const r of portfolioRows) {
    const rec = r as Record<string, unknown>;
    const lastIso = isoOrNull(rec.last_act) ?? isoOrNull(rec.updated_at);
    const ageDays = lastIso
      ? (nowMs - new Date(lastIso).getTime()) / 86400000
      : Number.POSITIVE_INFINITY;
    const rag: RagStatus = ageDays < 14 ? "green" : ageDays < 30 ? "amber" : "red";
    ragCounts[rag] += 1;
    await db`UPDATE core.companies SET rag = ${rag} WHERE id = ${str(rec.id)}`;
  }
  await db`
    UPDATE core.companies SET rag = NULL
    WHERE stage <> 'portfolio' AND rag IS NOT NULL`;
  const portfolioCount = portfolioRows.length;

  /* ---- needs attention ---- */
  const needsAttention: NeedsAttentionItem[] = [];
  const overdueRows = await db`
    SELECT id, title, due_date, owner FROM tasks
    WHERE done = false AND due_date <> '' AND due_date < ${today}
    ORDER BY due_date ASC LIMIT 5`;
  for (const r of overdueRows) {
    const rec = r as Record<string, unknown>;
    needsAttention.push({
      kind: "overdue_task",
      label: str(rec.title),
      detail: `Due ${str(rec.due_date)}${str(rec.owner) ? ` · ${str(rec.owner)}` : ""}`,
      href: "/overview",
      at: str(rec.due_date),
    });
  }
  const stalledRows = await db`
    SELECT id, company_name, stage, updated_at FROM deals
    WHERE stage NOT IN ('Passed', 'Closed Won')
      AND updated_at < now() - interval '45 days'
    ORDER BY updated_at ASC LIMIT 5`;
  for (const r of stalledRows) {
    const rec = r as Record<string, unknown>;
    needsAttention.push({
      kind: "stalled_deal",
      label: str(rec.company_name),
      detail: `In ${str(rec.stage)} for 45+ days`,
      href: "/pipeline",
      at: isoOrNull(rec.updated_at) ?? "",
    });
  }

  /* ---- company cards rollup ----
   * Rebuilt as one SQL statement: the card JSON is assembled in Postgres
   * so ~9k fit companies don't round-trip through this process. */
  await db`
    DELETE FROM core.company_cards
    WHERE company_id NOT IN (
      SELECT id FROM core.companies WHERE deleted_at IS NULL
    )`;
  await db`
    INSERT INTO core.company_cards (company_id, data, updated_at)
    SELECT s.id, jsonb_build_object(
      'id', s.id,
      'name', s.name,
      'vertical', s.vertical,
      'stage', s.stage,
      'dealStage', s.deal_stage,
      'city', s.city,
      'state', s.state,
      'lat', s.lat,
      'lng', s.lng,
      'thesisFit', s.thesis_fit,
      'ownerContext', s.owner_context,
      'nextAction', CASE WHEN s.next_action <> '' THEN s.next_action
        ELSE coalesce(s.nt_title, '') END,
      'lastActivityAt', greatest(s.updated_at, coalesce(s.last_act, s.updated_at)),
      'rag', CASE WHEN s.stage = 'portfolio' THEN s.rag ELSE NULL END,
      'logoUrl', s.logo_url,
      'heroUrl', s.hero_url,
      'logoVersion', coalesce(s.logo_version, 0),
      'logoSource', coalesce(s.logo_source, ''),
      'accentColor', coalesce(s.accent_color, ''),
      'accentSuggested', coalesce(s.accent_suggested, ''),
      'website', coalesce(s.website, '')
    ), now()
    FROM (
      SELECT c.*,
        (SELECT max(a.created_at) FROM core.activity_log a
          WHERE a.entity_id = c.id) AS last_act,
        (SELECT t.title FROM tasks t
          WHERE t.related_id = c.legacy_deal_id AND t.done = false
          ORDER BY (t.due_date = '') ASC, t.due_date ASC
          LIMIT 1) AS nt_title
      FROM core.companies c
      WHERE c.deleted_at IS NULL
    ) s
    ON CONFLICT (company_id) DO UPDATE
      SET data = EXCLUDED.data, updated_at = now()`;

  /* ---- store the summary ---- */
  const summary: OverviewSummary = {
    dealsByStage,
    totalDeals,
    openTasks,
    upcomingFollowUps,
    capitalCommitted,
    capitalNeeded,
    portfolioCount,
    ragCounts,
    heatmap,
    capitalStacks,
    needsAttention,
    updatedAt: new Date().toISOString(),
  };
  await db`
    INSERT INTO core.overview_summary (id, data, updated_at)
    VALUES ('main', ${JSON.stringify(summary)}::jsonb, now())
    ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`;
  cacheInvalidate("overview");
  logUsage("refresh_overview_summary", portfolioRows.length + stageRows.length, 0);
  return summary;
}

/**
 * Read path for the Overview API: summary row + a page of company cards,
 * served from the summary tables only. A missing summary row returns the
 * empty shape (updatedAt null) — reads NEVER trigger a recompute.
 */
export async function getOverview(
  cardsLimit = 24
): Promise<{ summary: OverviewSummary; cards: CompanyCard[] }> {
  const lim = Math.min(50, Math.max(1, cardsLimit || 24));
  return cached(`overview:data:${lim}`, CACHE_TTLS.overview, async () => {
    const db = sql();
    const sumRows = await db`
      SELECT data FROM core.overview_summary WHERE id = 'main' LIMIT 1`;
    let summary = emptyOverviewSummary();
    if (sumRows.length) {
      const raw = sumRows[0].data;
      const parsed =
        typeof raw === "string" ? (JSON.parse(raw) as OverviewSummary) : raw;
      if (parsed && typeof parsed === "object") {
        summary = { ...emptyOverviewSummary(), ...(parsed as OverviewSummary) };
      }
    }
    const cardRows = await db`
      SELECT data FROM core.company_cards
      ORDER BY (data ->> 'lastActivityAt') DESC NULLS LAST
      LIMIT ${lim}`;
    const cards = cardRows.map((r) => {
      const raw = (r as Record<string, unknown>).data;
      return (typeof raw === "string" ? JSON.parse(raw) : raw) as CompanyCard;
    });
    logUsage(
      "overview",
      cards.length + sumRows.length,
      JSON.stringify(summary).length + JSON.stringify(cards).length
    );
    return { summary, cards };
  });
}

import { sql, str, num, isoOrNull } from "./db";
import { bumpDatasets } from "./versions";
import { cacheInvalidate, cached } from "./cache";
import { CACHE_TTLS } from "./config";
import { logUsage } from "./usage";
import {
  DEAL_STAGES,
  DEFAULT_STAGES_BY_TYPE,
  INVESTMENT_TYPE_LABELS,
  type InvestmentTypeKey,
} from "../types";
import { getDeals } from "../db";
import { getMultiples } from "../market-db";
import { resolveDealValue, type MarketRates } from "../valuation";
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

  /* ---- capital ----
   * Stage names fixed Oct 25, 2026 (Overview redesign): the lists
   * still carried the pre–Investment-Types names (Sourcing / Initial
   * Contact / Negotiation / Closing / Closed Won), so after the
   * Step 1 migration only 'Diligence' matched and both figures were
   * materially wrong. Needed = every ACTIVE stage (new + legacy
   * names); committed = Closed (+ legacy Closed Won).
   * Needed AND committed are RECOMPUTED from resolveDealValue
   * in the redesign block below (Ethan, Oct 25, 2026: align
   * Capital needed to resolved deal values; committed aligned
   * the same way later that day); the SQL figures here are
   * only the fallbacks if that block fails. */
  const capRows = await db`
    SELECT
      coalesce(sum(CASE
        WHEN stage IN ('Sourced', 'IOI', 'Diligence', 'LOI', 'Financing',
                       'Sourcing', 'Initial Contact', 'Negotiation', 'Closing')
        THEN coalesce(NULLIF(deal_value, 0), asking_price, 0) ELSE 0 END), 0) AS needed,
      coalesce(sum(CASE
        WHEN stage IN ('Closed', 'Closed Won')
        THEN coalesce(NULLIF(deal_value, 0), asking_price, 0) ELSE 0 END), 0) AS committed
    FROM deals WHERE stage <> 'Passed'`;
  let capitalNeeded = capRows.length ? num(capRows[0].needed) : 0;
  let capitalCommitted = capRows.length ? num(capRows[0].committed) : 0;

  const stackRows = await db`
    SELECT d.id AS deal_id, d.company_name, d.deal_value, d.asking_price,
      d.structure, cd.company_id AS company_id,
      coalesce(cc.logo_version, 0) AS logo_version
    FROM deals d
    LEFT JOIN core.deals cd ON cd.id = d.id
    LEFT JOIN core.companies cc ON cc.id = cd.company_id
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
      logoVersion: num(rec.logo_version),
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
    WHERE stage NOT IN ('Passed', 'Closed Won', 'Closed')
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

  /* ---- Overview redesign (Oct 25, 2026): pipeline value, funnel,
   * readiness, history ----
   * All of this runs HERE, in the summary refresh — page reads stay
   * summary-only. Every sub-computation is failure-isolated: a
   * missing multiples table or diligence schema degrades that field
   * to its empty value, never the whole summary. */
  const TERMINAL = new Set(["Closed", "Passed", "Closed Won"]);
  let pipelineValue = 0;
  let pipelineValuedCount = 0;
  let dealsInDiligence = 0;
  let funnel: OverviewSummary["funnel"];
  let readinessByDeal: Record<string, number> = {};
  let pipelineHistory: { day: string; value: number }[] = [];
  try {
    const allDeals = await getDeals();
    let multiples: Awaited<ReturnType<typeof getMultiples>> = [];
    try {
      multiples = await getMultiples();
    } catch {
      /* multiples unavailable — stated prices still resolve */
    }
    let rates: MarketRates = {};
    try {
      const primeRows = await db`
        SELECT value FROM mi_indicators
        WHERE series_id = 'DPRIME' AND value IS NOT NULL
        ORDER BY obs_date DESC LIMIT 1`;
      if (primeRows.length) {
        const v = num((primeRows[0] as Record<string, unknown>).value);
        if (v > 0) rates = { prime: v, sba: v + 3 };
      }
    } catch {
      /* rates unavailable — valuation falls back to its defaults */
    }
    const valueOf = new Map<string, number | null>();
    for (const d of allDeals) {
      valueOf.set(d.id, resolveDealValue(d, multiples, rates).value);
    }
    /* Capital needed on resolved values (Ethan, Oct 25, 2026):
     * the legacy capital SQL above sums only the deal_value /
     * asking_price columns, so structure-priced deals (Brightline)
     * were missing from "needed" while pipelineValue counted
     * them. Same stage set the SQL used — active stages, new +
     * legacy names (the SQL's outer filter already excluded
     * Passed) — but each deal contributes its resolved value,
     * exactly as in pipelineValue below; deals whose value does
     * not resolve contribute nothing (never $0-forced). Runs
     * inside this failure-isolated block: if resolution is
     * unavailable, capitalNeeded keeps the SQL fallback above.
     * Committed is recomputed identically right after this —
     * resolved values over Closed / Closed Won (Ethan, Oct 25,
     * 2026: align committed the same way). */
    const NEEDED_STAGES = new Set([
      "Sourced",
      "IOI",
      "Diligence",
      "LOI",
      "Financing",
      "Sourcing",
      "Initial Contact",
      "Negotiation",
      "Closing",
    ]);
    let resolvedNeeded = 0;
    for (const d of allDeals) {
      if (!NEEDED_STAGES.has(d.stage)) continue;
      const v = valueOf.get(d.id);
      if (v !== null && v !== undefined) resolvedNeeded += v;
    }
    capitalNeeded = resolvedNeeded;
    /* Capital committed on resolved values (Ethan, Oct 25,
     * 2026: align committed the same way as needed): the legacy
     * SQL above sums only the deal_value / asking_price columns
     * over Closed / Closed Won, so a structure-priced deal that
     * closes would drop out of "committed" even though its
     * resolved value counted toward pipelineValue while it was
     * active. Same stage set the SQL used; each closed deal
     * contributes its resolved value; deals whose value does
     * not resolve contribute nothing (never $0-forced). Inside
     * this failure-isolated block, so if resolution is
     * unavailable, capitalCommitted keeps the SQL fallback
     * above. No live effect until a deal actually closes. */
    const COMMITTED_STAGES = new Set(["Closed", "Closed Won"]);
    let resolvedCommitted = 0;
    for (const d of allDeals) {
      if (!COMMITTED_STAGES.has(d.stage)) continue;
      const v = valueOf.get(d.id);
      if (v !== null && v !== undefined) resolvedCommitted += v;
    }
    capitalCommitted = resolvedCommitted;
    const active = allDeals.filter((d) => !TERMINAL.has(d.stage));
    for (const d of active) {
      const v = valueOf.get(d.id);
      if (v !== null && v !== undefined) {
        pipelineValue += v;
        pipelineValuedCount += 1;
      }
      if (d.stage === "Diligence") dealsInDiligence += 1;
    }

    /* Funnel: dominant investment type by ACTIVE deal count (ties
     * resolve in type-config order, platform_lbo first). Stages are
     * the type's LIVE list from bd.type_config; counts/values are
     * current-stage, zeros included; Passed is reported separately. */
    try {
      const typeRows = await db`
        SELECT key, label, stages FROM bd.type_config ORDER BY sort ASC, key ASC`;
      const configs = typeRows.map((r) => {
        const rec = r as Record<string, unknown>;
        let stages: string[] = [];
        const raw = rec.stages;
        const parsed =
          typeof raw === "string" ? (JSON.parse(raw) as unknown) : raw;
        if (Array.isArray(parsed)) {
          stages = parsed.map((s) => String(s)).filter(Boolean);
        }
        const key = str(rec.key) as InvestmentTypeKey;
        return {
          key,
          label: str(rec.label) || INVESTMENT_TYPE_LABELS[key] || key,
          stages: stages.length
            ? stages
            : [...(DEFAULT_STAGES_BY_TYPE[key] ?? DEAL_STAGES)],
        };
      });
      if (configs.length) {
        const activeByType = new Map<string, number>();
        for (const d of active) {
          const k = d.investmentType ?? "platform_lbo";
          activeByType.set(k, (activeByType.get(k) ?? 0) + 1);
        }
        let dominant = configs[0];
        for (const c of configs) {
          if (
            (activeByType.get(c.key) ?? 0) >
            (activeByType.get(dominant.key) ?? 0)
          ) {
            dominant = c;
          }
        }
        const ofType = allDeals.filter(
          (d) => (d.investmentType ?? "platform_lbo") === dominant.key
        );
        const stages = dominant.stages.map((stage) => {
          const inStage = ofType.filter((d) => d.stage === stage);
          return {
            stage,
            count: inStage.length,
            value: inStage.reduce((s, d) => s + (valueOf.get(d.id) ?? 0), 0),
          };
        });
        const passedDeals = ofType.filter((d) => d.stage === "Passed");
        funnel = {
          typeKey: dominant.key,
          typeLabel: dominant.label,
          stages: stages.filter((s) => s.stage !== "Passed"),
          passed: {
            count: passedDeals.length,
            value: passedDeals.reduce(
              (s, d) => s + (valueOf.get(d.id) ?? 0),
              0
            ),
          },
          otherTypeDeals: active.filter(
            (d) => (d.investmentType ?? "platform_lbo") !== dominant.key
          ).length,
        };
      }
    } catch (err) {
      console.error(
        "[overview] funnel build failed",
        err instanceof Error ? err.message : String(err)
      );
    }

    /* Readiness: diligence checklist completion per deal. Terminal
     * statuses per the dd-checklist-status-v2 migration note are
     * 'complete' and 'na' ("Done for completion %"). Deals without a
     * workspace or items are ABSENT from the map — no data, not 0%. */
    try {
      const rdRows = await db`
        SELECT w.deal_id AS deal_id,
          count(*)::int AS total,
          count(*) FILTER (WHERE ci.status IN ('complete', 'na'))::int AS done
        FROM diligence.workspaces w
        JOIN diligence.checklist_items ci
          ON ci.workspace_id = w.id AND ci.deleted_at IS NULL
        WHERE w.deleted_at IS NULL
        GROUP BY w.deal_id`;
      const map: Record<string, number> = {};
      for (const r of rdRows) {
        const rec = r as Record<string, unknown>;
        const total = num(rec.total);
        if (total > 0) {
          map[str(rec.deal_id)] = Math.round((num(rec.done) / total) * 100);
        }
      }
      readinessByDeal = map;
    } catch {
      /* diligence schema not built yet — readiness simply absent */
    }

    /* Daily pipeline-value snapshot: upsert TODAY's value (the last
     * refresh of the day wins) and read the trailing 30 days. This
     * is the sparkline's only source — real snapshots from today
     * forward, never backfilled. */
    try {
      await db`
        INSERT INTO core.overview_history (day, pipeline_value, active_deals)
        VALUES (${today}, ${pipelineValue}, ${active.length})
        ON CONFLICT (day) DO UPDATE
          SET pipeline_value = EXCLUDED.pipeline_value,
            active_deals = EXCLUDED.active_deals`;
      const histRows = await db`
        SELECT day, pipeline_value FROM core.overview_history
        ORDER BY day DESC LIMIT 30`;
      pipelineHistory = histRows
        .map((r) => {
          const rec = r as Record<string, unknown>;
          return { day: str(rec.day), value: num(rec.pipeline_value) };
        })
        .reverse();
    } catch {
      /* history table not created yet (older schema) — no trend */
    }
  } catch (err) {
    console.error(
      "[overview] redesign fields build failed",
      err instanceof Error ? err.message : String(err)
    );
  }

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
    pipelineValue,
    pipelineValuedCount,
    dealsInDiligence,
    funnel,
    readinessByDeal,
    pipelineHistory,
  };
  await db`
    INSERT INTO core.overview_summary (id, data, updated_at)
    VALUES ('main', ${JSON.stringify(summary)}::jsonb, now())
    ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`;
  cacheInvalidate("overview");
  logUsage("refresh_overview_summary", portfolioRows.length + stageRows.length, 0);
  // Performance Fix Pass (DESIGN.md §2): "overview" bumps HERE, after
  // the summary write commits — never at event publish time.
  await bumpDatasets("overview");
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

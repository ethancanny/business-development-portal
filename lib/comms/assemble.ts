import { createHash } from "node:crypto";
import { getCompanyFinancials } from "../financials/service";
import { getCurrentAnalysis } from "../finanalysis/service";
import {
  getCovenantTests,
  getKpis,
  getVariance,
} from "../monitoring/analytics";
import { getPortfolioCompany } from "../monitoring/service";
import {
  getPlanByCompany,
  getPlanSummary,
  getValueCreationTargets,
} from "../valuecreation/service";
import { getDealSummary, getOpenRaise } from "../capital/service";
import { getDealReporting } from "../capital/reporting";
import {
  getDealContext,
  getWorkspaceByDeal,
  listFindings,
  listRedFlags,
} from "../diligence/service";
import { getCurrentMemo } from "../diligence/memo";
import type {
  AppendixFigure,
  CommsTemplate,
  FigureFormat,
  RenderBlock,
  ReportRender,
  ReportSubject,
  TemplateBlock,
} from "./types";
import { getSampleDataset, type CommsSectionData } from "./sample";

/**
 * Communications & Reports (Part 12) — report assembly.
 *
 * assembleReport renders a template's blocks for one subject into a
 * ReportRender + appendix. Two data sources feed the SAME block
 * renderers through the Sources interface below:
 * - RealSources: reads ONLY through the owning modules' service
 *   functions (contract list — no cross-module SQL anywhere here).
 * - SampleSources: the canned dataset in lib/comms/sample.ts.
 *
 * Verification rules (contract):
 * - Posted financial-statement figures → 'reviewed'.
 * - Analysis figures: approved analysis → 'reviewed'; a draft
 *   (unapproved) current analysis → 'unreviewed'.
 * - Manual KPIs (kpi_values source 'manual') → 'unreviewed';
 *   financials-sourced KPIs → 'reviewed'.
 * - Sample figures → 'unreviewed' (stamped in sample.ts).
 *
 * Missing data is a block state, never an exception: a block whose
 * source has nothing for the subject renders dataStatus 'missing'
 * (or 'not_applicable' when the block cannot apply to the subject,
 * e.g. variance for a non-portfolio company). assembleReport throws
 * only for programmer errors (no template / no blocks).
 *
 * Figure provenance: sourceId carries the OWNING ENTITY id
 * (companyId / dealId, or 'sample') so the pre-send check can assert
 * structurally that no figure belongs to a different subject
 * (lib/comms/filter.ts, code 'foreign_figure'); record-level
 * provenance (set id, analysis id, period) lives in sourceLabel, and
 * href links to the owning surface.
 */

export interface Sources {
  readonly sample: boolean;
  readonly asOf: string;
  financialSummary(): Promise<CommsSectionData>;
  kpiTable(): Promise<CommsSectionData>;
  varianceTable(): Promise<CommsSectionData>;
  covenantStatus(): Promise<CommsSectionData>;
  planStatus(): Promise<CommsSectionData>;
  capitalStatus(): Promise<CommsSectionData>;
  findings(): Promise<CommsSectionData>;
  memo(): Promise<CommsSectionData>;
}

/* ------------------------------ helpers ------------------------------ */

const MISSING: CommsSectionData = { status: "missing", figures: [] };
const NOT_APPLICABLE: CommsSectionData = {
  status: "not_applicable",
  figures: [],
};

async function safe<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch {
    return null;
  }
}

interface FigSeed {
  key: string;
  label: string;
  value: number | string | null;
  format: FigureFormat;
  sourceModule: string;
  sourceId: string;
  sourceLabel: string;
  href: string;
  verification: "reviewed" | "unreviewed";
  confidence?: number | null;
}

function mkFig(seed: FigSeed): AppendixFigure {
  return {
    key: seed.key,
    label: seed.label,
    value: seed.value,
    format: seed.format,
    sourceModule: seed.sourceModule,
    sourceId: seed.sourceId,
    sourceLabel: seed.sourceLabel,
    href: seed.href,
    verification: seed.verification,
    confidence: seed.confidence ?? null,
  };
}

function pctText(v: number | null): string | null {
  if (v === null || !isFinite(v)) return null;
  return `${v > 0 ? "+" : ""}${v.toFixed(1)}%`;
}

/** finanalysis MetricValue confidence is a word; the appendix stores
 * a number. Mapping is indicative only (display + schedule checks). */
function confidenceNum(c: string | undefined): number | null {
  if (c === "high") return 0.9;
  if (c === "medium") return 0.7;
  if (c === "low") return 0.45;
  return null;
}

/* ---------------------------- real sources --------------------------- */

class RealSources implements Sources {
  readonly sample = false;
  readonly asOf = new Date().toISOString().slice(0, 10);

  constructor(
    private readonly companyId: string | null,
    private readonly dealId: string | null
  ) {}

  private companyHref(): string {
    return this.companyId ? `/companies/${this.companyId}` : "";
  }
  private monitoringHref(): string {
    return this.companyId
      ? `/portfolio-monitoring/${this.companyId}`
      : "";
  }

  async financialSummary(): Promise<CommsSectionData> {
    const companyId = this.companyId;
    if (!companyId) return NOT_APPLICABLE;
    const fin = await safe(() => getCompanyFinancials(companyId));
    if (!fin) return MISSING;
    const hasPosted = fin.sets.some((s) => s.status === "posted");
    if (!hasPosted) return MISSING;
    const { summary } = fin;
    const latest = summary.latest;
    if (!latest) return MISSING;

    const figures: AppendixFigure[] = [];
    const src = {
      sourceModule: "financials",
      sourceId: companyId,
      sourceLabel: `Posted financials${latest.periodEnd ? ` · period ending ${latest.periodEnd}` : ""}`,
      href: this.companyHref(),
      verification: "reviewed" as const,
    };
    const period = summary.periods.find(
      (p) => p.periodEnd === latest.periodEnd
    );
    const kpi = period ? summary.kpis[period.setId] : undefined;
    if (latest.revenue !== null)
      figures.push(mkFig({ key: "fin_revenue_latest", label: "Revenue (latest period)", value: latest.revenue, format: "money", ...src }));
    if (kpi?.grossProfit != null)
      figures.push(mkFig({ key: "fin_gross_profit_latest", label: "Gross profit (latest period)", value: kpi.grossProfit, format: "money", ...src }));
    if (kpi?.grossMarginPct != null)
      figures.push(mkFig({ key: "fin_gross_margin_latest", label: "Gross margin (latest period)", value: kpi.grossMarginPct, format: "pct", ...src }));
    if (latest.ebitda !== null)
      figures.push(mkFig({ key: "fin_ebitda_latest", label: "EBITDA (latest period)", value: latest.ebitda, format: "money", ...src }));
    if (kpi?.ebitdaMarginPct != null)
      figures.push(mkFig({ key: "fin_ebitda_margin_latest", label: "EBITDA margin (latest period)", value: kpi.ebitdaMarginPct, format: "pct", ...src }));
    if (latest.netIncome !== null)
      figures.push(mkFig({ key: "fin_net_income_latest", label: "Net income (latest period)", value: latest.netIncome, format: "money", ...src }));
    if (summary.ttm) {
      if (summary.ttm.revenue !== null)
        figures.push(mkFig({ key: "fin_revenue_ttm", label: "Revenue (TTM)", value: summary.ttm.revenue, format: "money", ...src }));
      if (summary.ttm.ebitda !== null)
        figures.push(mkFig({ key: "fin_ebitda_ttm", label: "EBITDA (TTM)", value: summary.ttm.ebitda, format: "money", ...src }));
      if (summary.ttm.netIncome !== null)
        figures.push(mkFig({ key: "fin_net_income_ttm", label: "Net income (TTM)", value: summary.ttm.netIncome, format: "money", ...src }));
    }
    if (summary.yoy) {
      if (summary.yoy.revenuePct !== null)
        figures.push(mkFig({ key: "fin_revenue_yoy_pct", label: "Revenue growth (YoY)", value: summary.yoy.revenuePct, format: "pct", ...src }));
      if (summary.yoy.ebitdaPct !== null)
        figures.push(mkFig({ key: "fin_ebitda_yoy_pct", label: "EBITDA growth (YoY)", value: summary.yoy.ebitdaPct, format: "pct", ...src }));
    }

    // Analysis figures ride along in the financial summary: adjusted
    // EBITDA + headline metrics from the CURRENT analysis (draft
    // included — that is what makes them 'unreviewed' until the
    // analysis is approved).
    const current = await safe(() => getCurrentAnalysis(companyId));
    if (current) {
      const verification =
        current.analysis.status === "approved"
          ? ("reviewed" as const)
          : ("unreviewed" as const);
      const asrc = {
        sourceModule: "finanalysis",
        sourceId: companyId,
        sourceLabel: `Financial analysis ${current.analysis.id} (${current.analysis.status})`,
        href: this.companyHref(),
        verification,
      };
      const adjusted = current.payload.marginBridge?.adjustedEbitda;
      if (adjusted != null)
        figures.push(mkFig({ key: "fin_adjusted_ebitda", label: "Adjusted EBITDA", value: adjusted, format: "money", ...asrc }));
      const periods = current.payload.metricsByPeriod ?? [];
      const latestMetrics = periods.length
        ? periods[periods.length - 1].metrics
        : [];
      for (const m of latestMetrics) {
        if (m.value === null) continue;
        if (m.unit !== "usd" && m.unit !== "x") continue;
        figures.push(
          mkFig({
            key: `ana_${m.key}`,
            label: m.label,
            value: m.value,
            format: m.unit === "usd" ? "money" : "multiple",
            confidence: confidenceNum(m.confidence),
            ...asrc,
          })
        );
      }
    }

    const revPoints = summary.chartSeries
      .filter((p) => p.revenue !== null)
      .map((p) => ({ x: p.periodEnd ?? p.label, y: p.revenue as number }));
    const ebitdaPoints = summary.chartSeries
      .filter((p) => p.ebitda !== null)
      .map((p) => ({ x: p.periodEnd ?? p.label, y: p.ebitda as number }));
    const chart =
      revPoints.length || ebitdaPoints.length
        ? {
            kind: "bar" as const,
            series: [
              ...(revPoints.length ? [{ name: "Revenue", points: revPoints }] : []),
              ...(ebitdaPoints.length ? [{ name: "EBITDA", points: ebitdaPoints }] : []),
            ],
          }
        : undefined;
    const table = summary.chartSeries.length
      ? {
          columns: ["Period", "Revenue", "EBITDA"],
          rows: summary.chartSeries.map((p) => [
            p.periodEnd ?? p.label,
            p.revenue,
            p.ebitda,
          ]) as (string | number | null)[][],
        }
      : undefined;
    return { status: "ok", figures, chart, table };
  }

  async kpiTable(): Promise<CommsSectionData> {
    const companyId = this.companyId;
    if (!companyId) return NOT_APPLICABLE;
    const pc = await safe(() => getPortfolioCompany(companyId));
    if (pc) {
      const res = await safe(() => getKpis(companyId));
      const latest = res?.periods[0];
      if (!latest || !latest.values.length) return MISSING;
      const figures: AppendixFigure[] = [];
      const rows: (string | number | null)[][] = [];
      for (const v of latest.values) {
        if (v.value === null) continue;
        const isPct = v.unit === "pct" || v.kpiKey.endsWith("_pct");
        // Stored *_pct kpi_values are fractions; appendix/table show
        // percent points (house display convention).
        const display = isPct ? v.value * 100 : v.value;
        figures.push(
          mkFig({
            key: `kpi_${v.kpiKey}`,
            label: v.label,
            value: display,
            format:
              v.unit === "usd"
                ? "money"
                : isPct
                  ? "pct"
                  : v.unit === "x"
                    ? "multiple"
                    : "number",
            sourceModule: "monitoring",
            sourceId: companyId,
            sourceLabel: `KPI · ${latest.periodEnd ?? "latest period"} · source ${v.source}`,
            href: this.monitoringHref(),
            verification: v.source === "financials" ? "reviewed" : "unreviewed",
          })
        );
        rows.push([
          v.label,
          isPct ? `${display.toFixed(1)}%` : display,
          latest.periodEnd,
          v.source,
        ]);
      }
      if (!figures.length) return MISSING;
      return {
        status: "ok",
        figures,
        table: { columns: ["KPI", "Value", "Period", "Source"], rows },
      };
    }
    // Non-portfolio company: KPIs come from the posted financial
    // summary — all reviewed.
    const fin = await safe(() => getCompanyFinancials(companyId));
    const latest = fin?.summary.latest;
    if (!fin || !latest) return MISSING;
    const period = fin.summary.periods.find(
      (p) => p.periodEnd === latest.periodEnd
    );
    const kpi = period ? fin.summary.kpis[period.setId] : undefined;
    if (!kpi) return MISSING;
    const src = {
      sourceModule: "financials",
      sourceId: companyId,
      sourceLabel: `Posted financials${latest.periodEnd ? ` · period ending ${latest.periodEnd}` : ""}`,
      href: this.companyHref(),
      verification: "reviewed" as const,
    };
    const defs: Array<{
      key: string;
      label: string;
      value: number | null;
      format: FigureFormat;
    }> = [
      { key: "kpi_revenue", label: "Revenue", value: kpi.revenue, format: "money" },
      { key: "kpi_gross_profit", label: "Gross profit", value: kpi.grossProfit, format: "money" },
      { key: "kpi_gross_margin_pct", label: "Gross margin", value: kpi.grossMarginPct, format: "pct" },
      { key: "kpi_ebitda", label: "EBITDA", value: kpi.ebitda, format: "money" },
      { key: "kpi_ebitda_margin_pct", label: "EBITDA margin", value: kpi.ebitdaMarginPct, format: "pct" },
      { key: "kpi_net_income", label: "Net income", value: kpi.netIncome, format: "money" },
      { key: "kpi_cash", label: "Cash (period end)", value: kpi.cashEnd, format: "money" },
      { key: "kpi_total_assets", label: "Total assets", value: kpi.totalAssets, format: "money" },
      { key: "kpi_total_liabilities", label: "Total liabilities", value: kpi.totalLiabilities, format: "money" },
    ];
    const figures: AppendixFigure[] = [];
    const rows: (string | number | null)[][] = [];
    for (const d of defs) {
      if (d.value === null) continue;
      figures.push(mkFig({ key: d.key, label: d.label, value: d.value, format: d.format, ...src }));
      rows.push([
        d.label,
        d.format === "pct" ? `${d.value.toFixed(1)}%` : d.value,
        latest.periodEnd,
        "financials",
      ]);
    }
    if (!figures.length) return MISSING;
    return {
      status: "ok",
      figures,
      table: { columns: ["KPI", "Value", "Period", "Source"], rows },
    };
  }

  async varianceTable(): Promise<CommsSectionData> {
    const companyId = this.companyId;
    if (!companyId) return NOT_APPLICABLE;
    const pc = await safe(() => getPortfolioCompany(companyId));
    if (!pc) return NOT_APPLICABLE;
    const variance = await safe(() => getVariance(companyId));
    if (!variance || !variance.rows.length) return MISSING;
    const figures: AppendixFigure[] = [];
    const rows: (string | number | null)[][] = [];
    const notes: string[] = [];
    for (const r of variance.rows) {
      const src = {
        sourceModule: "monitoring",
        sourceId: companyId,
        sourceLabel: `Variance · period ending ${variance.periodEnd}`,
        href: this.monitoringHref(),
        verification: "reviewed" as const,
      };
      if (r.actual !== null)
        figures.push(mkFig({ key: `var_${r.metric}_actual`, label: `${r.label} — actual`, value: r.actual, format: "money", ...src }));
      if (r.budget !== null)
        figures.push(mkFig({ key: `var_${r.metric}_budget`, label: `${r.label} — budget`, value: r.budget, format: "money", ...src }));
      rows.push([
        r.label,
        r.actual,
        r.budget,
        r.vcTarget ?? r.vc,
        r.underwriting,
        pctText(r.variances.actualVsBudget?.pct ?? null),
      ]);
      if (r.commentary) notes.push(`${r.label}: ${r.commentary}`);
    }
    return {
      status: "ok",
      figures,
      table: {
        columns: ["Metric", "Actual", "Budget", "VC target", "Underwriting", "Variance vs budget"],
        rows,
      },
      text: notes.length ? notes.join("\n") : undefined,
    };
  }

  async covenantStatus(): Promise<CommsSectionData> {
    const companyId = this.companyId;
    if (!companyId) return NOT_APPLICABLE;
    const res = await safe(() => getCovenantTests(companyId));
    if (!res || !res.tests.length) return MISSING;
    // Tests arrive newest first — first row per covenant is latest.
    const latestByCovenant = new Map<string, (typeof res.tests)[number]>();
    for (const t of res.tests) {
      if (!latestByCovenant.has(t.covenantId)) {
        latestByCovenant.set(t.covenantId, t);
      }
    }
    const figures: AppendixFigure[] = [];
    const rows: (string | number | null)[][] = [];
    for (const t of Array.from(latestByCovenant.values())) {
      const slug = t.covenantKey || t.covenantId;
      const src = {
        sourceModule: "monitoring",
        sourceId: companyId,
        sourceLabel: `Covenant test${t.periodEnd ? ` · period ending ${t.periodEnd}` : ""}`,
        href: this.monitoringHref(),
        verification: "reviewed" as const,
      };
      if (t.computedValue !== null)
        figures.push(mkFig({ key: `cov_${slug}_value`, label: `${t.label} — computed`, value: t.computedValue, format: "number", ...src }));
      if (t.threshold !== null)
        figures.push(mkFig({ key: `cov_${slug}_threshold`, label: `${t.label} — threshold`, value: t.threshold, format: "number", ...src }));
      rows.push([
        t.label,
        t.computedValue,
        t.threshold,
        t.status,
        t.headroomPct !== null ? `${t.headroomPct.toFixed(1)}%` : null,
      ]);
    }
    return {
      status: "ok",
      figures,
      table: {
        columns: ["Covenant", "Computed", "Threshold", "Status", "Headroom"],
        rows,
      },
    };
  }

  async planStatus(): Promise<CommsSectionData> {
    const companyId = this.companyId;
    if (!companyId) return NOT_APPLICABLE;
    const plan = await safe(() => getPlanByCompany(companyId));
    if (!plan) return MISSING;
    const summary = await safe(() => getPlanSummary(plan.id));
    const targetsRes = await safe(() => getValueCreationTargets(companyId));
    const targets = targetsRes?.targets ?? [];
    if (!summary && !targets.length) return MISSING;
    const src = {
      sourceModule: "valuecreation",
      sourceId: companyId,
      sourceLabel: `Value creation plan "${plan.name}"`,
      href: `/value-creation/${companyId}`,
      verification: "reviewed" as const,
    };
    const figures: AppendixFigure[] = [];
    let text: string | undefined;
    if (summary) {
      const total = Object.values(summary.initiativeCounts).reduce(
        (a, b) => a + b,
        0
      );
      figures.push(mkFig({ key: "plan_initiatives_total", label: "Initiatives (total)", value: total, format: "number", ...src }));
      figures.push(mkFig({ key: "plan_initiatives_open", label: "Initiatives (open)", value: summary.openInitiatives, format: "number", ...src }));
      figures.push(mkFig({ key: "plan_impact_weighted", label: "Weighted EBITDA impact", value: summary.impactWeighted, format: "money", ...src }));
      figures.push(mkFig({ key: "plan_impact_unweighted", label: "Unweighted EBITDA impact", value: summary.impactUnweighted, format: "money", ...src }));
      figures.push(mkFig({ key: "plan_one_time_cost", label: "One-time cost (total)", value: summary.totalOneTimeCost, format: "money", ...src }));
      const counts = Object.entries(summary.initiativeCounts)
        .map(([k, v]) => `${v} ${k}`)
        .join(", ");
      text = `Value creation plan "${plan.name}": ${total} initiatives (${counts}). Weighted EBITDA impact ${summary.impactWeighted} against ${summary.totalOneTimeCost} of one-time cost.`;
    }
    const table = targets.length
      ? {
          columns: ["Target metric", "Period", "Target"],
          rows: [...targets]
            .sort((a, b) => (a.periodEnd < b.periodEnd ? -1 : 1))
            .slice(0, 6)
            .map((t) => [t.metric, t.periodLabel || t.periodEnd, t.targetValue]) as (string | number | null)[][],
        }
      : undefined;
    return { status: "ok", figures, table, text };
  }

  async capitalStatus(): Promise<CommsSectionData> {
    const dealId = this.dealId;
    if (!dealId) return NOT_APPLICABLE;
    const summary = await safe(() => getDealSummary(dealId));
    const raise = await safe(() => getOpenRaise(dealId));
    const reporting = await safe(() => getDealReporting(dealId));
    if (!summary && !reporting) return MISSING;
    const src = {
      sourceModule: "capital",
      sourceId: dealId,
      sourceLabel: "Capital — deal summary & reporting",
      href: `/investors-capital/${dealId}`,
      verification: "reviewed" as const,
    };
    const called = reporting?.totals.called ?? summary?.calledTotal ?? null;
    const distributed =
      reporting?.totals.distributed ?? summary?.distributedTotal ?? null;
    const nav = reporting?.totals.navLatest ?? summary?.navTotal ?? null;
    const defs: Array<{
      key: string;
      label: string;
      value: number | null;
      format: FigureFormat;
    }> = [
      { key: "cap_target_raise", label: "Target raise", value: raise?.targetRaise ?? summary?.targetRaise ?? null, format: "money" },
      { key: "cap_committed_total", label: "Commitments (hard + soft)", value: summary ? summary.hardTotal + summary.softTotal : null, format: "money" },
      { key: "cap_funded_total", label: "Funded commitments", value: summary?.fundedTotal ?? null, format: "money" },
      { key: "cap_investor_count", label: "Investor count", value: summary?.investorCount ?? null, format: "number" },
      { key: "cap_called_total", label: "Capital called", value: called, format: "money" },
      { key: "cap_distributed_total", label: "Distributions", value: distributed, format: "money" },
      { key: "cap_nav_total", label: "Net asset value", value: nav, format: "money" },
    ];
    const figures: AppendixFigure[] = [];
    const rows: (string | number | null)[][] = [];
    for (const d of defs) {
      if (d.value === null) continue;
      figures.push(mkFig({ key: d.key, label: d.label, value: d.value, format: d.format, ...src }));
      rows.push([d.label, d.value]);
    }
    if (!figures.length) return MISSING;
    return {
      status: "ok",
      figures,
      table: { columns: ["Measure", "Amount"], rows },
    };
  }

  async findings(): Promise<CommsSectionData> {
    const dealId = this.dealId;
    if (!dealId) return NOT_APPLICABLE;
    const ws = await safe(() => getWorkspaceByDeal(dealId));
    if (!ws) return MISSING;
    const allFindings = (await safe(() => listFindings(ws.id))) ?? [];
    const allFlags = (await safe(() => listRedFlags(ws.id))) ?? [];
    const closed = new Set(["closed", "resolved", "dismissed", "rejected"]);
    const open = allFindings.filter((f) => !closed.has(f.status));
    const confirmedFlags = allFlags.filter(
      (f) => f.status !== "candidate" && f.status !== "dismissed"
    );
    const bySeverity = (sev: string): number =>
      open.filter((f) => f.severity === sev).length;
    const src = {
      sourceModule: "diligence",
      sourceId: dealId,
      sourceLabel: "Diligence workspace — findings & red flags",
      href: `/due-diligence/${dealId}`,
      verification: "reviewed" as const,
    };
    const figures: AppendixFigure[] = [
      mkFig({ key: "find_open_total", label: "Open findings", value: open.length, format: "number", ...src }),
      mkFig({ key: "find_open_high", label: "Open findings — high severity", value: bySeverity("high"), format: "number", ...src }),
      mkFig({ key: "find_open_medium", label: "Open findings — medium severity", value: bySeverity("medium"), format: "number", ...src }),
      mkFig({ key: "find_open_low", label: "Open findings — low severity", value: bySeverity("low"), format: "number", ...src }),
      mkFig({ key: "find_red_flags_confirmed", label: "Confirmed red flags", value: confirmedFlags.length, format: "number", ...src }),
    ];
    // Titles / labels only for findings and flags (contract) — the
    // finding detail and flag mitigation text never enter a report.
    const rows: (string | number | null)[][] = [
      ...open.map((f) => [f.title, f.severity, f.category, f.status] as (string | number | null)[]),
      ...confirmedFlags.map((f) => [`${f.title} (red flag)`, f.severity, "Red flag", f.status] as (string | number | null)[]),
    ];
    return {
      status: "ok",
      figures,
      table: rows.length
        ? { columns: ["Finding", "Severity", "Category", "Status"], rows }
        : undefined,
      text: `Open findings: ${open.length} (high ${bySeverity("high")}, medium ${bySeverity("medium")}, low ${bySeverity("low")}). Confirmed red flags: ${confirmedFlags.length}.`,
    };
  }

  async memo(): Promise<CommsSectionData> {
    const dealId = this.dealId;
    if (!dealId) return NOT_APPLICABLE;
    const res = await safe(() => getCurrentMemo(dealId));
    if (!res?.memo) return MISSING;
    const parts: string[] = [];
    if (res.stale) {
      parts.push(
        "Note: this memo may be stale relative to its current sources."
      );
    }
    for (const s of res.memo.sections) {
      parts.push(`## ${s.title}`, s.body);
      if (s.citations.length) {
        parts.push(
          `Citations: ${s.citations.map((c) => c.label).join("; ")}.`
        );
      }
      parts.push("");
    }
    return { status: "ok", figures: [], text: parts.join("\n").trim() };
  }
}

/* --------------------------- sample sources -------------------------- */

class SampleSources implements Sources {
  readonly sample = true;
  readonly asOf = getSampleDataset().asOf;
  private readonly data = getSampleDataset();
  async financialSummary(): Promise<CommsSectionData> {
    return this.data.financialSummary;
  }
  async kpiTable(): Promise<CommsSectionData> {
    return this.data.kpiTable;
  }
  async varianceTable(): Promise<CommsSectionData> {
    return this.data.varianceTable;
  }
  async covenantStatus(): Promise<CommsSectionData> {
    return this.data.covenantStatus;
  }
  async planStatus(): Promise<CommsSectionData> {
    return this.data.planStatus;
  }
  async capitalStatus(): Promise<CommsSectionData> {
    return this.data.capitalStatus;
  }
  async findings(): Promise<CommsSectionData> {
    return this.data.findings;
  }
  async memo(): Promise<CommsSectionData> {
    return this.data.memo;
  }
}

/* ------------------------------ assembly ----------------------------- */

export interface AssembleReportInput {
  template: CommsTemplate;
  subject: ReportSubject;
  sample: boolean;
  actor: string;
}

export interface AssembleReportResult {
  render: ReportRender;
  appendix: AppendixFigure[];
  fingerprint: string;
  hasUnreviewed: boolean;
  /** Keys of the template's narrative blocks (contract name). */
  narrativeBlocks: string[];
  /** Alias of narrativeBlocks (Part 12 task name). */
  narrativeBlockKeys: string[];
}

function sectionFor(
  sources: Sources,
  type: string
): Promise<CommsSectionData> {
  switch (type) {
    case "financial_summary":
      return sources.financialSummary();
    case "kpi_table":
      return sources.kpiTable();
    case "variance_table":
      return sources.varianceTable();
    case "covenant_status":
      return sources.covenantStatus();
    case "plan_status":
      return sources.planStatus();
    case "capital_status":
      return sources.capitalStatus();
    case "findings":
      return sources.findings();
    case "memo":
      return sources.memo();
    default:
      return Promise.resolve(NOT_APPLICABLE);
  }
}

/** The shared block renderer: template block + section data → the
 * stored RenderBlock. Real and sample data both pass through here. */
function renderBlock(
  tpl: TemplateBlock,
  data: CommsSectionData
): RenderBlock {
  const block: RenderBlock = {
    key: tpl.key,
    type: tpl.type,
    heading: tpl.heading,
    visibility:
      tpl.type === "internal_notes" ? "internal_only" : tpl.visibility,
    dataStatus: data.status,
    figures: data.figures,
  };
  if (data.table) block.table = data.table;
  if (data.chart) block.chart = data.chart;
  if (data.text !== undefined) block.text = data.text;
  return block;
}

export async function assembleReport(
  input: AssembleReportInput
): Promise<AssembleReportResult> {
  const { template, subject } = input;
  if (!template || !Array.isArray(template.blocks)) {
    throw new Error("template_required");
  }
  void input.actor;

  let sources: Sources;
  let subjectLabel: string;
  if (input.sample) {
    sources = new SampleSources();
    subjectLabel = getSampleDataset().subjectLabel;
  } else {
    let companyId = subject.companyId ?? null;
    const dealId = subject.dealId ?? null;
    if (!companyId && dealId) {
      const ctx = await safe(() => getDealContext(dealId));
      companyId = ctx?.companyId ?? null;
    }
    sources = new RealSources(companyId, dealId);
    subjectLabel = subject.subjectLabel || "Untitled subject";
  }

  const blocks: RenderBlock[] = [];
  const warnings: string[] = [];
  const narrativeBlockKeys: string[] = [];
  if (input.sample) {
    warnings.push("Sample report — figures are illustrative only.");
  }

  for (const tpl of template.blocks) {
    if (tpl.type === "narrative") {
      narrativeBlockKeys.push(tpl.key);
      blocks.push({
        key: tpl.key,
        type: tpl.type,
        heading: tpl.heading,
        visibility: tpl.visibility,
        dataStatus: "ok",
        figures: [],
        narrative: { status: "pending", statements: [] },
      });
      continue;
    }
    if (tpl.type === "text" || tpl.type === "internal_notes") {
      blocks.push(
        renderBlock(tpl, {
          status: "ok",
          figures: [],
          text: tpl.config?.text ?? "",
        })
      );
      continue;
    }
    const data = await sectionFor(sources, tpl.type);
    if (data.status === "missing") {
      warnings.push(`No data available for "${tpl.heading}".`);
    }
    blocks.push(renderBlock(tpl, data));
  }

  // Appendix = every figure from every block, deduped by key
  // (first occurrence wins — block order is template order).
  const seen = new Set<string>();
  const appendix: AppendixFigure[] = [];
  for (const b of blocks) {
    for (const f of b.figures) {
      if (seen.has(f.key)) continue;
      seen.add(f.key);
      appendix.push(f);
    }
  }
  const hasUnreviewed = appendix.some(
    (f) => f.verification === "unreviewed"
  );

  const fingerprint = createHash("sha256")
    .update(
      JSON.stringify({
        figures: appendix.map((f) => [f.key, f.value, f.verification]),
        statuses: blocks.map((b) => [b.key, b.dataStatus]),
      })
    )
    .digest("hex");

  const render: ReportRender = {
    title: `${template.name} — ${subjectLabel}`,
    subjectLabel,
    asOf: sources.asOf,
    sample: input.sample,
    firm: "Canny Capital Partners",
    disclaimers: template.disclaimers ?? [],
    blocks,
    warnings,
  };

  return {
    render,
    appendix,
    fingerprint,
    hasUnreviewed,
    narrativeBlocks: narrativeBlockKeys,
    narrativeBlockKeys,
  };
}

import { sql, newId, str, num, isoOrNull } from "../platform/db";
import { enqueueJob } from "../platform/jobs";
import { ensureAutomation } from "./automation-schema";
import {
  gatherMemoSources,
  type MemoSources,
} from "./memo";
import { listLicenses } from "./service";
import type { MetricValue } from "../finanalysis/types";

/**
 * Deal risk score (Part 5B) — a deterministic 0–100 score (0 = low
 * risk, 100 = high risk) over six weighted components, each computed
 * from the same service-layer sources the IC memo assembles
 * (lib/diligence/memo.ts gatherMemoSources) plus the license register.
 *
 * Rules:
 * - A component whose input genuinely does not exist is null and its
 *   weight RENORMALIZES out of the total — it never silently scores 0.
 * - Every component carries a human-readable value + detail and a
 *   source citation with an href, so the score is auditable.
 * - Scores are append-only rows; each row stores the per-component
 *   delta vs the previous row so movement is explainable.
 * - Owner dependence reads the LEGACY deal row: diligence joins the
 *   legacy `deals` table for deal names (see getDealContext in
 *   lib/diligence/service.ts — `LEFT JOIN deals ld ON ld.id = cd.id`),
 *   and the legacy row's `drivers` JSONB is what lib/valuation.ts
 *   reads as deal.drivers. Its levels are 'neg' | 'neu' | 'pos'
 *   (lib/types.ts DriverLevel); valuation maps them to multiple
 *   adjustments of ±weight (ownerDependence weight 0.75, 'pos' = runs
 *   WITHOUT the owner = +0.75). The dependence bucket used here is the
 *   inverse sign (neg → +0.75 = business runs through the owner), and
 *   a raw numeric bucket, if one is ever stored, is taken as-is.
 *
 * No financial figures in logs.
 */

export interface RiskComponent {
  key: string;
  label: string;
  weight: number;
  subscore: number | null;
  value: string;
  detail: string;
  source: { kind: string; id: string; label: string; href: string } | null;
}

export interface RiskDriver {
  label: string;
  subscore: number;
  value: string;
  href: string;
}

export interface RiskRow {
  id: string;
  dealId: string;
  companyId: string | null;
  workspaceId: string;
  score: number;
  band: string;
  components: RiskComponent[];
  drivers: RiskDriver[];
  changes: Record<string, unknown>;
  triggerSource: string;
  computedBy: string;
  createdAt: string;
}

export const RISK_WEIGHTS: Record<string, number> = {
  financial_trends: 25,
  customer_concentration: 15,
  owner_dependence: 15,
  contract_risk: 15,
  compliance_gaps: 15,
  data_completeness: 15,
};

const DAY_MS = 86400000;
const SATISFIED = ["received", "reviewed", "approved", "waived", "na"];

const pct = (v: number | null | undefined): string =>
  v === null || v === undefined ? "—" : `${(v * 100).toFixed(1)}%`;

/* ----------------------------- components ------------------------------ */

function latestMetrics(src: MemoSources): MetricValue[] {
  const byPeriod = src.analysis?.payload.metricsByPeriod ?? [];
  return byPeriod.length ? byPeriod[byPeriod.length - 1].metrics : [];
}

function metric(metrics: MetricValue[], key: string): MetricValue | undefined {
  return metrics.find((m) => m.key === key);
}

function financialTrends(src: MemoSources, dealHref: string): RiskComponent {
  const base: Omit<RiskComponent, "subscore" | "value" | "detail"> = {
    key: "financial_trends",
    label: "Financial trends",
    weight: RISK_WEIGHTS.financial_trends,
    source: null,
  };
  if (!src.analysis) {
    return {
      ...base,
      subscore: null,
      value: "No analysis",
      detail: "No financial analysis exists for this company yet.",
    };
  }
  const metrics = latestMetrics(src);
  const growth = metric(metrics, "revenue_growth_yoy")?.value ?? null;
  const marginM = metric(metrics, "ebitda_margin");
  const debt = metric(metrics, "debt_ebitda")?.value ?? null;
  if (growth === null) {
    return {
      ...base,
      subscore: null,
      value: "Growth not computed",
      detail:
        "The current analysis does not carry a year-over-year revenue growth figure (needs a year-ago period).",
      source: {
        kind: "analysis",
        id: src.analysis.analysis.id,
        label: "Financial analysis",
        href: src.companyId ? `/companies/${src.companyId}` : dealHref,
      },
    };
  }
  let sub = growth < -0.1 ? 85 : growth < 0 ? 65 : growth < 0.03 ? 45 : 25;
  const notes: string[] = [`growth-based subscore ${sub}`];
  // EBITDA margin trend: margin value vs its prior-period value
  // (MetricValue.prior). A fall of more than 300bps adds +15.
  const margin = marginM?.value ?? null;
  const marginPrior = marginM?.prior ?? null;
  if (margin !== null && marginPrior !== null && marginPrior - margin > 0.03) {
    sub = Math.min(100, sub + 15);
    notes.push(
      `margin fell ${((marginPrior - margin) * 10000).toFixed(0)}bps vs prior period (+15)`
    );
  }
  if (debt !== null && debt > 5) {
    sub = Math.min(100, sub + 20);
    notes.push(`debt/EBITDA ${debt.toFixed(1)}× above 5× (+20)`);
  } else if (debt !== null && debt > 3.5) {
    sub = Math.min(100, sub + 10);
    notes.push(`debt/EBITDA ${debt.toFixed(1)}× above 3.5× (+10)`);
  }
  return {
    ...base,
    subscore: sub,
    value: `Growth ${pct(growth)} · margin ${pct(margin)} · debt/EBITDA ${debt === null ? "—" : `${debt.toFixed(1)}×`}`,
    detail: notes.join("; "),
    source: {
      kind: "analysis",
      id: src.analysis.analysis.id,
      label: "Financial analysis",
      href: src.companyId ? `/companies/${src.companyId}` : dealHref,
    },
  };
}

function customerConcentration(
  src: MemoSources,
  dealHref: string
): RiskComponent {
  const base: Omit<RiskComponent, "subscore" | "value" | "detail"> = {
    key: "customer_concentration",
    label: "Customer concentration",
    weight: RISK_WEIGHTS.customer_concentration,
    source: null,
  };
  const conc = src.analysis?.payload.revenueQuality?.concentration;
  if (!src.analysis || !conc || !conc.available || conc.top1Pct === null) {
    return {
      ...base,
      subscore: null,
      value: "Not available",
      detail:
        "Customer concentration is not available in the current analysis (no revenue-by-customer data posted).",
    };
  }
  const top1 = conc.top1Pct;
  const sub = top1 >= 40 ? 90 : top1 >= 25 ? 70 : top1 >= 15 ? 45 : 25;
  return {
    ...base,
    subscore: sub,
    value: `Top customer ${top1.toFixed(1)}%${conc.top5Pct !== null ? ` · top 5 ${conc.top5Pct.toFixed(1)}%` : ""}`,
    detail:
      conc.top5Pct !== null
        ? `Largest customer is ${top1.toFixed(1)}% of revenue; the top five are ${conc.top5Pct.toFixed(1)}%.`
        : `Largest customer is ${top1.toFixed(1)}% of revenue.`,
    source: {
      kind: "analysis",
      id: src.analysis.analysis.id,
      label: "Financial analysis — revenue quality",
      href: src.companyId ? `/companies/${src.companyId}` : dealHref,
    },
  };
}

async function ownerDependence(
  src: MemoSources,
  dealHref: string
): Promise<RiskComponent> {
  const base: Omit<RiskComponent, "subscore" | "value" | "detail"> = {
    key: "owner_dependence",
    label: "Owner dependence",
    weight: RISK_WEIGHTS.owner_dependence,
    source: null,
  };
  const db = sql();
  const rows = await db`
    SELECT drivers FROM deals WHERE id = ${src.ws.dealId} LIMIT 1`;
  const drivers =
    rows.length && rows[0].drivers && typeof rows[0].drivers === "object"
      ? (rows[0].drivers as Record<string, unknown>)
      : {};
  const raw = drivers.ownerDependence;
  // Legacy levels → dependence bucket (valuation weight 0.75, sign
  // inverted: 'pos' means the business runs WITHOUT the owner).
  let bucket: number | null = null;
  let levelLabel = "";
  if (typeof raw === "number" && isFinite(raw)) {
    bucket = raw;
    levelLabel = `bucket ${raw}`;
  } else if (raw === "neg") {
    bucket = 0.75;
    levelLabel = "business runs through the owner";
  } else if (raw === "neu") {
    bucket = 0;
    levelLabel = "some key-person risk";
  } else if (raw === "pos") {
    bucket = -0.75;
    levelLabel = "runs without the owner";
  }
  if (bucket === null) {
    return {
      ...base,
      subscore: null,
      value: "Not assessed",
      detail: "Owner dependence not yet assessed on the deal.",
    };
  }
  const sub = bucket >= 0.5 ? 85 : bucket >= 0.25 ? 65 : bucket > -0.25 ? 45 : 25;
  return {
    ...base,
    subscore: sub,
    value: levelLabel,
    detail: `Deal driver 'ownerDependence' = ${levelLabel} (dependence bucket ${bucket}).`,
    source: {
      kind: "deal",
      id: src.ws.dealId,
      label: "Deal drivers (valuation)",
      href: dealHref,
    },
  };
}

function contractRisk(src: MemoSources, dealHref: string): RiskComponent {
  const base: Omit<RiskComponent, "subscore" | "value" | "detail"> = {
    key: "contract_risk",
    label: "Contract risk",
    weight: RISK_WEIGHTS.contract_risk,
    source: null,
  };
  const contracts = src.contracts;
  if (!contracts.length) {
    return {
      ...base,
      subscore: null,
      value: "No contracts in register",
      detail: "No contracts in register.",
    };
  }
  const adversePattern = /consent|prohibit|terminat/i;
  const now = Date.now();
  let sub = 20;
  let adverseCount = 0;
  let expiringCount = 0;
  let firstAdverse: (typeof contracts)[number] | null = null;
  for (const c of contracts) {
    if (adversePattern.test(c.changeOfControl)) {
      sub += 20;
      adverseCount += 1;
      if (!firstAdverse) firstAdverse = c;
    }
    if (c.expiryDate && !c.autoRenew) {
      const days = (new Date(c.expiryDate).getTime() - now) / DAY_MS;
      if (days >= 0 && days <= 365) {
        sub += 15;
        expiringCount += 1;
      }
    }
  }
  sub = Math.min(100, sub);
  const sourceContract = firstAdverse ?? contracts[0];
  return {
    ...base,
    subscore: sub,
    value: `${contracts.length} contracts · ${adverseCount} change-of-control restricted · ${expiringCount} expiring ≤365d without auto-renew`,
    detail:
      `Base 20 for a populated register; +20 per contract whose change-of-control terms require consent / prohibit transfer / allow termination (${adverseCount}); ` +
      `+15 per contract expiring within 365 days without auto-renew (${expiringCount}).`,
    source: {
      kind: "contract",
      id: sourceContract.id,
      label: firstAdverse
        ? `Contract — ${firstAdverse.title}`
        : "Contract register",
      href: dealHref,
    },
  };
}

async function complianceGaps(
  src: MemoSources,
  dealHref: string
): Promise<RiskComponent> {
  const base: Omit<RiskComponent, "subscore" | "value" | "detail"> = {
    key: "compliance_gaps",
    label: "Compliance gaps",
    weight: RISK_WEIGHTS.compliance_gaps,
    source: null,
  };
  const findings = src.checks.filter(
    (c) => c.latest && c.latest.resultStatus === "finding"
  );
  const missing = src.checks.filter((c) => !c.latest);
  let sub = 15;
  if (findings.length) sub = 80 + 10 * (findings.length - 1);
  sub += 8 * missing.length;
  let expiringLicenses = 0;
  try {
    const licenses = await listLicenses(src.ws.id);
    const now = Date.now();
    expiringLicenses = licenses.filter((l) => {
      if (!l.expiryDate) return false;
      const days = (new Date(l.expiryDate).getTime() - now) / DAY_MS;
      return days >= 0 && days <= 90;
    }).length;
  } catch {
    expiringLicenses = 0;
  }
  if (expiringLicenses) sub += 15;
  sub = Math.min(100, sub);
  const notes: string[] = [];
  if (findings.length)
    notes.push(
      `${findings.length} record check(s) with findings: ${findings.map((f) => f.meta.label).join(", ")}`
    );
  if (missing.length)
    notes.push(
      `no snapshot yet for: ${missing.map((m) => m.meta.label).join(", ")} (+8 each — unknown is risk)`
    );
  if (expiringLicenses)
    notes.push(`${expiringLicenses} license(s) expiring within 90 days (+15)`);
  if (!notes.length) notes.push("All check types have snapshots; no findings.");
  return {
    ...base,
    subscore: sub,
    value: `${findings.length} finding(s) · ${missing.length} check type(s) unchecked · ${expiringLicenses} license(s) expiring ≤90d`,
    detail: notes.join("; "),
    source: {
      kind: "record_checks",
      id: src.companyId ?? src.ws.id,
      label: "Public-record checks",
      href: dealHref,
    },
  };
}

function dataCompleteness(src: MemoSources, dealHref: string): RiskComponent {
  const total = src.checklist.length;
  const done = src.checklist.filter((i) => SATISFIED.includes(i.status)).length;
  const ratio = total ? done / total : 0;
  let sub = Math.round((1 - ratio) * 70);
  const notes: string[] = [
    `checklist ${done}/${total} satisfied (${(ratio * 100).toFixed(0)}%)`,
  ];
  if (!src.analysis) {
    sub += 20;
    notes.push("no financial analysis (+20)");
  }
  const anyChecks = src.checks.some((c) => c.latest);
  if (!anyChecks) {
    sub += 10;
    notes.push("no record checks on file (+10)");
  }
  sub = Math.min(100, sub);
  return {
    key: "data_completeness",
    label: "Data completeness",
    weight: RISK_WEIGHTS.data_completeness,
    subscore: sub,
    value: `Checklist ${(ratio * 100).toFixed(0)}% satisfied · analysis ${src.analysis ? "present" : "missing"} · record checks ${anyChecks ? "present" : "none"}`,
    detail: notes.join("; "),
    source: {
      kind: "workspace",
      id: src.ws.id,
      label: "Diligence workspace",
      href: dealHref,
    },
  };
}

/* ------------------------------ scoring -------------------------------- */

export function bandFor(score: number): string {
  return score < 25 ? "Low" : score < 50 ? "Moderate" : score < 75 ? "Elevated" : "High";
}

interface StoredComponent {
  key: string;
  subscore: number | null;
}

function rowToRisk(r: Record<string, unknown>): RiskRow {
  const components = Array.isArray(r.components)
    ? (r.components as RiskComponent[])
    : [];
  const drivers = Array.isArray(r.drivers) ? (r.drivers as RiskDriver[]) : [];
  const changes =
    r.changes && typeof r.changes === "object" && !Array.isArray(r.changes)
      ? (r.changes as Record<string, unknown>)
      : {};
  return {
    id: str(r.id),
    dealId: str(r.deal_id),
    companyId: r.company_id ? str(r.company_id) : null,
    workspaceId: str(r.workspace_id),
    score: num(r.score),
    band: str(r.band),
    components,
    drivers,
    changes,
    triggerSource: str(r.trigger_source),
    computedBy: str(r.computed_by),
    createdAt: isoOrNull(r.created_at) ?? "",
  };
}

const RISK_COLS = `id, deal_id, company_id, workspace_id, score, band,
  components, drivers, changes, trigger_source, computed_by, created_at`;

export async function computeRisk(
  workspaceId: string,
  actor: string,
  triggerSource: string
): Promise<RiskRow> {
  await ensureAutomation();
  const src = await gatherMemoSources(workspaceId);
  const dealHref = `/due-diligence/${src.ws.dealId}`;
  const components: RiskComponent[] = [
    financialTrends(src, dealHref),
    customerConcentration(src, dealHref),
    await ownerDependence(src, dealHref),
    contractRisk(src, dealHref),
    await complianceGaps(src, dealHref),
    dataCompleteness(src, dealHref),
  ];
  const scored = components.filter((c) => c.subscore !== null);
  const weightSum = scored.reduce((s, c) => s + c.weight, 0);
  const score =
    weightSum > 0
      ? Math.round(
          (scored.reduce((s, c) => s + c.weight * (c.subscore as number), 0) /
            weightSum) *
            10
        ) / 10
      : 0;
  const band = bandFor(score);
  const drivers: RiskDriver[] = scored
    .map((c) => ({
      label: c.label,
      subscore: c.subscore as number,
      value: c.value,
      href: c.source?.href ?? dealHref,
      impact: c.weight * (c.subscore as number),
    }))
    .sort((a, b) => b.impact - a.impact)
    .slice(0, 3)
    .map(({ label, subscore, value, href }) => ({ label, subscore, value, href }));

  const db = sql();
  const prevRows = await db`
    SELECT ${db.unsafe(RISK_COLS)} FROM diligence.risk_scores
    WHERE deal_id = ${src.ws.dealId}
    ORDER BY created_at DESC LIMIT 1`;
  const changes: Record<string, unknown> = {};
  if (prevRows.length) {
    const prev = rowToRisk(prevRows[0] as Record<string, unknown>);
    const prevByKey = new Map<string, StoredComponent>(
      prev.components.map((c) => [c.key, c])
    );
    const componentDeltas: Array<{
      key: string;
      label: string;
      delta: number | null;
      from: number | null;
      to: number | null;
    }> = [];
    for (const c of components) {
      const p = prevByKey.get(c.key);
      componentDeltas.push({
        key: c.key,
        label: c.label,
        delta:
          p && p.subscore !== null && c.subscore !== null
            ? Math.round((c.subscore - p.subscore) * 10) / 10
            : null,
        from: p ? p.subscore : null,
        to: c.subscore,
      });
    }
    changes.scoreDelta = Math.round((score - prev.score) * 10) / 10;
    changes.previousScore = prev.score;
    changes.previousBand = prev.band;
    changes.components = componentDeltas;
  } else {
    changes.scoreDelta = null;
    changes.components = [];
  }

  const id = `rsk_${newId()}`;
  await db`
    INSERT INTO diligence.risk_scores
      (id, deal_id, company_id, workspace_id, score, band, components,
       drivers, changes, trigger_source, computed_by)
    VALUES (${id}, ${src.ws.dealId}, ${src.companyId}, ${workspaceId},
      ${score}, ${band}, ${JSON.stringify(components)}::jsonb,
      ${JSON.stringify(drivers)}::jsonb, ${JSON.stringify(changes)}::jsonb,
      ${triggerSource}, ${actor})`;
  const rows = await db`
    SELECT ${db.unsafe(RISK_COLS)} FROM diligence.risk_scores
    WHERE id = ${id} LIMIT 1`;
  return rowToRisk(rows[0] as Record<string, unknown>);
}

export interface RiskHistoryEntry {
  id: string;
  score: number;
  band: string;
  triggerSource: string;
  createdAt: string;
  changes: Record<string, unknown>;
}

export async function getRisk(
  dealId: string
): Promise<{ current: RiskRow | null; history: RiskHistoryEntry[] }> {
  await ensureAutomation();
  const db = sql();
  const rows = await db`
    SELECT ${db.unsafe(RISK_COLS)} FROM diligence.risk_scores
    WHERE deal_id = ${dealId}
    ORDER BY created_at DESC LIMIT 20`;
  if (!rows.length) return { current: null, history: [] };
  const all = rows.map((r) => rowToRisk(r as Record<string, unknown>));
  return {
    current: all[0],
    history: all.map((r) => ({
      id: r.id,
      score: r.score,
      band: r.band,
      triggerSource: r.triggerSource,
      createdAt: r.createdAt,
      changes: r.changes,
    })),
  };
}

/** Job handler (kind 'compute_risk_score') — wired by the coordinator. */
export async function runRiskJob(
  payload: Record<string, unknown>
): Promise<RiskRow> {
  const workspaceId = str(payload.workspaceId ?? payload.workspace_id);
  if (!workspaceId) throw new Error("workspace_required");
  const actor = str(payload.actor) || "system";
  return computeRisk(workspaceId, actor, "job");
}

/**
 * Called by the coordinator from the analysis-approval hook: enqueue a
 * risk recompute + memo regeneration for every live diligence
 * workspace on the company whose analysis was just approved.
 */
export async function enqueueRiskAndMemoForCompany(
  companyId: string,
  actor: string
): Promise<{ workspaces: number }> {
  await ensureAutomation();
  const db = sql();
  const rows = await db`
    SELECT id FROM diligence.workspaces
    WHERE company_id = ${companyId} AND deleted_at IS NULL`;
  for (const r of rows) {
    const workspaceId = str((r as Record<string, unknown>).id);
    if (!workspaceId) continue;
    await enqueueJob("compute_risk_score", { workspaceId, actor });
    await enqueueJob("generate_memo", { workspaceId, actor });
  }
  return { workspaces: rows.length };
}

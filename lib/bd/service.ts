import { sql, str, num } from "../platform/db";
import { getDeals } from "../db";
import type { Deal, InvestmentTypeKey } from "../types";
import { DEFAULT_STAGES_BY_TYPE } from "../types";
import {
  ensureBd,
  type MetricDefinitionRow,
  type SectorPackRow,
  type TypeConfigRow,
} from "./schema";

export {
  ensureBd,
  type MetricDefinitionRow,
  type SectorPackRow,
  type TypeConfigRow,
};

/**
 * Business Development — Investment Types service (Step 1, Oct 23, 2026).
 * The BD module's own read/write surface: type + stage configuration,
 * the metric-definition catalog, per-deal structured metrics, the
 * pipeline bootstrap payload, and the Overview flywheel figures.
 * Other modules consume these through this service only — no
 * cross-schema SQL into bd.* anywhere else.
 */

/* ------------------------- request parsing ------------------------ */

const INVESTMENT_TYPE_KEYS: InvestmentTypeKey[] = [
  "platform_lbo",
  "add_on",
  "early_stage",
  "minority_growth",
];

export function parseInvestmentType(v: unknown): InvestmentTypeKey | null {
  return typeof v === "string" &&
    (INVESTMENT_TYPE_KEYS as string[]).includes(v)
    ? (v as InvestmentTypeKey)
    : null;
}

export function parseSourcedFromType(
  v: unknown
): "portfolio_company" | "market_insight" | null {
  return v === "portfolio_company" || v === "market_insight" ? v : null;
}

export interface DealMetricValue {
  num: number | null;
  text: string | null;
  period: string | null;
  source: string;
  updatedAt: string;
}

export type DealMetricsMap = Record<string, DealMetricValue>;

/* ------------------------------- config ----------------------------- */

function parseStages(v: unknown): string[] {
  let arr: unknown = v;
  if (typeof v === "string" && v.trim()) {
    try {
      arr = JSON.parse(v) as unknown;
    } catch {
      arr = [];
    }
  }
  if (!Array.isArray(arr)) return [];
  return arr.map((s) => String(s)).filter(Boolean);
}

function parseConfig(v: unknown): MetricDefinitionRow["config"] {
  let obj: unknown = v;
  if (typeof v === "string" && v.trim()) {
    try {
      obj = JSON.parse(v) as unknown;
    } catch {
      obj = {};
    }
  }
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return {};
  const r = obj as Record<string, unknown>;
  return {
    group: r.group === "hold" ? "hold" : r.group === "primary" ? "primary" : undefined,
    options: Array.isArray(r.options) ? r.options.map(String) : undefined,
    types: Array.isArray(r.types) ? r.types.map(String) : undefined,
  };
}

export interface BdConfig {
  types: TypeConfigRow[];
  definitions: MetricDefinitionRow[];
  sectorPacks: SectorPackRow[];
}

export async function getBdConfig(): Promise<BdConfig> {
  await ensureBd();
  const db = sql();
  const [typeRows, defRows, packRows] = await Promise.all([
    db`SELECT * FROM bd.type_config ORDER BY sort ASC, key ASC`,
    db`SELECT * FROM bd.metric_definitions ORDER BY applies_to ASC, sort ASC, key ASC`,
    db`SELECT * FROM bd.sector_packs ORDER BY sort ASC, key ASC`,
  ]);
  return {
    types: typeRows.map((r) => {
      const rec = r as Record<string, unknown>;
      const key = str(rec.key) as InvestmentTypeKey;
      const stages = parseStages(rec.stages);
      return {
        key,
        label: str(rec.label),
        enabled: Boolean(rec.enabled),
        stages: stages.length ? stages : [...(DEFAULT_STAGES_BY_TYPE[key] ?? [])],
        sort: num(rec.sort),
      };
    }),
    definitions: defRows.map((r) => {
      const rec = r as Record<string, unknown>;
      return {
        key: str(rec.key),
        label: str(rec.label),
        appliesTo: str(rec.applies_to),
        dataType: str(rec.data_type) as MetricDefinitionRow["dataType"],
        sort: num(rec.sort),
        required: Boolean(rec.required),
        enabled: Boolean(rec.enabled),
        config: parseConfig(rec.config),
      };
    }),
    sectorPacks: packRows.map((r) => {
      const rec = r as Record<string, unknown>;
      return {
        key: str(rec.key),
        label: str(rec.label),
        industryMatch: str(rec.industry_match),
        enabled: Boolean(rec.enabled),
        sort: num(rec.sort),
      };
    }),
  };
}

/** Settings writes: type enabled flags + stage lists, definition
 * enabled/label/sort, sector-pack enabled + creation. Partial merge —
 * only the sections present in the patch are touched. */
export async function updateBdConfig(
  patch: {
    types?: Array<{ key: string; enabled?: boolean; stages?: string[] }>;
    definitions?: Array<{ key: string; enabled?: boolean; label?: string; sort?: number }>;
    sectorPacks?: Array<{
      key: string;
      label?: string;
      industryMatch?: string;
      enabled?: boolean;
    }>;
  },
  actor: string
): Promise<BdConfig> {
  await ensureBd();
  const db = sql();
  for (const t of patch.types ?? []) {
    if (!t.key) continue;
    if (typeof t.enabled === "boolean") {
      await db`
        UPDATE bd.type_config
        SET enabled = ${t.enabled}, updated_at = now(), updated_by = ${actor}
        WHERE key = ${t.key}`;
    }
    if (Array.isArray(t.stages)) {
      const stages = t.stages.map((s) => String(s).trim()).filter(Boolean);
      if (stages.length) {
        await db`
          UPDATE bd.type_config
          SET stages = ${JSON.stringify(stages)}::jsonb,
            updated_at = now(), updated_by = ${actor}
          WHERE key = ${t.key}`;
      }
    }
  }
  for (const d of patch.definitions ?? []) {
    if (!d.key) continue;
    await db`
      UPDATE bd.metric_definitions
      SET enabled = COALESCE(${typeof d.enabled === "boolean" ? d.enabled : null}, enabled),
        label = COALESCE(${typeof d.label === "string" && d.label.trim() ? d.label.trim() : null}, label),
        sort = COALESCE(${typeof d.sort === "number" ? d.sort : null}, sort),
        updated_at = now()
      WHERE key = ${d.key}`;
  }
  for (const p of patch.sectorPacks ?? []) {
    if (!p.key) continue;
    await db`
      INSERT INTO bd.sector_packs (key, label, industry_match, enabled, sort)
      VALUES (${p.key}, ${p.label ?? p.key}, ${p.industryMatch ?? ""},
        ${typeof p.enabled === "boolean" ? p.enabled : true}, 100)
      ON CONFLICT (key) DO UPDATE
      SET label = COALESCE(${p.label ?? null}, bd.sector_packs.label),
        industry_match = COALESCE(${p.industryMatch ?? null}, bd.sector_packs.industry_match),
        enabled = COALESCE(${typeof p.enabled === "boolean" ? p.enabled : null}, bd.sector_packs.enabled),
        updated_at = now()`;
  }
  return getBdConfig();
}

/** Stage list for a type from live config (falls back to the seeded
 * defaults when bd is unavailable — callers must never hard-fail a
 * deal write on config). */
export async function stagesForType(
  typeKey: string
): Promise<readonly string[]> {
  try {
    const cfg = await getBdConfig();
    const t = cfg.types.find((x) => x.key === typeKey);
    if (t && t.stages.length) return t.stages;
  } catch {
    /* fall through to defaults */
  }
  return DEFAULT_STAGES_BY_TYPE[typeKey as InvestmentTypeKey] ?? [];
}

/* ------------------------------ metrics ----------------------------- */

function rowToMetric(r: Record<string, unknown>): DealMetricValue {
  return {
    num: r.value_num === null || r.value_num === undefined ? null : Number(r.value_num),
    text: r.value_text === null || r.value_text === undefined ? null : String(r.value_text),
    period: r.period ? String(r.period) : null,
    source: str(r.source) || "manual",
    updatedAt: r.updated_at ? new Date(r.updated_at as string).toISOString() : "",
  };
}

export async function getDealMetrics(
  dealId: string
): Promise<DealMetricsMap> {
  await ensureBd();
  const db = sql();
  const rows = await db`
    SELECT * FROM bd.deal_metrics WHERE deal_id = ${dealId}`;
  const out: DealMetricsMap = {};
  for (const r of rows) {
    const rec = r as Record<string, unknown>;
    out[str(rec.metric_key)] = rowToMetric(rec);
  }
  return out;
}

export async function getAllDealMetrics(): Promise<Record<string, DealMetricsMap>> {
  await ensureBd();
  const db = sql();
  const rows = await db`SELECT * FROM bd.deal_metrics`;
  const out: Record<string, DealMetricsMap> = {};
  for (const r of rows) {
    const rec = r as Record<string, unknown>;
    const dealId = str(rec.deal_id);
    (out[dealId] ??= {})[str(rec.metric_key)] = rowToMetric(rec);
  }
  return out;
}

const NUMERIC_TYPES = new Set(["money", "multiple", "pct", "number"]);

/** Upsert a batch of metric values for one deal. Values are validated
 * against the definition catalog: numeric kinds → value_num, text /
 * enum / bool / date → value_text. null / "" clears the row. Unknown
 * keys are rejected in the result, never silently stored. */
export async function setDealMetrics(
  dealId: string,
  values: Record<string, unknown>,
  actor: string,
  source = "manual"
): Promise<{ saved: string[]; rejected: string[] }> {
  await ensureBd();
  const db = sql();
  const cfg = await getBdConfig();
  const defs = new Map(cfg.definitions.map((d) => [d.key, d]));
  const saved: string[] = [];
  const rejected: string[] = [];
  for (const [key, raw] of Object.entries(values)) {
    const def = defs.get(key);
    if (!def) {
      rejected.push(key);
      continue;
    }
    if (raw === null || raw === undefined || raw === "") {
      await db`
        DELETE FROM bd.deal_metrics
        WHERE deal_id = ${dealId} AND metric_key = ${key}`;
      saved.push(key);
      continue;
    }
    if (NUMERIC_TYPES.has(def.dataType)) {
      const n =
        typeof raw === "number"
          ? raw
          : Number(String(raw).replace(/[$,×%]/g, "").trim());
      if (!Number.isFinite(n)) {
        rejected.push(key);
        continue;
      }
      await db`
        INSERT INTO bd.deal_metrics
          (deal_id, metric_key, value_num, value_text, source, updated_by)
        VALUES (${dealId}, ${key}, ${n}, NULL, ${source}, ${actor})
        ON CONFLICT (deal_id, metric_key) DO UPDATE
        SET value_num = EXCLUDED.value_num, value_text = NULL,
          source = EXCLUDED.source, updated_by = EXCLUDED.updated_by,
          updated_at = now()`;
    } else {
      const text = String(raw).slice(0, 2000);
      await db`
        INSERT INTO bd.deal_metrics
          (deal_id, metric_key, value_num, value_text, source, updated_by)
        VALUES (${dealId}, ${key}, NULL, ${text}, ${source}, ${actor})
        ON CONFLICT (deal_id, metric_key) DO UPDATE
        SET value_num = NULL, value_text = EXCLUDED.value_text,
          source = EXCLUDED.source, updated_by = EXCLUDED.updated_by,
          updated_at = now()`;
    }
    saved.push(key);
  }
  return { saved, rejected };
}

/* ------------------------- applicable fields ------------------------ */

/** The definitions that apply to a deal: its type's fields plus every
 * enabled sector pack whose industry matches the deal's industry. */
export function applicableDefinitions(
  cfg: BdConfig,
  deal: Pick<Deal, "investmentType" | "industry">
): MetricDefinitionRow[] {
  const typeKey = deal.investmentType ?? "platform_lbo";
  const industry = (deal.industry ?? "").trim().toLowerCase();
  const packKeys = new Set(
    cfg.sectorPacks
      .filter(
        (p) =>
          p.enabled &&
          p.industryMatch.trim().toLowerCase() !== "" &&
          p.industryMatch.trim().toLowerCase() === industry
      )
      .map((p) => `sector:${p.key}`)
  );
  return cfg.definitions
    .filter((d) => d.enabled)
    .filter((d) => {
      if (d.appliesTo === `type:${typeKey}`) return true;
      if (packKeys.has(d.appliesTo)) {
        const only = d.config.types;
        return !only || only.includes(typeKey);
      }
      return false;
    })
    .sort((a, b) => a.sort - b.sort || a.key.localeCompare(b.key));
}

/** Sector pack keys matching an industry string (for room warnings). */
export function matchingPackKeys(cfg: BdConfig, industry: string): string[] {
  const ind = (industry ?? "").trim().toLowerCase();
  if (!ind) return [];
  return cfg.sectorPacks
    .filter(
      (p) => p.enabled && p.industryMatch.trim().toLowerCase() === ind
    )
    .map((p) => p.key);
}

/* ----------------------------- bootstrap ---------------------------- */

export interface BdBootstrap {
  config: BdConfig;
  metricsByDeal: Record<string, DealMetricsMap>;
  sourcedFromOptions: {
    portfolioCompanies: Array<{ id: string; label: string }>;
    marketInsights: Array<{ id: string; label: string }>;
  };
}

export async function getBdBootstrap(): Promise<BdBootstrap> {
  const [config, metricsByDeal] = await Promise.all([
    getBdConfig(),
    getAllDealMetrics(),
  ]);
  const db = sql();
  let portfolioCompanies: Array<{ id: string; label: string }> = [];
  let marketInsights: Array<{ id: string; label: string }> = [];
  try {
    const rows = await db`
      SELECT id, name FROM core.companies
      WHERE stage = 'portfolio' AND deleted_at IS NULL
      ORDER BY name ASC LIMIT 100`;
    portfolioCompanies = rows.map((r) => {
      const rec = r as Record<string, unknown>;
      return { id: str(rec.id), label: str(rec.name) };
    });
  } catch {
    /* core companies unavailable — options simply empty */
  }
  try {
    const rows = await db`
      SELECT id, headline FROM mi_acquisitions
      ORDER BY announced_date DESC NULLS LAST LIMIT 50`;
    marketInsights = rows.map((r) => {
      const rec = r as Record<string, unknown>;
      return { id: str(rec.id), label: str(rec.headline) };
    });
  } catch {
    /* market intel table unavailable — options simply empty */
  }
  return { config, metricsByDeal, sourcedFromOptions: { portfolioCompanies, marketInsights } };
}

/* ------------------------- export / import -------------------------- */

import { DEAL_COLUMNS, type TabularColumn } from "../platform/tabular";
import { INVESTMENT_TYPE_LABELS } from "../types";

/** The full column set the deals import accepts: the Phase 10 grid
 * columns + the Step 1 type columns + one column per metric
 * definition (key `metric:<key>`, header = the definition label), so
 * a per-type export round-trips through the import unchanged. */
export async function dealImportColumns(): Promise<TabularColumn[]> {
  const cfg = await getBdConfig();
  const typeCols: TabularColumn[] = [
    { key: "investmentType", label: "Investment Type" },
    { key: "parentCompany", label: "Parent Company" },
    { key: "sourcedFromType", label: "Sourced From Type" },
    { key: "sourcedFromId", label: "Sourced From ID" },
  ];
  const metricCols: TabularColumn[] = cfg.definitions
    .filter((d) => d.enabled)
    .map((d) => ({ key: `metric:${d.key}`, label: d.label }));
  return [...DEAL_COLUMNS, ...typeCols, ...metricCols];
}

/** Columns for one type's export/template: base grid + type columns +
 * that type's metric columns + the A&D pack columns when the type is
 * filtered (pack fields are additive and commonly exported together). */
export function dealTypeColumns(
  cfg: BdConfig,
  typeKey: string
): TabularColumn[] {
  const metricCols = cfg.definitions
    .filter(
      (d) =>
        d.enabled &&
        (d.appliesTo === `type:${typeKey}` ||
          d.appliesTo.startsWith("sector:"))
    )
    .sort((a, b) => a.sort - b.sort)
    .map((d) => ({ key: `metric:${d.key}`, label: d.label }));
  return [
    ...DEAL_COLUMNS,
    { key: "investmentType", label: "Investment Type" },
    { key: "parentCompany", label: "Parent Company" },
    { key: "sourcedFromType", label: "Sourced From Type" },
    { key: "sourcedFromId", label: "Sourced From ID" },
    ...metricCols,
  ];
}

export async function buildDealExport(
  typeKey?: string
): Promise<{ columns: TabularColumn[]; rows: Record<string, unknown>[] }> {
  const cfg = await getBdConfig();
  const deals = await getDeals();
  const metricsByDeal = await getAllDealMetrics();
  const byId = new Map(deals.map((d) => [d.id, d]));
  const filtered = typeKey
    ? deals.filter((d) => (d.investmentType ?? "platform_lbo") === typeKey)
    : deals;
  const columns = typeKey
    ? dealTypeColumns(cfg, typeKey)
    : [
        ...DEAL_COLUMNS,
        { key: "investmentType", label: "Investment Type" },
        { key: "parentCompany", label: "Parent Company" },
      ];
  const rows = filtered.map((d) => {
    const row: Record<string, unknown> = { ...d };
    row.investmentType =
      INVESTMENT_TYPE_LABELS[d.investmentType ?? "platform_lbo"] ??
      (d.investmentType ?? "platform_lbo");
    row.parentCompany = d.parentDealId
      ? (byId.get(d.parentDealId)?.companyName ?? "")
      : "";
    const metrics = metricsByDeal[d.id] ?? {};
    for (const [key, v] of Object.entries(metrics)) {
      row[`metric:${key}`] = v.num ?? v.text ?? "";
    }
    return row;
  });
  return { columns, rows };
}

/* ----------------------------- flywheel ----------------------------- */

export interface FlywheelData {
  portfolioCompanyCount: number;
  platformCash: number | null;
  platformEbitda: number | null;
  earlyStageCommitted: number;
  earlyStageClosedCount: number;
  earlyStageDeals: Array<{ id: string; name: string; amount: number }>;
}

/** Overview flywheel (spec item 6): cash generated by platform
 * companies (Portfolio Monitoring's stored rollup — never recomputed
 * here) vs capital committed to closed early-stage investments
 * (round_size metric, falling back to asking price / deal value). */
export async function getFlywheel(): Promise<FlywheelData> {
  let platformCash: number | null = null;
  let platformEbitda: number | null = null;
  let portfolioCompanyCount = 0;
  try {
    const { getRollups } = await import("../monitoring/service");
    const roll = await getRollups();
    const payload = (roll?.payload ?? {}) as Record<string, unknown>;
    portfolioCompanyCount = Number(payload.companyCount ?? 0) || 0;
    platformCash =
      payload.totalCash === null || payload.totalCash === undefined
        ? null
        : Number(payload.totalCash);
    platformEbitda =
      payload.totalEBITDA === null || payload.totalEBITDA === undefined
        ? null
        : Number(payload.totalEBITDA);
  } catch {
    /* monitoring unavailable — honest nulls, panel shows empty state */
  }
  const deals = await getDeals();
  const metricsByDeal = await getAllDealMetrics().catch(
    () => ({}) as Record<string, DealMetricsMap>
  );
  const closed = deals.filter(
    (d) => (d.investmentType ?? "platform_lbo") === "early_stage" && d.stage === "Closed"
  );
  const items = closed.map((d) => {
    const round = metricsByDeal[d.id]?.round_size?.num;
    const amount =
      typeof round === "number" && round > 0
        ? round
        : d.askingPrice ?? d.dealValue ?? 0;
    return { id: d.id, name: d.companyName, amount };
  });
  return {
    portfolioCompanyCount,
    platformCash,
    platformEbitda,
    earlyStageCommitted: items.reduce((s, x) => s + x.amount, 0),
    earlyStageClosedCount: items.length,
    earlyStageDeals: items,
  };
}

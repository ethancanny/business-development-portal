import type { AppendixFigure } from "./types";

/**
 * Communications & Reports (Part 12) — canned sample dataset.
 *
 * A deterministic, fully self-contained dataset for
 * "Sample Manufacturing Co." used when a report is generated in
 * sample mode: every block type has data, so the sample render
 * exercises the exact same block renderers as real reports
 * (lib/comms/assemble.ts — one Sources interface, two impls).
 *
 * Honesty rules: sample figures are NEVER mixed into a real report.
 * Every figure carries sourceModule 'sample', sourceId 'sample' and
 * verification 'unreviewed', the render is stamped sample = true,
 * and the pre-send check flags a sample report going to a real
 * recipient (lib/comms/filter.ts, code 'sample_report').
 *
 * The section shapes below (CommsSectionData) are the assembly
 * contract: the real sources adapter in assemble.ts produces these
 * exact shapes from the owning modules' service functions.
 */

export interface CommsSectionData {
  status: "ok" | "missing" | "not_applicable";
  figures: AppendixFigure[];
  table?: { columns: string[]; rows: (string | number | null)[][] };
  chart?: {
    kind: "line" | "bar";
    series: { name: string; points: { x: string; y: number }[] }[];
  };
  text?: string;
}

export interface SampleDataset {
  subjectLabel: string;
  asOf: string;
  financialSummary: CommsSectionData;
  kpiTable: CommsSectionData;
  varianceTable: CommsSectionData;
  covenantStatus: CommsSectionData;
  planStatus: CommsSectionData;
  capitalStatus: CommsSectionData;
  findings: CommsSectionData;
  memo: CommsSectionData;
  /** Figure keys the sample narrative may cite (all in the appendix). */
  narrativeFigureKeys: string[];
}

export const SAMPLE_COMPANY_NAME = "Sample Manufacturing Co.";
export const SAMPLE_AS_OF = "2026-01-15";

function fig(
  key: string,
  label: string,
  value: number | string | null,
  format: AppendixFigure["format"]
): AppendixFigure {
  return {
    key,
    label,
    value,
    format,
    sourceModule: "sample",
    sourceId: "sample",
    sourceLabel: "Sample data — Sample Manufacturing Co.",
    href: "",
    verification: "unreviewed",
    confidence: null,
  };
}

const FINANCIAL_FIGURES: AppendixFigure[] = [
  fig("fin_revenue_latest", "Revenue (FY2025)", 18420000, "money"),
  fig("fin_gross_profit_latest", "Gross profit (FY2025)", 6810000, "money"),
  fig("fin_gross_margin_latest", "Gross margin (FY2025)", 37.0, "pct"),
  fig("fin_ebitda_latest", "EBITDA (FY2025)", 3940000, "money"),
  fig("fin_ebitda_margin_latest", "EBITDA margin (FY2025)", 21.4, "pct"),
  fig("fin_net_income_latest", "Net income (FY2025)", 1620000, "money"),
  fig("fin_revenue_ttm", "Revenue (TTM)", 18420000, "money"),
  fig("fin_ebitda_ttm", "EBITDA (TTM)", 3940000, "money"),
  fig("fin_revenue_yoy_pct", "Revenue growth (YoY)", 8.6, "pct"),
  fig("fin_ebitda_yoy_pct", "EBITDA growth (YoY)", 11.2, "pct"),
  fig("fin_adjusted_ebitda", "Adjusted EBITDA", 4110000, "money"),
];

const KPI_FIGURES: AppendixFigure[] = [
  fig("kpi_revenue", "Revenue (Dec 2025)", 1625000, "money"),
  fig("kpi_gross_profit", "Gross profit (Dec 2025)", 618000, "money"),
  fig("kpi_gross_margin_pct", "Gross margin (Dec 2025)", 38.0, "pct"),
  fig("kpi_ebitda", "EBITDA (Dec 2025)", 356000, "money"),
  fig("kpi_ebitda_margin_pct", "EBITDA margin (Dec 2025)", 21.9, "pct"),
  fig("kpi_net_income", "Net income (Dec 2025)", 148000, "money"),
  fig("kpi_cash", "Cash & equivalents", 1240000, "money"),
  fig("kpi_total_debt", "Total debt", 4850000, "money"),
  fig("kpi_headcount", "Headcount", 86, "number"),
  fig("kpi_customer_count", "Customer count", 142, "number"),
];

const VARIANCE_FIGURES: AppendixFigure[] = [
  fig("var_revenue_actual", "Revenue — actual (Q4 2025)", 4920000, "money"),
  fig("var_revenue_budget", "Revenue — budget (Q4 2025)", 4750000, "money"),
  fig("var_gross_profit_actual", "Gross profit — actual (Q4 2025)", 1860000, "money"),
  fig("var_gross_profit_budget", "Gross profit — budget (Q4 2025)", 1780000, "money"),
  fig("var_ebitda_actual", "EBITDA — actual (Q4 2025)", 1060000, "money"),
  fig("var_ebitda_budget", "EBITDA — budget (Q4 2025)", 985000, "money"),
];

const COVENANT_FIGURES: AppendixFigure[] = [
  fig("cov_max_total_leverage_value", "Max total leverage — computed", 1.23, "multiple"),
  fig("cov_max_total_leverage_threshold", "Max total leverage — threshold", 3.5, "multiple"),
  fig("cov_min_ebitda_value", "Minimum EBITDA — computed", 3940000, "money"),
  fig("cov_min_ebitda_threshold", "Minimum EBITDA — threshold", 2500000, "money"),
  fig("cov_min_cash_value", "Minimum cash — computed", 1240000, "money"),
  fig("cov_min_cash_threshold", "Minimum cash — threshold", 500000, "money"),
];

const PLAN_FIGURES: AppendixFigure[] = [
  fig("plan_initiatives_total", "Initiatives (total)", 9, "number"),
  fig("plan_initiatives_open", "Initiatives (open)", 6, "number"),
  fig("plan_impact_weighted", "Weighted EBITDA impact", 1150000, "money"),
  fig("plan_impact_unweighted", "Unweighted EBITDA impact", 1640000, "money"),
  fig("plan_one_time_cost", "One-time cost (total)", 420000, "money"),
];

const CAPITAL_FIGURES: AppendixFigure[] = [
  fig("cap_target_raise", "Target raise", 6000000, "money"),
  fig("cap_committed_total", "Commitments (hard + soft)", 4250000, "money"),
  fig("cap_funded_total", "Funded commitments", 3100000, "money"),
  fig("cap_investor_count", "Investor count", 7, "number"),
  fig("cap_called_total", "Capital called", 2850000, "money"),
  fig("cap_distributed_total", "Distributions", 150000, "money"),
  fig("cap_nav_total", "Net asset value", 3420000, "money"),
];

const FINDINGS_FIGURES: AppendixFigure[] = [
  fig("find_open_total", "Open findings", 6, "number"),
  fig("find_open_high", "Open findings — high severity", 1, "number"),
  fig("find_open_medium", "Open findings — medium severity", 3, "number"),
  fig("find_open_low", "Open findings — low severity", 2, "number"),
  fig("find_red_flags_confirmed", "Confirmed red flags", 1, "number"),
  fig("find_impact_total", "Quantified impact (open findings)", 385000, "money"),
];

export const SAMPLE_DATASET: SampleDataset = {
  subjectLabel: SAMPLE_COMPANY_NAME,
  asOf: SAMPLE_AS_OF,
  financialSummary: {
    status: "ok",
    figures: FINANCIAL_FIGURES,
    chart: {
      kind: "bar",
      series: [
        {
          name: "Revenue",
          points: [
            { x: "2025-Q1", y: 4210000 },
            { x: "2025-Q2", y: 4480000 },
            { x: "2025-Q3", y: 4810000 },
            { x: "2025-Q4", y: 4920000 },
          ],
        },
        {
          name: "EBITDA",
          points: [
            { x: "2025-Q1", y: 884000 },
            { x: "2025-Q2", y: 941000 },
            { x: "2025-Q3", y: 1055000 },
            { x: "2025-Q4", y: 1060000 },
          ],
        },
      ],
    },
    table: {
      columns: ["Period", "Revenue", "EBITDA", "Net income"],
      rows: [
        ["FY2024", 16960000, 3540000, 1310000],
        ["FY2025", 18420000, 3940000, 1620000],
        ["TTM", 18420000, 3940000, 1620000],
      ],
    },
  },
  kpiTable: {
    status: "ok",
    figures: KPI_FIGURES,
    table: {
      columns: ["KPI", "Value", "Period", "Source"],
      rows: [
        ["Revenue", 1625000, "Dec 2025", "Sample"],
        ["Gross profit", 618000, "Dec 2025", "Sample"],
        ["Gross margin", "38.0%", "Dec 2025", "Sample"],
        ["EBITDA", 356000, "Dec 2025", "Sample"],
        ["EBITDA margin", "21.9%", "Dec 2025", "Sample"],
        ["Net income", 148000, "Dec 2025", "Sample"],
        ["Cash & equivalents", 1240000, "Dec 2025", "Sample"],
        ["Total debt", 4850000, "Dec 2025", "Sample"],
        ["Headcount", 86, "Dec 2025", "Sample"],
        ["Customer count", 142, "Dec 2025", "Sample"],
      ],
    },
  },
  varianceTable: {
    status: "ok",
    figures: VARIANCE_FIGURES,
    table: {
      columns: ["Metric", "Actual", "Budget", "VC target", "Underwriting", "Variance vs budget"],
      rows: [
        ["Revenue", 4920000, 4750000, 4800000, 4600000, "+3.6%"],
        ["Gross profit", 1860000, 1780000, 1800000, 1690000, "+4.5%"],
        ["EBITDA", 1060000, 985000, 1020000, 940000, "+7.6%"],
      ],
    },
  },
  covenantStatus: {
    status: "ok",
    figures: COVENANT_FIGURES,
    table: {
      columns: ["Covenant", "Computed", "Threshold", "Status", "Headroom"],
      rows: [
        ["Max total leverage", "1.23x", "≤ 3.50x", "pass", "64.9%"],
        ["Minimum EBITDA", 3940000, 2500000, "pass", "57.6%"],
        ["Minimum cash", 1240000, 500000, "pass", "148.0%"],
      ],
    },
  },
  planStatus: {
    status: "ok",
    figures: PLAN_FIGURES,
    text: "Value creation plan: 9 initiatives (3 completed, 4 in progress, 2 not started). Weighted EBITDA impact $1,150,000 against $420,000 of one-time cost.",
    table: {
      columns: ["Target metric", "Period", "Target"],
      rows: [
        ["Revenue", "Q2 2026", 5100000],
        ["EBITDA margin", "Q2 2026", "22.5%"],
        ["Headcount", "Q4 2026", 95],
      ],
    },
  },
  capitalStatus: {
    status: "ok",
    figures: CAPITAL_FIGURES,
    table: {
      columns: ["Measure", "Amount"],
      rows: [
        ["Target raise", 6000000],
        ["Commitments (hard + soft)", 4250000],
        ["Funded", 3100000],
        ["Capital called", 2850000],
        ["Distributions", 150000],
        ["Net asset value", 3420000],
      ],
    },
  },
  findings: {
    status: "ok",
    figures: FINDINGS_FIGURES,
    table: {
      columns: ["Finding", "Severity", "Category", "Status", "Impact"],
      rows: [
        ["Customer concentration — top customer 18% of revenue", "high", "Revenue quality", "open", 240000],
        ["Two lathes beyond expected useful life", "medium", "Operations", "open", 85000],
        ["Month-end close takes 12 business days", "medium", "Finance", "open", null],
        ["No written succession plan for plant manager", "medium", "Management", "proposed", null],
        ["Insurance limits below peer benchmark", "low", "Risk", "open", 18000],
        ["Aged receivables over 90 days at 4.1% of AR", "low", "Working capital", "open", 42000],
        ["Red flag: owner salary above market (confirmed)", "high", "Adjustments", "confirmed", null],
      ],
    },
    text: "Open findings: 6 (high 1, medium 3, low 2). Confirmed red flags: 1. Quantified impact of open findings: $385,000.",
  },
  memo: {
    status: "ok",
    figures: [],
    text: [
      "## Business overview",
      "Sample Manufacturing Co. is a Phoenix-based precision machining business serving aerospace and industrial customers across the Southwest. Revenue has compounded steadily on multi-year supply agreements.",
      "Citations: FY2025 financial statements; management interviews.",
      "",
      "## Financial performance",
      "FY2025 revenue of $18.4M with EBITDA of $3.9M (21.4% margin). Adjusted EBITDA of $4.1M reflects a single owner-compensation normalization.",
      "Citations: Adjusted EBITDA bridge; posted FY2025 set.",
      "",
      "## Risks and open items",
      "Customer concentration (top customer 18% of revenue) and aging equipment are the principal diligence items; both carry proposed mitigations in the findings register.",
      "Citations: Findings register; red-flag log.",
    ].join("\n"),
  },
  narrativeFigureKeys: [
    "fin_revenue_latest",
    "fin_ebitda_latest",
    "fin_ebitda_margin_latest",
    "cap_called_total",
    "cap_nav_total",
  ],
};

/** The canned dataset (constant — deterministic by construction). */
export function getSampleDataset(): SampleDataset {
  return SAMPLE_DATASET;
}

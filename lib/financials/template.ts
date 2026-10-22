/**
 * Financial statement template (Phase 4) — the canonical line taxonomy
 * extracted statements are mapped onto, label→line matching, derived
 * line computation, and statement self-checks.
 *
 * Kinds: 'is' income statement, 'bs' balance sheet, 'cf' cash flow.
 * `derived` on a def names the formula that can fill the line when it
 * is missing (see computeDerivedLines). Values handled here are
 * NORMALIZED dollars (raw value × unit multiplier, applied by the
 * caller/service before checks run) — tolerance is in normalized
 * dollars per the contract: max(100, 0.5% of the larger operand).
 */

export type StatementKind = "is" | "bs" | "cf";

export interface LineDef {
  key: string;
  /** Plain-language label shown in the UI. */
  label: string;
  kind: StatementKind;
  isSubtotal: boolean;
  /** Formula key when this line can be derived from other lines. */
  derived?: string;
  synonyms: string[];
}

/**
 * A line in any shape the service/parser layer uses. compute/check
 * functions accept loose inputs (camelCase or snake_case keys, `value`
 * or `rawValue`) and return the canonical shape below.
 */
export interface FinancialLine {
  kind: StatementKind;
  lineKey: string;
  label: string;
  /** Normalized dollars. */
  value: number | null;
  rawValue?: number | null;
  isDerived: boolean;
  /** snake_case mirror of isDerived for DB-shaped consumers. */
  is_derived: boolean;
  isSubtotal: boolean;
  is_subtotal: boolean;
  confidence: number | null;
  source: Record<string, unknown>;
  sort: number;
  /** Formula key when isDerived. */
  derived?: string;
  /** Template keys this derived line was computed from. */
  derivedFrom?: string[];
}

export type LineInput = {
  kind?: string;
  statementKind?: string;
  statement_kind?: string;
  lineKey?: string;
  line_key?: string;
  label?: string;
  value?: number | null;
  rawValue?: number | null;
  raw_value?: number | null;
  isDerived?: boolean;
  is_derived?: boolean;
  isSubtotal?: boolean;
  is_subtotal?: boolean;
  confidence?: number | null;
  source?: Record<string, unknown> | null;
  sort?: number;
  [key: string]: unknown;
};

export interface FinancialChecks {
  bsPresent: boolean;
  bsBalanced: boolean | null;
  bsVariance: number | null;
  ebitdaStated: number | null;
  ebitdaComputed: number | null;
  ebitdaVariance: number | null;
  ebitdaReconciles: boolean | null;
  cfTies: boolean | null;
  cfVariance: number | null;
  flags: string[];
}

/* ------------------------------ line defs ---------------------------- */

export const LINE_DEFS: LineDef[] = [
  /* ------------------------- income statement ------------------------ */
  {
    key: "revenue",
    label: "Revenue",
    kind: "is",
    isSubtotal: false,
    synonyms: [
      "revenue", "revenues", "total revenue", "total revenues",
      "net revenue", "sales", "net sales", "total sales", "gross sales",
      "net sales revenue", "sales revenue", "total operating revenue",
      "operating revenue", "operating revenues", "gross receipts",
      "gross receipts or sales", "total receipts", "total income",
      "service revenue", "service revenues", "contract revenue",
    ],
  },
  {
    key: "cogs",
    label: "Cost of goods sold",
    kind: "is",
    isSubtotal: false,
    synonyms: [
      "cost of goods sold", "costs of goods sold", "cogs",
      "cost of revenue", "cost of revenues", "cost of sales",
      "total cost of goods sold", "cost of services", "cost of services sold",
      "direct costs", "direct cost of revenue",
    ],
  },
  {
    key: "gross_profit",
    label: "Gross profit",
    kind: "is",
    isSubtotal: true,
    derived: "gross_profit",
    synonyms: [
      "gross profit", "gross margin", "total gross profit",
      "gross profit (loss)", "gross income",
    ],
  },
  {
    // Detail operating-expense lines (rent, payroll, insurance, …).
    // Several detail lines may share this key in one statement; they
    // roll up into operating_expenses for EBITDA computation.
    key: "opex_detail",
    label: "Operating expense (detail)",
    kind: "is",
    isSubtotal: false,
    synonyms: [
      "salaries and wages", "salaries", "wages", "payroll", "payroll expenses",
      "wages and salaries", "salary expense", "compensation expense",
      "employee benefits", "benefits", "rent expense", "rent", "occupancy",
      "occupancy costs", "utilities", "telephone", "insurance expense",
      "insurance", "advertising", "advertising and promotion", "marketing",
      "marketing expenses", "promotion", "professional fees",
      "professional services", "legal and professional", "legal fees",
      "legal and accounting", "accounting fees", "consulting fees",
      "repairs and maintenance", "maintenance", "office expenses",
      "office supplies", "supplies", "travel", "travel and entertainment",
      "meals and entertainment", "vehicle expense", "fuel",
      "equipment rental", "licenses and permits", "dues and subscriptions",
      "bank charges", "bank fees", "credit card fees", "contract labor",
      "outside services", "janitorial", "security", "freight", "shipping",
      "postage", "training", "recruiting", "bad debt expense",
      "other operating expenses", "miscellaneous expenses",
    ],
  },
  {
    key: "operating_expenses",
    label: "Operating expenses",
    kind: "is",
    isSubtotal: true,
    synonyms: [
      "operating expenses", "total operating expenses",
      "total operating expense", "operating costs", "total operating costs",
      "general and administrative", "general and administrative expenses",
      "general & administrative", "total general and administrative",
      "g&a", "g & a", "sg&a", "s g & a",
      "selling general and administrative",
      "selling, general and administrative",
      "selling general & administrative",
      "selling and administrative", "selling expenses",
      "total selling general and administrative",
      "total expenses", "total costs and expenses",
    ],
  },
  {
    key: "ebitda",
    label: "EBITDA",
    kind: "is",
    isSubtotal: true,
    synonyms: [
      "ebitda", "adjusted ebitda",
      "earnings before interest taxes depreciation and amortization",
      "earnings before interest tax depreciation and amortization",
      "earnings before interest, taxes, depreciation and amortization",
    ],
  },
  {
    key: "depreciation_amortization",
    label: "Depreciation & amortization",
    kind: "is",
    isSubtotal: false,
    synonyms: [
      "depreciation and amortization", "depreciation & amortization",
      "depreciation", "amortization", "depreciation expense",
      "amortization expense", "total depreciation and amortization",
      "d&a", "depreciation and amortisation",
    ],
  },
  {
    key: "ebit",
    label: "Operating income (EBIT)",
    kind: "is",
    isSubtotal: true,
    derived: "ebit",
    synonyms: [
      "ebit", "operating income", "operating income (loss)",
      "income from operations", "income (loss) from operations",
      "earnings from operations", "operating profit", "operating earnings",
      "operating loss", "income from continuing operations",
    ],
  },
  {
    key: "interest_expense",
    label: "Interest expense",
    kind: "is",
    isSubtotal: false,
    synonyms: [
      "interest expense", "interest expense, net", "interest expense net",
      "net interest expense", "interest", "interest cost",
      "interest and finance charges", "finance costs", "financing costs",
      "interest expense and finance charges",
    ],
  },
  {
    key: "other_income",
    label: "Other income (expense)",
    kind: "is",
    isSubtotal: false,
    synonyms: [
      "other income", "other income (expense)", "other income/expense",
      "other income and expense", "other nonoperating income",
      "other revenue", "interest income", "interest and dividend income",
      "dividend income", "gain on sale", "gain on sale of assets",
      "other gains", "nonoperating income", "miscellaneous income",
      "other income net", "other, net",
    ],
  },
  {
    key: "pretax_income",
    label: "Income before taxes",
    kind: "is",
    isSubtotal: true,
    derived: "pretax_income",
    synonyms: [
      "income before income taxes", "income (loss) before income taxes",
      "income before taxes", "pretax income", "pre-tax income",
      "earnings before taxes", "earnings before income taxes",
      "income before provision for income taxes",
      "income before tax provision",
    ],
  },
  {
    key: "income_taxes",
    label: "Income taxes",
    kind: "is",
    isSubtotal: false,
    synonyms: [
      "income taxes", "income tax expense", "income tax provision",
      "provision for income taxes", "provision for taxes",
      "total income tax expense", "federal income tax",
      "income tax benefit", "taxes", "income tax",
    ],
  },
  {
    key: "net_income",
    label: "Net income",
    kind: "is",
    isSubtotal: true,
    synonyms: [
      "net income", "net income (loss)", "net earnings", "net profit",
      "net loss", "net income (loss) attributable to shareholders",
      "net income attributable to the company", "bottom line",
    ],
  },

  /* --------------------------- balance sheet ------------------------- */
  {
    key: "cash",
    label: "Cash & equivalents",
    kind: "bs",
    isSubtotal: false,
    synonyms: [
      "cash and cash equivalents", "cash & cash equivalents",
      "cash and equivalents", "cash & equivalents", "cash",
      "cash on hand", "unrestricted cash", "cash in bank",
    ],
  },
  {
    key: "accounts_receivable",
    label: "Accounts receivable",
    kind: "bs",
    isSubtotal: false,
    synonyms: [
      "accounts receivable", "accounts receivable, net",
      "accounts receivable net", "trade receivables",
      "trade accounts receivable", "receivables", "a/r",
      "accounts receivable - trade", "notes receivable - current",
    ],
  },
  {
    key: "inventory",
    label: "Inventory",
    kind: "bs",
    isSubtotal: false,
    synonyms: [
      "inventory", "inventories", "merchandise inventory",
      "finished goods inventory", "inventory - finished goods",
    ],
  },
  {
    key: "other_current_assets",
    label: "Other current assets",
    kind: "bs",
    isSubtotal: false,
    synonyms: [
      "other current assets", "prepaid expenses",
      "prepaid expenses and other current assets",
      "prepaid expenses and other", "prepaid", "prepaid insurance",
      "prepaid expenses and deposits", "deposits", "other receivables",
      "current tax receivable",
    ],
  },
  {
    key: "total_current_assets",
    label: "Total current assets",
    kind: "bs",
    isSubtotal: true,
    derived: "total_current_assets",
    synonyms: ["total current assets"],
  },
  {
    key: "ppe_net",
    label: "Property & equipment, net",
    kind: "bs",
    isSubtotal: false,
    synonyms: [
      "property and equipment, net", "property and equipment net",
      "property & equipment, net", "property and equipment",
      "property, plant and equipment", "property plant and equipment",
      "property, plant & equipment, net", "pp&e", "ppe",
      "fixed assets", "fixed assets, net", "net fixed assets",
      "net property and equipment", "property and equipment - net",
    ],
  },
  {
    key: "intangible_assets",
    label: "Intangible assets",
    kind: "bs",
    isSubtotal: false,
    synonyms: [
      "intangible assets", "intangible assets, net", "intangible assets net",
      "goodwill", "goodwill and intangible assets",
      "intangibles", "net intangible assets",
    ],
  },
  {
    key: "other_assets",
    label: "Other assets",
    kind: "bs",
    isSubtotal: false,
    synonyms: [
      "other assets", "other noncurrent assets", "other long-term assets",
      "other long term assets", "long-term investments", "investments",
      "other investments", "deferred tax assets", "security deposits",
    ],
  },
  {
    key: "total_assets",
    label: "Total assets",
    kind: "bs",
    isSubtotal: true,
    derived: "total_assets",
    synonyms: ["total assets"],
  },
  {
    key: "accounts_payable",
    label: "Accounts payable",
    kind: "bs",
    isSubtotal: false,
    synonyms: [
      "accounts payable", "trade payables", "accounts payable - trade",
      "a/p", "accounts payable and accrued expenses",
      "accounts payable & accrued expenses",
    ],
  },
  {
    key: "current_debt",
    label: "Current debt",
    kind: "bs",
    isSubtotal: false,
    synonyms: [
      "current maturities", "current maturities of long-term debt",
      "current portion of long-term debt", "current portion",
      "current portion of notes payable", "short-term debt",
      "short-term borrowings", "short term debt", "current debt",
      "notes payable - current", "notes payable, current portion",
      "line of credit", "revolving line of credit",
      "current portion of long-term obligations",
    ],
  },
  {
    key: "other_current_liabilities",
    label: "Other current liabilities",
    kind: "bs",
    isSubtotal: false,
    synonyms: [
      "other current liabilities", "accrued liabilities",
      "accrued expenses", "accrued expenses and other current liabilities",
      "accrued expenses and other", "other accrued liabilities",
      "deferred revenue", "unearned revenue", "accrued payroll",
      "accrued compensation", "customer deposits", "sales tax payable",
      "payroll taxes payable",
    ],
  },
  {
    key: "total_current_liabilities",
    label: "Total current liabilities",
    kind: "bs",
    isSubtotal: true,
    derived: "total_current_liabilities",
    synonyms: ["total current liabilities"],
  },
  {
    key: "long_term_debt",
    label: "Long-term debt",
    kind: "bs",
    isSubtotal: false,
    synonyms: [
      "long-term debt", "long term debt",
      "long-term debt, net of current portion",
      "long-term debt net of current portion",
      "long-term notes payable", "notes payable - long term",
      "notes payable, net of current portion", "long-term borrowings",
      "term loan", "mortgage payable", "mortgages payable",
    ],
  },
  {
    key: "other_liabilities",
    label: "Other liabilities",
    kind: "bs",
    isSubtotal: false,
    synonyms: [
      "other liabilities", "other noncurrent liabilities",
      "other long-term liabilities", "other long term liabilities",
      "long term liabilities", "long-term liabilities",
      "deferred tax liabilities", "deferred taxes",
    ],
  },
  {
    key: "total_liabilities",
    label: "Total liabilities",
    kind: "bs",
    isSubtotal: true,
    derived: "total_liabilities",
    synonyms: ["total liabilities"],
  },
  {
    key: "total_equity",
    label: "Total equity",
    kind: "bs",
    isSubtotal: true,
    synonyms: [
      "total equity", "total stockholders' equity", "total stockholders equity",
      "total shareholders' equity", "total shareholders equity",
      "shareholders' equity", "shareholders equity",
      "stockholders' equity", "stockholders equity",
      "members' equity", "members equity", "total members' equity",
      "total members equity", "partners' equity", "partners equity",
      "owner's equity", "owners equity", "equity",
      "total shareholder equity", "total stockholder equity",
      // Equity components seen standalone on small-company statements;
      // there is no separate equity-component key in the template.
      "retained earnings", "accumulated earnings", "member equity",
      "shareholder equity", "stockholder equity",
    ],
  },
  {
    key: "total_liab_equity",
    label: "Total liabilities & equity",
    kind: "bs",
    isSubtotal: true,
    derived: "total_liab_equity",
    synonyms: [
      "total liabilities and equity", "total liabilities & equity",
      "total liabilities and stockholders' equity",
      "total liabilities and shareholders' equity",
      "total liabilities and members' equity",
      "total liabilities, equity", "total liabilities and shareholder equity",
    ],
  },

  /* ---------------------------- cash flow ---------------------------- */
  {
    key: "cfo",
    label: "Cash flow from operations",
    kind: "cf",
    isSubtotal: true,
    synonyms: [
      "net cash provided by operating activities",
      "net cash used in operating activities",
      "net cash provided by operations", "net cash from operating activities",
      "cash flows from operating activities",
      "cash flow from operating activities", "cash flow from operations",
      "net cash flow from operating activities",
      "cash provided by operating activities",
      "cash used in operating activities",
    ],
  },
  {
    key: "cfi",
    label: "Cash flow from investing",
    kind: "cf",
    isSubtotal: true,
    synonyms: [
      "net cash used in investing activities",
      "net cash provided by investing activities",
      "net cash from investing activities",
      "cash flows from investing activities",
      "cash flow from investing activities", "cash flow from investing",
      "net cash flow from investing activities",
      "cash used in investing activities",
      "cash provided by investing activities",
    ],
  },
  {
    key: "cff",
    label: "Cash flow from financing",
    kind: "cf",
    isSubtotal: true,
    synonyms: [
      "net cash provided by financing activities",
      "net cash used in financing activities",
      "net cash from financing activities",
      "cash flows from financing activities",
      "cash flow from financing activities", "cash flow from financing",
      "net cash flow from financing activities",
      "cash provided by financing activities",
      "cash used in financing activities",
    ],
  },
  {
    key: "net_change_cash",
    label: "Net change in cash",
    kind: "cf",
    isSubtotal: true,
    derived: "net_change_cash",
    synonyms: [
      "net change in cash", "net increase in cash", "net decrease in cash",
      "net increase (decrease) in cash",
      "net increase (decrease) in cash and cash equivalents",
      "net increase in cash and cash equivalents",
      "net change in cash and cash equivalents", "change in cash",
      "increase (decrease) in cash", "increase in cash",
    ],
  },
  {
    key: "cash_begin",
    label: "Cash, beginning of period",
    kind: "cf",
    isSubtotal: false,
    synonyms: [
      "cash at beginning of period", "cash, beginning of period",
      "cash beginning of period", "beginning cash",
      "cash and cash equivalents at beginning of period",
      "cash and cash equivalents, beginning of period",
      "cash at beginning of year", "cash, beginning of year",
      "beginning cash and cash equivalents",
    ],
  },
  {
    key: "cash_end",
    label: "Cash, end of period",
    kind: "cf",
    isSubtotal: false,
    synonyms: [
      "cash at end of period", "cash, end of period",
      "cash end of period", "ending cash",
      "cash and cash equivalents at end of period",
      "cash and cash equivalents, end of period",
      "cash at end of year", "cash, end of year",
      "cash at the end of the period", "ending cash and cash equivalents",
    ],
  },
];

export const TEMPLATE_LINES_BY_KEY: Record<string, LineDef> =
  Object.fromEntries(LINE_DEFS.map((d) => [d.key, d]));

/** Sort position of a template line within its kind (template order). */
export function templateSort(kind: StatementKind, lineKey: string): number {
  const idx = LINE_DEFS.findIndex((d) => d.kind === kind && d.key === lineKey);
  return idx >= 0 ? idx * 10 : 900;
}

/* --------------------------- label matching -------------------------- */

/** Normalize a printed label for matching: lowercase, punctuation and
 * "&" folded, whitespace collapsed, light singular/plural stemming. */
export function normalizeLabel(raw: string): string {
  const cleaned = (raw ?? "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/ +/g, " ")
    .trim();
  return cleaned
    .split(" ")
    .map((t) =>
      t.length > 3 && t.endsWith("s") && !t.endsWith("ss") ? t.slice(0, -1) : t
    )
    .join(" ");
}

interface NormalizedDef {
  def: LineDef;
  label: string;
  synonyms: string[];
}

const NORMALIZED_DEFS: NormalizedDef[] = LINE_DEFS.map((def) => ({
  def,
  label: normalizeLabel(def.label),
  synonyms: def.synonyms.map((s) => normalizeLabel(s)),
}));

function tokenSet(s: string): Set<string> {
  return new Set(s.split(" ").filter(Boolean));
}

/**
 * Map a printed statement label to a template line.
 * Kind-agnostic by default; pass `kindHint` to restrict to one kind.
 * Confidence: exact synonym/label match 0.95, phrase containment 0.8,
 * token-overlap fuzzy 0.6. Returns null when nothing plausibly matches.
 */
export function mapLabelToLine(
  label: string,
  kindHint?: StatementKind
): { lineKey: string; kind: StatementKind; confidence: number } | null {
  const norm = normalizeLabel(label ?? "");
  if (!norm) return null;
  const pool = kindHint
    ? NORMALIZED_DEFS.filter((d) => d.def.kind === kindHint)
    : NORMALIZED_DEFS;

  // 1) Exact match against the def label or any synonym.
  for (const nd of pool) {
    if (norm === nd.label || nd.synonyms.includes(norm)) {
      return { lineKey: nd.def.key, kind: nd.def.kind, confidence: 0.95 };
    }
  }

  // 2) Containment: the label contains a synonym (or vice versa).
  //    Longest synonym wins so "total liabilities and equity" beats
  //    "total liabilities"/"equity" for the combined line.
  let bestContains: { nd: NormalizedDef; len: number } | null = null;
  const padded = ` ${norm} `;
  for (const nd of pool) {
    for (const syn of [nd.label, ...nd.synonyms]) {
      if (syn.length < 3) continue;
      if (
        padded.includes(` ${syn} `) ||
        (syn.length >= 8 && ` ${syn} `.includes(padded))
      ) {
        if (!bestContains || syn.length > bestContains.len) {
          bestContains = { nd, len: syn.length };
        }
      }
    }
  }
  if (bestContains) {
    return {
      lineKey: bestContains.nd.def.key,
      kind: bestContains.nd.def.kind,
      confidence: 0.8,
    };
  }

  // 3) Token-overlap fuzzy: Jaccard over token sets ≥ 0.5.
  const labelTokens = tokenSet(norm);
  let bestFuzzy: { nd: NormalizedDef; score: number } | null = null;
  for (const nd of pool) {
    for (const syn of [nd.label, ...nd.synonyms]) {
      const synTokens = tokenSet(syn);
      let inter = 0;
      labelTokens.forEach((t) => {
        if (synTokens.has(t)) inter++;
      });
      if (!inter) continue;
      const union = labelTokens.size + synTokens.size - inter;
      const score = union ? inter / union : 0;
      if (score >= 0.5 && (!bestFuzzy || score > bestFuzzy.score)) {
        bestFuzzy = { nd, score };
      }
    }
  }
  if (bestFuzzy) {
    return {
      lineKey: bestFuzzy.nd.def.key,
      kind: bestFuzzy.nd.def.kind,
      confidence: 0.6,
    };
  }
  return null;
}

/* --------------------------- derived lines --------------------------- */

/** Tolerance in normalized dollars: max(100, 0.5% of the larger). */
export function toleranceFor(a: number, b: number): number {
  return Math.max(100, 0.005 * Math.max(Math.abs(a), Math.abs(b)));
}

function finiteOrNull(v: number | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return isFinite(n) ? n : null;
}

/** Normalize a loose line input into the canonical FinancialLine. */
export function normalizeLine(input: LineInput): FinancialLine {
  const def =
    TEMPLATE_LINES_BY_KEY[input.lineKey ?? input.line_key ?? ""];
  const kindRaw = input.kind ?? input.statementKind ?? input.statement_kind;
  const kind: StatementKind =
    kindRaw === "bs" || kindRaw === "cf" || kindRaw === "is"
      ? kindRaw
      : def
        ? def.kind
        : "is";
  const lineKey = input.lineKey ?? input.line_key ?? def?.key ?? "unmapped";
  const value = finiteOrNull(input.value ?? input.rawValue ?? input.raw_value);
  const isDerived = Boolean(input.isDerived ?? input.is_derived ?? false);
  const isSubtotal = Boolean(
    input.isSubtotal ?? input.is_subtotal ?? def?.isSubtotal ?? false
  );
  return {
    kind,
    lineKey,
    label: input.label ?? def?.label ?? "",
    value,
    rawValue: finiteOrNull(input.rawValue ?? input.raw_value ?? input.value),
    isDerived,
    is_derived: isDerived,
    isSubtotal,
    is_subtotal: isSubtotal,
    confidence: finiteOrNull(input.confidence),
    source: input.source ?? {},
    sort: typeof input.sort === "number" ? input.sort : templateSort(kind, lineKey),
    ...(def?.derived && isDerived ? { derived: def.derived } : {}),
  };
}

function firstValue(lines: FinancialLine[], key: string): number | null {
  for (const l of lines) {
    if (l.lineKey === key && l.value !== null) return l.value;
  }
  return null;
}

function sumValues(lines: FinancialLine[], key: string): number | null {
  let sum = 0;
  let seen = false;
  for (const l of lines) {
    if (l.lineKey === key && l.value !== null) {
      sum += l.value;
      seen = true;
    }
  }
  return seen ? sum : null;
}

function confidenceOf(lines: FinancialLine[], key: string): number {
  for (const l of lines) {
    if (l.lineKey === key && l.value !== null) {
      return l.confidence ?? 1;
    }
  }
  return 1;
}

interface DerivedSpec {
  key: string;
  /** Returns the computed value, or null when inputs are insufficient. */
  compute: (get: (key: string) => number | null) => number | null;
  /** Input keys the value actually depends on (confidence + provenance). */
  inputs: string[];
  minInputs: number;
}

const DERIVED_SPECS: DerivedSpec[] = [
  {
    key: "gross_profit",
    compute: (get) => {
      const r = get("revenue");
      const c = get("cogs");
      return r !== null && c !== null ? r - c : null;
    },
    inputs: ["revenue", "cogs"],
    minInputs: 2,
  },
  {
    key: "ebit",
    compute: (get) => {
      const e = get("ebitda");
      const da = get("depreciation_amortization");
      return e !== null && da !== null ? e - da : null;
    },
    inputs: ["ebitda", "depreciation_amortization"],
    minInputs: 2,
  },
  {
    key: "pretax_income",
    compute: (get) => {
      const ebit = get("ebit");
      if (ebit === null) return null;
      const interest = get("interest_expense") ?? 0;
      const other = get("other_income") ?? 0;
      return ebit - interest + other;
    },
    inputs: ["ebit", "interest_expense", "other_income"],
    minInputs: 1,
  },
  {
    // Component sums only when at least two components are present —
    // a lone component is not a total.
    key: "total_current_assets",
    compute: (get) => {
      const parts = [
        get("cash"),
        get("accounts_receivable"),
        get("inventory"),
        get("other_current_assets"),
      ].filter((v): v is number => v !== null);
      return parts.length >= 2
        ? parts.reduce((a, b) => a + b, 0)
        : null;
    },
    inputs: ["cash", "accounts_receivable", "inventory", "other_current_assets"],
    minInputs: 2,
  },
  {
    key: "total_current_liabilities",
    compute: (get) => {
      const parts = [
        get("accounts_payable"),
        get("current_debt"),
        get("other_current_liabilities"),
      ].filter((v): v is number => v !== null);
      return parts.length >= 2
        ? parts.reduce((a, b) => a + b, 0)
        : null;
    },
    inputs: ["accounts_payable", "current_debt", "other_current_liabilities"],
    minInputs: 2,
  },
  {
    key: "total_assets",
    compute: (get) => {
      const tca = get("total_current_assets");
      if (tca === null) return null;
      const rest = [
        get("ppe_net"),
        get("intangible_assets"),
        get("other_assets"),
      ].filter((v): v is number => v !== null);
      if (!rest.length) return null;
      return tca + rest.reduce((a, b) => a + b, 0);
    },
    inputs: ["total_current_assets", "ppe_net", "intangible_assets", "other_assets"],
    minInputs: 2,
  },
  {
    key: "total_liabilities",
    compute: (get) => {
      const tcl = get("total_current_liabilities");
      if (tcl === null) return null;
      const ltd = get("long_term_debt") ?? 0;
      const other = get("other_liabilities") ?? 0;
      return tcl + ltd + other;
    },
    inputs: ["total_current_liabilities", "long_term_debt", "other_liabilities"],
    minInputs: 1,
  },
  {
    key: "total_liab_equity",
    compute: (get) => {
      const tl = get("total_liabilities");
      const te = get("total_equity");
      return tl !== null && te !== null ? tl + te : null;
    },
    inputs: ["total_liabilities", "total_equity"],
    minInputs: 2,
  },
  {
    key: "net_change_cash",
    compute: (get) => {
      const o = get("cfo");
      const i = get("cfi");
      const f = get("cff");
      return o !== null && i !== null && f !== null ? o + i + f : null;
    },
    inputs: ["cfo", "cfi", "cff"],
    minInputs: 3,
  },
];

/**
 * Fill MISSING derived lines from the lines present (contract formulas
 * in DERIVED_SPECS). Existing lines are never overwritten. Derived
 * lines get isDerived/is_derived = true and confidence =
 * min(input confidences, 0.9). Iterates so chained derivations
 * (e.g. total_current_assets → total_assets) resolve in one call.
 * Input values are normalized dollars (value ?? rawValue).
 */
export function computeDerivedLines(inputs: LineInput[]): FinancialLine[] {
  const lines = inputs.map(normalizeLine);
  const get = (key: string) => firstValue(lines, key);
  for (let pass = 0; pass < DERIVED_SPECS.length; pass++) {
    let added = false;
    for (const spec of DERIVED_SPECS) {
      if (firstValue(lines, spec.key) !== null) continue;
      if (lines.some((l) => l.lineKey === spec.key)) continue;
      const value = spec.compute(get);
      if (value === null) continue;
      const def = TEMPLATE_LINES_BY_KEY[spec.key];
      const presentInputs = spec.inputs.filter((k) => get(k) !== null);
      if (presentInputs.length < spec.minInputs) continue;
      const confidence = Math.min(
        0.9,
        ...presentInputs.map((k) => confidenceOf(lines, k))
      );
      lines.push({
        kind: def.kind,
        lineKey: spec.key,
        label: def.label,
        value,
        rawValue: value,
        isDerived: true,
        is_derived: true,
        isSubtotal: def.isSubtotal,
        is_subtotal: def.isSubtotal,
        confidence,
        source: {},
        sort: templateSort(def.kind, spec.key),
        derived: spec.key,
        derivedFrom: presentInputs,
      });
      added = true;
    }
    if (!added) break;
  }
  return lines;
}

/** Contract-name alias (Phase 4 spec: computeDerived(lines)). */
export const computeDerived = computeDerivedLines;

/* ------------------------------- checks ------------------------------ */

/**
 * Statement self-checks over normalized-dollar line values.
 * EBITDA computed: prefer EBIT + D&A; else revenue − COGS − operating
 * expenses (stated operating_expenses total, or the sum of opex_detail
 * lines). NOTE the contract assumption: when D&A is a separate line,
 * whether it is already included in the operating-expenses total is
 * unknowable from the statement — the review screen surfaces this.
 * BS imbalance is flagged, never "fixed".
 */
export function runChecks(
  inputs: LineInput[],
  // Optional statement-set context (contract signature runChecks(lines,
  // set)); checks are line-derived, the param is accepted for callers
  // that have the set at hand.
  _set?: { periodType?: string } | null
): FinancialChecks {
  const lines = inputs.map(normalizeLine);
  const get = (key: string) => firstValue(lines, key);
  const flags: string[] = [];

  const isPresent = lines.some((l) => l.kind === "is" && l.value !== null);
  const bsPresent = lines.some((l) => l.kind === "bs" && l.value !== null);
  const cfPresent = lines.some((l) => l.kind === "cf" && l.value !== null);

  /* balance sheet */
  let bsBalanced: boolean | null = null;
  let bsVariance: number | null = null;
  const totalAssets = get("total_assets");
  const totalLiabEquity =
    get("total_liab_equity") ??
    (() => {
      const tl = get("total_liabilities");
      const te = get("total_equity");
      return tl !== null && te !== null ? tl + te : null;
    })();
  if (totalAssets !== null && totalLiabEquity !== null) {
    bsVariance = totalAssets - totalLiabEquity;
    bsBalanced =
      Math.abs(bsVariance) <= toleranceFor(totalAssets, totalLiabEquity);
    if (!bsBalanced) flags.push("does_not_balance");
  }
  if (!bsPresent) flags.push("missing_balance_sheet");
  if (!isPresent) flags.push("missing_income_statement");

  /* EBITDA */
  const ebitdaStated = get("ebitda");
  let ebitdaComputed: number | null = null;
  const ebit = get("ebit");
  const da = get("depreciation_amortization");
  if (ebit !== null && da !== null) {
    ebitdaComputed = ebit + da;
  } else {
    const revenue = get("revenue");
    const cogs = get("cogs");
    const opex = get("operating_expenses") ?? sumValues(lines, "opex_detail");
    if (revenue !== null && cogs !== null && opex !== null) {
      ebitdaComputed = revenue - cogs - opex;
    }
  }
  let ebitdaVariance: number | null = null;
  let ebitdaReconciles: boolean | null = null;
  if (ebitdaStated !== null && ebitdaComputed !== null) {
    ebitdaVariance = ebitdaStated - ebitdaComputed;
    ebitdaReconciles =
      Math.abs(ebitdaVariance) <= toleranceFor(ebitdaStated, ebitdaComputed);
    if (!ebitdaReconciles) flags.push("ebitda_variance");
  }

  /* cash flow ties */
  let cfTies: boolean | null = null;
  let cfVariance: number | null = null;
  if (cfPresent) {
    const cfo = get("cfo");
    const cfi = get("cfi");
    const cff = get("cff");
    const flowSum =
      cfo !== null && cfi !== null && cff !== null ? cfo + cfi + cff : null;
    const netChange = get("net_change_cash") ?? flowSum;
    const cashBegin = get("cash_begin");
    const cashEnd = get("cash_end");
    if (cashBegin !== null && netChange !== null && cashEnd !== null) {
      cfVariance = cashBegin + netChange - cashEnd;
      cfTies = Math.abs(cfVariance) <= toleranceFor(cashEnd, cashBegin + netChange);
    } else if (flowSum !== null && get("net_change_cash") !== null) {
      cfVariance = flowSum - (get("net_change_cash") as number);
      cfTies = Math.abs(cfVariance) <= toleranceFor(flowSum, get("net_change_cash") as number);
    }
  }

  /* completeness */
  const incomplete =
    (isPresent && (get("revenue") === null || get("net_income") === null)) ||
    (bsPresent && totalAssets === null) ||
    (!isPresent && !bsPresent);
  if (incomplete) flags.push("incomplete_period");

  return {
    bsPresent,
    bsBalanced,
    bsVariance,
    ebitdaStated,
    ebitdaComputed,
    ebitdaVariance,
    ebitdaReconciles,
    cfTies,
    cfVariance,
    flags,
  };
}

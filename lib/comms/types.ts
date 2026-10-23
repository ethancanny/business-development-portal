/**
 * Communications & Reports (Part 12) — shared types.
 *
 * Verbatim from the Part 12 build contract (~/workspace/.p12push/
 * CONTRACT.md, "Shared types" section). Every comms workstream
 * (schema / sample / assemble / filter / service / ai / delivery /
 * pdf / UI) imports these shapes from here — never re-declares them.
 *
 * A ReportRender is the single stored representation of a report
 * version: the internal detail view, the audience-filtered preview
 * and the guest recipient view all render from it (via
 * filterRenderForAudience in lib/comms/filter.ts), and the PDF is
 * built from the same filtered render.
 */

export const AUDIENCES = [
  "investor",
  "lender",
  "seller",
  "portfolio_manager",
  "board",
  "internal",
] as const;

export type Audience = (typeof AUDIENCES)[number];

export const PURPOSES = [
  "investor_update",
  "investment_memo",
  "ic_memo",
  "lender_package",
  "seller_feedback",
  "board_packet",
  "portfolio_monthly",
  "diligence_summary",
] as const;

export type Purpose = (typeof PURPOSES)[number];

export const BLOCK_TYPES = [
  "financial_summary",
  "kpi_table",
  "variance_table",
  "covenant_status",
  "plan_status",
  "capital_status",
  "findings",
  "memo",
  "narrative",
  "text",
  "internal_notes",
] as const;

export type BlockType = (typeof BLOCK_TYPES)[number];

export type BlockVisibility = "all" | "internal_only";

export type BlockDataStatus = "ok" | "missing" | "not_applicable";

export type FigureFormat = "money" | "pct" | "multiple" | "number" | "text";

export type FigureVerification = "reviewed" | "unreviewed";

export interface TemplateBlock {
  key: string;
  type: BlockType | string;
  heading: string;
  visibility: BlockVisibility;
  config?: { text?: string; note?: string };
}

export interface AppendixFigure {
  key: string;
  label: string;
  value: number | string | null;
  format: FigureFormat;
  sourceModule: string;
  sourceId: string;
  sourceLabel: string;
  href: string;
  verification: FigureVerification;
  confidence: number | null;
}

export interface NarrativeStatement {
  text: string;
  figureKeys: string[];
}

export interface RenderBlock {
  key: string;
  type: BlockType | string;
  heading: string;
  visibility: BlockVisibility;
  dataStatus: BlockDataStatus;
  figures: AppendixFigure[];
  table?: { columns: string[]; rows: (string | number | null)[][] };
  chart?: {
    kind: "line" | "bar";
    series: { name: string; points: { x: string; y: number }[] }[];
  };
  text?: string;
  narrative?: { status: string; statements: NarrativeStatement[] };
}

export interface ReportRender {
  title: string;
  subjectLabel: string;
  asOf: string;
  sample: boolean;
  firm: "Canny Capital Partners";
  disclaimers: string[];
  blocks: RenderBlock[];
  warnings: string[];
}

export interface CheckIssue {
  code: string;
  message: string;
  blockKey?: string;
}

/* ------------------------- template + subject ------------------------ */

/** The template shape assemble / routineAllowed / the service layer
 * share. Mirrors the comms.templates row (camelCase projection). */
export interface CommsTemplate {
  id: string;
  name: string;
  purpose: string;
  audience: Audience | string;
  subjectKinds: string[];
  blocks: TemplateBlock[];
  tone: string;
  disclaimers: string[];
  routine: boolean;
  isSystem: boolean;
}

/** Alias — several call sites read more naturally with this name. */
export type Template = CommsTemplate;

export type SubjectKind =
  | "company"
  | "deal"
  | "investor"
  | "portfolio_company"
  | string;

export interface ReportSubject {
  subjectKind?: SubjectKind;
  /** Alias for subjectKind — the reports/schedules services build
   * the subject from a stored row whose field is named `kind`. */
  kind?: SubjectKind;
  companyId?: string | null;
  dealId?: string | null;
  personId?: string | null;
  /** Display label; assemble substitutes a default when empty. */
  subjectLabel?: string;
}

/**
 * A template may run on a recurring schedule ("routine") only when it
 * is not a judgment document (investment / IC memo) and carries no
 * AI/manual narrative block — narrative content is never sent
 * unattended. The comms.templates CHECK constraint is the DB
 * backstop for the purpose half of this rule.
 */
export function routineAllowed(template: {
  purpose: string;
  blocks: TemplateBlock[];
}): boolean {
  if (
    template.purpose === "investment_memo" ||
    template.purpose === "ic_memo"
  ) {
    return false;
  }
  return !(template.blocks ?? []).some((b) => b.type === "narrative");
}

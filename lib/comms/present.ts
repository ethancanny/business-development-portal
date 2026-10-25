import type {
  AppendixFigure,
  RenderBlock,
  ReportRender,
} from "./types";

/**
 * Report presentation model (Report viewer redesign, Oct 24, 2026).
 *
 * PURE and shared: the web document (components/comms/ReportDocument),
 * the sender preview warnings, and the PDF renderer all consume this
 * one model, so what a recipient sees on the web is what the PDF
 * prints and what the sender previewed. Nothing here reads the DB,
 * the clock, or ambient state — every input arrives as an argument.
 *
 * Rules encoded here (Ethan's spec):
 *  - Sections with no data are HIDDEN for recipients — "Not
 *    applicable" / "Data missing" blocks never render outside the
 *    internal view. Hidden sections are reported in `hidden` so the
 *    SENDER preview can warn about exactly what will not show.
 *  - The executive summary is DERIVED from the stored render only
 *    (figures, tables, findings text, approved narrative statements)
 *    — no recompute, no invented numbers, no AI text.
 *  - Footnotes: every figure gets a stable number by appendix order;
 *    sections reference their figures by number and the appendix
 *    lists them in the same order.
 */

export interface PresentTile {
  key: string;
  label: string;
  value: string;
  delta?: string;
  deltaTone?: "up" | "down" | "flat";
}

export interface PresentTakeaway {
  text: string;
  sectionKey: string;
}

export interface PresentSection {
  key: string;
  heading: string;
  type: string;
  /** One-line conclusion derived from stored data; "" when none. */
  headline: string;
  block: RenderBlock;
  /** Footnote numbers (appendix order) for this section's figures. */
  figureNotes: number[];
  internalOnly: boolean;
  dataStatus: string;
}

export interface HiddenSection {
  key: string;
  heading: string;
  reason: "missing" | "not_applicable" | "internal_only" | "empty";
}

export interface PresentModel {
  sections: PresentSection[];
  hidden: HiddenSection[];
  exec: { tiles: PresentTile[]; takeaways: PresentTakeaway[] } | null;
  /** Visible figures, deduped by key, in appendix (first-use) order. */
  appendix: AppendixFigure[];
  /** figure key -> footnote number (1-based, appendix order). */
  footnotes: Record<string, number>;
  showToc: boolean;
}

/* --------------------------- formatting --------------------------- */

export function formatFigure(fig: AppendixFigure): string {
  if (fig.value === null || fig.value === undefined || fig.value === "") {
    return "—";
  }
  if (typeof fig.value === "string") return fig.value;
  const n = fig.value;
  switch (fig.format) {
    case "money":
      return `$${Math.round(n).toLocaleString("en-US")}`;
    case "pct":
      return `${(Math.abs(n) <= 1 ? n * 100 : n).toFixed(1)}%`;
    case "multiple":
      return `${n.toFixed(2)}x`;
    case "number":
      return n.toLocaleString("en-US");
    default:
      return String(n);
  }
}

/** Table cells: numbers get thousands separators; strings pass
 * through untouched (many cells are pre-formatted at assembly). */
export function formatCell(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "number") {
    return Number.isInteger(v)
      ? v.toLocaleString("en-US")
      : v.toLocaleString("en-US", { maximumFractionDigits: 2 });
  }
  return v;
}

/** Right-align a column when most of its non-empty cells are numeric
 * or look numeric (money / pct / multiple strings included). */
export function columnAlign(
  rows: (string | number | null)[][],
  idx: number
): "left" | "right" {
  let numeric = 0;
  let total = 0;
  for (const row of rows) {
    const v = row[idx];
    if (v === null || v === undefined || v === "") continue;
    total++;
    if (typeof v === "number") numeric++;
    else if (/^-?\$?[\d,]+(\.\d+)?%?x?$/.test(String(v).trim())) numeric++;
  }
  return total > 0 && numeric / total >= 0.6 ? "right" : "left";
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** "2026-01-15" / ISO timestamp -> "January 15, 2026". Unparseable
 * input passes through unchanged. */
export function fmtDateLong(iso: string | null | undefined): string {
  if (!iso) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const month = MONTHS[Number(m[2]) - 1];
  if (!month) return iso;
  return `${month} ${Number(m[3])}, ${m[1]}`;
}

/** Reporting-period label derived from purpose + as-of date. Monthly
 * cadence purposes get "Month ended …"; everything else "As of …". */
export function periodLabel(
  purpose: string | undefined,
  asOf: string | null | undefined
): string {
  if (!asOf) return "";
  if (purpose === "portfolio_monthly" || purpose === "investor_update") {
    const m = /^(\d{4})-(\d{2})/.exec(asOf);
    if (m && MONTHS[Number(m[2]) - 1]) {
      return `Month ended ${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
    }
  }
  return `As of ${fmtDateLong(asOf)}`;
}

/** The audience-driven confidentiality line (spec §5). Template
 * disclaimers are separate and editable; this line is structural. */
export function confidentialityLine(
  audience: string | undefined,
  recipientName: string | null | undefined
): string {
  if (audience === "internal") return "Internal only.";
  const who = (recipientName ?? "").trim() || "the named recipient";
  return `Confidential — prepared for ${who}. Do not forward or distribute.`;
}

/* --------------------------- derivation --------------------------- */

function firstSentence(text: string | undefined, max = 180): string {
  if (!text) return "";
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return "";
  const cut = clean.search(/[.!?](\s|$)/);
  const s = cut > 0 ? clean.slice(0, cut + 1) : clean;
  return s.length > max ? `${s.slice(0, max - 1).trim()}…` : s;
}

function figMap(blocks: RenderBlock[]): Map<string, AppendixFigure> {
  const map = new Map<string, AppendixFigure>();
  for (const b of blocks) {
    for (const f of b.figures ?? []) {
      if (f.key && !map.has(f.key)) map.set(f.key, f);
    }
  }
  return map;
}

function pickFig(
  map: Map<string, AppendixFigure>,
  keys: string[]
): AppendixFigure | undefined {
  for (const k of keys) {
    const f = map.get(k);
    if (f && f.value !== null && f.value !== undefined && f.value !== "") {
      return f;
    }
  }
  return undefined;
}

function pctDelta(
  map: Map<string, AppendixFigure>,
  key: string
): { text: string; tone: "up" | "down" | "flat" } | undefined {
  const f = map.get(key);
  if (!f || typeof f.value !== "number") return undefined;
  const pct = Math.abs(f.value) <= 1 ? f.value * 100 : f.value;
  const tone = pct > 0.05 ? "up" : pct < -0.05 ? "down" : "flat";
  return {
    text: `${pct > 0 ? "+" : ""}${pct.toFixed(1)}% YoY`,
    tone,
  };
}

function buildTiles(
  purpose: string | undefined,
  map: Map<string, AppendixFigure>,
  sections: PresentSection[]
): PresentTile[] {
  const tiles: PresentTile[] = [];
  const add = (
    key: string,
    label: string,
    fig: AppendixFigure | undefined,
    deltaKey?: string
  ) => {
    if (!fig || tiles.length >= 5) return;
    const d = deltaKey ? pctDelta(map, deltaKey) : undefined;
    tiles.push({
      key,
      label,
      value: formatFigure(fig),
      delta: d?.text,
      deltaTone: d?.tone,
    });
  };

  const revenue = pickFig(map, ["fin_revenue_ttm", "fin_revenue_latest", "kpi_revenue"]);
  const ebitda = pickFig(map, ["fin_adjusted_ebitda", "fin_ebitda_ttm", "fin_ebitda_latest", "kpi_ebitda"]);
  const margin = pickFig(map, ["fin_ebitda_margin_latest", "kpi_ebitda_margin_pct", "fin_gross_margin_latest"]);
  const cash = pickFig(map, ["kpi_cash"]);

  if (purpose === "diligence_summary") {
    add("findings", "Open findings", pickFig(map, ["find_open_total"]));
    add("findings_high", "High severity", pickFig(map, ["find_open_high"]));
    add("red_flags", "Confirmed red flags", pickFig(map, ["find_red_flags_confirmed"]));
    add("impact", "Quantified impact", pickFig(map, ["find_impact_total"]));
    add("revenue", "Revenue", revenue, "fin_revenue_yoy_pct");
    add("ebitda", ebitda?.label ?? "EBITDA", ebitda, "fin_ebitda_yoy_pct");
    return tiles;
  }

  add("revenue", "Revenue", revenue, "fin_revenue_yoy_pct");
  add("ebitda", ebitda?.label ?? "EBITDA", ebitda, "fin_ebitda_yoy_pct");
  add("margin", "EBITDA margin", margin);
  add("cash", "Cash", cash);
  if (purpose === "investor_update" || purpose === "portfolio_monthly") {
    add("nav", "Net asset value", pickFig(map, ["cap_nav_total"]));
    add("plan_impact", "Weighted EBITDA impact", pickFig(map, ["plan_impact_weighted"]));
  }
  // Covenant headroom tile: the tightest headroom in the covenant
  // table, when the section is visible.
  const cov = sections.find((s) => s.type === "covenant_status");
  if (cov?.block.table) {
    const headIdx = cov.block.table.columns.findIndex((c) =>
      /headroom/i.test(c)
    );
    const statusIdx = cov.block.table.columns.findIndex((c) =>
      /status/i.test(c)
    );
    if (headIdx >= 0) {
      let tightest: number | null = null;
      let allOk = true;
      for (const row of cov.block.table.rows) {
        const h = row[headIdx];
        const n =
          typeof h === "number"
            ? h
            : typeof h === "string"
              ? parseFloat(h.replace(/[^0-9.-]/g, ""))
              : NaN;
        if (!Number.isNaN(n) && (tightest === null || n < tightest)) {
          tightest = n;
        }
        if (statusIdx >= 0) {
          const st = String(row[statusIdx] ?? "").toLowerCase();
          if (st && !/complian|pass|ok|met/.test(st)) allOk = false;
        }
      }
      if (tightest !== null && tiles.length < 5) {
        tiles.push({
          key: "covenant_headroom",
          label: "Covenant headroom (tightest)",
          value: `${tightest.toFixed(1)}%`,
          delta: allOk ? "All tests in compliance" : "See covenant section",
          deltaTone: allOk ? "up" : "down",
        });
      }
    }
  }
  return tiles;
}

function headlineFor(section: PresentSection, map: Map<string, AppendixFigure>): string {
  const b = section.block;
  switch (b.type) {
    case "financial_summary": {
      const rev = pickFig(map, ["fin_revenue_ttm", "fin_revenue_latest", "kpi_revenue"]);
      const eb = pickFig(map, ["fin_adjusted_ebitda", "fin_ebitda_ttm", "fin_ebitda_latest", "kpi_ebitda"]);
      const mg = pickFig(map, ["fin_ebitda_margin_latest", "kpi_ebitda_margin_pct"]);
      const parts: string[] = [];
      if (rev) parts.push(`Revenue ${formatFigure(rev)}`);
      if (eb) parts.push(`${eb.label.toLowerCase().includes("adjusted") ? "Adj. EBITDA" : "EBITDA"} ${formatFigure(eb)}`);
      if (mg) parts.push(`margin ${formatFigure(mg)}`);
      return parts.length ? `${parts.join(" · ")}.` : firstSentence(b.text);
    }
    case "findings":
      return firstSentence(b.text);
    case "covenant_status": {
      if (b.table) {
        const statusIdx = b.table.columns.findIndex((c) => /status/i.test(c));
        if (statusIdx >= 0 && b.table.rows.length) {
          const okCount = b.table.rows.filter((r) =>
            /complian|pass|ok|met/i.test(String(r[statusIdx] ?? ""))
          ).length;
          return okCount === b.table.rows.length
            ? `All ${b.table.rows.length} covenant tests in compliance.`
            : `${okCount} of ${b.table.rows.length} covenant tests in compliance.`;
        }
      }
      return firstSentence(b.text);
    }
    case "variance_table": {
      if (b.table) {
        const varIdx = b.table.columns.length - 1;
        let material = 0;
        for (const row of b.table.rows) {
          const v = row[varIdx];
          const n =
            typeof v === "number"
              ? v
              : typeof v === "string"
                ? parseFloat(v.replace(/[^0-9.-]/g, ""))
                : NaN;
          if (!Number.isNaN(n) && Math.abs(n) >= 5) material++;
        }
        return material
          ? `${material} of ${b.table.rows.length} lines moved materially against budget (≥5%).`
          : `All ${b.table.rows.length} lines are within 5% of budget.`;
      }
      return firstSentence(b.text);
    }
    case "plan_status": {
      const total = pickFig(map, ["plan_initiatives_total"]);
      const open = pickFig(map, ["plan_initiatives_open"]);
      const impact = pickFig(map, ["plan_impact_weighted"]);
      const parts: string[] = [];
      if (total) parts.push(`${formatFigure(total)} initiatives`);
      if (open) parts.push(`${formatFigure(open)} open`);
      if (impact) parts.push(`weighted EBITDA impact ${formatFigure(impact)}`);
      return parts.length ? `${parts.join(" · ")}.` : firstSentence(b.text);
    }
    case "capital_status": {
      const nav = pickFig(map, ["cap_nav_total"]);
      const called = pickFig(map, ["cap_called_total"]);
      const parts: string[] = [];
      if (nav) parts.push(`NAV ${formatFigure(nav)}`);
      if (called) parts.push(`called ${formatFigure(called)}`);
      return parts.length ? `${parts.join(" · ")}.` : firstSentence(b.text);
    }
    case "kpi_table": {
      const count = b.table?.rows.length ?? b.figures.length;
      return count ? `${count} key performance indicators for the period.` : "";
    }
    case "narrative": {
      const s = b.narrative?.statements?.[0];
      return s ? firstSentence(s.text) : "";
    }
    case "memo":
      return "";
    case "text":
      // A text block's content IS its body — a headline derived
      // from it would print the same sentence twice.
      return "";
    default:
      return firstSentence(b.text);
  }
}

/** "note 3" / "notes 3, 5" / "notes 7–17" — contiguous runs
 * collapse to a range so long source lists stay readable. */
export function notesLabel(notes: number[]): string {
  if (!notes.length) return "";
  const sorted = [...notes].sort((a, b) => a - b);
  const parts: string[] = [];
  let start = sorted[0];
  let prev = sorted[0];
  const flush = () => {
    parts.push(start === prev ? `${start}` : `${start}–${prev}`);
  };
  for (const n of sorted.slice(1)) {
    if (n === prev + 1) {
      prev = n;
      continue;
    }
    flush();
    start = prev = n;
  }
  flush();
  return `${sorted.length === 1 ? "note" : "notes"} ${parts.join(", ")}`;
}

function buildTakeaways(
  sections: PresentSection[],
  map: Map<string, AppendixFigure>
): PresentTakeaway[] {
  const out: PresentTakeaway[] = [];
  const push = (text: string, sectionKey: string) => {
    const t = text.trim();
    if (t && out.length < 5 && !out.some((x) => x.text === t)) {
      out.push({ text: t, sectionKey });
    }
  };
  // 1. Approved/manual narrative statements lead (they are the
  // sender's own words for this report).
  for (const s of sections) {
    if (s.type !== "narrative") continue;
    for (const st of s.block.narrative?.statements ?? []) {
      push(firstSentence(st.text, 200), s.key);
      if (out.length >= 3) break;
    }
    if (out.length >= 3) break;
  }
  // 2. Findings summary.
  const findings = sections.find((s) => s.type === "findings");
  if (findings?.block.text) push(firstSentence(findings.block.text, 200), findings.key);
  // 3. Headline financial movement.
  const fin = sections.find((s) => s.type === "financial_summary");
  if (fin) {
    const yoy = map.get("fin_revenue_yoy_pct");
    const rev = pickFig(map, ["fin_revenue_ttm", "fin_revenue_latest"]);
    if (yoy && typeof yoy.value === "number" && rev) {
      const pct = Math.abs(yoy.value) <= 1 ? yoy.value * 100 : yoy.value;
      push(
        `Revenue ${formatFigure(rev)}, ${pct >= 0 ? "up" : "down"} ${Math.abs(pct).toFixed(1)}% year over year.`,
        fin.key
      );
    } else if (fin.headline) {
      push(fin.headline, fin.key);
    }
  }
  // 4. Covenant position.
  const cov = sections.find((s) => s.type === "covenant_status");
  if (cov?.headline) push(cov.headline, cov.key);
  // 5. Variance exceptions.
  const variance = sections.find((s) => s.type === "variance_table");
  if (variance?.headline) push(variance.headline, variance.key);
  return out;
}

/* ------------------------- section ordering ------------------------ */

/** Canonical section order per purpose (spec §3 maps). Blocks whose
 * type is not listed keep template order after the listed ones. */
const PURPOSE_ORDER: Record<string, string[]> = {
  diligence_summary: ["text", "findings", "financial_summary", "memo", "narrative"],
  investor_update: ["narrative", "financial_summary", "variance_table", "plan_status", "covenant_status", "capital_status"],
  investment_memo: ["narrative", "memo", "financial_summary", "findings"],
  ic_memo: ["financial_summary", "findings", "memo", "narrative"],
  seller_feedback: ["text", "financial_summary", "findings", "narrative"],
  lender_package: ["financial_summary", "kpi_table", "covenant_status", "variance_table"],
  board_packet: ["kpi_table", "variance_table", "covenant_status", "plan_status", "capital_status"],
  portfolio_monthly: ["kpi_table", "variance_table", "covenant_status", "plan_status"],
};

/** Within repeated types (two narrative blocks in an investor
 * update), "highlights" leads and "outlook/asks" closes. */
function narrativeSubRank(block: RenderBlock): number {
  const k = `${block.key} ${block.heading}`.toLowerCase();
  if (/highlight|thesis/.test(k)) return 0;
  if (/outlook|ask|recommend|next steps/.test(k)) return 2;
  return 1;
}

function orderSections(
  sections: PresentSection[],
  purpose: string | undefined
): PresentSection[] {
  const order = purpose ? PURPOSE_ORDER[purpose] : undefined;
  if (!order) return sections;
  const rank = (s: PresentSection): [number, number, number] => {
    const typeIdx = order.indexOf(s.type);
    const sub =
      s.type === "narrative"
        ? narrativeSubRank(s.block)
        : s.type === "text"
          ? 0
          : 0;
    // A closing narrative (outlook/recommendation) sorts after every
    // listed type even though "narrative" also appears first.
    const closing =
      s.type === "narrative" && sub === 2 ? order.length + 1 : typeIdx;
    return [typeIdx === -1 ? order.length : closing, sub, sections.indexOf(s)];
  };
  return [...sections].sort((a, b) => {
    const ra = rank(a);
    const rb = rank(b);
    return ra[0] - rb[0] || ra[1] - rb[1] || ra[2] - rb[2];
  });
}

/* ------------------------------ model ------------------------------ */

export function buildPresentModel(
  render: ReportRender,
  opts: { purpose?: string; internal?: boolean } = {}
): PresentModel {
  const internal = Boolean(opts.internal);
  const blocks = render.blocks ?? [];

  // Appendix + footnotes come from the blocks VISIBLE in this mode:
  // internal view numbers every figure; recipient views number only
  // what the recipient can see.
  const hidden: HiddenSection[] = [];
  const visibleBlocks: RenderBlock[] = [];
  for (const b of blocks) {
    const isInternalOnly = b.visibility === "internal_only";
    const isMissing = b.dataStatus === "missing";
    const isNA = b.dataStatus === "not_applicable";
    const isEmpty =
      !isMissing &&
      !isNA &&
      (b.figures?.length ?? 0) === 0 &&
      !(b.table?.rows?.length ?? 0) &&
      !(b.chart?.series?.length ?? 0) &&
      !(b.text ?? "").trim() &&
      !(b.narrative?.statements?.length ?? 0);
    if (isInternalOnly && !internal) {
      hidden.push({ key: b.key, heading: b.heading || b.type, reason: "internal_only" });
      continue;
    }
    if (!internal && isMissing) {
      hidden.push({ key: b.key, heading: b.heading || b.type, reason: "missing" });
      continue;
    }
    if (!internal && isNA) {
      hidden.push({ key: b.key, heading: b.heading || b.type, reason: "not_applicable" });
      continue;
    }
    if (!internal && isEmpty) {
      hidden.push({ key: b.key, heading: b.heading || b.type, reason: "empty" });
      continue;
    }
    if (isMissing) {
      hidden.push({ key: b.key, heading: b.heading || b.type, reason: "missing" });
    } else if (isNA) {
      hidden.push({ key: b.key, heading: b.heading || b.type, reason: "not_applicable" });
    } else if (isEmpty) {
      hidden.push({ key: b.key, heading: b.heading || b.type, reason: "empty" });
    }
    visibleBlocks.push(b);
  }

  const appendix: AppendixFigure[] = [];
  const footnotes: Record<string, number> = {};
  for (const b of visibleBlocks) {
    for (const f of b.figures ?? []) {
      if (!f.key || footnotes[f.key] !== undefined) continue;
      footnotes[f.key] = appendix.length + 1;
      appendix.push(f);
    }
  }

  const map = figMap(visibleBlocks);
  let sections: PresentSection[] = visibleBlocks.map((b) => {
    const section: PresentSection = {
      key: b.key,
      heading: b.heading || b.type,
      type: b.type,
      headline: "",
      block: b,
      figureNotes: (b.figures ?? [])
        .map((f) => footnotes[f.key])
        .filter((n): n is number => typeof n === "number"),
      internalOnly: b.visibility === "internal_only",
      dataStatus: b.dataStatus,
    };
    section.headline = headlineFor(section, map);
    return section;
  });
  sections = orderSections(sections, opts.purpose);

  const tiles = buildTiles(opts.purpose, map, sections);
  const takeaways = buildTakeaways(sections, map);
  const exec =
    tiles.length >= 2 || takeaways.length >= 1
      ? { tiles, takeaways }
      : null;

  return {
    sections,
    hidden,
    exec,
    appendix,
    footnotes,
    showToc: sections.length > 3,
  };
}

/** Sender-preview warnings (spec §9): one line per hidden section,
 * plus unreviewed-figure and audience notes. Recipient views never
 * render these. */
export function previewWarnings(
  model: PresentModel,
  opts: { audience?: string; hasUnreviewed?: boolean } = {}
): string[] {
  const out: string[] = [];
  for (const h of model.hidden) {
    if (h.reason === "missing") {
      out.push(`${h.heading}: no data for this period — hidden from recipients.`);
    } else if (h.reason === "not_applicable") {
      out.push(`${h.heading}: not applicable to this subject — hidden from recipients.`);
    } else if (h.reason === "internal_only") {
      out.push(`${h.heading}: internal only — excluded for this audience.`);
    } else {
      out.push(`${h.heading}: no content yet — hidden from recipients.`);
    }
  }
  const unreviewed = model.appendix.filter(
    (f) => f.verification === "unreviewed"
  ).length;
  if (unreviewed > 0 || opts.hasUnreviewed) {
    out.push(
      unreviewed > 0
        ? `${unreviewed} figure${unreviewed === 1 ? " is" : "s are"} unreviewed — flagged in the appendix.`
        : "This report contains unreviewed figures."
    );
  }
  return out;
}

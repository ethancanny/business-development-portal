import { createHash } from "node:crypto";
import { sql, newId, str, num, isoOrNull } from "../platform/db";
import { ensureAutomation } from "./automation-schema";
import { WORKSTREAM_LABELS } from "./schema";
import {
  requireWorkspace,
  getDealContext,
  listRedFlags,
  getScorecard,
  listContracts,
  listFindings,
  listChecklistItems,
  listRequestItems,
  type WorkspaceRow,
  type DealContext,
  type RedFlagRow,
  type ScorecardRow,
  type ContractRow,
  type FindingRow,
  type ChecklistItemRow,
  type RequestItemRow,
} from "./service";
import { listLatestChecks, type LatestCheckEntry } from "./records";
import {
  getCurrentAnalysis,
  getCompanyAdjustments,
  type AnalysisRecord,
  type AdjustmentRecord,
} from "../finanalysis/service";
import type { AnalysisPayload } from "../finanalysis/types";

/**
 * IC memo assembly (Part 5B) — the investment-committee memo is
 * ASSEMBLED deterministically from platform records (current financial
 * analysis, accepted QoE adjustments, red flags, record checks,
 * contracts, findings, checklist state). It is never free-written:
 * every section body is rendered from the rows it cites, and the
 * Recommendation section is a fixed placeholder reserved for Ethan.
 *
 * Staleness: each memo stores a fingerprint of its source stamps
 * (analysis id + updatedAt, newest updatedAt across flags / contracts /
 * findings / checklist / requests, scorecard updatedAt, adjustment
 * count, newest record-check instant). getCurrentMemo recomputes the
 * same fingerprint from live sources and flags the memo stale when
 * they diverge. computeSourceFingerprint() is the ONE function both
 * paths use.
 *
 * No financial figures in logs (bodies are stored data, not logs).
 */

export interface MemoCitation {
  kind: string;
  id: string;
  label: string;
}

export interface MemoSection {
  key: string;
  title: string;
  body: string;
  citations: MemoCitation[];
}

export interface MemoRow {
  id: string;
  dealId: string;
  companyId: string | null;
  workspaceId: string;
  version: number;
  status: string;
  sections: MemoSection[];
  /** Same sections in the stored payload shape ({ sections }) — the
   * IC Memo UI reads memo.payload.sections. */
  payload: { sections: MemoSection[] };
  fingerprint: string;
  isCurrent: boolean;
  generatedBy: string;
  generatedAt: string;
  approvedBy: string | null;
  approvedAt: string | null;
  createdAt: string;
}

/* ------------------------------ formatting ----------------------------- */

export function fmtMoney(v: number | null | undefined): string {
  if (v === null || v === undefined || !isFinite(v)) return "—";
  const abs = Math.abs(v);
  const s = abs.toLocaleString("en-US", { maximumFractionDigits: 0 });
  return v < 0 ? `-$${s}` : `$${s}`;
}

const fmtSignedMoney = (v: number): string =>
  v < 0 ? `-${fmtMoney(Math.abs(v))}` : `+${fmtMoney(v)}`;

const datePart = (iso: string): string => (iso ? iso.slice(0, 10) : "");

/* --------------------------- source gathering -------------------------- */

export interface MemoSources {
  ws: WorkspaceRow;
  ctx: DealContext | null;
  companyId: string | null;
  analysis: { analysis: AnalysisRecord; payload: AnalysisPayload } | null;
  adjustments: AdjustmentRecord[];
  flags: RedFlagRow[];
  scorecard: ScorecardRow | null;
  contracts: ContractRow[];
  findings: FindingRow[];
  checklist: ChecklistItemRow[];
  requests: RequestItemRow[];
  checks: LatestCheckEntry[];
}

export async function gatherMemoSources(
  workspaceId: string
): Promise<MemoSources> {
  const ws = await requireWorkspace(workspaceId);
  const ctx = await getDealContext(ws.dealId);
  const companyId = ws.companyId ?? ctx?.companyId ?? null;
  const [analysis, adjustments, flags, scorecard, contracts, findings, checklist, requests, checks] =
    await Promise.all([
      companyId
        ? getCurrentAnalysis(companyId).catch(() => null)
        : Promise.resolve(null),
      companyId
        ? getCompanyAdjustments(companyId).catch(() => [] as AdjustmentRecord[])
        : Promise.resolve([] as AdjustmentRecord[]),
      listRedFlags(workspaceId),
      getScorecard(workspaceId).catch(() => null),
      listContracts(workspaceId),
      listFindings(workspaceId),
      listChecklistItems(workspaceId),
      listRequestItems(workspaceId),
      companyId
        ? listLatestChecks(companyId).catch(() => [] as LatestCheckEntry[])
        : Promise.resolve([] as LatestCheckEntry[]),
    ]);
  return {
    ws,
    ctx,
    companyId,
    analysis,
    adjustments,
    flags,
    scorecard,
    contracts,
    findings,
    checklist,
    requests,
    checks,
  };
}

const maxStamp = (stamps: string[]): string =>
  stamps.reduce((m, s) => (s > m ? s : m), "");

/**
 * The source-stamp fingerprint — the single function used when a memo
 * is generated AND when getCurrentMemo checks staleness, so the two
 * can never drift apart.
 */
export function computeSourceFingerprint(src: MemoSources): string {
  const stamps = {
    analysisId: src.analysis?.analysis.id ?? null,
    analysisUpdatedAt: src.analysis?.analysis.updatedAt ?? null,
    flagsMaxUpdatedAt: maxStamp(src.flags.map((f) => f.updatedAt)),
    contractsMaxUpdatedAt: maxStamp(src.contracts.map((c) => c.updatedAt)),
    findingsMaxUpdatedAt: maxStamp(src.findings.map((f) => f.updatedAt)),
    checklistMaxUpdatedAt: maxStamp(src.checklist.map((c) => c.updatedAt)),
    requestsMaxUpdatedAt: maxStamp(src.requests.map((r) => r.updatedAt)),
    scorecardUpdatedAt: src.scorecard?.updatedAt ?? null,
    adjustmentsLength: src.adjustments.length,
    checksMaxCheckedAt: maxStamp(
      src.checks.map((c) => c.latest?.checkedAt ?? "")
    ),
  };
  return createHash("sha256").update(JSON.stringify(stamps)).digest("hex");
}

/* ------------------------------ sections ------------------------------- */

const SEVERITY_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2 };
const SATISFIED = ["received", "reviewed", "approved", "waived", "na"];

function overviewSection(src: MemoSources): MemoSection {
  const companyName = src.ctx?.companyName || src.ctx?.dealName || "—";
  const dealName = src.ctx?.dealName || companyName;
  const industry = src.analysis?.payload.industry || "";
  const lines = [
    `Company: ${companyName}`,
    `Deal: ${dealName}`,
    `Stage: ${src.ctx?.stage || "—"}`,
    ...(industry ? [`Industry: ${industry}`] : []),
    `Diligence workspace opened: ${datePart(src.ws.createdAt) || "—"}`,
    `Workspace status: ${src.ws.status}`,
  ];
  const citations: MemoCitation[] = [];
  if (src.companyId)
    citations.push({ kind: "company", id: src.companyId, label: companyName });
  citations.push({ kind: "deal", id: src.ws.dealId, label: dealName });
  return { key: "overview", title: "Overview", body: lines.join("\n"), citations };
}

function financialSection(src: MemoSources): MemoSection {
  if (!src.analysis) {
    return {
      key: "financial_summary",
      title: "Financial summary",
      body: "Financial statements have not yet been posted and analyzed for this company — financial summary pending.",
      citations: [],
    };
  }
  const { analysis, payload } = src.analysis;
  const lines: string[] = [];
  // Latest period revenue / EBITDA live in chartData.monthly (the
  // engine's per-period chart series); metricsByPeriod carries ratios,
  // not raw dollars. Take the newest monthly point that has figures.
  const monthly = payload.chartData?.monthly ?? [];
  let latest: (typeof monthly)[number] | null = null;
  for (let i = monthly.length - 1; i >= 0; i--) {
    if (monthly[i].revenue !== null || monthly[i].ebitda !== null) {
      latest = monthly[i];
      break;
    }
  }
  if (latest) {
    lines.push(
      `Latest period (${latest.periodEnd ?? "date not recorded"}): revenue ${fmtMoney(latest.revenue)}, EBITDA ${fmtMoney(latest.ebitda)}.`
    );
  } else {
    lines.push("No monthly revenue / EBITDA series in the current analysis.");
  }
  const bridge = payload.marginBridge;
  if (bridge) {
    const items = bridge.items
      .map((i) => `${i.label} ${fmtSignedMoney(i.amount)}`)
      .join("; ");
    lines.push(
      `EBITDA bridge: Reported EBITDA ${fmtMoney(bridge.reportedEbitda)} → ` +
        `adjustments (${items || "none"}) → Adjusted EBITDA ${fmtMoney(bridge.adjustedEbitda)}.`
    );
  }
  const integrityFails = (payload.integrity ?? []).filter(
    (c) => c.status === "fail"
  ).length;
  lines.push(
    `Integrity checks failing: ${integrityFails}. Anomalies flagged: ${(payload.anomalies ?? []).length}.`
  );
  lines.push(`Analysis status: ${analysis.status}.`);
  const citations: MemoCitation[] = [
    {
      kind: "analysis",
      id: analysis.id,
      label: `Financial analysis (${analysis.status})`,
    },
    ...(payload.periods ?? []).map((p) => ({
      kind: "statement_set",
      id: p.setId,
      label: `Statement set${p.periodEnd ? ` — ${p.periodEnd}` : ""}`,
    })),
  ];
  return {
    key: "financial_summary",
    title: "Financial summary",
    body: lines.join("\n"),
    citations,
  };
}

function qoeSection(src: MemoSources): MemoSection {
  const accepted = src.adjustments.filter((a) => a.status === "accepted");
  if (!accepted.length) {
    return {
      key: "qoe_summary",
      title: "Quality of earnings",
      body: "No QoE adjustments accepted yet.",
      citations: [],
    };
  }
  const lines = accepted.map((a) => {
    const amount = a.decidedAmount ?? a.amount;
    const sign = a.direction === "subtract" ? "−" : "+";
    return `${a.label} — ${sign}${fmtMoney(amount !== null ? Math.abs(amount) : null)} (${a.direction === "subtract" ? "subtract" : "add back"})`;
  });
  lines.push(
    "As-reported financials are never modified; accepted adjustments live only in the adjusted (QoE) layer."
  );
  return {
    key: "qoe_summary",
    title: "Quality of earnings",
    body: lines.join("\n"),
    citations: accepted.map((a) => ({
      kind: "adjustment",
      id: a.id,
      label: a.label,
    })),
  };
}

function risksSection(src: MemoSources): MemoSection {
  const active = src.flags
    .filter((f) => f.status === "open" || f.status === "mitigating")
    .sort(
      (a, b) =>
        (SEVERITY_ORDER[a.severity] ?? 3) - (SEVERITY_ORDER[b.severity] ?? 3)
    );
  const candidates = src.flags.filter((f) => f.status === "candidate").length;
  const checkFindings = src.checks.filter(
    (c) => c.latest && c.latest.resultStatus === "finding"
  );
  const lines: string[] = [];
  const citations: MemoCitation[] = [];
  for (const f of active) {
    lines.push(
      `[${f.severity}] ${f.title} — mitigation: ${f.mitigation.trim() || "no mitigation recorded"}`
    );
    citations.push({ kind: "red_flag", id: f.id, label: f.title });
  }
  if (candidates)
    lines.push(
      `${candidates} candidate red flag(s) from automated analysis await review and are not counted above.`
    );
  for (const c of checkFindings) {
    lines.push(
      `Record check — ${c.meta.label}: finding — ${c.latest?.summary ?? ""}`
    );
    citations.push({
      kind: "record_check",
      id: c.latest?.id ?? "",
      label: `${c.meta.label} check`,
    });
  }
  if (!lines.length)
    lines.push("No open red flags or record-check findings recorded.");
  return { key: "key_risks", title: "Key risks", body: lines.join("\n"), citations };
}

function openItemsSection(src: MemoSources): MemoSection {
  const open = src.checklist.filter((i) => !SATISFIED.includes(i.status));
  const openRequests = src.requests.filter((r) => r.status === "requested");
  const lines: string[] = [
    `Checklist items outstanding: ${open.length} of ${src.checklist.length}.`,
    `Open information requests: ${openRequests.length}.`,
  ];
  for (const item of open.slice(0, 10)) {
    const ws = WORKSTREAM_LABELS[item.workstream] ?? item.workstream;
    lines.push(
      `• ${item.title} (${ws}${item.dueDate ? `, due ${item.dueDate}` : ""})`
    );
  }
  if (open.length > 10)
    lines.push(`…and ${open.length - 10} more checklist items.`);
  return {
    key: "open_items",
    title: "Open items",
    body: lines.join("\n"),
    citations: [
      { kind: "workspace", id: src.ws.id, label: "Diligence workspace" },
    ],
  };
}

function dealTermsSection(src: MemoSources): MemoSection {
  if (!src.findings.length) {
    return {
      key: "deal_terms_impact",
      title: "Deal-terms impact",
      body: "No findings have been mapped to deal terms.",
      citations: [],
    };
  }
  const lines = src.findings.map(
    (f: FindingRow) =>
      `${f.title} → ${f.proposedTermType}: ${f.proposedTermDetail || f.detail || "—"} (${f.status})`
  );
  return {
    key: "deal_terms_impact",
    title: "Deal-terms impact",
    body: lines.join("\n"),
    citations: src.findings.map((f) => ({
      kind: "finding",
      id: f.id,
      label: f.title,
    })),
  };
}

function recommendationSection(): MemoSection {
  return {
    key: "recommendation",
    title: "Recommendation",
    body: "— Reserved for Ethan —",
    citations: [],
  };
}

/* ------------------------------- build --------------------------------- */

export interface BuiltMemo {
  workspaceId: string;
  dealId: string;
  companyId: string | null;
  sections: MemoSection[];
  fingerprint: string;
}

export async function buildMemo(
  workspaceId: string,
  actor: string
): Promise<BuiltMemo> {
  void actor;
  const src = await gatherMemoSources(workspaceId);
  return {
    workspaceId,
    dealId: src.ws.dealId,
    companyId: src.companyId,
    sections: [
      overviewSection(src),
      financialSection(src),
      qoeSection(src),
      risksSection(src),
      openItemsSection(src),
      dealTermsSection(src),
      recommendationSection(),
    ],
    fingerprint: computeSourceFingerprint(src),
  };
}

/* ------------------------------ persistence ---------------------------- */

function rowToMemo(r: Record<string, unknown>): MemoRow {
  const payload =
    r.payload && typeof r.payload === "object"
      ? (r.payload as Record<string, unknown>)
      : {};
  const sections = Array.isArray(payload.sections)
    ? (payload.sections as MemoSection[])
    : [];
  return {
    id: str(r.id),
    dealId: str(r.deal_id),
    companyId: r.company_id ? str(r.company_id) : null,
    workspaceId: str(r.workspace_id),
    version: num(r.version),
    status: str(r.status) || "draft",
    sections,
    payload: { sections },
    fingerprint: str(r.fingerprint),
    isCurrent: Boolean(r.is_current),
    generatedBy: str(r.generated_by),
    generatedAt: isoOrNull(r.generated_at) ?? "",
    approvedBy: r.approved_by ? str(r.approved_by) : null,
    approvedAt: isoOrNull(r.approved_at),
    createdAt: isoOrNull(r.created_at) ?? "",
  };
}

const MEMO_COLS = `id, deal_id, company_id, workspace_id, version, status,
  payload, fingerprint, is_current, generated_by, generated_at,
  approved_by, approved_at, created_at`;

export async function generateMemo(
  workspaceId: string,
  actor: string
): Promise<MemoRow> {
  await ensureAutomation();
  const built = await buildMemo(workspaceId, actor);
  const db = sql();
  const verRows = await db`
    SELECT coalesce(max(version), 0)::int AS v FROM diligence.memos
    WHERE deal_id = ${built.dealId} AND deleted_at IS NULL`;
  const version = num((verRows[0] as Record<string, unknown>).v) + 1;
  await db`
    UPDATE diligence.memos SET is_current = false
    WHERE deal_id = ${built.dealId} AND is_current = true
      AND deleted_at IS NULL`;
  const id = `mem_${newId()}`;
  await db`
    INSERT INTO diligence.memos
      (id, deal_id, company_id, workspace_id, version, status, payload,
       fingerprint, is_current, generated_by, generated_at)
    VALUES (${id}, ${built.dealId}, ${built.companyId}, ${workspaceId},
      ${version}, 'draft',
      ${JSON.stringify({ sections: built.sections })}::jsonb,
      ${built.fingerprint}, true, ${actor}, now())`;
  const rows = await db`
    SELECT ${db.unsafe(MEMO_COLS)} FROM diligence.memos
    WHERE id = ${id} LIMIT 1`;
  return rowToMemo(rows[0] as Record<string, unknown>);
}

export async function getCurrentMemo(
  dealId: string
): Promise<{ memo: MemoRow | null; stale: boolean }> {
  await ensureAutomation();
  const db = sql();
  const rows = await db`
    SELECT ${db.unsafe(MEMO_COLS)} FROM diligence.memos
    WHERE deal_id = ${dealId} AND is_current = true AND deleted_at IS NULL
    ORDER BY version DESC LIMIT 1`;
  if (!rows.length) return { memo: null, stale: false };
  const memo = rowToMemo(rows[0] as Record<string, unknown>);
  let stale = true;
  try {
    const src = await gatherMemoSources(memo.workspaceId);
    stale = computeSourceFingerprint(src) !== memo.fingerprint;
  } catch {
    // Sources can no longer be gathered (e.g. workspace removed) —
    // the memo cannot be verified against live records, so it is stale.
    stale = true;
  }
  return { memo, stale };
}

export async function approveMemo(
  id: string,
  actor: string
): Promise<MemoRow> {
  await ensureAutomation();
  const db = sql();
  const rows = await db`
    UPDATE diligence.memos
    SET status = 'approved', approved_by = ${actor}, approved_at = now()
    WHERE id = ${id} AND deleted_at IS NULL
    RETURNING ${db.unsafe(MEMO_COLS)}`;
  if (!rows.length) throw new Error("memo_not_found");
  return rowToMemo(rows[0] as Record<string, unknown>);
}

/** Job handler (kind 'generate_memo') — wired by the coordinator. */
export async function runMemoJob(
  payload: Record<string, unknown>
): Promise<MemoRow> {
  const workspaceId = str(payload.workspaceId ?? payload.workspace_id);
  if (!workspaceId) throw new Error("workspace_required");
  const actor = str(payload.actor) || "system";
  return generateMemo(workspaceId, actor);
}

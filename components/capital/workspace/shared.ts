/**
 * Raise workspace — shared data layer (Investors & Capital redesign,
 * Step 1, Oct 25, 2026).
 *
 * The bundle contract (lane DATA): GET /api/platform/capital/deals/
 * [dealId] returns { deal, raise, summary, commitments[], investors,
 * economics / ic / reporting as before } with EXTENDED commitment
 * fields (pipelineStage, indicated/soft/hard/funded buckets, owner,
 * docStatus, wireStatus, expectedFundingDate, stageDates).
 *
 * The pre-redesign bundle lives at …/deals/[dealId]/raise with the
 * legacy commitment shape (single amount + kind + legacy stage).
 * fetchBundle tries the contract route first and falls back to the
 * legacy route, then normalizes both into one shape so every
 * workspace tab renders the same numbers either way. Bucket /
 * pipeline-stage helpers likewise read the extended fields when
 * present and derive them from the legacy amount/kind/stage when
 * not — derivations are labeled as such in the tabs that show them.
 *
 * Writes go through the existing commitment / raise routes, which
 * accept PATCH today (see RaiseTab); a 405 falls back to PUT, the
 * verb named in the redesign contract.
 */

import {
  API,
  ApiError,
  api,
  listFrom,
  type CapitalDeal,
  type Commitment,
  type Raise,
  type RaiseSummary,
} from "@/components/capital/types";

/* ------------------------------ stages ------------------------------ */

export const PIPELINE_STAGES: Array<{ key: string; label: string }> = [
  { key: "prospect", label: "Prospect" },
  { key: "intro", label: "Intro" },
  { key: "meeting", label: "Meeting" },
  { key: "interested", label: "Interested" },
  { key: "soft_circled", label: "Soft-circled" },
  { key: "committed", label: "Committed" },
  { key: "funded", label: "Funded" },
  { key: "passed", label: "Passed" },
];

export const DOC_STATUSES: Array<{ key: string; label: string }> = [
  { key: "none", label: "None" },
  { key: "draft", label: "Draft" },
  { key: "sent", label: "Sent" },
  { key: "signed", label: "Signed" },
  { key: "countersigned", label: "Countersigned" },
  { key: "filed", label: "Filed" },
];

export const WIRE_STATUSES: Array<{ key: string; label: string }> = [
  { key: "pending", label: "Pending" },
  { key: "instructions_sent", label: "Instructions sent" },
  { key: "received", label: "Received" },
];

export function labelOfSafe(
  list: Array<{ key: string; label: string }>,
  key: string
): string {
  return list.find((x) => x.key === key)?.label ?? key;
}

export const TYPE_LABELS: Record<string, string> = {
  platform_lbo: "Platform LBO",
  add_on: "Add-on",
  early_stage: "Early Stage",
  minority_growth: "Minority Growth",
};

/* ------------------------------ types ------------------------------ */

export interface ExtCommitment extends Commitment {
  raiseId?: string;
  dealId?: string;
  firm?: string;
  pipelineStage?: string;
  indicatedAmount?: number | null;
  softAmount?: number | null;
  hardAmount?: number | null;
  fundedAmount?: number | null;
  owner?: string;
  docStatus?: string;
  wireStatus?: string;
  expectedFundingDate?: string | null;
  stageDates?: Record<string, string> | null;
  lastTouchAt?: string | null;
}

export interface ExtRaise extends Raise {
  entityName?: string;
  nextMilestone?: string;
  nextMilestoneDate?: string | null;
}

export interface ExtSummary extends RaiseSummary {
  indicatedTotal?: number;
  byStage?: Record<string, unknown>;
}

export interface BundleDeal {
  dealId?: string;
  id?: string;
  dealName?: string;
  companyName?: string;
  companyId?: string;
  stage?: string;
  codename?: string;
  investmentType?: string | { key: string; label?: string };
  investment_type?: string;
  metrics?: Record<string, unknown>;
  targetCloseDate?: string | null;
  targetClose?: string | null;
  closingDate?: string | null;
  closeDate?: string | null;
  [key: string]: unknown;
}

export interface BundleInvestorInfo {
  personId: string;
  name: string;
  firm: string;
  lastTouchAt: string | null;
  profile?: { lastTouchAt?: string | null } | null;
  [key: string]: unknown;
}

export interface WorkspaceBundle {
  deal: BundleDeal | null;
  raise: ExtRaise | null;
  summary: ExtSummary | null;
  commitments: ExtCommitment[];
  investors: BundleInvestorInfo[];
  activity: Array<Record<string, unknown>>;
  reporting: Record<string, unknown> | null;
  ic: Record<string, unknown> | null;
  companyId: string;
  raw: Record<string, unknown>;
}

/* ------------------------------ fetching ------------------------------ */

const dealBase = (dealId: string) =>
  `${API}/deals/${encodeURIComponent(dealId)}`;

function normalizeInvestors(raw: unknown): BundleInvestorInfo[] {
  if (Array.isArray(raw)) {
    return raw.map((r, i) => {
      const rec = (r ?? {}) as Record<string, unknown>;
      const profile = (rec.profile ?? null) as
        | { lastTouchAt?: string | null }
        | null;
      return {
        ...(rec as BundleInvestorInfo),
        personId: String(rec.personId ?? rec.id ?? i),
        name: String(rec.name ?? rec.investorName ?? ""),
        firm: String(rec.firm ?? rec.investorFirm ?? ""),
        lastTouchAt:
          (typeof rec.lastTouchAt === "string" ? rec.lastTouchAt : null) ??
          profile?.lastTouchAt ??
          null,
        profile,
      };
    });
  }
  if (raw && typeof raw === "object") {
    return Object.entries(raw as Record<string, unknown>).map(([k, v]) => {
      const rec = (v ?? {}) as Record<string, unknown>;
      const profile = (rec.profile ?? null) as
        | { lastTouchAt?: string | null }
        | null;
      return {
        ...(rec as BundleInvestorInfo),
        personId: String(rec.personId ?? k),
        name: String(rec.name ?? rec.investorName ?? ""),
        firm: String(rec.firm ?? rec.investorFirm ?? ""),
        lastTouchAt:
          (typeof rec.lastTouchAt === "string" ? rec.lastTouchAt : null) ??
          profile?.lastTouchAt ??
          null,
        profile,
      };
    });
  }
  return [];
}

function normalizeBundle(
  data: Record<string, unknown>,
  legacyRaise: Record<string, unknown> | null
): WorkspaceBundle {
  const src = (legacyRaise ?? data) as Record<string, unknown>;
  const deal = (data.deal ?? null) as BundleDeal | null;
  const commitmentsRaw = (src.commitments ?? data.commitments ?? []) as
    | ExtCommitment[]
    | undefined;
  const commitments = (Array.isArray(commitmentsRaw) ? commitmentsRaw : []).map(
    (c) => ({
      ...c,
      investorFirm: c.investorFirm ?? c.firm ?? "",
    })
  );
  const activityRaw = (data.activity ?? data.activities ?? []) as unknown;
  return {
    deal,
    raise: (src.raise ?? null) as ExtRaise | null,
    summary: (src.summary ?? data.summary ?? null) as ExtSummary | null,
    commitments,
    investors: normalizeInvestors(data.investors),
    activity: Array.isArray(activityRaw)
      ? (activityRaw as Array<Record<string, unknown>>)
      : [],
    reporting:
      data.reporting && typeof data.reporting === "object"
        ? (data.reporting as Record<string, unknown>)
        : null,
    ic:
      data.ic && typeof data.ic === "object"
        ? (data.ic as Record<string, unknown>)
        : null,
    companyId: String(deal?.companyId ?? data.companyId ?? ""),
    raw: data,
  };
}

/**
 * Load the deal's raise bundle. Contract route first
 * (GET …/deals/[dealId]); on any failure or non-bundle shape, fall
 * back to the legacy raise route (GET …/deals/[dealId]/raise), whose
 * { raise, summary, commitments } is the base shape the extended
 * fields are added to.
 */
export async function fetchBundle(dealId: string): Promise<WorkspaceBundle> {
  let data: Record<string, unknown> = {};
  let legacy: Record<string, unknown> | null = null;
  try {
    const d = await api<Record<string, unknown>>(dealBase(dealId));
    if (
      d &&
      ("raise" in d || "summary" in d || "commitments" in d || "deal" in d)
    ) {
      data = d;
    } else {
      throw new Error("not_a_bundle");
    }
  } catch {
    legacy = await api<Record<string, unknown>>(`${dealBase(dealId)}/raise`);
  }
  // The raise bundle carries no deal identity/type/metrics — the
  // deals list row does (investmentType, whitelisted metrics,
  // companyId, raise). Merge it in as the bundle's deal when the
  // bundle itself didn't include one.
  if (!data.deal) {
    try {
      const list = await api<Record<string, unknown>>(`${API}/deals`);
      const row = listFrom<CapitalDeal>(list, "items", "deals").find(
        (d) => d.dealId === dealId
      );
      if (row) {
        data = {
          ...data,
          deal: row as unknown as Record<string, unknown>,
          companyId: (row as CapitalDeal).companyId ?? data.companyId,
        };
      }
    } catch {
      /* bundle stands without deal identity */
    }
  }
  return normalizeBundle(data, legacy);
}

/* ------------------------------ writes ------------------------------ */

/** PATCH first (existing routes); PUT on 405 (contract verb). */
export async function updateCommitment(
  id: string,
  patch: Record<string, unknown>
): Promise<unknown> {
  const url = `${API}/commitments/${encodeURIComponent(id)}`;
  try {
    return await api(url, { method: "PATCH", body: JSON.stringify(patch) });
  } catch (err) {
    if (err instanceof ApiError && err.status === 405) {
      return api(url, { method: "PUT", body: JSON.stringify(patch) });
    }
    throw err;
  }
}

export async function createCommitment(
  dealId: string,
  body: Record<string, unknown>
): Promise<unknown> {
  return api(`${dealBase(dealId)}/commitments`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function deleteCommitment(id: string): Promise<unknown> {
  return api(`${API}/commitments/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

/** Save raise settings (PATCH …/raise today; PUT fallbacks per contract). */
export async function saveRaise(
  dealId: string,
  patch: Record<string, unknown>
): Promise<unknown> {
  const url = `${dealBase(dealId)}/raise`;
  try {
    return await api(url, { method: "PATCH", body: JSON.stringify(patch) });
  } catch (err) {
    if (err instanceof ApiError && err.status === 405) {
      try {
        return await api(url, { method: "PUT", body: JSON.stringify(patch) });
      } catch {
        return api(dealBase(dealId), {
          method: "PUT",
          body: JSON.stringify(patch),
        });
      }
    }
    throw err;
  }
}

export async function createRaise(
  dealId: string,
  body: Record<string, unknown>
): Promise<unknown> {
  return api(`${dealBase(dealId)}/raise`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

/* ------------------------------ commitment math ------------------------------ */

const hasBuckets = (c: ExtCommitment) =>
  c.indicatedAmount != null ||
  c.softAmount != null ||
  c.hardAmount != null ||
  c.fundedAmount != null;

/** One bucket (indicated / soft / hard / funded) for a commitment. */
export function bucketAmount(
  c: ExtCommitment,
  bucket: "indicated" | "soft" | "hard" | "funded"
): number {
  if (hasBuckets(c)) {
    const v =
      bucket === "indicated"
        ? c.indicatedAmount
        : bucket === "soft"
          ? c.softAmount
          : bucket === "hard"
            ? c.hardAmount
            : c.fundedAmount;
    return typeof v === "number" && Number.isFinite(v) ? v : 0;
  }
  // Legacy single-amount rows: kind splits soft vs hard, the funded
  // stage marks funded dollars; indicated = anything at indicated.
  const amt = typeof c.amount === "number" ? c.amount : 0;
  if (c.stage === "passed") return 0;
  switch (bucket) {
    case "funded":
      return c.stage === "funded" ? amt : 0;
    case "hard":
      return c.kind === "hard" ? amt : 0;
    case "soft":
      return c.kind === "hard" ? 0 : amt;
    case "indicated":
      return c.stage === "indicated" || !c.stage ? amt : 0;
  }
}

/** The investor's current headline amount (deepest bucket set). */
export function currentAmount(c: ExtCommitment): number {
  if (hasBuckets(c)) {
    return (
      c.fundedAmount ??
      c.hardAmount ??
      c.softAmount ??
      c.indicatedAmount ??
      c.amount ??
      0
    );
  }
  return typeof c.amount === "number" ? c.amount : 0;
}

export function pipelineStageOf(c: ExtCommitment): string {
  if (c.pipelineStage) return c.pipelineStage;
  switch (c.stage) {
    case "funded":
      return "funded";
    case "passed":
      return "passed";
    case "committed":
      return c.kind === "hard" ? "committed" : "soft_circled";
    default:
      return "prospect";
  }
}

/** Legacy stage that mirrors a pipeline stage (keeps the stored
 * summary's by-stage rollup sane on legacy-shaped backends). */
export function legacyStageFor(pipelineStage: string): string {
  if (pipelineStage === "funded") return "funded";
  if (pipelineStage === "passed") return "passed";
  if (pipelineStage === "committed" || pipelineStage === "soft_circled")
    return "committed";
  return "indicated";
}

export function docStatusOf(c: ExtCommitment): string {
  return c.docStatus || "none";
}

export function wireStatusOf(c: ExtCommitment): string {
  return c.wireStatus || "pending";
}

export function docBadge(status: string): string {
  switch (status) {
    case "filed":
    case "countersigned":
      return "badge-fit";
    case "signed":
      return "badge-fit";
    case "sent":
      return "badge-warn";
    case "draft":
      return "badge-warn";
    default:
      return "badge-neutral";
  }
}

/* ------------------------------ deal / metrics ------------------------------ */

export function typeKeyOf(bundle: WorkspaceBundle | null): string {
  const t = bundle?.deal?.investmentType ?? bundle?.deal?.investment_type;
  if (typeof t === "string" && t) return t;
  if (t && typeof t === "object" && typeof t.key === "string") return t.key;
  return "platform_lbo";
}

export function typeLabelOf(bundle: WorkspaceBundle | null): string {
  const t = bundle?.deal?.investmentType;
  if (t && typeof t === "object" && t.label) return t.label;
  const key = typeKeyOf(bundle);
  return TYPE_LABELS[key] ?? key;
}

export function metricsOf(
  bundle: WorkspaceBundle | null
): Record<string, unknown> {
  const m = bundle?.deal?.metrics;
  return m && typeof m === "object" ? m : {};
}

/** bd.deal_metrics values arrive as { num, text } rows; flat
 * number/string shapes are read too. */
export function metricNum(
  metrics: Record<string, unknown>,
  key: string
): number | null {
  const v = metrics[key];
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (v && typeof v === "object") {
    const num = (v as { num?: unknown }).num;
    if (typeof num === "number" && Number.isFinite(num)) return num;
  }
  return null;
}

export function metricText(
  metrics: Record<string, unknown>,
  key: string
): string {
  const v = metrics[key];
  if (typeof v === "string") return v;
  if (v && typeof v === "object") {
    const text = (v as { text?: unknown }).text;
    if (typeof text === "string") return text;
    const num = (v as { num?: unknown }).num;
    if (typeof num === "number") return String(num);
  }
  return "";
}

export function investorInfo(
  bundle: WorkspaceBundle | null,
  personId: string
): BundleInvestorInfo | null {
  return bundle?.investors.find((i) => i.personId === personId) ?? null;
}

export function lastTouchOf(
  bundle: WorkspaceBundle | null,
  c: ExtCommitment
): string | null {
  if (c.lastTouchAt) return c.lastTouchAt;
  const info = investorInfo(bundle, c.investorPersonId);
  return info?.lastTouchAt ?? info?.profile?.lastTouchAt ?? null;
}

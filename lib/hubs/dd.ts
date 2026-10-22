/**
 * Due Diligence hub summaries (navigation restructure, WS-C).
 *
 * Compact, paginated read models for the three /due-diligence hub
 * sections. All cross-module data flows through the owning module's
 * service functions only (PROJECT_RULES module boundaries):
 * - diligence workspaces via lib/diligence/service,
 * - value-creation plans via lib/valuecreation/service + scenarios
 *   (STORED plan_summary / scenario bridges — a bridge is never
 *   recomputed on this read path),
 * - data rooms via lib/dataroom/service (listRooms summaries).
 *
 * Honest-data notes (do not "fix" by inventing values):
 * - Findings severity: neither the findings store nor the red-flag
 *   register has a "critical" severity — both cap at high / medium /
 *   low (lib/diligence/schema.ts). `critical` is therefore always 0
 *   and exists only to keep the hub card shape stable.
 * - Initiative health: the VC store has no "off track" status. The
 *   buckets below partition every initiative exactly once using the
 *   stored statuses plus dates: offTrack = deferred, OR past its end
 *   date and neither done nor already at risk; atRisk = the stored
 *   at_risk status; onTrack = every remaining open initiative
 *   (on_track / in_progress / planned, not overdue).
 * - Room last activity: the dataroom service exposes only the room's
 *   updated_at (no separate activity timestamp), so lastActivityAt
 *   IS updated_at — the response names the source.
 */

import {
  listChecklistItems,
  listClosingItems,
  listDealWorkspaces,
  listFindings,
  listRedFlags,
} from "../diligence/service";
import { WORKSTREAMS, WORKSTREAM_LABELS } from "../diligence/schema";
import {
  listInitiatives,
  listPlans,
  type PlanListItem,
} from "../valuecreation/service";
import { listScenarios } from "../valuecreation/scenarios";
import { listRooms } from "../dataroom/service";

const DAY_MS = 86400000;
/** Checklist statuses the diligence service counts as done. */
const DONE_STATUSES = ["received", "reviewed", "approved", "waived", "na"];

export interface PageOpts {
  limit: number;
  offset: number;
}

export function pageOptsFrom(sp: URLSearchParams): PageOpts {
  const rawLimit = Number(sp.get("limit") ?? 25);
  const rawOffset = Number(sp.get("offset") ?? 0);
  return {
    limit: Math.min(50, Math.max(1, Number.isFinite(rawLimit) ? rawLimit : 25)),
    offset: Math.max(0, Number.isFinite(rawOffset) ? rawOffset : 0),
  };
}

/* ------------------------- diligence workspaces ------------------------ */

export interface DdWorkspaceWorkstream {
  key: string;
  label: string;
  done: number;
  total: number;
}

export interface DdWorkspaceItem {
  dealId: string;
  companyId: string | null;
  companyName: string;
  /** Claimed-by partner (legacy deals.owner via the diligence service). */
  owner: string;
  workstreams: DdWorkspaceWorkstream[];
  findings: { critical: number; high: number; medium: number; low: number };
  nextMilestone: { label: string; dueDate: string } | null;
}

export async function getDdWorkspacesSummary(
  page: PageOpts
): Promise<{ items: DdWorkspaceItem[]; total: number }> {
  const all = (await listDealWorkspaces()).filter((x) => x.workspace);
  const total = all.length;
  const slice = all.slice(page.offset, page.offset + page.limit);
  const items: DdWorkspaceItem[] = [];
  for (const entry of slice) {
    const ws = entry.workspace;
    if (!ws) continue;
    const [checklist, findings, redFlags, closing] = await Promise.all([
      listChecklistItems(ws.id),
      listFindings(ws.id),
      listRedFlags(ws.id),
      listClosingItems(ws.id),
    ]);

    const workstreams: DdWorkspaceWorkstream[] = WORKSTREAMS.map((key) => {
      const rows = checklist.filter((i) => i.workstream === key);
      return {
        key,
        label: WORKSTREAM_LABELS[key] ?? key,
        done: rows.filter((i) => DONE_STATUSES.includes(i.status)).length,
        total: rows.length,
      };
    }).filter((w) => w.total > 0);

    // OPEN findings = proposed deal-term findings + open/mitigating
    // red flags, counted by severity across both stores.
    const sev = { critical: 0, high: 0, medium: 0, low: 0 };
    const bump = (severity: string) => {
      if (severity === "high") sev.high += 1;
      else if (severity === "low") sev.low += 1;
      else if (severity === "medium") sev.medium += 1;
      // No store carries "critical" — see the module header note.
    };
    for (const f of findings) if (f.status === "proposed") bump(f.severity);
    for (const f of redFlags) {
      if (f.status === "open" || f.status === "mitigating") bump(f.severity);
    }

    // Next milestone = earliest due date among open closing items and
    // not-yet-done checklist items that carry a due date.
    const candidates: Array<{ label: string; dueDate: string }> = [];
    for (const c of closing) {
      if (c.status === "open" && c.dueDate) {
        candidates.push({ label: c.title, dueDate: c.dueDate });
      }
    }
    for (const i of checklist) {
      if (!DONE_STATUSES.includes(i.status) && i.dueDate) {
        candidates.push({ label: i.title, dueDate: i.dueDate });
      }
    }
    candidates.sort((a, b) => a.dueDate.localeCompare(b.dueDate));

    items.push({
      dealId: entry.deal.dealId,
      companyId: entry.deal.companyId,
      companyName: entry.deal.companyName || entry.deal.dealName || "Untitled deal",
      owner: entry.deal.owner ?? "",
      workstreams,
      findings: sev,
      nextMilestone: candidates.length ? candidates[0] : null,
    });
  }
  return { items, total };
}

/* --------------------------- value creation ---------------------------- */

export interface DdPlanItem {
  companyId: string;
  companyName: string;
  planId: string;
  planName: string;
  planStartDate: string | null;
  /** Whole days since the plan start date (null when no start date). */
  dayOfPlan: number | null;
  /** Elapsed share of the 100-day window, 0–1. */
  hundredDayProgress: number;
  initiatives: {
    total: number;
    onTrack: number;
    atRisk: number;
    offTrack: number;
    done: number;
  };
  impactPreview: {
    baseEbitda: number | null;
    projectedEbitda: number | null;
    weightedImpact: number;
  };
}

function planWindow(plan: PlanListItem): {
  dayOfPlan: number | null;
  hundredDayProgress: number;
} {
  if (!plan.planStartDate) return { dayOfPlan: null, hundredDayProgress: 0 };
  const start = new Date(`${plan.planStartDate}T12:00:00Z`).getTime();
  if (!Number.isFinite(start)) return { dayOfPlan: null, hundredDayProgress: 0 };
  const days = Math.max(0, Math.floor((Date.now() - start) / DAY_MS));
  return {
    dayOfPlan: days,
    hundredDayProgress: Math.min(1, Math.max(0, days / 100)),
  };
}

export async function getDdPlansSummary(
  page: PageOpts
): Promise<{ items: DdPlanItem[]; total: number }> {
  const plans = await listPlans();
  const total = plans.length;
  const slice = plans.slice(page.offset, page.offset + page.limit);
  const today = new Date().toISOString().slice(0, 10);
  const items: DdPlanItem[] = [];
  for (const plan of slice) {
    const initiatives = await listInitiatives(plan.id).catch(() => []);
    let onTrack = 0;
    let atRisk = 0;
    let offTrack = 0;
    let done = 0;
    for (const i of initiatives) {
      if (i.status === "done") {
        done += 1;
      } else if (i.status === "at_risk") {
        atRisk += 1;
      } else if (
        i.status === "deferred" ||
        (i.endDate !== null && i.endDate < today)
      ) {
        offTrack += 1;
      } else {
        onTrack += 1;
      }
    }

    // Impact preview from STORED data only: the plan_summary weighted
    // impact + the default scenario's stored bridge (listScenarios
    // reads the persisted bridge; it never recomputes one).
    let baseEbitda: number | null = null;
    let projectedEbitda: number | null = null;
    const scenarios = await listScenarios(plan.id).catch(() => []);
    const scenario = scenarios.find((s) => s.isDefault) ?? scenarios[0] ?? null;
    if (scenario) {
      baseEbitda = scenario.baseEbitda;
      projectedEbitda = scenario.totals
        ? scenario.totals.adjustedWeightedEbitda
        : null;
    }
    const weightedImpact =
      plan.summary?.impactWeighted ?? scenario?.totals?.totalWeightedImpact ?? 0;

    items.push({
      companyId: plan.companyId,
      companyName: plan.companyName || plan.name,
      planId: plan.id,
      planName: plan.name,
      planStartDate: plan.planStartDate,
      ...planWindow(plan),
      initiatives: {
        total: initiatives.length,
        onTrack,
        atRisk,
        offTrack,
        done,
      },
      impactPreview: { baseEbitda, projectedEbitda, weightedImpact },
    });
  }
  return { items, total };
}

/* ------------------------------ data rooms ----------------------------- */

export interface DdRoomItem {
  roomId: string;
  dealId: string;
  companyId: string | null;
  companyName: string;
  completenessPct: number;
  missingCount: number;
  /** The room's updated_at — the only activity timestamp the
   * dataroom service exposes (see module header note). */
  lastActivityAt: string;
  status: string;
}

export async function getDdRoomsSummary(
  page: PageOpts
): Promise<{ items: DdRoomItem[]; total: number }> {
  // listRooms caps at 50 per call; page through it (bounded) so the
  // hub's company grouping is complete at expected volumes.
  const rooms: Awaited<ReturnType<typeof listRooms>>["items"] = [];
  for (let offset = 0; offset < 200; offset += 50) {
    const batch = await listRooms({ limit: 50, offset });
    rooms.push(...batch.items);
    if (rooms.length >= batch.total || batch.items.length === 0) break;
  }
  const all: DdRoomItem[] = rooms
    .map((r) => ({
      roomId: r.id,
      dealId: r.dealId,
      companyId: r.companyId,
      companyName: r.dealName || r.name,
      completenessPct: r.completenessPct,
      missingCount: Math.max(0, r.checklistTotal - r.checklistSatisfied),
      lastActivityAt: r.updatedAt,
      status: r.status,
    }))
    .sort(
      (a, b) =>
        a.companyName.localeCompare(b.companyName) ||
        b.lastActivityAt.localeCompare(a.lastActivityAt)
    );
  return {
    items: all.slice(page.offset, page.offset + page.limit),
    total: all.length,
  };
}

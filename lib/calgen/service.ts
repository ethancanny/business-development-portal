import { sql, str, isoOrNull } from "@/lib/platform/db";
import { enqueueUniqueJob } from "@/lib/platform/jobs";
import { ensureCalgen } from "./schema";
import {
  GENERATED_EVENT_SOURCES,
  type GeneratedEventGenerator,
  type GeneratedEventInput,
  type GeneratedEventKind,
} from "./registry";

/**
 * Phase 2 — Generated-events service.
 *
 * regenerateGeneratedEvents() runs every registered generator, upserts
 * its rows by (source_kind, source_id), and deletes stale rows of that
 * kind that the generator no longer produces. Kinds without a
 * generator are untouched (their rows, if a future module writes them
 * directly, are not this service's to prune).
 *
 * Freshness: ensureFreshGeneratedEvents() implements the config rule
 * "refresh on open if >15m stale" (lib/platform/config.ts
 * SYNC_INTERVALS.calendar) — it regenerates inline only when the
 * newest generated_events.updated_at is older than 15 minutes.
 *
 * Generated events are read-only portal views. They never create
 * notifications and never write to Outlook — single-notification
 * ownership stays with Outlook for covered items.
 */

const FRESH_WINDOW_MS = 15 * 60 * 1000;
const TZ_OFFSET = "-07:00"; // America/Phoenix — no DST.

/* ------------------------------ generators ------------------------------ */

async function generateTaskEvents(): Promise<GeneratedEventInput[]> {
  const { getTasks } = await import("@/lib/db");
  const tasks = await getTasks();
  const thirtyDaysAgo = Date.now() - 30 * 86400000;
  const out: GeneratedEventInput[] = [];
  for (const t of tasks) {
    if (!t.dueDate) continue;
    const done = Boolean(t.done);
    if (done) {
      // Completed tasks stay visible only briefly (status 'done');
      // older completions drop out of the generated layer entirely.
      const completedMs = t.completedAt
        ? new Date(t.completedAt).getTime()
        : new Date(`${t.dueDate}T23:59:59${TZ_OFFSET}`).getTime();
      if (isFinite(completedMs) && completedMs < thirtyDaysAgo) continue;
    }
    const startsAt = t.dueTime
      ? `${t.dueDate}T${t.dueTime}:00${TZ_OFFSET}`
      : `${t.dueDate}T09:00:00${TZ_OFFSET}`;
    const endsAt = t.dueTime
      ? new Date(new Date(startsAt).getTime() + 30 * 60000).toISOString()
      : null;
    const dealId =
      t.relatedKind === "deal" && t.relatedId ? t.relatedId : null;
    const href = dealId
      ? `/deals/${dealId}`
      : t.relatedKind === "executive" && t.relatedName
        ? `/directory?q=${encodeURIComponent(t.relatedName)}`
        : "/overview";
    out.push({
      sourceId: t.id,
      title: t.title,
      startsAt,
      endsAt,
      allDay: !t.dueTime,
      dealId,
      companyId: null,
      href,
      status: done ? "done" : "",
      meta: {
        taskType: t.type ?? "",
        priority: t.priority ?? "normal",
        owner: t.owner ?? "",
        relatedKind: t.relatedKind ?? null,
        relatedId: t.relatedId ?? null,
        relatedName: t.relatedName ?? "",
        dealName:
          t.relatedKind === "deal" ? t.relatedName ?? "" : "",
      },
    });
  }
  return out;
}

/** kind → generator. Missing kind = no generator yet (registry-only). */
/**
 * Phase 5 — post-closing checklist items (kind 'closing'). Only
 * category='post_closing' items with a due date generate events;
 * waived items drop out, completed items stay briefly as 'done'.
 */
async function generateClosingEvents(): Promise<GeneratedEventInput[]> {
  const { listClosingCalendarItems } = await import(
    "@/lib/diligence/service"
  );
  const items = await listClosingCalendarItems();
  const out: GeneratedEventInput[] = [];
  for (const item of items) {
    if (!item.dueDate) continue;
    if (item.status === "waived") continue;
    out.push({
      sourceId: item.itemId,
      title:
        `Post-closing: ${item.title}` +
        (item.dealName ? ` — ${item.dealName}` : ""),
      startsAt: `${item.dueDate}T09:00:00${TZ_OFFSET}`,
      endsAt: null,
      allDay: true,
      dealId: item.dealId || null,
      companyId: item.companyId,
      href: `/due-diligence/${item.dealId}`,
      status: item.status === "done" ? "done" : "",
      meta: {
        category: item.category,
        workspaceId: item.workspaceId,
      },
    });
  }
  return out;
}

/**
 * Phase 5 — diligence checklist due dates (kind 'milestone').
 * Satisfied items (received / reviewed / approved / waived / N/A) do
 * not generate events.
 */
async function generateMilestoneEvents(): Promise<GeneratedEventInput[]> {
  const { listMilestoneCalendarItems } = await import(
    "@/lib/diligence/service"
  );
  const items = await listMilestoneCalendarItems();
  const satisfied = ["received", "reviewed", "approved", "waived", "na"];
  const out: GeneratedEventInput[] = [];
  for (const item of items) {
    if (!item.dueDate) continue;
    if (satisfied.includes(item.status)) continue;
    out.push({
      sourceId: item.itemId,
      title:
        `Diligence (${item.workstream}): ${item.title}` +
        (item.dealName ? ` — ${item.dealName}` : ""),
      startsAt: `${item.dueDate}T09:00:00${TZ_OFFSET}`,
      endsAt: null,
      allDay: true,
      dealId: item.dealId || null,
      companyId: item.companyId,
      href: `/due-diligence/${item.dealId}`,
      status: "",
      meta: {
        workstream: item.workstream,
        workspaceId: item.workspaceId,
      },
    });
  }
  return out;
}

/**
 * Phase 8 — portfolio reporting due dates (kind 'reporting'). Only
 * pending/late periods generate events; the period's own status rides
 * through so late items render as late.
 */
async function generateReportingEvents(): Promise<GeneratedEventInput[]> {
  const { listReportingCalendarItems } = await import(
    "@/lib/monitoring/service"
  );
  const items = await listReportingCalendarItems();
  const out: GeneratedEventInput[] = [];
  for (const item of items) {
    if (!item.dueDate) continue;
    const label = item.periodEnd
      ? `${item.cadence} period ending ${item.periodEnd}`
      : `${item.cadence} period`;
    out.push({
      sourceId: item.periodId,
      title:
        `Reporting due: ${item.companyName || item.companyId} ${label}`,
      startsAt: `${item.dueDate}T09:00:00${TZ_OFFSET}`,
      endsAt: null,
      allDay: true,
      dealId: null,
      companyId: item.companyId,
      href: `/portfolio-monitoring/${item.companyId}`,
      status: item.status,
      meta: {
        cadence: item.cadence,
        periodEnd: item.periodEnd,
      },
    });
  }
  return out;
}

/**
 * Phase 8 — covenant test dates (kind 'covenant'). Active covenants
 * with a next test date generate one event each.
 */
async function generateCovenantEvents(): Promise<GeneratedEventInput[]> {
  const { listCovenantCalendarItems } = await import(
    "@/lib/monitoring/service"
  );
  const items = await listCovenantCalendarItems();
  const out: GeneratedEventInput[] = [];
  for (const item of items) {
    if (!item.nextTestDate) continue;
    out.push({
      sourceId: item.covenantId,
      title:
        `Covenant test: ${item.label || item.covenantKey}` +
        (item.companyName ? ` — ${item.companyName}` : ""),
      startsAt: `${item.nextTestDate}T09:00:00${TZ_OFFSET}`,
      endsAt: null,
      allDay: true,
      dealId: null,
      companyId: item.companyId,
      href: `/portfolio-monitoring/${item.companyId}`,
      status: "",
      meta: {
        covenantKey: item.covenantKey,
      },
    });
  }
  return out;
}

/**
 * Phase 9 — board meetings (kind 'meeting'). Scheduled/held board
 * meetings with a start instant generate one event each, following
 * generateReportingEvents exactly; the portmgmt service is imported
 * dynamically (module-boundary pattern).
 */
async function generateMeetingEvents(): Promise<GeneratedEventInput[]> {
  const { listBoardMeetingCalendarItems } = await import(
    "@/lib/portmgmt/service"
  );
  const items = await listBoardMeetingCalendarItems();
  const out: GeneratedEventInput[] = [];
  for (const item of items) {
    if (!item.startsAt) continue;
    out.push({
      sourceId: item.meetingId,
      title:
        `Board meeting: ${item.title}` +
        (item.companyName ? ` — ${item.companyName}` : ""),
      startsAt: item.startsAt,
      endsAt: item.endsAt,
      allDay: false,
      dealId: null,
      companyId: item.companyId,
      href: `/portfolio-monitoring/${item.companyId}`,
      status: item.status,
      meta: {},
    });
  }
  return out;
}

/**
 * Part 12 — Communications report drafts + scheduled report runs
 * (kind 'report'). Schedule-generated draft reports land on the
 * calendar on their generation date; active schedules also project
 * their next run date. Items come from the comms module's own service
 * surface (listReportCalendarItems) — imported dynamically per the
 * module-boundary pattern.
 */
async function generateReportEvents(): Promise<GeneratedEventInput[]> {
  const { listReportCalendarItems } = await import(
    "@/lib/comms/schedules"
  );
  const items = await listReportCalendarItems();
  const out: GeneratedEventInput[] = [];
  for (const item of items) {
    const anyItem = item as unknown as Record<string, unknown>;
    const isReport = typeof anyItem.reportId === "string";
    const sourceId = isReport
      ? `report:${String(anyItem.reportId)}`
      : `schedule:${String(anyItem.scheduleId ?? "")}`;
    const rawDate = isReport
      ? String(anyItem.createdAt ?? "")
      : String(anyItem.date ?? "");
    if (!rawDate) continue;
    const startsAt =
      rawDate.length <= 10
        ? `${rawDate}T09:00:00${TZ_OFFSET}`
        : rawDate;
    out.push({
      sourceId,
      title: String(anyItem.title ?? "Report"),
      startsAt,
      endsAt: null,
      allDay: rawDate.length <= 10,
      dealId: (anyItem.dealId as string | null) ?? null,
      companyId: (anyItem.companyId as string | null) ?? null,
      href: String(anyItem.href ?? "/communications"),
      status: String(anyItem.status ?? ""),
      meta: { comms: isReport ? "draft" : "scheduled" },
    });
  }
  return out;
}

/**
 * Contract generation (Oct 24, 2026) — executed contracts' key
 * dates (kind 'deadline', previously generatorless). Titles follow
 * the spec: company + contract name + date type; the href links back
 * to the contract's home (company profile / investor record).
 */
async function generateContractDeadlineEvents(): Promise<
  GeneratedEventInput[]
> {
  const { listContractCalendarItems } = await import(
    "@/lib/docgen/contracts"
  );
  const items = await listContractCalendarItems();
  const LABELS: Record<string, string> = {
    exclusivityExpiry: "Exclusivity expiry",
    closing: "Closing",
    renewal: "Renewal",
  };
  const out: GeneratedEventInput[] = [];
  for (const item of items) {
    if (!item.date) continue;
    const subject = item.companyName || item.investorName || "Contract";
    // Contract titles already embed the subject ("<Template> —
    // <Company>"); prefix it only when it is missing so the calendar
    // title never names the company twice.
    const base = item.title.includes(subject)
      ? item.title
      : `${subject} — ${item.title}`;
    out.push({
      sourceId: `${item.contractId}:${item.dateType}`,
      title: `${base} — ${LABELS[item.dateType] ?? item.dateType}`,
      startsAt: `${item.date}T09:00:00${TZ_OFFSET}`,
      endsAt: null,
      allDay: true,
      dealId: item.dealId,
      companyId: item.companyId,
      href: item.companyId
        ? `/companies/${item.companyId}#contracts`
        : "/investors-capital",
      status: "",
      meta: {
        contractId: item.contractId,
        dateType: item.dateType,
        investorPersonId: item.investorPersonId,
      },
    });
  }
  return out;
}

export const GENERATED_EVENT_GENERATORS: Partial<
  Record<GeneratedEventKind, GeneratedEventGenerator>
> = {
  task: generateTaskEvents,
  closing: generateClosingEvents,
  milestone: generateMilestoneEvents,
  reporting: generateReportingEvents,
  covenant: generateCovenantEvents,
  meeting: generateMeetingEvents,
  report: generateReportEvents,
  deadline: generateContractDeadlineEvents,
};

/* ------------------------------ regeneration ---------------------------- */

export async function regenerateGeneratedEvents(): Promise<{
  kinds: string[];
  upserted: number;
  pruned: number;
}> {
  await ensureCalgen();
  const db = sql();
  let upserted = 0;
  let pruned = 0;
  const kinds: string[] = [];
  for (const source of GENERATED_EVENT_SOURCES) {
    const gen = GENERATED_EVENT_GENERATORS[source.kind];
    if (!gen) continue;
    kinds.push(source.kind);
    const rows = await gen();
    const keepIds: string[] = [];
    for (const r of rows) {
      const id = `${source.kind}:${r.sourceId}`;
      keepIds.push(id);
      await db`
        INSERT INTO calgen.generated_events
          (id, source_kind, source_id, title, starts_at, ends_at, all_day,
           deal_id, company_id, href, status, meta, updated_at)
        VALUES (${id}, ${source.kind}, ${r.sourceId}, ${r.title},
          ${r.startsAt}::timestamptz,
          ${r.endsAt ? r.endsAt : null}::timestamptz,
          ${Boolean(r.allDay)}, ${r.dealId ?? null}, ${r.companyId ?? null},
          ${r.href}, ${r.status ?? ""},
          ${JSON.stringify(r.meta ?? {})}::jsonb, now())
        ON CONFLICT (source_kind, source_id) DO UPDATE SET
          title = EXCLUDED.title,
          starts_at = EXCLUDED.starts_at,
          ends_at = EXCLUDED.ends_at,
          all_day = EXCLUDED.all_day,
          deal_id = EXCLUDED.deal_id,
          company_id = EXCLUDED.company_id,
          href = EXCLUDED.href,
          status = EXCLUDED.status,
          meta = EXCLUDED.meta,
          updated_at = now()`;
      upserted += 1;
    }
    // Delete stale rows of this kind that the generator no longer emits.
    if (keepIds.length === 0) {
      const staleAll = await db`
        SELECT id FROM calgen.generated_events
        WHERE source_kind = ${source.kind} LIMIT 500`;
      if (staleAll.length) {
        await db`
          DELETE FROM calgen.generated_events WHERE source_kind = ${source.kind}`;
        pruned += staleAll.length;
      }
    } else {
      const stale = await db`
        SELECT id FROM calgen.generated_events
        WHERE source_kind = ${source.kind} AND NOT (id = ANY(${keepIds}))
        LIMIT 500`;
      if (stale.length) {
        const staleIds = stale.map((r) =>
          str((r as Record<string, unknown>).id)
        );
        await db`
          DELETE FROM calgen.generated_events WHERE id = ANY(${staleIds})`;
        pruned += staleIds.length;
      }
    }
  }
  return { kinds, upserted, pruned };
}

/** Queue a background regen (deduplicated). Used by task mutations. */
export async function requestGeneratedEventsRefresh(): Promise<void> {
  try {
    await enqueueUniqueJob("refresh_generated_events", {
      reason: "task-mutation",
    });
  } catch (err) {
    console.error("[calgen] requestGeneratedEventsRefresh failed", err);
  }
}

let lastFreshCheck = 0;

/**
 * Refresh-on-open: if the newest generated event is older than 15
 * minutes (or none exist), regenerate inline. Throttled so concurrent
 * page opens don't stampede the generators.
 */
export async function ensureFreshGeneratedEvents(): Promise<void> {
  const now = Date.now();
  if (now - lastFreshCheck < 60_000) return;
  lastFreshCheck = now;
  try {
    await ensureCalgen();
    const db = sql();
    const rows = await db`
      SELECT max(updated_at) AS newest FROM calgen.generated_events`;
    const newest = rows.length
      ? isoOrNull((rows[0] as Record<string, unknown>).newest)
      : null;
    if (!newest || now - new Date(newest).getTime() > FRESH_WINDOW_MS) {
      await regenerateGeneratedEvents();
    }
  } catch (err) {
    console.error("[calgen] ensureFreshGeneratedEvents failed", err);
  }
}

/* --------------------------------- reads -------------------------------- */

export interface GeneratedEventRow {
  id: string;
  sourceKind: string;
  sourceId: string;
  title: string;
  startsAt: string;
  endsAt: string | null;
  allDay: boolean;
  dealId: string | null;
  companyId: string | null;
  href: string;
  status: string;
  meta: Record<string, unknown>;
}

export async function listGeneratedEvents(opts: {
  from: string;
  to: string;
  types?: string[];
  dealId?: string;
  limit?: number;
}): Promise<GeneratedEventRow[]> {
  await ensureCalgen();
  const db = sql();
  const types = (opts.types ?? []).filter(Boolean);
  const dealId = (opts.dealId ?? "").trim();
  const limit = Math.min(500, Math.max(1, opts.limit ?? 500));
  const rows = await db`
    SELECT id, source_kind, source_id, title, starts_at, ends_at, all_day,
      deal_id, company_id, href, status, meta
    FROM calgen.generated_events
    WHERE starts_at >= ${opts.from}::timestamptz
      AND starts_at < ${opts.to}::timestamptz
      AND (${types.length} = 0 OR source_kind = ANY(${types}))
      AND (${dealId} = '' OR deal_id = ${dealId})
    ORDER BY starts_at ASC
    LIMIT ${limit}`;
  return rows.map((r) => {
    const rec = r as Record<string, unknown>;
    const meta =
      rec.meta && typeof rec.meta === "object"
        ? (rec.meta as Record<string, unknown>)
        : {};
    return {
      id: str(rec.id),
      sourceKind: str(rec.source_kind),
      sourceId: str(rec.source_id),
      title: str(rec.title),
      startsAt: isoOrNull(rec.starts_at) ?? "",
      endsAt: isoOrNull(rec.ends_at),
      allDay: Boolean(rec.all_day),
      dealId: rec.deal_id ? str(rec.deal_id) : null,
      companyId: rec.company_id ? str(rec.company_id) : null,
      href: str(rec.href),
      status: str(rec.status),
      meta,
    };
  });
}

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
export const GENERATED_EVENT_GENERATORS: Partial<
  Record<GeneratedEventKind, GeneratedEventGenerator>
> = {
  task: generateTaskEvents,
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

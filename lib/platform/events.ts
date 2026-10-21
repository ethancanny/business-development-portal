import { sql, num } from "./db";
import { cacheInvalidate } from "./cache";
import { enqueueUniqueJob } from "./jobs";

/**
 * Internal event system (PROJECT_RULES.md): key actions publish events;
 * handlers update dependent summaries/caches. Never poll to detect
 * changes. publishEvent() never throws — a broken handler must not break
 * the caller's write path.
 */

export const EVENT_TYPES = [
  "financials_posted",
  "deal_stage_changed",
  "deal_closed",
  "document_uploaded",
  "covenant_breached",
  "reporting_received",
  "initiative_updated",
  "investor_commitment_changed",
  "contact_updated",
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

export interface PlatformEvent {
  type: EventType;
  entityKind: string;
  entityId: string;
  payload: Record<string, unknown>;
  actor: string;
}

type EventHandler = (evt: PlatformEvent) => Promise<void> | void;

const handlers = new Map<EventType, EventHandler[]>();

/** Register an additional handler for an event type (later phases). */
export function onEvent(type: EventType, fn: EventHandler): void {
  const list = handlers.get(type) ?? [];
  list.push(fn);
  handlers.set(type, list);
}

/** Event types whose effects can change Overview cards/summary numbers. */
const SUMMARY_EVENTS: ReadonlySet<EventType> = new Set<EventType>([
  "deal_stage_changed",
  "deal_closed",
  "investor_commitment_changed",
  "financials_posted",
  "document_uploaded",
  "contact_updated",
]);

async function builtinHandler(evt: PlatformEvent): Promise<void> {
  // Invalidate only the cache keys this entity can affect.
  cacheInvalidate("overview");
  if (evt.entityId) cacheInvalidate(`company:${evt.entityId}`);
  if (SUMMARY_EVENTS.has(evt.type)) {
    await enqueueUniqueJob("refresh_overview_summary", { reason: evt.type });
  }
}

/** Mark the Overview summary stale: drop cached reads + queue a refresh. */
export async function markSummaryStale(reason = "manual"): Promise<void> {
  try {
    cacheInvalidate("overview");
    await enqueueUniqueJob("refresh_overview_summary", { reason });
  } catch (err) {
    console.error("[platform/events] markSummaryStale failed", err);
  }
}

export async function publishEvent(
  type: EventType,
  opts: {
    entityKind?: string;
    entityId?: string;
    payload?: Record<string, unknown>;
    actor?: string;
  } = {}
): Promise<void> {
  const evt: PlatformEvent = {
    type,
    entityKind: opts.entityKind ?? "",
    entityId: opts.entityId ?? "",
    payload: opts.payload ?? {},
    actor: opts.actor ?? "",
  };
  try {
    const db = sql();
    const rows = await db`
      INSERT INTO core.events (type, entity_kind, entity_id, payload, actor)
      VALUES (${evt.type}, ${evt.entityKind}, ${evt.entityId},
        ${JSON.stringify(evt.payload)}::jsonb, ${evt.actor})
      RETURNING id`;
    const eventId = rows.length ? num(rows[0].id) : 0;

    try {
      await builtinHandler(evt);
    } catch (err) {
      console.error("[platform/events] builtin handler failed", type, err);
    }
    for (const fn of handlers.get(type) ?? []) {
      try {
        await fn(evt);
      } catch (err) {
        console.error("[platform/events] handler failed", type, err);
      }
    }

    if (eventId) {
      await db`
        UPDATE core.events SET processed_at = now() WHERE id = ${eventId}`;
    }
  } catch (err) {
    // Never throw out of publishEvent — callers' writes stand on their own.
    console.error("[platform/events] publishEvent failed", type, err);
  }
}

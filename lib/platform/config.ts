/**
 * Single source of truth for sync cadences (PROJECT_RULES.md — data
 * transfer efficiency) and server cache TTLs. All times America/Phoenix.
 * These are declarative: the schedulers that honor them live outside the
 * platform data layer (Vercel crons, Graph webhooks, the runtime jobs).
 */

export const SYNC_INTERVALS = {
  email:
    "15m Mon-Fri 07:00-19:00 PT, hourly otherwise (Graph webhook preferred)",
  calendar:
    "Graph change notifications / delta; polling fallback 30m business hours, hourly otherwise; refresh on open if >15m stale",
  news: "weekdays 06:00 + 16:00, weekends 08:00",
  accFitSourcing: "nightly 02:00",
  maricopaPermits: "weekly Sun 03:00",
  watchlistAndMarketEvents: "daily 05:00",
  fitEnrichment: "once per new record",
  dataRoomAccessLogs: "on demand, cached 15m",
  remindersPush:
    "event-driven: core.jobs scheduled at the exact due time when a record is created/edited (push_reminder / push_meeting60), drained opportunistically by platform API activity, the calendar webhook + watchdog ensure endpoint, market ingest and deal-flow writes; no scanning loop",
  pushDigest:
    "daily 08:00 America/Phoenix via the push_morning_digest job (morning digest + stalled deals + quiet contacts + feed silence + queued-digest flush); the job self-perpetuates and is bootstrapped by ensureMorningDigestJob",
  dataChangePush:
    "evaluated inline at the write that creates the state: deal-flow POST -> newListing; market ingest completion -> fitSignals / competingBuyer / feedDown; candidate create/update/rescore -> candidateHighScore. POST /api/push/check is a manual/diagnostic trigger only",
  frontend:
    "fetch on open + pull-to-refresh, stale 5-10m, no focus/reconnect refetch, no interval polling",
} as const;

export type SyncIntervalKey = keyof typeof SYNC_INTERVALS;

/** Server-side cache TTLs in milliseconds (rules: 5-15 min for reads). */
export const CACHE_TTLS = {
  overview: 5 * 60 * 1000,
  companies: 5 * 60 * 1000,
  companyDetail: 5 * 60 * 1000,
  search: 60 * 1000,
  integrations: 60 * 1000,
  dataRoomAccessLogs: 15 * 60 * 1000,
  default: 5 * 60 * 1000,
} as const;

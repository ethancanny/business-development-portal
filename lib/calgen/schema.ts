import { sql } from "@/lib/platform/db";

/**
 * Phase 2 — Calendar generated-events schema (schema `calgen`).
 *
 * Generated events are portal-side, derived views over other modules'
 * records (tasks today; diligence milestones, deadlines, reporting,
 * covenants, capital calls, closings, investor/board meetings and data
 * room expirations as those modules land). They are NOT Outlook events
 * and never create notifications — single-notification ownership stays
 * with Outlook for items it covers (graph_reminder_on = true).
 *
 * Module boundary: this schema is owned by the Calendar module. Other
 * modules contribute rows only through generators registered in
 * lib/calgen/registry.ts.
 */

let ready: Promise<void> | null = null;

export function ensureCalgen(): Promise<void> {
  if (!ready) {
    ready = (async () => {
      const db = sql();
      await db`CREATE SCHEMA IF NOT EXISTS calgen`;
      await db`
        CREATE TABLE IF NOT EXISTS calgen.generated_events (
          id TEXT PRIMARY KEY,
          source_kind TEXT NOT NULL DEFAULT '',
          source_id TEXT NOT NULL DEFAULT '',
          title TEXT NOT NULL DEFAULT '',
          starts_at TIMESTAMPTZ,
          ends_at TIMESTAMPTZ,
          all_day BOOLEAN NOT NULL DEFAULT false,
          deal_id TEXT,
          company_id TEXT,
          href TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT '',
          meta JSONB NOT NULL DEFAULT '{}'::jsonb,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          UNIQUE (source_kind, source_id)
        )`;
      await db`
        CREATE INDEX IF NOT EXISTS calgen_generated_events_starts_idx
        ON calgen.generated_events (starts_at)`;
      await db`
        CREATE INDEX IF NOT EXISTS calgen_generated_events_kind_idx
        ON calgen.generated_events (source_kind, starts_at)`;
      await db`
        CREATE INDEX IF NOT EXISTS calgen_generated_events_deal_idx
        ON calgen.generated_events (deal_id) WHERE deal_id IS NOT NULL`;
    })().catch((err) => {
      ready = null;
      throw err;
    });
  }
  return ready;
}

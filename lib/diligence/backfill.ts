import { sql } from "../platform/db";
import { getDeals } from "../db";
import { ensureWorkspaceForDeal } from "./service";

/**
 * Due Diligence workspace backfill — one-time migration (Oct 24, 2026).
 *
 * Marker-guarded by core.migration_state key 'dd-workspace-backfill-v1'
 * (the Phase 1 / bd-migration pattern). Runs server-side from
 * ensurePlatform on the first platform boot after deploy.
 *
 * Why: diligence workspaces were only ever created by the manual
 * "Start diligence" action on a deal's DD page. Deals that reached a
 * diligence stage any other way — seeded (Brightline SaaS, Acme
 * Logistics), imported, or created directly in the stage — had no
 * workspace, and because the Due Diligence hub lists workspace-holders
 * only, they were invisible on the Due Diligence page. The forward
 * handoff (ensureWorkspaceForDeal, wired into the deals write paths
 * and the deal_stage_changed event) prevents new gaps; this backfill
 * repairs the existing ones.
 *
 * What it does: for every legacy deal, run the same idempotent
 * handoff — deals in (or past) their type's Diligence stage gain a
 * seeded workspace; every other deal (incl. Passed/Closed) is skipped
 * untouched. No stages, owners, or financial data are modified.
 */

export const DD_BACKFILL_KEY = "dd-workspace-backfill-v1";

export interface DdBackfillReport {
  migrationKey: string;
  ranAt: string;
  dealsScanned: number;
  workspacesCreated: number;
  workspacesExisting: number;
  skippedNotInDiligence: number;
  failed: number;
}

let backfillPromise: Promise<void> | null = null;

/** Cheap marker check, then the backfill. Safe on every boot. */
export async function runDdWorkspaceBackfillIfNeeded(): Promise<void> {
  if (!backfillPromise) {
    backfillPromise = (async () => {
      const db = sql();
      try {
        const marker = await db`
          SELECT key FROM core.migration_state
          WHERE key = ${DD_BACKFILL_KEY} LIMIT 1`;
        if (marker.length) return;
      } catch {
        /* migration_state unreadable — run anyway; the handoff is
           idempotent and the marker write is ON CONFLICT DO NOTHING */
      }
      await runDdWorkspaceBackfill("system");
    })().catch((err) => {
      backfillPromise = null;
      throw err;
    });
  }
  return backfillPromise;
}

export async function runDdWorkspaceBackfill(
  actor: string
): Promise<DdBackfillReport> {
  const deals = await getDeals();
  let created = 0;
  let existing = 0;
  let skipped = 0;
  let failed = 0;
  for (const d of deals) {
    const res = await ensureWorkspaceForDeal(d.id, actor);
    if (res.created) created++;
    else if (res.existed) existing++;
    else if (res.reason === "stage_not_in_diligence") skipped++;
    else failed++;
  }
  const report: DdBackfillReport = {
    migrationKey: DD_BACKFILL_KEY,
    ranAt: new Date().toISOString(),
    dealsScanned: deals.length,
    workspacesCreated: created,
    workspacesExisting: existing,
    skippedNotInDiligence: skipped,
    failed,
  };
  const db = sql();
  await db`
    INSERT INTO core.migration_state (key, detail)
    VALUES (${DD_BACKFILL_KEY}, ${JSON.stringify(report)}::jsonb)
    ON CONFLICT (key) DO NOTHING`;
  return report;
}

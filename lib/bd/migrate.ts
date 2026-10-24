import { sql, newId } from "../platform/db";
import { getDeals, saveDeals } from "../db";
import { ensureBd } from "./schema";

/**
 * Investment Types Step 1 — one-time migration (Oct 23, 2026).
 *
 * Marker-guarded by core.migration_state key 'bd-investment-types-v1'
 * (the Phase 1 marker pattern). Runs server-side from ensurePlatform
 * on the first authenticated platform boot after deploy; the counts
 * therefore populate then, not at push time.
 *
 * What it does (additive, data-preserving):
 * 1. Stamps every existing deal investment_type = 'platform_lbo'
 *    (the deals.investment_type column default already carries this;
 *    the stamp makes it explicit in the report).
 * 2. Remaps legacy stage names to the Platform LBO defaults with the
 *    mapping ETHAN APPROVED on Oct 23 (23:45):
 *      Sourcing → Sourced · Initial Contact → Sourced ·
 *      Diligence → Diligence · Negotiation → LOI · Closing → Financing ·
 *      Closed Won → Closed · Passed → Passed.
 *    Deals already carrying a new-list stage keep it (counted as
 *    already-current). Anything else is left untouched and reported
 *    as unmapped — never guessed.
 * 3. Mirrors the new stage into core.deals (the platform projection)
 *    per deal, so summaries agree without waiting for the hourly
 *    backfill top-up.
 * 4. Re-points workflow.gate_rules at the new stage names with the
 *    same mapping. The 'Initial Contact' rules are RETIRED (deleted):
 *    their target stage no longer exists and its successor, Sourced,
 *    is the entry stage — ungated, exactly as Sourcing was. Without
 *    this, the three live deals' next stage moves would evaluate
 *    rules keyed to stages that no longer exist.
 * 5. Writes the persistent report row (bd.migration_reports) that
 *    GET /api/platform/investment-types/migration-report serves.
 *
 * The valuation layer (drivers / structure / metrics / synthesis and
 * every stored figure) is never touched — saveDeals round-trips the
 * full record verbatim.
 */

export const BD_MIGRATION_KEY = "bd-investment-types-v1";

export const APPROVED_STAGE_MAP: Record<string, string> = {
  Sourcing: "Sourced",
  "Initial Contact": "Sourced",
  Diligence: "Diligence",
  Negotiation: "LOI",
  Closing: "Financing",
  "Closed Won": "Closed",
  Passed: "Passed",
};

const NEW_LBO_STAGES = new Set([
  "Sourced",
  "IOI",
  "Diligence",
  "LOI",
  "Financing",
  "Closed",
  "Passed",
]);

export interface BdMigrationReport {
  migrationKey: string;
  ranAt: string;
  dealsScanned: number;
  dealsUpdated: number;
  byType: Record<string, number>;
  stageFromTo: Array<{ from: string; to: string; count: number }>;
  alreadyCurrent: number;
  unmapped: Array<{ dealId: string; companyName: string; stage: string }>;
  gateRulesRemapped: number;
  gateRulesRetired: number;
  stageMap: Record<string, string>;
}

let migrationPromise: Promise<void> | null = null;

/** Cheap marker check, then the migration. Safe on every boot. */
export async function runBdMigrationIfNeeded(): Promise<void> {
  if (!migrationPromise) {
    migrationPromise = (async () => {
      await ensureBd();
      const db = sql();
      try {
        const marker = await db`
          SELECT key FROM core.migration_state
          WHERE key = ${BD_MIGRATION_KEY} LIMIT 1`;
        if (marker.length) return;
      } catch {
        /* migration_state unreadable — run anyway; the report insert
           and marker write below are idempotent per key check */
      }
      await runBdMigration("system");
    })().catch((err) => {
      migrationPromise = null;
      throw err;
    });
  }
  return migrationPromise;
}

export async function runBdMigration(
  actor: string
): Promise<BdMigrationReport> {
  await ensureBd();
  const db = sql();
  const deals = await getDeals();

  const fromTo = new Map<string, number>();
  const unmapped: BdMigrationReport["unmapped"] = [];
  let alreadyCurrent = 0;
  let changed = false;

  const updated = deals.map((d) => {
    const next = { ...d, investmentType: "platform_lbo" as const };
    const mapped = APPROVED_STAGE_MAP[d.stage];
    if (mapped) {
      const k = `${d.stage} → ${mapped}`;
      fromTo.set(k, (fromTo.get(k) ?? 0) + 1);
      if (mapped !== d.stage) {
        next.stage = mapped;
        changed = true;
      } else {
        alreadyCurrent += 1;
      }
    } else if (NEW_LBO_STAGES.has(d.stage)) {
      alreadyCurrent += 1;
    } else {
      unmapped.push({ dealId: d.id, companyName: d.companyName, stage: d.stage });
    }
    if ((d.investmentType ?? "platform_lbo") !== "platform_lbo") changed = true;
    return next;
  });

  const dealsUpdated = updated.filter((d, i) => {
    const before = deals[i];
    return (
      d.stage !== before.stage ||
      (before.investmentType ?? "platform_lbo") !== "platform_lbo"
    );
  }).length;

  if (changed || dealsUpdated > 0) {
    await saveDeals(updated);
  }

  /* Mirror stages into the core.deals projection per deal (core.deals
   * carries the legacy deal id as its own id, stage in `stage`).
   * Best-effort: the hourly backfill top-up converges regardless. */
  try {
    const moved = updated.filter((d, i) => d.stage !== deals[i].stage);
    for (const d of moved) {
      await db`
        UPDATE core.deals
        SET stage = ${d.stage}, updated_at = now()
        WHERE id = ${d.id}`;
    }
  } catch (err) {
    console.error(
      "[bd] core.deals stage mirror failed (top-up will converge)",
      err instanceof Error ? err.message : String(err)
    );
  }

  /* Gate rules: remap targets; retire the Initial Contact rules. */
  let gateRulesRemapped = 0;
  let gateRulesRetired = 0;
  try {
    await ensureBd();
    const { ensureWorkflow } = await import("../workflow/schema");
    await ensureWorkflow();
    for (const [from, to] of Object.entries(APPROVED_STAGE_MAP)) {
      if (from === to || from === "Initial Contact") continue;
      const rows = await db`
        UPDATE workflow.gate_rules SET target_stage = ${to}, updated_at = now()
        WHERE target_stage = ${from}
        RETURNING id`;
      gateRulesRemapped += rows.length;
    }
    const retired = await db`
      DELETE FROM workflow.gate_rules
      WHERE target_stage = 'Initial Contact'
      RETURNING id`;
    gateRulesRetired = retired.length;
  } catch (err) {
    console.error(
      "[bd] gate rule remap failed",
      err instanceof Error ? err.message : String(err)
    );
  }

  const byType: Record<string, number> = {};
  for (const d of updated) {
    const t = d.investmentType ?? "platform_lbo";
    byType[t] = (byType[t] ?? 0) + 1;
  }

  const report: BdMigrationReport = {
    migrationKey: BD_MIGRATION_KEY,
    ranAt: new Date().toISOString(),
    dealsScanned: deals.length,
    dealsUpdated,
    byType,
    stageFromTo: Array.from(fromTo.entries()).map(([k, count]) => {
      const [from, to] = k.split(" → ");
      return { from, to, count };
    }),
    alreadyCurrent,
    unmapped,
    gateRulesRemapped,
    gateRulesRetired,
    stageMap: APPROVED_STAGE_MAP,
  };

  const id = `bdmig_${newId()}`;
  await db`
    INSERT INTO bd.migration_reports (id, migration_key, actor, report)
    VALUES (${id}, ${BD_MIGRATION_KEY}, ${actor},
      ${JSON.stringify(report)}::jsonb)`;
  await db`
    INSERT INTO core.migration_state (key, detail)
    VALUES (${BD_MIGRATION_KEY},
      ${JSON.stringify({
        dealsScanned: report.dealsScanned,
        dealsUpdated: report.dealsUpdated,
        unmapped: report.unmapped.length,
      })}::jsonb)
    ON CONFLICT (key) DO NOTHING`;
  return report;
}

export async function getLatestMigrationReport(): Promise<{
  ran: boolean;
  report: BdMigrationReport | null;
}> {
  await ensureBd();
  const db = sql();
  const rows = await db`
    SELECT report, ran_at FROM bd.migration_reports
    WHERE migration_key = ${BD_MIGRATION_KEY}
    ORDER BY ran_at DESC LIMIT 1`;
  if (!rows.length) return { ran: false, report: null };
  const rec = rows[0] as Record<string, unknown>;
  let report = rec.report as BdMigrationReport;
  if (typeof report === "string") {
    try {
      report = JSON.parse(report) as BdMigrationReport;
    } catch {
      report = null as unknown as BdMigrationReport;
    }
  }
  if (report && !report.ranAt) {
    report.ranAt = rec.ran_at ? new Date(rec.ran_at as string).toISOString() : "";
  }
  return { ran: true, report };
}

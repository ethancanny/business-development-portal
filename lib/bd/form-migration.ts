import { sql, newId } from "../platform/db";
import { ensureBd } from "./schema";

/**
 * New investment form — section assignment migration (Oct 24, 2026).
 *
 * The type-first form renders its metric sections FROM
 * bd.metric_definitions: each definition's config.section names the
 * form section it belongs to. The Step 1 seeds predate sections, so
 * this one-time, marker-guarded migration ('bd-form-sections-v1',
 * the Phase 1 marker pattern) stamps the assignment onto every seed
 * that lacks one. The UPDATE only touches rows whose config has NO
 * 'section' key — a section Ethan later changes in Settings is never
 * overwritten, and re-runs are no-ops. Newer definitions (the Early
 * Stage round/traction/team/investor fields and the Add-on synergy
 * split) are seeded with their section already in schema.ts; they
 * are listed here too so a database that receives them through any
 * path converges to the same assignment.
 *
 * A report row lands in bd.migration_reports under this key.
 */

export const FORM_SECTIONS_MIGRATION_KEY = "bd-form-sections-v1";

const SECTION_BY_KEY: Record<string, string> = {
  /* Platform LBO metrics */
  leverage_x: "lbo_metrics",
  equity_check: "lbo_metrics",
  fcf_yield_pct: "lbo_metrics",
  roic_pct: "lbo_metrics",
  dscr: "lbo_metrics",
  target_irr_pct: "lbo_metrics",
  target_moic: "lbo_metrics",
  hold_years: "lbo_metrics",
  /* Add-on metrics */
  purchase_multiple: "addon_metrics",
  synergies_annual: "addon_metrics",
  synergies_cost: "addon_metrics",
  synergies_revenue: "addon_metrics",
  integration_cost: "addon_metrics",
  fit_score: "addon_metrics",
  /* Early Stage — round */
  round_stage: "round",
  round_size: "round",
  instrument: "round",
  pre_money: "round",
  valuation_cap: "round",
  discount_pct: "round",
  check_size: "round",
  ownership_pct: "round",
  follow_on_reserves: "round",
  /* Early Stage — traction */
  arr: "traction",
  mrr: "traction",
  contract_revenue: "traction",
  traction_growth_pct: "traction",
  gross_margin_pct: "traction",
  burn_monthly: "traction",
  runway_months: "traction",
  customers: "traction",
  /* Early Stage — basics / team & market / investors */
  founders: "es_basics",
  team_notes: "team_market",
  market_notes: "team_market",
  lead_investor: "investors_es",
  co_investors: "investors_es",
  /* Aerospace & Defense sector pack (additive, any type) */
  backlog: "sector_pack",
  book_to_bill: "sector_pack",
  contract_mix: "sector_pack",
  customer_concentration: "sector_pack",
  certifications: "sector_pack",
  facility_clearance: "sector_pack",
  sole_source_status: "sector_pack",
  machine_utilization_pct: "sector_pack",
  equipment_age_years: "sector_pack",
  machinist_headcount: "sector_pack",
  gov_budget_exposure: "sector_pack",
  trl: "sector_pack",
  sbir_phase: "sector_pack",
  sbir_awards_total: "sector_pack",
  ip_data_rights: "sector_pack",
  export_control_status: "sector_pack",
  path_to_production: "sector_pack",
};

let migrationPromise: Promise<void> | null = null;

/** Cheap marker check, then the migration. Safe on every boot. */
export function runFormSectionsMigrationIfNeeded(): Promise<void> {
  if (!migrationPromise) {
    migrationPromise = (async () => {
      await ensureBd();
      const db = sql();
      try {
        const marker = await db`
          SELECT key FROM core.migration_state
          WHERE key = ${FORM_SECTIONS_MIGRATION_KEY} LIMIT 1`;
        if (marker.length) return;
      } catch {
        /* migration_state unreadable — run anyway; every UPDATE is
           guarded on the absence of a section, so it stays safe */
      }
      await runFormSectionsMigration("system");
    })().catch((err) => {
      migrationPromise = null;
      throw err;
    });
  }
  return migrationPromise;
}

export async function runFormSectionsMigration(
  actor: string
): Promise<{ assigned: number; alreadySet: number; missing: string[] }> {
  await ensureBd();
  const db = sql();
  let assigned = 0;
  let alreadySet = 0;
  const missing: string[] = [];
  for (const [key, section] of Object.entries(SECTION_BY_KEY)) {
    const rows = await db`
      UPDATE bd.metric_definitions
      SET config = config || ${JSON.stringify({ section })}::jsonb,
        updated_at = now()
      WHERE key = ${key} AND NOT (config ? 'section')
      RETURNING key`;
    if (rows.length) {
      assigned += rows.length;
      continue;
    }
    const existing = await db`
      SELECT key FROM bd.metric_definitions WHERE key = ${key} LIMIT 1`;
    if (existing.length) alreadySet += 1;
    else missing.push(key);
  }

  const id = `bdmig_${newId()}`;
  await db`
    INSERT INTO bd.migration_reports (id, migration_key, actor, report)
    VALUES (${id}, ${FORM_SECTIONS_MIGRATION_KEY}, ${actor},
      ${JSON.stringify({ assigned, alreadySet, missing })}::jsonb)`;
  await db`
    INSERT INTO core.migration_state (key, detail)
    VALUES (${FORM_SECTIONS_MIGRATION_KEY},
      ${JSON.stringify({ assigned, alreadySet, missing })}::jsonb)
    ON CONFLICT (key) DO NOTHING`;
  return { assigned, alreadySet, missing };
}

import { sql, str } from "./platform/db";
import {
  ensureDismissedBlocklist,
  tombstoneCompanyRows,
} from "./market-db";
import { getDealFlow, saveDealFlow } from "./db";

/**
 * Data retention & hygiene (Ethan's rule, Nov 7, 2026): the portal
 * does not store anything that has been cleared, dismissed, or
 * deleted, and it does not keep old data from retired sources.
 *
 * This module is the purge that enforces it:
 *  - retired macro/economic datasets (Nov 5, 2026 retirements) are
 *    deleted outright — FRED/BLS/Census/commodity-spot/EBRC indicator
 *    series, the WARN table, and the Google-News economic-event and
 *    bankruptcy rows in the acquisitions feed. Kept in the same
 *    tables: USASpending (defense) and Damodaran indicator series,
 *    and genuine acquisition rows.
 *  - dismissed news stories are deleted (saved stories stay).
 *  - dismissed companies are tombstoned into the slim
 *    mi_dismissed_blocklist (identity keys only, so they can never
 *    resurface as fits) and their full rows deleted.
 *  - soft-deleted records (Directory people/organizations, platform
 *    companies, CRM interactions) are hard-deleted with their link
 *    rows. Deal attachments are deliberately NOT touched.
 *  - dismissed Deal Flow (Activity) items are deleted.
 *  - sync-log rows older than 30 days are deleted (logSync also
 *    prunes these on write; this is the backstop).
 *
 * Every step runs independently: one failing step never blocks the
 * others, and the result reports exact counts per step.
 */

export interface RetentionCounts {
  indicatorsMacro: number;
  warnRows: number;
  acquisitionsRetired: number;
  newsDismissed: number;
  syncLogOld: number;
  companiesDismissedRows: number;
  companiesTombstones: number;
  directoryPeople: number;
  directoryOrganizations: number;
  interactionsDeleted: number;
  platformCompanies: number;
  dealFlowDismissed: number;
}

export interface RetentionResult {
  ranAt: string;
  counts: RetentionCounts;
  errors: Record<string, string>;
}

const MACRO_INDICATOR_SOURCES = ["fred", "bls", "census", "yahoo", "ebrc"];
const RETIRED_ACQUISITION_TYPES = [
  "bankruptcy",
  "expansion",
  "contract",
  "relocation",
  "ipo",
  "policy",
  "investment",
];

async function countThenDelete(
  countSql: () => Promise<unknown>,
  deleteSql: () => Promise<unknown>
): Promise<number> {
  const rows = (await countSql()) as unknown as Array<Record<string, unknown>>;
  const n = Number(rows[0]?.c ?? 0);
  if (n > 0) await deleteSql();
  return n;
}

export async function runRetentionPurge(): Promise<RetentionResult> {
  const db = sql();
  const counts: RetentionCounts = {
    indicatorsMacro: 0,
    warnRows: 0,
    acquisitionsRetired: 0,
    newsDismissed: 0,
    syncLogOld: 0,
    companiesDismissedRows: 0,
    companiesTombstones: 0,
    directoryPeople: 0,
    directoryOrganizations: 0,
    interactionsDeleted: 0,
    platformCompanies: 0,
    dealFlowDismissed: 0,
  };
  const errors: Record<string, string> = {};
  const step = async (
    key: keyof RetentionCounts | string,
    fn: () => Promise<number>
  ) => {
    try {
      const n = await fn();
      if (key in counts) counts[key as keyof RetentionCounts] = n;
      return n;
    } catch (err) {
      errors[key] = err instanceof Error ? err.message : String(err);
      return 0;
    }
  };

  await step("indicatorsMacro", () =>
    countThenDelete(
      () => db`SELECT COUNT(*)::int AS c FROM mi_indicators WHERE source = ANY(${MACRO_INDICATOR_SOURCES})`,
      () => db`DELETE FROM mi_indicators WHERE source = ANY(${MACRO_INDICATOR_SOURCES})`
    )
  );

  await step("warnRows", () =>
    countThenDelete(
      () => db`SELECT COUNT(*)::int AS c FROM mi_warn`,
      () => db`DELETE FROM mi_warn`
    )
  );

  await step("acquisitionsRetired", () =>
    countThenDelete(
      () =>
        db`SELECT COUNT(*)::int AS c FROM mi_acquisitions WHERE event_type = ANY(${RETIRED_ACQUISITION_TYPES}) OR status = 'dismissed'`,
      () =>
        db`DELETE FROM mi_acquisitions WHERE event_type = ANY(${RETIRED_ACQUISITION_TYPES}) OR status = 'dismissed'`
    )
  );

  await step("newsDismissed", () =>
    countThenDelete(
      () =>
        db`SELECT COUNT(*)::int AS c FROM mi_news WHERE dismissed = TRUE AND saved = FALSE`,
      () => db`DELETE FROM mi_news WHERE dismissed = TRUE AND saved = FALSE`
    )
  );

  await step("syncLogOld", () =>
    countThenDelete(
      () =>
        db`SELECT COUNT(*)::int AS c FROM mi_sync_log WHERE ran_at < NOW() - INTERVAL '30 days'`,
      () => db`DELETE FROM mi_sync_log WHERE ran_at < NOW() - INTERVAL '30 days'`
    )
  );

  // Dismissed companies: tombstone first (never-resurface), then
  // delete the full rows.
  try {
    const rows = (await db`
      SELECT * FROM mi_companies WHERE status = 'dismissed'`) as unknown as Record<
      string,
      unknown
    >[];
    counts.companiesDismissedRows = rows.length;
    if (rows.length) {
      counts.companiesTombstones = await tombstoneCompanyRows(rows);
      await db`DELETE FROM mi_companies WHERE status = 'dismissed'`;
    }
  } catch (err) {
    errors.companiesDismissed = err instanceof Error ? err.message : String(err);
  }

  // Directory people (soft-deleted): link rows first, then the record.
  try {
    const people = await db`SELECT id FROM core.people WHERE deleted_at IS NOT NULL`;
    const ids = people.map((r) => str(r.id)).filter(Boolean);
    counts.directoryPeople = ids.length;
    if (ids.length) {
      await db`DELETE FROM directory.interaction_participants WHERE person_id = ANY(${ids})`;
      await db`DELETE FROM directory.list_members WHERE entity_kind = 'person' AND entity_id = ANY(${ids})`;
      await db`DELETE FROM directory.relationship_profiles WHERE entity_kind = 'person' AND entity_id = ANY(${ids})`;
      await db`DELETE FROM directory.email_links WHERE person_id = ANY(${ids})`;
      await db`DELETE FROM core.deal_participants WHERE entity_kind = 'person' AND entity_id = ANY(${ids})`;
      await db`DELETE FROM core.people WHERE deleted_at IS NOT NULL`;
    }
  } catch (err) {
    errors.directoryPeople = err instanceof Error ? err.message : String(err);
  }

  // Directory organizations (soft-deleted): unlink people, drop link
  // rows, then the record.
  try {
    const orgs = await db`SELECT id FROM core.organizations WHERE deleted_at IS NOT NULL`;
    const ids = orgs.map((r) => str(r.id)).filter(Boolean);
    counts.directoryOrganizations = ids.length;
    if (ids.length) {
      await db`UPDATE core.people SET organization_id = NULL WHERE organization_id = ANY(${ids})`;
      await db`DELETE FROM directory.list_members WHERE entity_kind = 'organization' AND entity_id = ANY(${ids})`;
      await db`DELETE FROM directory.relationship_profiles WHERE entity_kind = 'organization' AND entity_id = ANY(${ids})`;
      await db`DELETE FROM directory.email_links WHERE organization_id = ANY(${ids})`;
      await db`DELETE FROM core.deal_participants WHERE entity_kind = 'organization' AND entity_id = ANY(${ids})`;
      await db`DELETE FROM core.organizations WHERE deleted_at IS NOT NULL`;
    }
  } catch (err) {
    errors.directoryOrganizations =
      err instanceof Error ? err.message : String(err);
  }

  // CRM interactions (soft-deleted): participants first.
  await step("interactionsDeleted", async () => {
    const rows = (await db`
      SELECT COUNT(*)::int AS c FROM directory.interactions WHERE deleted_at IS NOT NULL`) as Array<
      Record<string, unknown>
    >;
    const n = Number(rows[0]?.c ?? 0);
    if (n > 0) {
      await db`DELETE FROM directory.interaction_participants WHERE interaction_id IN (SELECT id FROM directory.interactions WHERE deleted_at IS NOT NULL)`;
      await db`DELETE FROM directory.interactions WHERE deleted_at IS NOT NULL`;
    }
    return n;
  });

  // Platform companies (soft-deleted): drop their cached cards too.
  await step("platformCompanies", async () => {
    const rows = (await db`
      SELECT COUNT(*)::int AS c FROM core.companies WHERE deleted_at IS NOT NULL`) as Array<
      Record<string, unknown>
    >;
    const n = Number(rows[0]?.c ?? 0);
    if (n > 0) {
      await db`DELETE FROM core.company_cards WHERE company_id IN (SELECT id FROM core.companies WHERE deleted_at IS NOT NULL)`;
      await db`DELETE FROM core.companies WHERE deleted_at IS NOT NULL`;
    }
    return n;
  });

  // Deal Flow (Activity feed): dismissed items are removed outright.
  await step("dealFlowDismissed", async () => {
    const items = await getDealFlow();
    const kept = items.filter((it) => it.status !== "dismissed");
    const n = items.length - kept.length;
    if (n > 0) await saveDealFlow(kept);
    return n;
  });

  return { ranAt: new Date().toISOString(), counts, errors };
}

/** What a purge would remove right now, without removing it — feeds
 * the Settings → Data Hygiene card. */
export async function getRetentionStatus(): Promise<
  RetentionCounts & { syncLogTotal: number; blocklistTotal: number }
> {
  const db = sql();
  const one = async (q: Promise<unknown>): Promise<number> => {
    try {
      const rows = (await q) as unknown as Array<Record<string, unknown>>;
      return Number(rows[0]?.c ?? 0);
    } catch {
      return 0;
    }
  };
  const base = {
    indicatorsMacro: 0,
    warnRows: 0,
    acquisitionsRetired: 0,
    newsDismissed: 0,
    syncLogOld: 0,
    companiesDismissedRows: 0,
    companiesTombstones: 0,
    directoryPeople: 0,
    directoryOrganizations: 0,
    interactionsDeleted: 0,
    platformCompanies: 0,
    dealFlowDismissed: 0,
    syncLogTotal: 0,
    blocklistTotal: 0,
  };
  base.indicatorsMacro = await one(
    db`SELECT COUNT(*)::int AS c FROM mi_indicators WHERE source = ANY(${MACRO_INDICATOR_SOURCES})`);
  base.warnRows = await one(
    db`SELECT COUNT(*)::int AS c FROM mi_warn`);
  base.acquisitionsRetired = await one(
    db`SELECT COUNT(*)::int AS c FROM mi_acquisitions WHERE event_type = ANY(${RETIRED_ACQUISITION_TYPES}) OR status = 'dismissed'`);
  base.newsDismissed = await one(
    db`SELECT COUNT(*)::int AS c FROM mi_news WHERE dismissed = TRUE AND saved = FALSE`);
  base.syncLogOld = await one(
    db`SELECT COUNT(*)::int AS c FROM mi_sync_log WHERE ran_at < NOW() - INTERVAL '30 days'`);
  base.syncLogTotal = await one(
    db`SELECT COUNT(*)::int AS c FROM mi_sync_log`);
  base.companiesDismissedRows = await one(
    db`SELECT COUNT(*)::int AS c FROM mi_companies WHERE status = 'dismissed'`);
  try {
    await ensureDismissedBlocklist();
    base.blocklistTotal = await one(
      db`SELECT COUNT(*)::int AS c FROM mi_dismissed_blocklist`);
  } catch {
    base.blocklistTotal = 0;
  }
  base.directoryPeople = await one(
    db`SELECT COUNT(*)::int AS c FROM core.people WHERE deleted_at IS NOT NULL`);
  base.directoryOrganizations = await one(
    db`SELECT COUNT(*)::int AS c FROM core.organizations WHERE deleted_at IS NOT NULL`);
  base.interactionsDeleted = await one(
    db`SELECT COUNT(*)::int AS c FROM directory.interactions WHERE deleted_at IS NOT NULL`);
  base.platformCompanies = await one(
    db`SELECT COUNT(*)::int AS c FROM core.companies WHERE deleted_at IS NOT NULL`);
  try {
    const items = await getDealFlow();
    base.dealFlowDismissed = items.filter((it) => it.status === "dismissed").length;
  } catch {
    base.dealFlowDismissed = 0;
  }
  return base;
}

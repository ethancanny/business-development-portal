import { neon } from "@neondatabase/serverless";
import { ensureSchema } from "./db-postgres";
import { importCompanies, type CompanyInput } from "./market-db";

/** Company consolidation (moved out of lib/market-db.ts Oct 17, 2026 —
 * the file outgrew the GitHub push payload cap). Replaces groups of
 * duplicate member rows with one consolidated row per company; fit is
 * re-judged by computeFit on the consolidated numbers at insert;
 * triage status and filter exemptions carry over from absorbed rows. */

function sql() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set (market intel requires Postgres)");
  return neon(url);
}

export interface ConsolidateRow extends CompanyInput {
  /** "source|dedupKey" keys of the member rows this consolidated row replaces. */
  absorb: string[];
}

const STATUS_RANK: Record<string, number> = { new: 0, fit: 1, dismissed: 2, keep: 3, added: 4 };

/**
 * Replace groups of duplicate member rows (same company, many locations /
 * registrations, possibly spanning sectors and sources) with one consolidated
 * row per company. Fit is re-judged by computeFit on the consolidated numbers
 * at insert. Triage status carries over from the best-ranked absorbed row.
 *
 * Successor identity is the (source, dedupKey, sector) triple — the same
 * identity the table's unique key and importCompanies' ON CONFLICT target
 * use. A consolidation run CONVERGES: for every posted (source, dedupKey)
 * pair, exactly one row survives — the successor posted by this run, in its
 * posted sector. (Successor-identity fix, Oct 26, 2026: identity used to be
 * the sector-blind (source, dedupKey) pair in this function while the import
 * upserted per triple, so a prior successor in another sector was neither
 * updated in place — different conflict target — nor deleted: the pair-level
 * ownKeys shield below protected it. The stale row survived every later run
 * as a phantom duplicate, e.g. Honeywell's pre-Fix-A MFG successor sitting
 * next to its fresh A&D successor and inflating the visible total by 43%.)
 */
export async function consolidateCompanies(rowsIn: ConsolidateRow[]): Promise<{ groups: number; absorbed: number }> {
  await ensureSchema();
  const db = sql();
  const keyOf = (s: string, d: string) => `${s}|${d}`;
  const tripleOf = (s: string, d: string, sec: string) => `${s}|${d}|${sec}`;
  // (a) Dedupe the consolidated rows themselves by (source, dedupKey).
  // Two distinct groups can slugify to the same ENT key (long names share
  // a truncated slug); left in one payload they collide in the import's
  // multi-row INSERT and abort it. Merge their absorb lists into one row.
  const rowByKey: Record<string, ConsolidateRow> = {};
  const rowOrder: string[] = [];
  for (const r of rowsIn) {
    const k = keyOf(r.source, r.dedupKey);
    const prev = rowByKey[k];
    if (prev) {
      const abs: Record<string, true> = {};
      for (const a of prev.absorb ?? []) abs[a] = true;
      for (const a of r.absorb ?? []) abs[a] = true;
      prev.absorb = Object.keys(abs);
    } else {
      rowByKey[k] = r;
      rowOrder.push(k);
    }
  }
  const rows = rowOrder.map((k) => rowByKey[k]);
  // The posted successors' triples. A pre-existing row is protected from
  // the absorb delete ONLY under its exact posted triple: that is the row
  // the import updates in place, so deleting it would erase the
  // replacement. The same (source, dedupKey) pair in a DIFFERENT sector
  // is a different row — the import never touches it — so it gets no
  // protection from sharing the pair (that pair-level shield is what let
  // stale successors survive as phantoms; see the docstring above).
  const postedTriples: Record<string, true> = {};
  const postedPairs: string[] = [];
  for (const r of rows) {
    postedTriples[tripleOf(r.source, r.dedupKey, r.sector)] = true;
    postedPairs.push(keyOf(r.source, r.dedupKey));
  }
  const seenStatus: Record<string, true> = {};
  const statusKeys: string[] = [];
  const seenAbsorb: Record<string, true> = {};
  const absorbPairs: string[] = [];
  for (const r of rows) {
    for (const k of r.absorb ?? []) {
      if (!seenStatus[k]) {
        seenStatus[k] = true;
        statusKeys.push(k);
      }
      if (!seenAbsorb[k]) {
        seenAbsorb[k] = true;
        absorbPairs.push(k);
      }
    }
  }
  // Read absorbed rows before any write (triage carry-over + the sector
  // of every existing row under an absorbed pair, for the triple-precise
  // absorb delete below).
  const statusByKey = new Map<string, string>();
  // Filter exemptions carry over too (added Oct 17, 2026): a "Not a
  // chain" / "Not institutional" override on an absorbed member must
  // survive consolidation — the successor is a fresh row under a new
  // key, so without this carry the weekly consolidation silently
  // un-exempted every overridden company it regrouped.
  const chainExemptByKey = new Map<string, boolean>();
  const instExemptByKey = new Map<string, boolean>();
  const existingTriples: string[] = [];
  for (let i = 0; i < statusKeys.length; i += 1500) {
    const chunk = statusKeys.slice(i, i + 1500);
    const found = await db`SELECT source, dedup_key, sector, status, chain_exempt, institutional_exempt FROM mi_companies WHERE (source || '|' || dedup_key) = ANY(${chunk})`;
    for (const f of found as unknown as Record<string, unknown>[]) {
      const k = keyOf(String(f.source), String(f.dedup_key));
      statusByKey.set(k, String(f.status));
      if (f.chain_exempt === true) chainExemptByKey.set(k, true);
      if (f.institutional_exempt === true) instExemptByKey.set(k, true);
      existingTriples.push(tripleOf(String(f.source), String(f.dedup_key), String(f.sector)));
    }
  }
  // Absorb delete set: every existing row under an absorbed pair whose
  // triple is not one of this run's posted successor triples. Member rows
  // are never posted triples, so they are all deleted (as before, now
  // triple-precise); a prior successor in the posted sector is the posted
  // triple itself and survives to be updated in place; a prior successor
  // in any other sector is deleted here.
  const absorbTriples = existingTriples.filter((t) => !postedTriples[t]);
  // (b) Import the consolidated replacement rows FIRST. The absorbed
  // member rows are deleted only after every import has succeeded: a
  // failed import now leaves duplicates behind (the next consolidation
  // run re-groups and heals them) instead of the Oct 9, 2026 data loss,
  // where members were deleted first and a mid-import abort erased them.
  const bySource = new Map<string, ConsolidateRow[]>();
  const sourceOrder: string[] = [];
  for (const r of rows) {
    if (!bySource.has(r.source)) sourceOrder.push(r.source);
    const list = bySource.get(r.source) ?? [];
    list.push(r);
    bySource.set(r.source, list);
  }
  for (const source of sourceOrder) {
    await importCompanies(source, bySource.get(source) ?? [], false);
  }
  let absorbedCount = 0;
  for (let i = 0; i < absorbTriples.length; i += 1500) {
    const chunk = absorbTriples.slice(i, i + 1500);
    const gone = await db`DELETE FROM mi_companies WHERE (source || '|' || dedup_key || '|' || sector) = ANY(${chunk}) RETURNING dedup_key`;
    absorbedCount += (gone as unknown[]).length;
  }
  // (c) Posted-pair reconciliation: any row still carrying a posted
  // (source, dedupKey) pair under a triple this run did not post is a
  // stale successor from an earlier run (it may not have appeared in any
  // absorb list — e.g. its group was posted by an earlier chunk or its
  // name variant grouped it elsewhere). The current run's posted
  // successors win: delete those rows so each posted pair converges to
  // exactly one live row.
  if (postedPairs.length) {
    const postedTripleList = Object.keys(postedTriples);
    for (let i = 0; i < postedPairs.length; i += 1500) {
      const chunk = postedPairs.slice(i, i + 1500);
      const gone = await db`DELETE FROM mi_companies WHERE (source || '|' || dedup_key) = ANY(${chunk}) AND (source || '|' || dedup_key || '|' || sector) <> ALL(${postedTripleList}) RETURNING dedup_key`;
      absorbedCount += (gone as unknown[]).length;
    }
  }
  const keysByStatus = new Map<string, string[]>();
  const statusOrder: string[] = [];
  for (const r of rows) {
    let best = "new";
    for (const k of r.absorb ?? []) {
      const s = statusByKey.get(k);
      if (s && (STATUS_RANK[s] ?? 0) > (STATUS_RANK[best] ?? 0)) best = s;
    }
    if (best !== "new") {
      if (!keysByStatus.has(best)) statusOrder.push(best);
      const list = keysByStatus.get(best) ?? [];
      list.push(keyOf(r.source, r.dedupKey));
      keysByStatus.set(best, list);
    }
  }
  for (const status of statusOrder) {
    const keys = keysByStatus.get(status) ?? [];
    for (let i = 0; i < keys.length; i += 1500) {
      const chunk = keys.slice(i, i + 1500);
      await db`UPDATE mi_companies SET status = ${status} WHERE (source || '|' || dedup_key) = ANY(${chunk})`;
    }
  }
  // Exemption carry: any absorbed member exempt from a filter makes
  // the successor exempt from it (flags cleared, mirroring the
  // "Not a chain" / "Not institutional" overrides).
  const chainExemptKeys: string[] = [];
  const instExemptKeys: string[] = [];
  for (const r of rows) {
    if ((r.absorb ?? []).some((k) => chainExemptByKey.get(k))) chainExemptKeys.push(keyOf(r.source, r.dedupKey));
    if ((r.absorb ?? []).some((k) => instExemptByKey.get(k))) instExemptKeys.push(keyOf(r.source, r.dedupKey));
  }
  for (let i = 0; i < chainExemptKeys.length; i += 1500) {
    const chunk = chainExemptKeys.slice(i, i + 1500);
    await db`UPDATE mi_companies SET chain_exempt = true, is_chain = false, chain_reason = '', chain_suspect = false, updated_at = NOW() WHERE (source || '|' || dedup_key) = ANY(${chunk})`;
  }
  for (let i = 0; i < instExemptKeys.length; i += 1500) {
    const chunk = instExemptKeys.slice(i, i + 1500);
    await db`UPDATE mi_companies SET institutional_exempt = true, is_institutional = false, institutional_reason = '', institutional_suspect = false, updated_at = NOW() WHERE (source || '|' || dedup_key) = ANY(${chunk})`;
  }
  return { groups: rows.length, absorbed: absorbedCount };
}

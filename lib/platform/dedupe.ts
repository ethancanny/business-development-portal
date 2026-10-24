import { sql, str, numOrNull } from "./db";
import { cacheInvalidate } from "./cache";
import { enqueueUniqueJob } from "./jobs";
import { publishEvent } from "./events";
import type { DuplicatePair } from "./types";

/**
 * Duplicate detection + merge for companies and people. Detection groups
 * on normalized_name (computed at write/backfill time); merges are
 * soft-delete based: references are repointed to the keeper, empty keeper
 * fields are filled from the merged row, the merged row is stamped
 * deleted_at, and an audit_log row records the merge.
 */

export type DedupeKind = "companies" | "people";

export async function findDuplicates(kind: string): Promise<DuplicatePair[]> {
  const db = sql();
  const out: DuplicatePair[] = [];
  if (kind === "companies") {
    const rows = await db`
      SELECT a.id AS a_id, a.name AS a_name, a.city AS a_city,
        b.id AS b_id, b.name AS b_name, b.city AS b_city
      FROM core.companies a
      JOIN core.companies b
        ON a.normalized_name = b.normalized_name AND a.id < b.id
      WHERE a.deleted_at IS NULL AND b.deleted_at IS NULL
        AND a.normalized_name <> ''
      ORDER BY a.normalized_name
      LIMIT 100`;
    for (const r of rows) {
      const rec = r as Record<string, unknown>;
      const sameCity =
        str(rec.a_city) !== "" &&
        str(rec.a_city).toLowerCase() === str(rec.b_city).toLowerCase();
      out.push({
        kind: "companies",
        aId: str(rec.a_id),
        aName: str(rec.a_name),
        bId: str(rec.b_id),
        bName: str(rec.b_name),
        reason: sameCity ? "same normalized name + city" : "same normalized name",
        score: sameCity ? 100 : 90,
      });
    }
    return out;
  }
  if (kind === "people") {
    const rows = await db`
      SELECT a.id AS a_id, a.name AS a_name, a.email AS a_email,
        b.id AS b_id, b.name AS b_name, b.email AS b_email
      FROM core.people a
      JOIN core.people b
        ON a.id < b.id
        AND (
          (a.normalized_name <> '' AND a.normalized_name = b.normalized_name)
          OR (a.email <> '' AND lower(a.email) = lower(b.email))
        )
      WHERE a.deleted_at IS NULL AND b.deleted_at IS NULL
      ORDER BY a.normalized_name
      LIMIT 100`;
    for (const r of rows) {
      const rec = r as Record<string, unknown>;
      const sameEmail =
        str(rec.a_email) !== "" &&
        str(rec.a_email).toLowerCase() === str(rec.b_email).toLowerCase();
      out.push({
        kind: "people",
        aId: str(rec.a_id),
        aName: str(rec.a_name),
        bId: str(rec.b_id),
        bName: str(rec.b_name),
        reason: sameEmail ? "same email" : "same normalized name",
        score: sameEmail ? 100 : 90,
      });
    }
    return out;
  }
  return out;
}

const pickText = (keep: string, merged: string): string =>
  keep !== "" ? keep : merged;

/**
 * Merge mergeId into keepId. Returns { ok: true } on success; on a
 * validation failure returns { ok: false, error } without writing.
 */
export async function merge(
  kind: string,
  keepId: string,
  mergeId: string,
  actor = ""
): Promise<{ ok: boolean; error?: string }> {
  if (!keepId || !mergeId || keepId === mergeId) {
    return { ok: false, error: "keepId and mergeId must be different records" };
  }
  const db = sql();

  if (kind === "companies") {
    const keepRows = await db`
      SELECT id, vertical, city, state, thesis_fit, owner_context,
        next_action, logo_url, hero_url, notes, lat, lng
      FROM core.companies WHERE id = ${keepId} AND deleted_at IS NULL`;
    const mergeRows = await db`
      SELECT id, name, vertical, city, state, thesis_fit, owner_context,
        next_action, logo_url, hero_url, notes, lat, lng
      FROM core.companies WHERE id = ${mergeId} AND deleted_at IS NULL`;
    if (!keepRows.length || !mergeRows.length) {
      return { ok: false, error: "Company not found" };
    }
    const k = keepRows[0] as Record<string, unknown>;
    const m = mergeRows[0] as Record<string, unknown>;

    // Repoint references (drop participant rows that would collide with
    // the UNIQUE (deal_id, entity_kind, entity_id, role) key first).
    await db`
      DELETE FROM core.deal_participants dp
      WHERE dp.entity_id = ${mergeId} AND dp.entity_kind = 'company'
        AND EXISTS (
          SELECT 1 FROM core.deal_participants kp
          WHERE kp.deal_id = dp.deal_id AND kp.entity_id = ${keepId}
            AND kp.entity_kind = dp.entity_kind AND kp.role = dp.role
        )`;
    await db`
      UPDATE core.deal_participants SET entity_id = ${keepId}, updated_at = now()
      WHERE entity_id = ${mergeId} AND entity_kind = 'company'`;
    await db`
      UPDATE core.deals SET company_id = ${keepId}, updated_at = now()
      WHERE company_id = ${mergeId}`;
    await db`
      UPDATE core.documents SET company_id = ${keepId}, updated_at = now()
      WHERE company_id = ${mergeId}`;
    await db`
      UPDATE core.activity_log SET entity_id = ${keepId}
      WHERE entity_id = ${mergeId}`;
    await db`
      UPDATE core.comments SET entity_id = ${keepId}, updated_at = now()
      WHERE entity_kind = 'company' AND entity_id = ${mergeId}`;

    // Fill empty keeper fields from the merged row (name excluded — the
    // keeper's name is canonical by definition of the merge direction).
    await db`
      UPDATE core.companies SET
        vertical = ${pickText(str(k.vertical), str(m.vertical))},
        city = ${pickText(str(k.city), str(m.city))},
        thesis_fit = ${pickText(str(k.thesis_fit), str(m.thesis_fit))},
        owner_context = ${pickText(str(k.owner_context), str(m.owner_context))},
        next_action = ${pickText(str(k.next_action), str(m.next_action))},
        logo_url = ${pickText(str(k.logo_url), str(m.logo_url))},
        hero_url = ${pickText(str(k.hero_url), str(m.hero_url))},
        notes = ${pickText(str(k.notes), str(m.notes))},
        lat = ${numOrNull(k.lat) ?? numOrNull(m.lat)},
        lng = ${numOrNull(k.lng) ?? numOrNull(m.lng)},
        search_vector = to_tsvector('english',
          (SELECT name FROM core.companies WHERE id = ${keepId}) || ' ' ||
          ${pickText(str(k.vertical), str(m.vertical))} || ' ' ||
          ${pickText(str(k.city), str(m.city))}),
        updated_at = now()
      WHERE id = ${keepId}`;
    await db`
      UPDATE core.companies SET deleted_at = now(), updated_at = now()
      WHERE id = ${mergeId}`;
    await db`
      INSERT INTO core.audit_log (entity_kind, entity_id, actor, action, changes)
      VALUES ('company', ${keepId}, ${actor}, 'merge',
        ${JSON.stringify({ mergedId: mergeId, mergedName: str(m.name) })}::jsonb)`;
    cacheInvalidate("overview");
    cacheInvalidate(`company:${keepId}`);
    await enqueueUniqueJob("refresh_overview_summary", { reason: "company_merge" });
    return { ok: true };
  }

  if (kind === "people") {
    const keepRows = await db`
      SELECT id, title, email, phone, organization_id, organization_name, notes, photo_url
      FROM core.people WHERE id = ${keepId} AND deleted_at IS NULL`;
    const mergeRows = await db`
      SELECT id, name, title, email, phone, organization_id, organization_name, notes, photo_url
      FROM core.people WHERE id = ${mergeId} AND deleted_at IS NULL`;
    if (!keepRows.length || !mergeRows.length) {
      return { ok: false, error: "Person not found" };
    }
    const k = keepRows[0] as Record<string, unknown>;
    const m = mergeRows[0] as Record<string, unknown>;

    await db`
      DELETE FROM core.deal_participants dp
      WHERE dp.entity_id = ${mergeId} AND dp.entity_kind = 'person'
        AND EXISTS (
          SELECT 1 FROM core.deal_participants kp
          WHERE kp.deal_id = dp.deal_id AND kp.entity_id = ${keepId}
            AND kp.entity_kind = dp.entity_kind AND kp.role = dp.role
        )`;
    await db`
      UPDATE core.deal_participants SET entity_id = ${keepId}, updated_at = now()
      WHERE entity_id = ${mergeId} AND entity_kind = 'person'`;
    await db`
      UPDATE core.activity_log SET entity_id = ${keepId}
      WHERE entity_id = ${mergeId}`;
    await db`
      UPDATE core.comments SET entity_id = ${keepId}, updated_at = now()
      WHERE entity_kind = 'person' AND entity_id = ${mergeId}`;

    await db`
      UPDATE core.people SET
        title = ${pickText(str(k.title), str(m.title))},
        email = ${pickText(str(k.email), str(m.email))},
        phone = ${pickText(str(k.phone), str(m.phone))},
        organization_id = ${(k.organization_id ? str(k.organization_id) : m.organization_id ? str(m.organization_id) : null)},
        organization_name = ${pickText(str(k.organization_name), str(m.organization_name))},
        notes = ${pickText(str(k.notes), str(m.notes))},
        photo_url = ${pickText(str(k.photo_url), str(m.photo_url))},
        updated_at = now()
      WHERE id = ${keepId}`;
    await db`
      UPDATE core.people SET deleted_at = now(), updated_at = now()
      WHERE id = ${mergeId}`;
    await db`
      INSERT INTO core.audit_log (entity_kind, entity_id, actor, action, changes)
      VALUES ('person', ${keepId}, ${actor}, 'merge',
        ${JSON.stringify({ mergedId: mergeId, mergedName: str(m.name) })}::jsonb)`;
    await publishEvent("contact_updated", {
      entityKind: "person",
      entityId: keepId,
      payload: { mergedId: mergeId },
      actor,
    });
    return { ok: true };
  }

  return { ok: false, error: `Unknown dedupe kind: ${kind}` };
}

/**
 * Auto-merge (Ethan, Oct 23, 2026): the manual duplicate-review queue
 * is gone. Records whose normalized names are EXACTLY equal — the
 * "trademark office would get involved" test — are merged
 * automatically by the daily dedupe_scan job. Nothing fuzzy is ever
 * auto-merged: near-names stay separate records, and people matched
 * only by email (different names) are NOT merged either.
 *
 * Survivor rule per group: the record with the most references
 * (deals/documents/participants for companies, participants/activity
 * for people) wins; ties break to the earliest created, then id.
 * Every merge goes through merge() above, so references repoint,
 * empty keeper fields fill in, the loser soft-deletes, and
 * core.audit_log records it under the system actor.
 */
export async function autoMergeExactDuplicates(
  actor = "system:auto-merge"
): Promise<{ companiesMerged: number; peopleMerged: number; groups: number }> {
  const db = sql();
  let companiesMerged = 0;
  let peopleMerged = 0;
  let groups = 0;

  const companyGroups = await db`
    SELECT normalized_name FROM core.companies
    WHERE deleted_at IS NULL AND normalized_name <> ''
    GROUP BY normalized_name
    HAVING COUNT(*) > 1
    ORDER BY normalized_name
    LIMIT 50`;
  for (const g of companyGroups) {
    const name = str((g as Record<string, unknown>).normalized_name);
    const members = await db`
      SELECT c.id,
        (SELECT COUNT(*)::int FROM core.deals d WHERE d.company_id = c.id)
        + (SELECT COUNT(*)::int FROM core.documents doc WHERE doc.company_id = c.id)
        + (SELECT COUNT(*)::int FROM core.deal_participants dp
             WHERE dp.entity_id = c.id AND dp.entity_kind = 'company') AS refs
      FROM core.companies c
      WHERE c.normalized_name = ${name} AND c.deleted_at IS NULL
      ORDER BY refs DESC, c.created_at ASC, c.id ASC`;
    if (members.length < 2) continue;
    groups += 1;
    const keepId = str((members[0] as Record<string, unknown>).id);
    for (const m of members.slice(1)) {
      const mergeId = str((m as Record<string, unknown>).id);
      const res = await merge("companies", keepId, mergeId, actor);
      if (res.ok) companiesMerged += 1;
      else
        console.error(
          "[dedupe] auto-merge failed (companies)",
          keepId,
          mergeId,
          res.error ?? ""
        );
    }
  }

  const peopleGroups = await db`
    SELECT normalized_name FROM core.people
    WHERE deleted_at IS NULL AND normalized_name <> ''
    GROUP BY normalized_name
    HAVING COUNT(*) > 1
    ORDER BY normalized_name
    LIMIT 50`;
  for (const g of peopleGroups) {
    const name = str((g as Record<string, unknown>).normalized_name);
    const members = await db`
      SELECT p.id,
        (SELECT COUNT(*)::int FROM core.deal_participants dp
           WHERE dp.entity_id = p.id AND dp.entity_kind = 'person')
        + (SELECT COUNT(*)::int FROM core.activity_log a
             WHERE a.entity_id = p.id) AS refs
      FROM core.people p
      WHERE p.normalized_name = ${name} AND p.deleted_at IS NULL
      ORDER BY refs DESC, p.created_at ASC, p.id ASC`;
    if (members.length < 2) continue;
    groups += 1;
    const keepId = str((members[0] as Record<string, unknown>).id);
    for (const m of members.slice(1)) {
      const mergeId = str((m as Record<string, unknown>).id);
      const res = await merge("people", keepId, mergeId, actor);
      if (res.ok) peopleMerged += 1;
      else
        console.error(
          "[dedupe] auto-merge failed (people)",
          keepId,
          mergeId,
          res.error ?? ""
        );
    }
  }

  if (companiesMerged || peopleMerged) {
    console.log(
      `[dedupe] auto-merge: ${companiesMerged} companies + ${peopleMerged} people merged across ${groups} exact-name groups`
    );
  }
  return { companiesMerged, peopleMerged, groups };
}

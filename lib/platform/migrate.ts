import { str, type Sql } from "./db";

/**
 * Phase 1 one-time backfill: project the legacy public-schema tables
 * into the core schema WITHOUT modifying them. Guarded by the
 * core.migration_state marker 'phase1-backfill-v1' — the marker row is
 * inserted only after every statement succeeds, so a failed run retries
 * cleanly (every statement is INSERT … ON CONFLICT DO NOTHING).
 *
 * ID conventions: companies 'co_'||legacy id (market-intel 'co_mi_'||id),
 * people 'pe_'||id / 'pe_inv_'||id / 'pe_ct_'||id, organizations
 * 'org_'||md5(normalized firm), documents 'doc_'||id, activity 'al_'||id,
 * participants 'dp_'||deal id||'_'||exec id.
 */

export const BACKFILL_KEY = "phase1-backfill-v1";
export const TOPUP_KEY = "phase1-backfill-topup";
export const NORMALIZED_REPAIR_KEY = "phase2-normalized-repair-v1";

export async function runBackfillOnce(
  db: Sql,
  force = false
): Promise<{ ran: boolean }> {
  const marker = await db`
    SELECT key FROM core.migration_state WHERE key = ${BACKFILL_KEY} LIMIT 1`;
  if (marker.length && !force) return { ran: false };

  // --- deals → companies (+ core.deals link) ---
  // Stage mapping: 'Closed Won' → portfolio; Diligence/Negotiation/
  // Closing → diligence; everything else (incl. Passed) → pipeline.
  await db`
    INSERT INTO core.companies (
      id, legacy_deal_id, name, normalized_name, vertical, stage, deal_stage,
      city, state, lat, lng, owner_context, source, notes,
      created_at, updated_at, search_vector
    )
    SELECT
      'co_' || d.id, d.id, d.company_name, core.normalize_name(d.company_name),
      d.industry,
      CASE
        WHEN d.stage = 'Closed Won' THEN 'portfolio'
        WHEN d.stage IN ('Diligence', 'Negotiation', 'Closing') THEN 'diligence'
        ELSE 'pipeline'
      END,
      d.stage, d.city, 'AZ', d.lat, d.lng, d.contact_name, 'legacy-deal',
      d.notes, d.created_at, d.updated_at,
      to_tsvector('english',
        coalesce(d.company_name, '') || ' ' || coalesce(d.industry, '') ||
        ' ' || coalesce(d.city, ''))
    FROM deals d
    WHERE d.company_name <> ''
    ON CONFLICT (legacy_deal_id) WHERE legacy_deal_id IS NOT NULL
    DO UPDATE SET stage = EXCLUDED.stage, deal_stage = EXCLUDED.deal_stage,
      updated_at = now()`;

  await db`
    INSERT INTO core.deals (id, company_id, stage, updated_at)
    SELECT d.id, 'co_' || d.id, d.stage, d.updated_at
    FROM deals d
    ON CONFLICT (id) DO UPDATE SET stage = EXCLUDED.stage,
      company_id = EXCLUDED.company_id, updated_at = now()`;

  // --- executives → people (operators) ---
  await db`
    INSERT INTO core.people (
      id, legacy_exec_id, name, normalized_name, title, notes, photo_url,
      kind, source, created_at, updated_at, search_vector
    )
    SELECT
      'pe_' || e.id, e.id, e.name, core.normalize_name(e.name),
      e.current_title, e.notes, e.photo_url, 'operator', 'legacy-executive',
      e.created_at, e.updated_at,
      to_tsvector('english',
        coalesce(e.name, '') || ' ' || coalesce(e.current_title, ''))
    FROM executives e
    WHERE e.name <> ''
    ON CONFLICT (legacy_exec_id) WHERE legacy_exec_id IS NOT NULL DO NOTHING`;

  // --- investors → organizations (one per distinct normalized firm) ---
  await db`
    INSERT INTO core.organizations (
      id, name, normalized_name, kind, source, created_at, updated_at
    )
    SELECT DISTINCT ON (core.normalize_name(i.firm))
      'org_' || md5(core.normalize_name(i.firm)), i.firm,
      core.normalize_name(i.firm), 'investor', 'legacy-investor',
      i.created_at, i.updated_at
    FROM investors i
    WHERE i.firm <> '' AND core.normalize_name(i.firm) <> ''
    ORDER BY core.normalize_name(i.firm), i.created_at ASC
    ON CONFLICT (normalized_name) DO NOTHING`;

  // --- investors → people ---
  await db`
    INSERT INTO core.people (
      id, legacy_investor_id, name, normalized_name, title, email, phone,
      organization_id, organization_name, kind, notes, photo_url, source,
      created_at, updated_at, search_vector
    )
    SELECT
      'pe_inv_' || i.id, i.id, i.name, core.normalize_name(i.name),
      i.title, i.email, i.phone,
      (SELECT o.id FROM core.organizations o
        WHERE o.normalized_name = core.normalize_name(i.firm) LIMIT 1),
      i.firm, 'investor', i.notes, i.photo_url, 'legacy-investor',
      i.created_at, i.updated_at,
      to_tsvector('english',
        coalesce(i.name, '') || ' ' || coalesce(i.firm, '') ||
        ' ' || coalesce(i.title, ''))
    FROM investors i
    WHERE i.name <> ''
    ON CONFLICT (legacy_investor_id) WHERE legacy_investor_id IS NOT NULL DO NOTHING`;

  // --- contacts → people ---
  await db`
    INSERT INTO core.people (
      id, legacy_contact_id, name, normalized_name, title, email, phone,
      kind, notes, source, created_at, updated_at, search_vector
    )
    SELECT
      'pe_ct_' || c.id, c.id, c.name, core.normalize_name(c.name),
      c.role, c.email, c.phone, 'contact', c.notes, 'legacy-contact',
      c.created_at, c.updated_at,
      to_tsvector('english',
        coalesce(c.name, '') || ' ' || coalesce(c.role, '') ||
        ' ' || coalesce(c.email, ''))
    FROM contacts c
    WHERE c.name <> ''
    ON CONFLICT (legacy_contact_id) WHERE legacy_contact_id IS NOT NULL DO NOTHING`;

  // --- deal operator_ids → deal_participants ---
  await db`
    INSERT INTO core.deal_participants (
      id, deal_id, entity_kind, entity_id, entity_name, role, status,
      created_at, updated_at
    )
    SELECT
      'dp_' || d.id || '_' || op.exec_id, d.id, 'person',
      'pe_' || op.exec_id, coalesce(e.name, ''), 'operator', 'in talks',
      d.created_at, d.updated_at
    FROM deals d
    CROSS JOIN LATERAL jsonb_array_elements_text(
      CASE WHEN jsonb_typeof(d.operator_ids) = 'array'
        THEN d.operator_ids ELSE '[]'::jsonb END
    ) AS op(exec_id)
    LEFT JOIN executives e ON e.id = op.exec_id
    ON CONFLICT (deal_id, entity_kind, entity_id, role) DO NOTHING`;

  // --- attachments → documents ---
  // Legacy attachments store file bytes in `data` (base64). Per the rules
  // (files never live in the database going forward) only the metadata is
  // projected; storage_url stays '' until a later phase moves bytes to
  // object storage.
  await db`
    INSERT INTO core.documents (
      id, legacy_attachment_id, company_id, deal_id, name, mime,
      size_bytes, storage_url, source, created_at, updated_at, search_vector
    )
    SELECT
      'doc_' || a.id, a.id,
      CASE WHEN a.deal_id <> '' THEN 'co_' || a.deal_id ELSE NULL END,
      NULLIF(a.deal_id, ''),
      a.filename, a.mime_type, a.size, '', 'legacy-attachment',
      a.created_at, a.created_at,
      to_tsvector('english', coalesce(a.filename, ''))
    FROM attachments a
    ON CONFLICT (id) DO NOTHING`;

  // --- activity → activity_log ---
  // entity_kind follows the legacy shape ('deal' / 'executive' /
  // 'platform'); deal rows carry the core company id ('co_'||deal_id) so
  // company timelines resolve by entity_id alone.
  await db`
    INSERT INTO core.activity_log (
      id, entity_kind, entity_id, actor, kind, message, source, created_at
    )
    SELECT
      'al_' || a.id,
      CASE
        WHEN a.deal_id IS NOT NULL AND a.deal_id <> '' THEN 'deal'
        WHEN a.exec_id IS NOT NULL AND a.exec_id <> '' THEN 'executive'
        ELSE 'platform'
      END,
      CASE
        WHEN a.deal_id IS NOT NULL AND a.deal_id <> '' THEN 'co_' || a.deal_id
        WHEN a.exec_id IS NOT NULL AND a.exec_id <> '' THEN 'pe_' || a.exec_id
        ELSE ''
      END,
      a.actor, a.type, a.message, 'legacy-activity', a.created_at
    FROM activity a
    ON CONFLICT (id) DO NOTHING`;

  // --- mi_companies fits → companies ---
  // Only live fits: status='fit', not chain-flagged, not institutionally
  // flagged (the portal-wide filters, Ethan Oct 16-17, 2026).
  await db`
    INSERT INTO core.companies (
      id, legacy_mi_id, name, normalized_name, vertical, stage, deal_stage,
      city, state, thesis_fit, source, created_at, updated_at, search_vector
    )
    SELECT
      'co_mi_' || m.id, m.id, m.name, core.normalize_name(m.name),
      m.sector, 'pipeline', '', m.city, m.state, m.signal_label,
      'market-intel', m.created_at, m.updated_at,
      to_tsvector('english',
        coalesce(m.name, '') || ' ' || coalesce(m.sector, '') ||
        ' ' || coalesce(m.city, ''))
    FROM mi_companies m
    WHERE m.status = 'fit' AND m.is_chain = false AND m.is_institutional = false
      AND m.name <> ''
    ON CONFLICT (legacy_mi_id) WHERE legacy_mi_id IS NOT NULL DO NOTHING`;

  const counts = await db`
    SELECT
      (SELECT count(*)::int FROM core.companies) AS companies,
      (SELECT count(*)::int FROM core.people) AS people,
      (SELECT count(*)::int FROM core.organizations) AS organizations,
      (SELECT count(*)::int FROM core.documents) AS documents,
      (SELECT count(*)::int FROM core.deal_participants) AS participants`;
  const c = (counts[0] ?? {}) as Record<string, unknown>;
  await db`
    INSERT INTO core.migration_state (key, detail)
    VALUES (${BACKFILL_KEY},
      ${`companies=${str(c.companies)} people=${str(c.people)} organizations=${str(c.organizations)} documents=${str(c.documents)} participants=${str(c.participants)}`})
    ON CONFLICT (key) DO NOTHING`;

  return { ran: true };
}

/**
 * Backfill top-up (added Oct 21, 2026, after the Neon recovery): the
 * one-time backfill can run while other writers (e.g. the outage-backlog
 * recovery import) are still creating rows in the legacy source tables.
 * A strict run-once marker would skip those rows forever. Every backfill
 * statement is idempotent (INSERT … ON CONFLICT), so re-running is safe:
 * this pass re-runs them at most once per hour (gated by the
 * 'phase1-backfill-topup' marker's done_at) and the two deal inserts
 * upsert stage, so late-created deals/executives/investors/contacts/
 * participants/fits are picked up and deal stage mirrors stay fresh.
 * Edits to people/organizations still flow through contact_updated
 * events (Phase 2 owns Directory sync semantics).
 */
export async function topUpBackfill(db: Sql): Promise<{ ran: boolean }> {
  const marker = await db`
    SELECT done_at FROM core.migration_state WHERE key = ${TOPUP_KEY} LIMIT 1`;
  if (marker.length) {
    const doneAt = (marker[0] as Record<string, unknown>).done_at;
    const t = doneAt ? new Date(String(doneAt)).getTime() : 0;
    if (t && Date.now() - t < 60 * 60 * 1000) return { ran: false };
  }
  // Source-deletion propagation: a backfilled row whose stable legacy
  // source has since been deleted is soft-deleted here, so removed
  // profiles do not resurface through the platform layer. Deliberately
  // NOT applied to mi_companies-sourced companies — spine rebuilds
  // re-key mi rows, so absence there does not mean deletion.
  await db`
    UPDATE core.people p SET deleted_at = now(), updated_at = now()
    WHERE p.deleted_at IS NULL AND p.legacy_exec_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM executives e WHERE e.id = p.legacy_exec_id)`;
  await db`
    UPDATE core.people p SET deleted_at = now(), updated_at = now()
    WHERE p.deleted_at IS NULL AND p.legacy_investor_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM investors i WHERE i.id = p.legacy_investor_id)`;
  await db`
    UPDATE core.people p SET deleted_at = now(), updated_at = now()
    WHERE p.deleted_at IS NULL AND p.legacy_contact_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM contacts c WHERE c.id = p.legacy_contact_id)`;
  await db`
    UPDATE core.companies c SET deleted_at = now(), updated_at = now()
    WHERE c.deleted_at IS NULL AND c.legacy_deal_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM deals d WHERE d.id = c.legacy_deal_id)`;
  await runBackfillOnce(db, true);
  await db`
    INSERT INTO core.migration_state (key, done_at, detail)
    VALUES (${TOPUP_KEY}, now(), 'hourly idempotent top-up')
    ON CONFLICT (key) DO UPDATE SET done_at = now(),
      detail = 'hourly idempotent top-up'`;
  return { ran: true };
}

/**
 * One-time repair (Phase 2): the first deployed build of
 * core.normalize_name() lost the backslash in its whitespace-collapse
 * pattern ('\s+' arrived as 's+'), so normalized_name values written by
 * the original backfill had runs of the letter "s" replaced by spaces
 * ("Salt Creek Capital" -> "alt creek capital"). SQL-side comparisons
 * were unaffected (both sides equally corrupted), but comparisons
 * against the TS normalizeName() — e.g. the Directory import dedupe —
 * missed. The function definition has since been corrected; this pass
 * recomputes the stored values once, merging organizations whose
 * corrected names collide (keeper = most linked people, then oldest).
 */
export async function repairNormalizedNames(
  db: Sql
): Promise<{ ran: boolean }> {
  const marker = await db`
    SELECT key FROM core.migration_state
    WHERE key = ${NORMALIZED_REPAIR_KEY} LIMIT 1`;
  if (marker.length) return { ran: false };

  await db`
    UPDATE core.people
    SET normalized_name = core.normalize_name(name)
    WHERE deleted_at IS NULL
      AND normalized_name IS DISTINCT FROM core.normalize_name(name)`;
  await db`
    UPDATE core.companies
    SET normalized_name = core.normalize_name(name)
    WHERE deleted_at IS NULL
      AND normalized_name IS DISTINCT FROM core.normalize_name(name)`;

  // Organizations carry a unique index on normalized_name: resolve
  // collisions first (merge into the best-referenced org), then rewrite.
  const orgRows = await db`
    SELECT o.id, o.name, core.normalize_name(o.name) AS corrected,
      (SELECT count(*) FROM core.people p
        WHERE p.organization_id = o.id AND p.deleted_at IS NULL) AS refs,
      o.created_at
    FROM core.organizations o
    WHERE o.deleted_at IS NULL`;
  type OrgRow = {
    id: string;
    name: string;
    corrected: string;
    refs: number;
    createdMs: number;
  };
  const orgs: OrgRow[] = orgRows.map((r) => {
    const rec = r as Record<string, unknown>;
    const ca = rec.created_at ? new Date(String(rec.created_at)).getTime() : 0;
    return {
      id: str(rec.id),
      name: str(rec.name),
      corrected: str(rec.corrected),
      refs: Number(rec.refs ?? 0) || 0,
      createdMs: isFinite(ca) ? ca : 0,
    };
  });
  const groups = new Map<string, OrgRow[]>();
  for (const o of orgs) {
    if (!o.corrected) continue;
    const g = groups.get(o.corrected) ?? [];
    g.push(o);
    groups.set(o.corrected, g);
  }
  const tagsReg = await db`SELECT to_regclass('directory.type_tags') AS reg`;
  const hasTags = Boolean(
    (tagsReg[0] as Record<string, unknown> | undefined)?.reg
  );
  let merged = 0;
  for (const group of Array.from(groups.values())) {
    if (group.length < 2) continue;
    const sorted = [...group].sort(
      (a, b) =>
        b.refs - a.refs || a.createdMs - b.createdMs || a.id.localeCompare(b.id)
    );
    const keeper = sorted[0];
    for (const loser of sorted.slice(1)) {
      await db`
        UPDATE core.people
        SET organization_id = ${keeper.id},
            organization_name = ${keeper.name},
            updated_at = now()
        WHERE organization_id = ${loser.id} AND deleted_at IS NULL`;
      if (hasTags) {
        await db`
          INSERT INTO directory.type_tags (entity_kind, entity_id, type)
          SELECT 'organization', ${keeper.id}, type
          FROM directory.type_tags
          WHERE entity_kind = 'organization' AND entity_id = ${loser.id}
          ON CONFLICT DO NOTHING`;
        await db`
          DELETE FROM directory.type_tags
          WHERE entity_kind = 'organization' AND entity_id = ${loser.id}`;
      }
      await db`
        UPDATE core.organizations
        SET deleted_at = now(), updated_at = now()
        WHERE id = ${loser.id}`;
      await db`
        INSERT INTO core.audit_log (entity_kind, entity_id, actor, action, changes)
        VALUES ('organization', ${keeper.id}, 'phase2-repair', 'merge',
          ${JSON.stringify({
            mergedId: loser.id,
            mergedName: loser.name,
            reason: "normalized-name repair",
          })}::jsonb)`;
      merged++;
    }
  }
  // Rewrite stored values; a residual unique conflict (against a
  // soft-deleted row) leaves that row for the duplicates review.
  let rewritten = 0;
  for (const o of orgs) {
    try {
      const res = await db`
        UPDATE core.organizations
        SET normalized_name = ${o.corrected}
        WHERE id = ${o.id} AND deleted_at IS NULL
          AND normalized_name IS DISTINCT FROM ${o.corrected}
        RETURNING id`;
      if (Array.isArray(res) && res.length) rewritten++;
    } catch {
      /* unique conflict — leave for manual merge */
    }
  }
  await db`
    INSERT INTO core.migration_state (key, done_at, detail)
    VALUES (${NORMALIZED_REPAIR_KEY}, now(),
      ${`recomputed normalized_name on people/companies/organizations; org merges: ${merged}; org rows rewritten: ${rewritten}`})
    ON CONFLICT (key) DO NOTHING`;
  return { ran: true };
}

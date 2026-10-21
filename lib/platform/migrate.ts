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

export async function runBackfillOnce(db: Sql): Promise<{ ran: boolean }> {
  const marker = await db`
    SELECT key FROM core.migration_state WHERE key = ${BACKFILL_KEY} LIMIT 1`;
  if (marker.length) return { ran: false };

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
    ON CONFLICT (legacy_deal_id) WHERE legacy_deal_id IS NOT NULL DO NOTHING`;

  await db`
    INSERT INTO core.deals (id, company_id, stage, updated_at)
    SELECT d.id, 'co_' || d.id, d.stage, d.updated_at
    FROM deals d
    ON CONFLICT (id) DO NOTHING`;

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

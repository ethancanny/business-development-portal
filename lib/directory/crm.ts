import {
  ensurePlatformSchema,
  isoOrNull,
  newId,
  normalizeName,
  num,
  sql,
  str,
} from "../platform/db";
import { publishEvent } from "../platform/events";
import { ensureDirectorySchema } from "./schema";

/**
 * Relationship CRM service (Phase 1) — the data/service core of the
 * CRM layer on top of the Directory. Owns its tables in the
 * `directory` schema: relationship_profiles (denormalized summaries),
 * interactions + participants (the ONE contact-activity system),
 * tags, lists, and interaction templates.
 *
 * Boundaries (PROJECT_RULES.md + DESIGN.md):
 * - This module imports the platform db/events and the directory
 *   schema only. lib/directory/service.ts imports THIS module (one
 *   direction); service composition for the migration's seed sources
 *   (capital investor profiles, operator candidates) happens through
 *   dynamic imports inside the migration so there is no static cycle.
 * - Summaries (last_touch_at, next_touch_due, touch_count_90d,
 *   open_task_count) are maintained by writes through this module and
 *   the tasks hook — never recomputed on page load.
 * - Legacy public.interactions is read once (marker-guarded) and
 *   never modified.
 */

export type CrmEntityKind = "person" | "organization";

export const INTERACTION_TYPES = [
  "call",
  "meeting",
  "email",
  "text",
  "note",
  "event",
  "intro",
] as const;
export type InteractionType = (typeof INTERACTION_TYPES)[number];

export const INTERACTION_DIRECTIONS = ["outbound", "inbound", "na"] as const;
export type InteractionDirection = (typeof INTERACTION_DIRECTIONS)[number];

export const INTERACTION_VISIBILITIES = ["shared", "private"] as const;
export type InteractionVisibility = (typeof INTERACTION_VISIBILITIES)[number];

export const OUTCOME_PRESETS = [
  "none",
  "awaiting_reply",
  "replied",
  "meeting_set",
  "declined",
  "no_reply",
  "spoke",
  "voicemail",
  "no_answer",
  "completed",
] as const;

/** Tier cadence defaults in days (DESIGN.md): A=30, B=60, C=90. */
export const TIER_CADENCE_DEFAULTS: Record<string, number> = {
  A: 30,
  B: 60,
  C: 90,
};

export function effectiveCadenceDays(
  tier: string,
  cadenceDays: number | null | undefined
): number {
  if (cadenceDays !== null && cadenceDays !== undefined && cadenceDays > 0)
    return cadenceDays;
  return TIER_CADENCE_DEFAULTS[(tier ?? "").trim().toUpperCase()] ?? 90;
}

export const CRM_MIGRATION_KEY = "crm-phase1-v1";

function normKind(raw: unknown): CrmEntityKind | null {
  const v = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (v === "person" || v === "people" || v === "persons") return "person";
  if (v === "organization" || v === "organizations" || v === "org" || v === "orgs")
    return "organization";
  return null;
}

const isIsoDateish = (v: string): boolean =>
  v !== "" && !isNaN(new Date(v).getTime());

/* ------------------------------- schema ------------------------------ */

let schemaReady: Promise<void> | null = null;

export function ensureCrmSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = (async () => {
      await ensurePlatformSchema();
      await ensureDirectorySchema();
      const db = sql();
      await db`CREATE SCHEMA IF NOT EXISTS directory`;

      await db`
        CREATE TABLE IF NOT EXISTS directory.relationship_profiles (
          entity_kind TEXT NOT NULL,
          entity_id TEXT NOT NULL,
          tier TEXT NOT NULL DEFAULT '',
          stage TEXT NOT NULL DEFAULT 'New',
          cadence_days INT,
          owner TEXT NOT NULL DEFAULT '',
          source TEXT NOT NULL DEFAULT '',
          introduced_by_person_id TEXT,
          comm_prefs TEXT NOT NULL DEFAULT '',
          important_dates JSONB NOT NULL DEFAULT '[]',
          last_touch_at TIMESTAMPTZ,
          next_touch_due TIMESTAMPTZ,
          touch_count_90d INT NOT NULL DEFAULT 0,
          open_task_count INT NOT NULL DEFAULT 0,
          is_test_data BOOLEAN NOT NULL DEFAULT false,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          PRIMARY KEY (entity_kind, entity_id)
        )`;
      await db`
        CREATE INDEX IF NOT EXISTS directory_rel_profiles_tier_idx
        ON directory.relationship_profiles (tier)`;
      await db`
        CREATE INDEX IF NOT EXISTS directory_rel_profiles_stage_idx
        ON directory.relationship_profiles (stage)`;
      await db`
        CREATE INDEX IF NOT EXISTS directory_rel_profiles_owner_idx
        ON directory.relationship_profiles (owner)`;
      await db`
        CREATE INDEX IF NOT EXISTS directory_rel_profiles_last_touch_idx
        ON directory.relationship_profiles (last_touch_at)`;

      await db`
        CREATE TABLE IF NOT EXISTS directory.tags (
          entity_kind TEXT NOT NULL,
          entity_id TEXT NOT NULL,
          tag TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          PRIMARY KEY (entity_kind, entity_id, tag)
        )`;
      await db`
        CREATE INDEX IF NOT EXISTS directory_tags_tag_idx
        ON directory.tags (tag)`;

      await db`
        CREATE TABLE IF NOT EXISTS directory.interactions (
          id TEXT PRIMARY KEY,
          type TEXT NOT NULL DEFAULT 'note',
          direction TEXT NOT NULL DEFAULT 'na',
          occurred_at TIMESTAMPTZ NOT NULL,
          summary TEXT NOT NULL DEFAULT '',
          outcome TEXT NOT NULL DEFAULT 'none',
          next_step TEXT NOT NULL DEFAULT '',
          next_step_due DATE,
          predicted_reply_pct INT,
          visibility TEXT NOT NULL DEFAULT 'shared',
          owner TEXT NOT NULL DEFAULT '',
          created_by TEXT NOT NULL DEFAULT '',
          organization_id TEXT,
          company_id TEXT,
          deal_id TEXT,
          raise_deal_id TEXT,
          legacy_id TEXT UNIQUE,
          is_test_data BOOLEAN NOT NULL DEFAULT false,
          deleted_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )`;
      await db`
        CREATE INDEX IF NOT EXISTS directory_interactions_occurred_idx
        ON directory.interactions (occurred_at DESC)`;
      await db`
        CREATE INDEX IF NOT EXISTS directory_interactions_org_idx
        ON directory.interactions (organization_id)`;
      await db`
        CREATE INDEX IF NOT EXISTS directory_interactions_deal_idx
        ON directory.interactions (deal_id)`;

      await db`
        CREATE TABLE IF NOT EXISTS directory.interaction_participants (
          interaction_id TEXT NOT NULL,
          person_id TEXT NOT NULL,
          is_primary BOOLEAN NOT NULL DEFAULT false,
          PRIMARY KEY (interaction_id, person_id)
        )`;
      await db`
        CREATE INDEX IF NOT EXISTS directory_interaction_participants_person_idx
        ON directory.interaction_participants (person_id)`;

      await db`
        CREATE TABLE IF NOT EXISTS directory.interaction_templates (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL DEFAULT '',
          type TEXT NOT NULL DEFAULT 'note',
          summary TEXT NOT NULL DEFAULT '',
          outcome TEXT NOT NULL DEFAULT 'none',
          created_by TEXT NOT NULL DEFAULT '',
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )`;

      await db`
        CREATE TABLE IF NOT EXISTS directory.lists (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL DEFAULT '',
          created_by TEXT NOT NULL DEFAULT '',
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )`;
      await db`
        CREATE TABLE IF NOT EXISTS directory.list_members (
          list_id TEXT NOT NULL,
          entity_kind TEXT NOT NULL,
          entity_id TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          PRIMARY KEY (list_id, entity_kind, entity_id)
        )`;
    })().catch((err) => {
      schemaReady = null;
      throw err;
    });
  }
  return schemaReady;
}

/* ------------------------------ profiles ----------------------------- */

export interface ImportantDate {
  label: string;
  date: string;
}

export interface RelationshipProfile {
  entityKind: CrmEntityKind;
  entityId: string;
  tier: string;
  stage: string;
  cadenceDays: number | null;
  owner: string;
  source: string;
  introducedByPersonId: string | null;
  commPrefs: string;
  importantDates: ImportantDate[];
  lastTouchAt: string | null;
  nextTouchDue: string | null;
  touchCount90d: number;
  openTaskCount: number;
  isTestData: boolean;
  createdAt: string | null;
  updatedAt: string | null;
  tags: string[];
}

function parseImportantDates(v: unknown): ImportantDate[] {
  let raw: unknown = v;
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(raw)) return [];
  const out: ImportantDate[] = [];
  for (const item of raw) {
    if (item && typeof item === "object") {
      const rec = item as Record<string, unknown>;
      out.push({ label: str(rec.label), date: str(rec.date) });
    }
  }
  return out;
}

function rowToProfile(
  rec: Record<string, unknown>,
  tags: string[] = []
): RelationshipProfile {
  return {
    entityKind: normKind(rec.entity_kind) ?? "person",
    entityId: str(rec.entity_id),
    tier: str(rec.tier),
    stage: str(rec.stage) || "New",
    cadenceDays:
      rec.cadence_days === null || rec.cadence_days === undefined
        ? null
        : num(rec.cadence_days),
    owner: str(rec.owner),
    source: str(rec.source),
    introducedByPersonId: rec.introduced_by_person_id
      ? str(rec.introduced_by_person_id)
      : null,
    commPrefs: str(rec.comm_prefs),
    importantDates: parseImportantDates(rec.important_dates),
    lastTouchAt: isoOrNull(rec.last_touch_at),
    nextTouchDue: isoOrNull(rec.next_touch_due),
    touchCount90d: num(rec.touch_count_90d),
    openTaskCount: num(rec.open_task_count),
    isTestData: Boolean(rec.is_test_data),
    createdAt: isoOrNull(rec.created_at),
    updatedAt: isoOrNull(rec.updated_at),
    tags,
  };
}

export async function getEntityTags(
  kind: CrmEntityKind,
  id: string
): Promise<string[]> {
  await ensureCrmSchema();
  const db = sql();
  const rows = await db`
    SELECT tag FROM directory.tags
    WHERE entity_kind = ${kind} AND entity_id = ${id}
    ORDER BY tag ASC`;
  return rows.map((r) => str((r as Record<string, unknown>).tag)).filter(Boolean);
}

async function replaceEntityTags(
  kind: CrmEntityKind,
  id: string,
  tags: string[]
): Promise<void> {
  const db = sql();
  const clean: string[] = [];
  for (const t of tags) {
    const v = String(t ?? "").trim();
    if (v && !clean.includes(v)) clean.push(v);
  }
  await db`
    DELETE FROM directory.tags
    WHERE entity_kind = ${kind} AND entity_id = ${id}`;
  for (const tag of clean) {
    await db`
      INSERT INTO directory.tags (entity_kind, entity_id, tag)
      VALUES (${kind}, ${id}, ${tag})
      ON CONFLICT (entity_kind, entity_id, tag) DO NOTHING`;
  }
}

export async function getRelationship(
  kindRaw: string,
  id: string
): Promise<RelationshipProfile | null> {
  await ensureCrmSchema();
  const kind = normKind(kindRaw);
  if (!kind || !id) return null;
  const db = sql();
  const rows = await db`
    SELECT entity_kind, entity_id, tier, stage, cadence_days, owner,
      source, introduced_by_person_id, comm_prefs, important_dates,
      last_touch_at, next_touch_due, touch_count_90d, open_task_count,
      is_test_data, created_at, updated_at
    FROM directory.relationship_profiles
    WHERE entity_kind = ${kind} AND entity_id = ${id}
    LIMIT 1`;
  if (!rows.length) return null;
  const tags = await getEntityTags(kind, id);
  return rowToProfile(rows[0] as Record<string, unknown>, tags);
}

export interface RelationshipPatch {
  tier?: string;
  stage?: string;
  cadenceDays?: number | null;
  cadence_days?: number | null;
  owner?: string;
  source?: string;
  introducedByPersonId?: string | null;
  introduced_by_person_id?: string | null;
  commPrefs?: string;
  comm_prefs?: string;
  importantDates?: ImportantDate[];
  important_dates?: ImportantDate[];
  isTestData?: boolean;
  is_test_data?: boolean;
  tags?: string[];
}

export async function updateRelationship(
  kindRaw: string,
  id: string,
  patch: RelationshipPatch,
  actor = ""
): Promise<RelationshipProfile> {
  await ensureCrmSchema();
  const kind = normKind(kindRaw);
  if (!kind) throw new Error("kind must be 'person' or 'organization'");
  if (!id) throw new Error("id is required");
  const db = sql();
  const current = await getRelationship(kind, id);

  const next = {
    tier: patch.tier !== undefined ? String(patch.tier).trim() : current?.tier ?? "",
    stage:
      patch.stage !== undefined
        ? String(patch.stage).trim() || "New"
        : current?.stage ?? "New",
    cadenceDays:
      patch.cadenceDays !== undefined
        ? patch.cadenceDays
        : patch.cadence_days !== undefined
          ? patch.cadence_days
          : current?.cadenceDays ?? null,
    owner: patch.owner !== undefined ? String(patch.owner).trim() : current?.owner ?? "",
    source:
      patch.source !== undefined ? String(patch.source).trim() : current?.source ?? "",
    introducedByPersonId:
      patch.introducedByPersonId !== undefined
        ? patch.introducedByPersonId
        : patch.introduced_by_person_id !== undefined
          ? patch.introduced_by_person_id
          : current?.introducedByPersonId ?? null,
    commPrefs:
      patch.commPrefs !== undefined
        ? String(patch.commPrefs)
        : patch.comm_prefs !== undefined
          ? String(patch.comm_prefs)
          : current?.commPrefs ?? "",
    importantDates:
      patch.importantDates !== undefined
        ? patch.importantDates
        : patch.important_dates !== undefined
          ? patch.important_dates
          : current?.importantDates ?? [],
    isTestData:
      patch.isTestData !== undefined
        ? Boolean(patch.isTestData)
        : patch.is_test_data !== undefined
          ? Boolean(patch.is_test_data)
          : current?.isTestData ?? false,
  };

  const changes: Record<string, { from: unknown; to: unknown }> = {};
  const apply = (field: string, from: unknown, to: unknown) => {
    if (String(from ?? "") !== String(to ?? "")) {
      changes[field] = { from: from ?? "", to: to ?? "" };
    }
  };
  apply("tier", current?.tier ?? "", next.tier);
  apply("stage", current?.stage ?? "New", next.stage);
  apply("cadenceDays", current?.cadenceDays ?? null, next.cadenceDays);
  apply("owner", current?.owner ?? "", next.owner);
  apply("source", current?.source ?? "", next.source);
  apply("introducedByPersonId", current?.introducedByPersonId ?? null, next.introducedByPersonId);
  apply("commPrefs", current?.commPrefs ?? "", next.commPrefs);
  const stageChanged = (current?.stage ?? "New") !== next.stage;

  await db`
    INSERT INTO directory.relationship_profiles (
      entity_kind, entity_id, tier, stage, cadence_days, owner, source,
      introduced_by_person_id, comm_prefs, important_dates, is_test_data
    )
    VALUES (
      ${kind}, ${id}, ${next.tier}, ${next.stage}, ${next.cadenceDays},
      ${next.owner}, ${next.source}, ${next.introducedByPersonId},
      ${next.commPrefs}, ${JSON.stringify(next.importantDates)}::jsonb,
      ${next.isTestData}
    )
    ON CONFLICT (entity_kind, entity_id) DO UPDATE SET
      tier = EXCLUDED.tier,
      stage = EXCLUDED.stage,
      cadence_days = EXCLUDED.cadence_days,
      owner = EXCLUDED.owner,
      source = EXCLUDED.source,
      introduced_by_person_id = EXCLUDED.introduced_by_person_id,
      comm_prefs = EXCLUDED.comm_prefs,
      important_dates = EXCLUDED.important_dates,
      is_test_data = EXCLUDED.is_test_data,
      updated_at = now()`;

  if (patch.tags !== undefined) {
    await replaceEntityTags(kind, id, patch.tags);
  }

  if (Object.keys(changes).length) {
    await db`
      INSERT INTO core.audit_log (entity_kind, entity_id, actor, action, changes)
      VALUES (${kind}, ${id}, ${actor}, 'update',
        ${JSON.stringify(changes)}::jsonb)`;
  }
  if (stageChanged) {
    await publishEvent("stage_changed", {
      entityKind: kind,
      entityId: id,
      payload: { from: current?.stage ?? "New", to: next.stage },
      actor,
    });
  }
  // Recompute next_touch_due (and the other summaries) under the new
  // tier/cadence — recount owns that math in exactly one place.
  await recountEntitySummaries(kind, id).catch((err) =>
    console.error("[crm] recount after relationship update failed", err)
  );
  const saved = await getRelationship(kind, id);
  if (!saved) throw new Error("relationship profile was not saved");
  return saved;
}

/* ------------------------- summary recounts -------------------------- */

/**
 * Recompute the denormalized summary columns for ONE entity from the
 * source tables. Called by every interaction write, relationship
 * write, and the tasks hook (create / done-transition / delete).
 * open_task_count reads the legacy public.tasks table: CRM-linked
 * tasks carry related_kind 'person'/'organization' with the core id,
 * and legacy follow-ups carry related_kind 'executive' with the
 * legacy exec id (mapped through core.people.legacy_exec_id).
 */
export async function recountEntitySummaries(
  kindRaw: string,
  id: string
): Promise<void> {
  await ensureCrmSchema();
  const kind = normKind(kindRaw);
  if (!kind || !id) return;
  const db = sql();

  // Make sure a profile row exists so the UPDATE below lands even for
  // an entity whose only CRM footprint so far is an interaction/task.
  await db`
    INSERT INTO directory.relationship_profiles (entity_kind, entity_id)
    VALUES (${kind}, ${id})
    ON CONFLICT (entity_kind, entity_id) DO NOTHING`;

  let lastTouch: string | null = null;
  let touch90 = 0;
  if (kind === "person") {
    const rows = await db`
      SELECT max(i.occurred_at) AS last_touch,
        count(*) FILTER (WHERE i.occurred_at >= now() - interval '90 days')::int AS n90
      FROM directory.interactions i
      JOIN directory.interaction_participants p ON p.interaction_id = i.id
      WHERE p.person_id = ${id} AND i.deleted_at IS NULL`;
    if (rows.length) {
      const rec = rows[0] as Record<string, unknown>;
      lastTouch = isoOrNull(rec.last_touch);
      touch90 = num(rec.n90);
    }
  } else {
    const rows = await db`
      SELECT max(i.occurred_at) AS last_touch,
        count(*) FILTER (WHERE i.occurred_at >= now() - interval '90 days')::int AS n90
      FROM directory.interactions i
      WHERE i.organization_id = ${id} AND i.deleted_at IS NULL`;
    if (rows.length) {
      const rec = rows[0] as Record<string, unknown>;
      lastTouch = isoOrNull(rec.last_touch);
      touch90 = num(rec.n90);
    }
  }

  let openTasks = 0;
  try {
    const rows =
      kind === "person"
        ? await db`
            SELECT count(*)::int AS n FROM tasks t
            WHERE t.done = false
              AND (
                (t.related_kind = 'person' AND t.related_id = ${id})
                OR (t.related_kind = 'executive' AND t.related_id = (
                  SELECT p.legacy_exec_id FROM core.people p
                  WHERE p.id = ${id} AND p.legacy_exec_id IS NOT NULL
                  LIMIT 1))
              )`
        : await db`
            SELECT count(*)::int AS n FROM tasks t
            WHERE t.done = false
              AND t.related_kind = 'organization' AND t.related_id = ${id}`;
    if (rows.length) openTasks = num((rows[0] as Record<string, unknown>).n);
  } catch (err) {
    // Legacy tasks table may not exist yet on a fresh database; the
    // count is 0 until the legacy schema is created.
    console.error("[crm] open task count failed (treated as 0)", err);
  }

  const profRows = await db`
    SELECT tier, cadence_days FROM directory.relationship_profiles
    WHERE entity_kind = ${kind} AND entity_id = ${id} LIMIT 1`;
  const prof = (profRows[0] ?? {}) as Record<string, unknown>;
  const cadence = effectiveCadenceDays(
    str(prof.tier),
    prof.cadence_days === null || prof.cadence_days === undefined
      ? null
      : num(prof.cadence_days)
  );
  const nextDue = lastTouch
    ? new Date(new Date(lastTouch).getTime() + cadence * 86_400_000).toISOString()
    : null;

  await db`
    UPDATE directory.relationship_profiles SET
      last_touch_at = ${lastTouch},
      touch_count_90d = ${touch90},
      open_task_count = ${openTasks},
      next_touch_due = ${nextDue},
      updated_at = now()
    WHERE entity_kind = ${kind} AND entity_id = ${id}`;
}

/**
 * Recount hook for the legacy task write paths, whose related_kind
 * vocabulary is 'deal' | 'executive' (legacy) plus the CRM's
 * 'person' | 'organization'. 'executive' resolves to the core person
 * through legacy_exec_id. Anything else is a no-op.
 */
export async function recountTaskLink(
  relatedKind: string | null | undefined,
  relatedId: string | null | undefined
): Promise<void> {
  if (!relatedKind || !relatedId) return;
  try {
    if (relatedKind === "person" || relatedKind === "organization") {
      await recountEntitySummaries(relatedKind, relatedId);
      return;
    }
    if (relatedKind === "executive") {
      const db = sql();
      const rows = await db`
        SELECT id FROM core.people
        WHERE legacy_exec_id = ${relatedId} AND deleted_at IS NULL
        LIMIT 1`;
      if (rows.length) {
        await recountEntitySummaries(
          "person",
          str((rows[0] as Record<string, unknown>).id)
        );
      }
    }
  } catch (err) {
    console.error("[crm] recountTaskLink failed", err);
  }
}

/* ---------------------------- interactions --------------------------- */

export interface CrmInteraction {
  id: string;
  type: string;
  direction: string;
  occurredAt: string | null;
  summary: string;
  outcome: string;
  nextStep: string;
  nextStepDue: string | null;
  predictedReplyPct: number | null;
  visibility: string;
  owner: string;
  createdBy: string;
  organizationId: string | null;
  companyId: string | null;
  dealId: string | null;
  raiseDealId: string | null;
  legacyId: string | null;
  isTestData: boolean;
  participantIds: string[];
  primaryPersonId: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

const INTERACTION_COLUMNS = `
  id, type, direction, occurred_at, summary, outcome, next_step,
  next_step_due, predicted_reply_pct, visibility, owner, created_by,
  organization_id, company_id, deal_id, raise_deal_id, legacy_id,
  is_test_data, created_at, updated_at`;

function rowToInteraction(
  rec: Record<string, unknown>,
  participantIds: string[] = [],
  primaryPersonId: string | null = null
): CrmInteraction {
  const due = rec.next_step_due
    ? rec.next_step_due instanceof Date
      ? rec.next_step_due.toISOString().slice(0, 10)
      : String(rec.next_step_due).slice(0, 10)
    : null;
  return {
    id: str(rec.id),
    type: str(rec.type) || "note",
    direction: str(rec.direction) || "na",
    occurredAt: isoOrNull(rec.occurred_at),
    summary: str(rec.summary),
    outcome: str(rec.outcome) || "none",
    nextStep: str(rec.next_step),
    nextStepDue: due,
    predictedReplyPct:
      rec.predicted_reply_pct === null || rec.predicted_reply_pct === undefined
        ? null
        : num(rec.predicted_reply_pct),
    visibility: str(rec.visibility) || "shared",
    owner: str(rec.owner),
    createdBy: str(rec.created_by),
    organizationId: rec.organization_id ? str(rec.organization_id) : null,
    companyId: rec.company_id ? str(rec.company_id) : null,
    dealId: rec.deal_id ? str(rec.deal_id) : null,
    raiseDealId: rec.raise_deal_id ? str(rec.raise_deal_id) : null,
    legacyId: rec.legacy_id ? str(rec.legacy_id) : null,
    isTestData: Boolean(rec.is_test_data),
    participantIds,
    primaryPersonId,
    createdAt: isoOrNull(rec.created_at),
    updatedAt: isoOrNull(rec.updated_at),
  };
}

async function participantsFor(
  interactionIds: string[]
): Promise<Map<string, { ids: string[]; primary: string | null }>> {
  const out = new Map<string, { ids: string[]; primary: string | null }>();
  if (!interactionIds.length) return out;
  const db = sql();
  const rows = await db`
    SELECT interaction_id, person_id, is_primary
    FROM directory.interaction_participants
    WHERE interaction_id = ANY(${interactionIds})
    ORDER BY is_primary DESC, person_id ASC`;
  for (const r of rows) {
    const rec = r as Record<string, unknown>;
    const key = str(rec.interaction_id);
    const entry = out.get(key) ?? { ids: [], primary: null };
    entry.ids.push(str(rec.person_id));
    if (rec.is_primary) entry.primary = str(rec.person_id);
    out.set(key, entry);
  }
  return out;
}

async function getInteractionById(id: string): Promise<CrmInteraction | null> {
  const db = sql();
  const rows = await db.query(
    `SELECT ${INTERACTION_COLUMNS} FROM directory.interactions
     WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
    [id]
  );
  if (!rows.length) return null;
  const parts = await participantsFor([id]);
  const p = parts.get(id);
  return rowToInteraction(rows[0] as Record<string, unknown>, p?.ids ?? [], p?.primary ?? null);
}

export interface CreateInteractionInput {
  type?: string;
  direction?: string;
  occurredAt?: string;
  summary?: string;
  outcome?: string;
  nextStep?: string;
  nextStepDue?: string | null;
  predictedReplyPct?: number | null;
  visibility?: string;
  owner?: string;
  personIds?: string[];
  primaryPersonId?: string;
  participantIds?: string[];
  organizationId?: string | null;
  companyId?: string | null;
  dealId?: string | null;
  raiseDealId?: string | null;
  isTestData?: boolean;
  force?: boolean;
}

export type CreateInteractionResult =
  | { interaction: CrmInteraction; taskId: string | null }
  | { duplicateOf: string };

export async function createInteraction(
  input: CreateInteractionInput,
  actor = ""
): Promise<CreateInteractionResult> {
  await ensureCrmSchema();
  const db = sql();
  const type = (INTERACTION_TYPES as readonly string[]).includes(input.type ?? "")
    ? (input.type as string)
    : "note";
  const direction = (INTERACTION_DIRECTIONS as readonly string[]).includes(
    input.direction ?? ""
  )
    ? (input.direction as string)
    : "na";
  const visibility = (INTERACTION_VISIBILITIES as readonly string[]).includes(
    input.visibility ?? ""
  )
    ? (input.visibility as string)
    : "shared";
  const occurredAt =
    input.occurredAt && isIsoDateish(input.occurredAt)
      ? new Date(input.occurredAt).toISOString()
      : new Date().toISOString();
  const outcome = (input.outcome ?? "none").trim() || "none";
  const summary = (input.summary ?? "").trim();
  const nextStep = (input.nextStep ?? "").trim();
  const nextStepDue = input.nextStepDue ? String(input.nextStepDue).slice(0, 10) : null;
  const predictedReplyPct =
    input.predictedReplyPct === null || input.predictedReplyPct === undefined
      ? null
      : Math.max(0, Math.min(100, Math.round(num(input.predictedReplyPct))));

  const participantIds: string[] = [];
  for (const p of [...(input.personIds ?? []), ...(input.participantIds ?? [])]) {
    const v = String(p ?? "").trim();
    if (v && !participantIds.includes(v)) participantIds.push(v);
  }
  const primaryPersonId =
    (input.primaryPersonId ?? "").trim() ||
    (participantIds.length ? participantIds[0] : "");
  if (primaryPersonId && !participantIds.includes(primaryPersonId))
    participantIds.unshift(primaryPersonId);

  // Duplicate check: same primary participant person, same type,
  // occurred_at within ±5 minutes, not deleted.
  if (primaryPersonId && !input.force) {
    const dupRows = await db`
      SELECT i.id FROM directory.interactions i
      JOIN directory.interaction_participants p
        ON p.interaction_id = i.id AND p.is_primary = true
      WHERE p.person_id = ${primaryPersonId}
        AND i.type = ${type}
        AND i.deleted_at IS NULL
        AND i.occurred_at BETWEEN ${occurredAt}::timestamptz - interval '5 minutes'
          AND ${occurredAt}::timestamptz + interval '5 minutes'
      ORDER BY i.occurred_at DESC
      LIMIT 1`;
    if (dupRows.length) {
      return { duplicateOf: str((dupRows[0] as Record<string, unknown>).id) };
    }
  }

  let organizationId = input.organizationId ? String(input.organizationId) : null;
  if (!organizationId && primaryPersonId) {
    const orgRows = await db`
      SELECT organization_id FROM core.people WHERE id = ${primaryPersonId} LIMIT 1`;
    if (orgRows.length) {
      const rec = orgRows[0] as Record<string, unknown>;
      organizationId = rec.organization_id ? str(rec.organization_id) : null;
    }
  }

  const id = `int_${newId()}`;
  const owner = (input.owner ?? "").trim() || actor;
  await db`
    INSERT INTO directory.interactions (
      id, type, direction, occurred_at, summary, outcome, next_step,
      next_step_due, predicted_reply_pct, visibility, owner, created_by,
      organization_id, company_id, deal_id, raise_deal_id, is_test_data
    )
    VALUES (
      ${id}, ${type}, ${direction}, ${occurredAt}, ${summary}, ${outcome},
      ${nextStep}, ${nextStepDue}::date, ${predictedReplyPct}, ${visibility},
      ${owner}, ${actor}, ${organizationId}, ${input.companyId ?? null},
      ${input.dealId ?? null}, ${input.raiseDealId ?? null},
      ${Boolean(input.isTestData)}
    )`;
  for (const personId of participantIds) {
    await db`
      INSERT INTO directory.interaction_participants (
        interaction_id, person_id, is_primary
      )
      VALUES (${id}, ${personId}, ${personId === primaryPersonId})
      ON CONFLICT (interaction_id, person_id) DO NOTHING`;
  }

  // Next step → a task through the EXISTING task write path (lib/db
  // getTasks/saveTasks — the same functions app/api/tasks uses), never
  // a raw insert into the tasks table.
  let taskId: string | null = null;
  if (nextStep) {
    try {
      const { getTasks, saveTasks, newId: newTaskId } = await import("../db");
      const now = new Date().toISOString();
      const relatedKind = primaryPersonId ? "person" : organizationId ? "organization" : null;
      const task = {
        id: newTaskId(),
        title: nextStep,
        dueDate: nextStepDue ?? "",
        dueTime: null,
        type: "Call" as const,
        priority: "normal" as const,
        notes: summary,
        done: false,
        completedAt: null,
        owner: actor,
        relatedKind: relatedKind as never,
        relatedId: primaryPersonId || organizationId || null,
        relatedName: "",
        calendarEventId: null,
        createdAt: now,
        updatedAt: now,
      };
      const tasks = await getTasks();
      tasks.push(task);
      await saveTasks(tasks);
      taskId = task.id;
    } catch (err) {
      console.error("[crm] next-step task creation failed", err);
    }
  }

  // Summary recounts for all participants + the organization.
  const recounts: Promise<void>[] = participantIds.map((personId) =>
    recountEntitySummaries("person", personId)
  );
  if (organizationId)
    recounts.push(recountEntitySummaries("organization", organizationId));
  await Promise.all(
    recounts.map((p) =>
      p.catch((err) => console.error("[crm] recount after interaction failed", err))
    )
  );

  await publishEvent("interaction_logged", {
    entityKind: "person",
    entityId: primaryPersonId,
    payload: { interactionId: id, type },
    actor,
  });

  const saved = await getInteractionById(id);
  return {
    interaction:
      saved ??
      rowToInteraction(
        {
          id,
          type,
          direction,
          occurred_at: occurredAt,
          summary,
          outcome,
          next_step: nextStep,
          next_step_due: nextStepDue,
          predicted_reply_pct: predictedReplyPct,
          visibility,
          owner,
          created_by: actor,
          organization_id: organizationId,
          company_id: input.companyId ?? null,
          deal_id: input.dealId ?? null,
          raise_deal_id: input.raiseDealId ?? null,
          is_test_data: Boolean(input.isTestData),
        },
        participantIds,
        primaryPersonId || null
      ),
    taskId,
  };
}

/**
 * Create a task linked to a Directory record through the EXISTING task
 * write path (lib/db getTasks/saveTasks — the same functions
 * app/api/tasks uses). Used by the bulk create_task action; Quick log's
 * next-step tasks are created inline by createInteraction with the
 * identical construction. related_kind person/organization round-trips
 * safely since the lib/types + rowToTask extension (CRM Phase 1).
 */
export async function createLinkedTask(
  input: {
    title: string;
    dueDate?: string;
    relatedKind: string;
    relatedId: string;
    relatedName?: string;
    owner?: string;
  },
  actor = ""
): Promise<{ id: string }> {
  const title = (input.title ?? "").trim();
  if (!title) throw new Error("title is required");
  const kind = normKind(input.relatedKind);
  if (!kind) throw new Error("relatedKind must be person or organization");
  const { getTasks, saveTasks, newId: newTaskId } = await import("../db");
  const now = new Date().toISOString();
  const task = {
    id: newTaskId(),
    title,
    dueDate: input.dueDate ?? "",
    dueTime: null,
    type: "Call" as const,
    priority: "normal" as const,
    notes: "",
    done: false,
    completedAt: null,
    owner: input.owner ?? actor,
    relatedKind: kind as never,
    relatedId: input.relatedId,
    relatedName: input.relatedName ?? "",
    calendarEventId: null,
    createdAt: now,
    updatedAt: now,
  };
  const tasks = await getTasks();
  tasks.push(task);
  await saveTasks(tasks);
  await recountEntitySummaries(kind, input.relatedId);
  return { id: task.id };
}

export async function listInteractions(
  filters: {
    personId?: string;
    organizationId?: string;
    dealId?: string;
    limit?: number;
    offset?: number;
  },
  actor = ""
): Promise<{ items: CrmInteraction[]; total: number }> {
  await ensureCrmSchema();
  const db = sql();
  const personId = filters.personId ?? "";
  const organizationId = filters.organizationId ?? "";
  const dealId = filters.dealId ?? "";
  const limit = Math.min(50, Math.max(1, filters.limit || 25));
  const offset = Math.max(0, filters.offset || 0);
  // Visibility predicate IN SQL: shared rows for everyone; private
  // rows only for their creator/owner.
  const rows = await db.query(
    `SELECT ${INTERACTION_COLUMNS} FROM directory.interactions i
     WHERE i.deleted_at IS NULL
       AND (i.visibility = 'shared' OR i.created_by = $4 OR i.owner = $4)
       AND ($1 = '' OR EXISTS (
         SELECT 1 FROM directory.interaction_participants p
         WHERE p.interaction_id = i.id AND p.person_id = $1))
       AND ($2 = '' OR i.organization_id = $2)
       AND ($3 = '' OR i.deal_id = $3 OR i.raise_deal_id = $3)
     ORDER BY i.occurred_at DESC, i.created_at DESC
     LIMIT $5 OFFSET $6`,
    [personId, organizationId, dealId, actor, limit, offset]
  );
  const countRows = await db.query(
    `SELECT count(*)::int AS n FROM directory.interactions i
     WHERE i.deleted_at IS NULL
       AND (i.visibility = 'shared' OR i.created_by = $3 OR i.owner = $3)
       AND ($1 = '' OR EXISTS (
         SELECT 1 FROM directory.interaction_participants p
         WHERE p.interaction_id = i.id AND p.person_id = $1))
       AND ($2 = '' OR i.organization_id = $2)
       AND ($4 = '' OR i.deal_id = $4 OR i.raise_deal_id = $4)`,
    [personId, organizationId, actor, dealId]
  );
  const parts = await participantsFor(
    rows.map((r) => str((r as Record<string, unknown>).id))
  );
  const items = rows.map((r) => {
    const rec = r as Record<string, unknown>;
    const p = parts.get(str(rec.id));
    return rowToInteraction(rec, p?.ids ?? [], p?.primary ?? null);
  });
  const total = countRows.length ? num((countRows[0] as Record<string, unknown>).n) : 0;
  return { items, total };
}

export interface UpdateInteractionPatch {
  type?: string;
  direction?: string;
  occurredAt?: string;
  summary?: string;
  outcome?: string;
  nextStep?: string;
  nextStepDue?: string | null;
  predictedReplyPct?: number | null;
  visibility?: string;
  owner?: string;
  organizationId?: string | null;
  companyId?: string | null;
  dealId?: string | null;
  raiseDealId?: string | null;
  personIds?: string[];
  primaryPersonId?: string;
}

export async function updateInteraction(
  id: string,
  patch: UpdateInteractionPatch,
  actor = ""
): Promise<CrmInteraction> {
  await ensureCrmSchema();
  const existing = await getInteractionById(id);
  if (!existing) throw new Error("interaction not found");
  // Predicted reply % is Ethan's calibration instrument: captured at
  // log time and locked once saved.
  if (patch.predictedReplyPct !== undefined) {
    const nextPct =
      patch.predictedReplyPct === null ? null : num(patch.predictedReplyPct);
    if (nextPct !== existing.predictedReplyPct) {
      throw new Error("prediction_locked");
    }
  }
  const db = sql();
  const next = {
    type:
      patch.type !== undefined && (INTERACTION_TYPES as readonly string[]).includes(patch.type)
        ? patch.type
        : existing.type,
    direction:
      patch.direction !== undefined &&
      (INTERACTION_DIRECTIONS as readonly string[]).includes(patch.direction)
        ? patch.direction
        : existing.direction,
    occurredAt:
      patch.occurredAt !== undefined && isIsoDateish(patch.occurredAt)
        ? new Date(patch.occurredAt).toISOString()
        : existing.occurredAt,
    summary: patch.summary !== undefined ? String(patch.summary) : existing.summary,
    outcome: patch.outcome !== undefined ? String(patch.outcome) || "none" : existing.outcome,
    nextStep: patch.nextStep !== undefined ? String(patch.nextStep) : existing.nextStep,
    nextStepDue:
      patch.nextStepDue !== undefined
        ? patch.nextStepDue
          ? String(patch.nextStepDue).slice(0, 10)
          : null
        : existing.nextStepDue,
    visibility:
      patch.visibility !== undefined &&
      (INTERACTION_VISIBILITIES as readonly string[]).includes(patch.visibility)
        ? patch.visibility
        : existing.visibility,
    owner: patch.owner !== undefined ? String(patch.owner) : existing.owner,
    organizationId:
      patch.organizationId !== undefined ? patch.organizationId : existing.organizationId,
    companyId: patch.companyId !== undefined ? patch.companyId : existing.companyId,
    dealId: patch.dealId !== undefined ? patch.dealId : existing.dealId,
    raiseDealId: patch.raiseDealId !== undefined ? patch.raiseDealId : existing.raiseDealId,
  };
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  const apply = (field: string, from: unknown, to: unknown) => {
    if (String(from ?? "") !== String(to ?? "")) {
      changes[field] = { from: from ?? "", to: to ?? "" };
    }
  };
  apply("type", existing.type, next.type);
  apply("direction", existing.direction, next.direction);
  apply("occurredAt", existing.occurredAt, next.occurredAt);
  apply("summary", existing.summary, next.summary);
  apply("outcome", existing.outcome, next.outcome);
  apply("nextStep", existing.nextStep, next.nextStep);
  apply("nextStepDue", existing.nextStepDue, next.nextStepDue);
  apply("visibility", existing.visibility, next.visibility);
  apply("owner", existing.owner, next.owner);
  apply("organizationId", existing.organizationId, next.organizationId);

  await db`
    UPDATE directory.interactions SET
      type = ${next.type},
      direction = ${next.direction},
      occurred_at = ${next.occurredAt},
      summary = ${next.summary},
      outcome = ${next.outcome},
      next_step = ${next.nextStep},
      next_step_due = ${next.nextStepDue}::date,
      visibility = ${next.visibility},
      owner = ${next.owner},
      organization_id = ${next.organizationId},
      company_id = ${next.companyId},
      deal_id = ${next.dealId},
      raise_deal_id = ${next.raiseDealId},
      updated_at = now()
    WHERE id = ${id} AND deleted_at IS NULL`;

  let participantIds = existing.participantIds;
  if (patch.personIds !== undefined || patch.primaryPersonId !== undefined) {
    const ids: string[] = [];
    for (const p of patch.personIds ?? existing.participantIds) {
      const v = String(p ?? "").trim();
      if (v && !ids.includes(v)) ids.push(v);
    }
    const primary =
      (patch.primaryPersonId ?? "").trim() || existing.primaryPersonId || ids[0] || "";
    if (primary && !ids.includes(primary)) ids.unshift(primary);
    await db`
      DELETE FROM directory.interaction_participants WHERE interaction_id = ${id}`;
    for (const personId of ids) {
      await db`
        INSERT INTO directory.interaction_participants (
          interaction_id, person_id, is_primary
        )
        VALUES (${id}, ${personId}, ${personId === primary})
        ON CONFLICT (interaction_id, person_id) DO NOTHING`;
    }
    participantIds = ids;
    changes["participants"] = {
      from: existing.participantIds.join(","),
      to: ids.join(","),
    };
  }

  if (Object.keys(changes).length) {
    await db`
      INSERT INTO core.audit_log (entity_kind, entity_id, actor, action, changes)
      VALUES ('interaction', ${id}, ${actor}, 'update',
        ${JSON.stringify(changes)}::jsonb)`;
  }
  const recountIds = new Set<string>([...existing.participantIds, ...participantIds]);
  const recounts: Promise<void>[] = Array.from(recountIds).map((personId) =>
    recountEntitySummaries("person", personId)
  );
  if (existing.organizationId)
    recounts.push(recountEntitySummaries("organization", existing.organizationId));
  if (next.organizationId && next.organizationId !== existing.organizationId)
    recounts.push(recountEntitySummaries("organization", next.organizationId));
  await Promise.all(
    recounts.map((p) =>
      p.catch((err) => console.error("[crm] recount after interaction update failed", err))
    )
  );
  const saved = await getInteractionById(id);
  if (!saved) throw new Error("interaction not found after update");
  return saved;
}

export async function deleteInteraction(id: string, actor = ""): Promise<boolean> {
  await ensureCrmSchema();
  const existing = await getInteractionById(id);
  if (!existing) return false;
  const db = sql();
  const rows = await db`
    UPDATE directory.interactions
    SET deleted_at = now(), updated_at = now()
    WHERE id = ${id} AND deleted_at IS NULL
    RETURNING id`;
  if (!rows.length) return false;
  await db`
    INSERT INTO core.audit_log (entity_kind, entity_id, actor, action, changes)
    VALUES ('interaction', ${id}, ${actor}, 'delete',
      ${JSON.stringify({ deleted_at: { from: null, to: "soft-deleted" } })}::jsonb)`;
  const recounts: Promise<void>[] = existing.participantIds.map((personId) =>
    recountEntitySummaries("person", personId)
  );
  if (existing.organizationId)
    recounts.push(recountEntitySummaries("organization", existing.organizationId));
  await Promise.all(
    recounts.map((p) =>
      p.catch((err) => console.error("[crm] recount after interaction delete failed", err))
    )
  );
  return true;
}

/* ------------------------------ timeline ----------------------------- */

export type TimelineKind = "interaction" | "task" | "email" | "document" | "event";

export interface TimelineItem {
  key: string;
  kind: TimelineKind;
  ts: string | null;
  title: string;
  detail: string;
  href: string;
  /** Interaction type for kind="interaction" items (call/meeting/…). */
  type?: string;
  /** Completion flag for kind="task" items. */
  done?: boolean;
}

export async function getTimeline(
  kindRaw: string,
  id: string,
  opts: { kinds?: string[]; limit?: number; offset?: number } = {}
): Promise<{ items: TimelineItem[]; total: number }> {
  await ensureCrmSchema();
  const kind = normKind(kindRaw);
  if (!kind || !id) return { items: [], total: 0 };
  const db = sql();
  const limit = Math.min(50, Math.max(1, opts.limit || 20));
  const offset = Math.max(0, opts.offset || 0);
  const fetchN = limit + offset;
  const wanted = (k: TimelineKind): boolean =>
    !opts.kinds || !opts.kinds.length || opts.kinds.includes(k);
  const items: TimelineItem[] = [];

  if (wanted("interaction")) {
    const rows =
      kind === "person"
        ? await db`
            SELECT i.id, i.type, i.occurred_at, i.summary, i.outcome
            FROM directory.interactions i
            JOIN directory.interaction_participants p
              ON p.interaction_id = i.id
            WHERE p.person_id = ${id} AND i.deleted_at IS NULL
            ORDER BY i.occurred_at DESC
            LIMIT ${fetchN}`
        : await db`
            SELECT DISTINCT i.id, i.type, i.occurred_at, i.summary, i.outcome
            FROM directory.interactions i
            LEFT JOIN directory.interaction_participants p
              ON p.interaction_id = i.id
            LEFT JOIN core.people pp ON pp.id = p.person_id
            WHERE i.deleted_at IS NULL
              AND (i.organization_id = ${id} OR pp.organization_id = ${id})
            ORDER BY i.occurred_at DESC
            LIMIT ${fetchN}`;
    for (const r of rows) {
      const rec = r as Record<string, unknown>;
      items.push({
        key: `interaction:${str(rec.id)}`,
        kind: "interaction",
        type: str(rec.type) || "note",
        ts: isoOrNull(rec.occurred_at),
        title: str(rec.summary) || `${str(rec.type)} interaction`,
        detail: [str(rec.type), str(rec.outcome) !== "none" ? str(rec.outcome) : ""]
          .filter(Boolean)
          .join(" · "),
        href: "",
      });
    }
  }

  if (wanted("task")) {
    try {
      const rows =
        kind === "person"
          ? await db`
              SELECT t.id, t.title, t.due_date, t.done, t.created_at
              FROM tasks t
              WHERE (t.related_kind = 'person' AND t.related_id = ${id})
                OR (t.related_kind = 'executive' AND t.related_id = (
                  SELECT p.legacy_exec_id FROM core.people p
                  WHERE p.id = ${id} AND p.legacy_exec_id IS NOT NULL
                  LIMIT 1))
              ORDER BY t.created_at DESC
              LIMIT ${fetchN}`
          : await db`
              SELECT t.id, t.title, t.due_date, t.done, t.created_at
              FROM tasks t
              WHERE t.related_kind = 'organization' AND t.related_id = ${id}
              ORDER BY t.created_at DESC
              LIMIT ${fetchN}`;
      for (const r of rows) {
        const rec = r as Record<string, unknown>;
        items.push({
          key: `task:${str(rec.id)}`,
          kind: "task",
          done: Boolean(rec.done),
          ts: isoOrNull(rec.created_at),
          title: str(rec.title),
          detail: [
            rec.done ? "Done" : "Open",
            str(rec.due_date) ? `due ${str(rec.due_date)}` : "",
          ]
            .filter(Boolean)
            .join(" · "),
          href: "",
        });
      }
    } catch (err) {
      console.error("[crm] timeline tasks failed", err);
    }
  }

  if (wanted("email")) {
    const rows =
      kind === "person"
        ? await db`
            SELECT id, subject, from_addr, email_date, note, created_at
            FROM directory.email_links
            WHERE person_id = ${id}
            ORDER BY created_at DESC
            LIMIT ${fetchN}`
        : await db`
            SELECT id, subject, from_addr, email_date, note, created_at
            FROM directory.email_links
            WHERE organization_id = ${id}
            ORDER BY created_at DESC
            LIMIT ${fetchN}`;
    for (const r of rows) {
      const rec = r as Record<string, unknown>;
      const dateText = str(rec.email_date);
      items.push({
        key: `email:${str(rec.id)}`,
        kind: "email",
        ts:
          isoOrNull(rec.email_date) ??
          (isIsoDateish(dateText) ? new Date(dateText).toISOString() : isoOrNull(rec.created_at)),
        title: str(rec.subject) || "(no subject)",
        detail: [str(rec.from_addr), str(rec.note)].filter(Boolean).join(" · "),
        href: "",
      });
    }
  }

  if (wanted("document")) {
    const rows =
      kind === "person"
        ? await db`
            SELECT id, name, mime, created_at FROM core.documents
            WHERE person_id = ${id} AND deleted_at IS NULL
            ORDER BY created_at DESC
            LIMIT ${fetchN}`
        : await db`
            SELECT id, name, mime, created_at FROM core.documents
            WHERE company_id = ${id} AND deleted_at IS NULL
            ORDER BY created_at DESC
            LIMIT ${fetchN}`;
    for (const r of rows) {
      const rec = r as Record<string, unknown>;
      items.push({
        key: `document:${str(rec.id)}`,
        kind: "document",
        ts: isoOrNull(rec.created_at),
        title: str(rec.name),
        detail: str(rec.mime),
        href: "",
      });
    }
  }

  if (wanted("event")) {
    const rows = await db`
      SELECT id, kind, message, actor, created_at FROM core.activity_log
      WHERE entity_kind = ${kind} AND entity_id = ${id}
      ORDER BY created_at DESC
      LIMIT ${fetchN}`;
    for (const r of rows) {
      const rec = r as Record<string, unknown>;
      items.push({
        key: `event:${str(rec.id)}`,
        kind: "event",
        ts: isoOrNull(rec.created_at),
        title: str(rec.message),
        detail: [str(rec.kind), str(rec.actor)].filter(Boolean).join(" · "),
        href: "",
      });
    }
  }

  items.sort((a, b) => {
    const ta = a.ts ? new Date(a.ts).getTime() : 0;
    const tb = b.ts ? new Date(b.ts).getTime() : 0;
    return tb - ta;
  });
  return { items: items.slice(offset, offset + limit), total: items.length };
}

/* ------------------------- duplicates + merge ------------------------ */

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
    prev = cur;
  }
  return prev[b.length];
}

const phoneDigits = (v: string): string => {
  const d = (v ?? "").replace(/\D/g, "");
  return d.length > 10 ? d.slice(-10) : d;
};
const emailDomain = (v: string): string => {
  const at = (v ?? "").toLowerCase().lastIndexOf("@");
  return at >= 0 ? v.slice(at + 1).trim().toLowerCase() : "";
};

export interface DirectoryRecordCounts {
  interactions: number;
  tasks: number;
  links: number;
}

export interface DirectoryDuplicatePair {
  kind: CrmEntityKind;
  aId: string;
  aName: string;
  bId: string;
  bName: string;
  score: number;
  reasons: string[];
  aCounts: DirectoryRecordCounts;
  bCounts: DirectoryRecordCounts;
}

interface DirectoryRecordLite {
  id: string;
  name: string;
  normalizedName: string;
  email: string;
  phone: string;
  organizationId: string | null;
}

async function recordCounts(
  kind: CrmEntityKind,
  rec: DirectoryRecordLite
): Promise<DirectoryRecordCounts> {
  const db = sql();
  let interactions = 0;
  let links = 0;
  if (kind === "person") {
    const rows = await db`
      SELECT count(*)::int AS n FROM directory.interaction_participants
      WHERE person_id = ${rec.id}`;
    interactions = rows.length ? num((rows[0] as Record<string, unknown>).n) : 0;
    const linkRows = await db`
      SELECT count(*)::int AS n FROM core.deal_participants
      WHERE entity_kind = 'person' AND entity_id = ${rec.id}`;
    links = linkRows.length ? num((linkRows[0] as Record<string, unknown>).n) : 0;
  } else {
    const rows = await db`
      SELECT count(*)::int AS n FROM directory.interactions
      WHERE organization_id = ${rec.id} AND deleted_at IS NULL`;
    interactions = rows.length ? num((rows[0] as Record<string, unknown>).n) : 0;
    const linkRows = await db`
      SELECT count(*)::int AS n FROM core.deal_participants
      WHERE entity_kind = 'organization' AND entity_id = ${rec.id}`;
    links = linkRows.length ? num((linkRows[0] as Record<string, unknown>).n) : 0;
  }
  let tasks = 0;
  try {
    const rows =
      kind === "person"
        ? await db`
            SELECT count(*)::int AS n FROM tasks t
            WHERE (t.related_kind = 'person' AND t.related_id = ${rec.id})
              OR (t.related_kind = 'executive' AND t.related_id = (
                SELECT p.legacy_exec_id FROM core.people p
                WHERE p.id = ${rec.id} AND p.legacy_exec_id IS NOT NULL
                LIMIT 1))`
        : await db`
            SELECT count(*)::int AS n FROM tasks t
            WHERE t.related_kind = 'organization' AND t.related_id = ${rec.id}`;
    tasks = rows.length ? num((rows[0] as Record<string, unknown>).n) : 0;
  } catch {
    tasks = 0;
  }
  return { interactions, tasks, links };
}

export async function findDirectoryDuplicates(
  kindRaw: string
): Promise<DirectoryDuplicatePair[]> {
  await ensureCrmSchema();
  const kind = normKind(kindRaw);
  if (!kind) throw new Error("kind must be 'person' or 'organization'");
  const db = sql();
  let records: DirectoryRecordLite[] = [];
  if (kind === "person") {
    const rows = await db`
      SELECT id, name, normalized_name, email, phone, organization_id
      FROM core.people WHERE deleted_at IS NULL
      ORDER BY normalized_name ASC
      LIMIT 2000`;
    records = rows.map((r) => {
      const rec = r as Record<string, unknown>;
      return {
        id: str(rec.id),
        name: str(rec.name),
        normalizedName: str(rec.normalized_name) || normalizeName(str(rec.name)),
        email: str(rec.email),
        phone: str(rec.phone),
        organizationId: rec.organization_id ? str(rec.organization_id) : null,
      };
    });
  } else {
    const rows = await db`
      SELECT id, name, normalized_name FROM core.organizations
      WHERE deleted_at IS NULL
      ORDER BY normalized_name ASC
      LIMIT 2000`;
    records = rows.map((r) => {
      const rec = r as Record<string, unknown>;
      return {
        id: str(rec.id),
        name: str(rec.name),
        normalizedName: str(rec.normalized_name) || normalizeName(str(rec.name)),
        email: "",
        phone: "",
        organizationId: null,
      };
    });
  }

  // Blocking: pairs must share an email, a phone-digit key, or a
  // normalized name before they are ever scored.
  const blocks = new Map<string, string[]>();
  const addBlock = (key: string, id: string) => {
    if (!key) return;
    const list = blocks.get(key) ?? [];
    list.push(id);
    blocks.set(key, list);
  };
  for (const rec of records) {
    if (rec.email) addBlock(`email:${rec.email.toLowerCase()}`, rec.id);
    const digits = phoneDigits(rec.phone);
    if (digits.length >= 7) addBlock(`phone:${digits}`, rec.id);
    if (rec.normalizedName) addBlock(`name:${rec.normalizedName}`, rec.id);
    const domain = emailDomain(rec.email);
    if (domain) addBlock(`domain:${domain}`, rec.id);
    // Near-name blocking for the edit-distance rule: first token bucket.
    const first = rec.normalizedName.split(" ")[0];
    if (first) addBlock(`first:${first}`, rec.id);
  }
  const byId = new Map(records.map((r) => [r.id, r]));
  const pairKeys = new Set<string>();
  for (const ids of Array.from(blocks.values())) {
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const [a, b] = ids[i] < ids[j] ? [ids[i], ids[j]] : [ids[j], ids[i]];
        if (a !== b) pairKeys.add(`${a}|${b}`);
      }
    }
  }

  const scored: Omit<DirectoryDuplicatePair, "aCounts" | "bCounts">[] = [];
  for (const key of Array.from(pairKeys)) {
    const [aId, bId] = key.split("|");
    const a = byId.get(aId);
    const b = byId.get(bId);
    if (!a || !b) continue;
    let score = 0;
    const reasons: string[] = [];
    if (a.email && b.email && a.email.toLowerCase() === b.email.toLowerCase()) {
      score = Math.max(score, 100);
      reasons.push("same email");
    }
    const da = phoneDigits(a.phone);
    const dbDigits = phoneDigits(b.phone);
    if (da && dbDigits && da === dbDigits) {
      score = Math.max(score, 95);
      reasons.push("same phone");
    }
    if (a.normalizedName && a.normalizedName === b.normalizedName) {
      score = Math.max(score, 85);
      reasons.push("exact normalized name");
    } else if (
      a.normalizedName &&
      b.normalizedName &&
      levenshtein(a.normalizedName, b.normalizedName) <= 2 &&
      a.organizationId &&
      a.organizationId === b.organizationId
    ) {
      score = Math.max(score, 75);
      reasons.push("near name (edit distance ≤2) + same organization");
    }
    const domA = emailDomain(a.email);
    const domB = emailDomain(b.email);
    if (
      domA &&
      domA === domB &&
      a.normalizedName &&
      b.normalizedName &&
      a.normalizedName.split(" ")[0] === b.normalizedName.split(" ")[0]
    ) {
      score = Math.max(score, 60);
      reasons.push("same first name + same email domain");
    }
    if (score >= 60) {
      scored.push({
        kind,
        aId: a.id,
        aName: a.name,
        bId: b.id,
        bName: b.name,
        score,
        reasons,
      });
    }
  }
  scored.sort((x, y) => y.score - x.score);
  const top = scored.slice(0, 100);
  const out: DirectoryDuplicatePair[] = [];
  for (const pair of top) {
    const a = byId.get(pair.aId) as DirectoryRecordLite;
    const b = byId.get(pair.bId) as DirectoryRecordLite;
    const [aCounts, bCounts] = await Promise.all([
      recordCounts(kind, a),
      recordCounts(kind, b),
    ]);
    out.push({ ...pair, aCounts, bCounts });
  }
  return out;
}

export async function mergeDirectoryRecords(
  kindRaw: string,
  keeperId: string,
  duplicateId: string,
  actor = ""
): Promise<{ movedCounts: { interactions: number; tasks: number; links: number } }> {
  await ensureCrmSchema();
  const kind = normKind(kindRaw);
  if (!kind) throw new Error("kind must be 'person' or 'organization'");
  if (!keeperId || !duplicateId || keeperId === duplicateId)
    throw new Error("keeperId and duplicateId must be different records");
  const db = sql();

  const keeperRows =
    kind === "person"
      ? await db`SELECT id, name FROM core.people WHERE id = ${keeperId} AND deleted_at IS NULL LIMIT 1`
      : await db`SELECT id, name FROM core.organizations WHERE id = ${keeperId} AND deleted_at IS NULL LIMIT 1`;
  const dupRows =
    kind === "person"
      ? await db`SELECT id, name, legacy_exec_id FROM core.people WHERE id = ${duplicateId} AND deleted_at IS NULL LIMIT 1`
      : await db`SELECT id, name FROM core.organizations WHERE id = ${duplicateId} AND deleted_at IS NULL LIMIT 1`;
  if (!keeperRows.length) throw new Error("keeper record not found");
  if (!dupRows.length) throw new Error("duplicate record not found");
  const dupRec = dupRows[0] as Record<string, unknown>;

  let interactions = 0;
  let tasks = 0;
  let links = 0;

  if (kind === "person") {
    // Core links via the platform dedupe merge where it fits (people
    // is one of its two supported kinds): repoints deal_participants,
    // activity_log and comments, fills blank keeper fields, soft-
    // deletes the duplicate, writes its own audit row and publishes
    // contact_updated.
    const { merge } = await import("../platform/dedupe");
    const res = await merge("people", keeperId, duplicateId, actor);
    if (!res.ok) throw new Error(res.error ?? "core merge failed");
  } else {
    // dedupe.ts has no organizations branch — do the equivalent core
    // re-pointing here: deal participants, people's organization
    // link, comments and activity, blank-field fill, soft delete.
    await db`
      DELETE FROM core.deal_participants dp
      WHERE dp.entity_id = ${duplicateId} AND dp.entity_kind = 'organization'
        AND EXISTS (
          SELECT 1 FROM core.deal_participants kp
          WHERE kp.deal_id = dp.deal_id AND kp.entity_id = ${keeperId}
            AND kp.entity_kind = dp.entity_kind AND kp.role = dp.role
        )`;
    const dpRows = await db`
      UPDATE core.deal_participants SET entity_id = ${keeperId}, updated_at = now()
      WHERE entity_id = ${duplicateId} AND entity_kind = 'organization'
      RETURNING id`;
    links += dpRows.length;
    const keeperName = str((keeperRows[0] as Record<string, unknown>).name);
    await db`
      UPDATE core.people SET organization_id = ${keeperId},
        organization_name = ${keeperName}, updated_at = now()
      WHERE organization_id = ${duplicateId} AND deleted_at IS NULL`;
    await db`
      UPDATE core.activity_log SET entity_id = ${keeperId}
      WHERE entity_id = ${duplicateId}`;
    await db`
      UPDATE core.comments SET entity_id = ${keeperId}, updated_at = now()
      WHERE entity_kind = 'organization' AND entity_id = ${duplicateId}`;
    const kRows = await db`
      SELECT website, notes, kind FROM core.organizations WHERE id = ${keeperId} LIMIT 1`;
    const dRows = await db`
      SELECT website, notes, kind FROM core.organizations WHERE id = ${duplicateId} LIMIT 1`;
    const k = (kRows[0] ?? {}) as Record<string, unknown>;
    const d = (dRows[0] ?? {}) as Record<string, unknown>;
    const pick = (keep: string, merged: string) => (keep !== "" ? keep : merged);
    await db`
      UPDATE core.organizations SET
        website = ${pick(str(k.website), str(d.website))},
        notes = ${pick(str(k.notes), str(d.notes))},
        kind = ${pick(str(k.kind), str(d.kind))},
        updated_at = now()
      WHERE id = ${keeperId}`;
    await db`
      UPDATE core.organizations SET deleted_at = now(), updated_at = now()
      WHERE id = ${duplicateId}`;
  }

  /* Directory-owned rows — always re-pointed here. */
  if (kind === "person") {
    await db`
      DELETE FROM directory.interaction_participants ip
      WHERE ip.person_id = ${duplicateId}
        AND EXISTS (
          SELECT 1 FROM directory.interaction_participants kp
          WHERE kp.interaction_id = ip.interaction_id AND kp.person_id = ${keeperId}
        )`;
    const partRows = await db`
      UPDATE directory.interaction_participants SET person_id = ${keeperId}
      WHERE person_id = ${duplicateId}
      RETURNING interaction_id`;
    interactions += partRows.length;
  } else {
    const orgRows = await db`
      UPDATE directory.interactions SET organization_id = ${keeperId}, updated_at = now()
      WHERE organization_id = ${duplicateId} AND deleted_at IS NULL
      RETURNING id`;
    interactions += orgRows.length;
  }

  // Tags + type tags: union onto the keeper, then drop the duplicate's.
  for (const table of ["directory.tags", "directory.type_tags"] as const) {
    const moved = await db.query(
      table === "directory.tags"
        ? `INSERT INTO directory.tags (entity_kind, entity_id, tag)
           SELECT entity_kind, $1, tag FROM directory.tags
           WHERE entity_kind = $2 AND entity_id = $3
           ON CONFLICT (entity_kind, entity_id, tag) DO NOTHING
           RETURNING tag`
        : `INSERT INTO directory.type_tags (entity_kind, entity_id, type)
           SELECT entity_kind, $1, type FROM directory.type_tags
           WHERE entity_kind = $2 AND entity_id = $3
           ON CONFLICT (entity_kind, entity_id, type) DO NOTHING
           RETURNING type`,
      [keeperId, kind, duplicateId]
    );
    links += moved.length;
    await db.query(
      table === "directory.tags"
        ? `DELETE FROM directory.tags WHERE entity_kind = $1 AND entity_id = $2`
        : `DELETE FROM directory.type_tags WHERE entity_kind = $1 AND entity_id = $2`,
      [kind, duplicateId]
    );
  }

  // Relationship profile: keeper wins; blank keeper fields fill from
  // the duplicate; the duplicate's profile row is removed.
  const keeperProfile = await getRelationship(kind, keeperId);
  const dupProfile = await getRelationship(kind, duplicateId);
  if (dupProfile && !keeperProfile) {
    await db`
      UPDATE directory.relationship_profiles SET entity_id = ${keeperId}, updated_at = now()
      WHERE entity_kind = ${kind} AND entity_id = ${duplicateId}`;
  } else if (dupProfile && keeperProfile) {
    const blank = (v: unknown) => v === null || v === undefined || v === "";
    await updateRelationship(
      kind,
      keeperId,
      {
        tier: blank(keeperProfile.tier) ? dupProfile.tier : keeperProfile.tier,
        stage: keeperProfile.stage === "New" && dupProfile.stage !== "New"
          ? dupProfile.stage
          : keeperProfile.stage,
        cadenceDays: keeperProfile.cadenceDays ?? dupProfile.cadenceDays,
        owner: blank(keeperProfile.owner) ? dupProfile.owner : keeperProfile.owner,
        source: blank(keeperProfile.source) ? dupProfile.source : keeperProfile.source,
        introducedByPersonId:
          keeperProfile.introducedByPersonId ?? dupProfile.introducedByPersonId,
        commPrefs: blank(keeperProfile.commPrefs)
          ? dupProfile.commPrefs
          : keeperProfile.commPrefs,
        importantDates: keeperProfile.importantDates.length
          ? keeperProfile.importantDates
          : dupProfile.importantDates,
      },
      actor
    );
    await db`
      DELETE FROM directory.relationship_profiles
      WHERE entity_kind = ${kind} AND entity_id = ${duplicateId}`;
  }

  // Email links.
  const emailRows =
    kind === "person"
      ? await db`
          UPDATE directory.email_links SET person_id = ${keeperId}
          WHERE person_id = ${duplicateId}
          RETURNING id`
      : await db`
          UPDATE directory.email_links SET organization_id = ${keeperId}
          WHERE organization_id = ${duplicateId}
          RETURNING id`;
  links += emailRows.length;

  // List members: union onto the keeper, then drop the duplicate's.
  const memberRows = await db`
    INSERT INTO directory.list_members (list_id, entity_kind, entity_id)
    SELECT list_id, entity_kind, ${keeperId} FROM directory.list_members
    WHERE entity_kind = ${kind} AND entity_id = ${duplicateId}
    ON CONFLICT (list_id, entity_kind, entity_id) DO NOTHING
    RETURNING list_id`;
  links += memberRows.length;
  await db`
    DELETE FROM directory.list_members
    WHERE entity_kind = ${kind} AND entity_id = ${duplicateId}`;

  // Tasks: CRM-linked rows re-point directly; legacy 'executive'
  // follow-ups re-point from the duplicate's legacy exec id to the
  // keeper's legacy exec id (when the keeper has one).
  try {
    const taskRows = await db.query(
      `UPDATE tasks SET related_id = $1, updated_at = now()
       WHERE related_kind = $2 AND related_id = $3
       RETURNING id`,
      [keeperId, kind, duplicateId]
    );
    tasks += taskRows.length;
    if (kind === "person") {
      const dupLegacy = dupRec.legacy_exec_id ? str(dupRec.legacy_exec_id) : "";
      const keeperLegacyRows = await db`
        SELECT legacy_exec_id FROM core.people WHERE id = ${keeperId} LIMIT 1`;
      const keeperLegacy = keeperLegacyRows.length
        ? str((keeperLegacyRows[0] as Record<string, unknown>).legacy_exec_id)
        : "";
      if (dupLegacy && keeperLegacy && dupLegacy !== keeperLegacy) {
        const legacyTaskRows = await db.query(
          `UPDATE tasks SET related_id = $1, updated_at = now()
           WHERE related_kind = 'executive' AND related_id = $2
           RETURNING id`,
          [keeperLegacy, dupLegacy]
        );
        tasks += legacyTaskRows.length;
      }
    }
  } catch (err) {
    console.error("[crm] merge task re-point failed", err);
  }

  const movedCounts = { interactions, tasks, links };
  await db`
    INSERT INTO core.audit_log (entity_kind, entity_id, actor, action, changes)
    VALUES (${kind}, ${keeperId}, ${actor}, 'merge',
      ${JSON.stringify({ mergedId: duplicateId, mergedName: str(dupRec.name), movedCounts })}::jsonb)`;
  await publishEvent("contact_updated", {
    entityKind: kind,
    entityId: keeperId,
    payload: { action: "merge", mergedId: duplicateId, movedCounts },
    actor,
  });
  await recountEntitySummaries(kind, keeperId).catch(() => undefined);
  return { movedCounts };
}

/* ------------------------------- lists ------------------------------- */

export interface CrmList {
  id: string;
  name: string;
  createdBy: string;
  createdAt: string | null;
  memberCount: number;
}

export async function listLists(): Promise<CrmList[]> {
  await ensureCrmSchema();
  const db = sql();
  const rows = await db`
    SELECT l.id, l.name, l.created_by, l.created_at,
      (SELECT count(*)::int FROM directory.list_members m
        WHERE m.list_id = l.id) AS member_count
    FROM directory.lists l
    ORDER BY l.created_at DESC
    LIMIT 50`;
  return rows.map((r) => {
    const rec = r as Record<string, unknown>;
    return {
      id: str(rec.id),
      name: str(rec.name),
      createdBy: str(rec.created_by),
      createdAt: isoOrNull(rec.created_at),
      memberCount: num(rec.member_count),
    };
  });
}

export async function createList(name: string, actor = ""): Promise<CrmList> {
  await ensureCrmSchema();
  const trimmed = (name ?? "").trim();
  if (!trimmed) throw new Error("name is required");
  const db = sql();
  const id = `lst_${newId()}`;
  await db`
    INSERT INTO directory.lists (id, name, created_by)
    VALUES (${id}, ${trimmed}, ${actor})`;
  return { id, name: trimmed, createdBy: actor, createdAt: new Date().toISOString(), memberCount: 0 };
}

export async function addListMembers(
  listId: string,
  entityKind: string,
  entityIds: string[]
): Promise<{ added: number }> {
  await ensureCrmSchema();
  const kind = normKind(entityKind);
  if (!kind) throw new Error("entityKind must be 'person' or 'organization'");
  const db = sql();
  let added = 0;
  for (const entityId of entityIds) {
    const v = String(entityId ?? "").trim();
    if (!v) continue;
    const rows = await db`
      INSERT INTO directory.list_members (list_id, entity_kind, entity_id)
      VALUES (${listId}, ${kind}, ${v})
      ON CONFLICT (list_id, entity_kind, entity_id) DO NOTHING
      RETURNING entity_id`;
    added += rows.length;
  }
  return { added };
}

export interface CrmListMember {
  listId: string;
  entityKind: CrmEntityKind;
  entityId: string;
  name: string;
  createdAt: string | null;
}

export async function listListMembers(
  listId: string,
  opts: { limit?: number; offset?: number } = {}
): Promise<{ items: CrmListMember[]; total: number }> {
  await ensureCrmSchema();
  const db = sql();
  const limit = Math.min(50, Math.max(1, opts.limit || 25));
  const offset = Math.max(0, opts.offset || 0);
  const rows = await db`
    SELECT m.list_id, m.entity_kind, m.entity_id, m.created_at,
      coalesce(p.name, o.name, '') AS name
    FROM directory.list_members m
    LEFT JOIN core.people p
      ON m.entity_kind = 'person' AND p.id = m.entity_id
    LEFT JOIN core.organizations o
      ON m.entity_kind = 'organization' AND o.id = m.entity_id
    WHERE m.list_id = ${listId}
    ORDER BY name ASC
    LIMIT ${limit} OFFSET ${offset}`;
  const countRows = await db`
    SELECT count(*)::int AS n FROM directory.list_members WHERE list_id = ${listId}`;
  const items = rows.map((r) => {
    const rec = r as Record<string, unknown>;
    return {
      listId: str(rec.list_id),
      entityKind: normKind(rec.entity_kind) ?? "person",
      entityId: str(rec.entity_id),
      name: str(rec.name),
      createdAt: isoOrNull(rec.created_at),
    };
  });
  const total = countRows.length ? num((countRows[0] as Record<string, unknown>).n) : 0;
  return { items, total };
}

/* ----------------------------- templates ----------------------------- */

export interface InteractionTemplate {
  id: string;
  name: string;
  type: string;
  summary: string;
  outcome: string;
  createdBy: string;
  createdAt: string | null;
}

export async function listInteractionTemplates(): Promise<InteractionTemplate[]> {
  await ensureCrmSchema();
  const db = sql();
  const countRows = await db`
    SELECT count(*)::int AS n FROM directory.interaction_templates`;
  if (countRows.length && num((countRows[0] as Record<string, unknown>).n) === 0) {
    // Seed on first list when the table is empty (DESIGN.md).
    await db`
      INSERT INTO directory.interaction_templates (id, name, type, summary, outcome, created_by)
      VALUES (${`tpl_${newId()}`}, 'Intro call', 'call', '', 'none', 'system')
      ON CONFLICT (id) DO NOTHING`;
    await db`
      INSERT INTO directory.interaction_templates (id, name, type, summary, outcome, created_by)
      VALUES (${`tpl_${newId()}`}, 'Broker coffee', 'meeting', '', 'none', 'system')
      ON CONFLICT (id) DO NOTHING`;
  }
  const rows = await db`
    SELECT id, name, type, summary, outcome, created_by, created_at
    FROM directory.interaction_templates
    ORDER BY created_at ASC
    LIMIT 50`;
  return rows.map((r) => {
    const rec = r as Record<string, unknown>;
    return {
      id: str(rec.id),
      name: str(rec.name),
      type: str(rec.type),
      summary: str(rec.summary),
      outcome: str(rec.outcome),
      createdBy: str(rec.created_by),
      createdAt: isoOrNull(rec.created_at),
    };
  });
}

export async function createInteractionTemplate(input: {
  name?: string;
  type?: string;
  summary?: string;
  outcome?: string;
  createdBy?: string;
  actor?: string;
}): Promise<InteractionTemplate> {
  await ensureCrmSchema();
  const db = sql();
  const id = `tpl_${newId()}`;
  const name = (input.name ?? "").trim();
  if (!name) throw new Error("name is required");
  const type = (INTERACTION_TYPES as readonly string[]).includes(input.type ?? "")
    ? (input.type as string)
    : "note";
  const createdBy = input.createdBy ?? input.actor ?? "";
  await db`
    INSERT INTO directory.interaction_templates (id, name, type, summary, outcome, created_by)
    VALUES (${id}, ${name}, ${type}, ${(input.summary ?? "").trim()},
      ${(input.outcome ?? "none").trim() || "none"}, ${createdBy})`;
  const rows = await db`
    SELECT id, name, type, summary, outcome, created_by, created_at
    FROM directory.interaction_templates WHERE id = ${id} LIMIT 1`;
  const rec = (rows[0] ?? {}) as Record<string, unknown>;
  return {
    id: str(rec.id) || id,
    name: str(rec.name),
    type: str(rec.type),
    summary: str(rec.summary),
    outcome: str(rec.outcome),
    createdBy: str(rec.created_by),
    createdAt: isoOrNull(rec.created_at),
  };
}

/* ------------------------- migration + ensure ------------------------ */

export interface CrmMigrationDetail {
  legacyInteractionsSeen: number;
  legacyInteractionsMigrated: number;
  legacyParticipantsLinked: number;
  capitalProfilesSeeded: number;
  capitalProfilesSkipped: number;
  candidateProfilesSeeded: number;
  candidateProfilesSkipped: number;
  notes: string[];
}

/**
 * One-time migration (marker 'crm-phase1-v1' in core.migration_state,
 * detail = JSON of CrmMigrationDetail):
 *
 * 1. Legacy public.interactions → directory.interactions via
 *    legacy_id. Legacy columns (lib/db-postgres.ts ensureSchema +
 *    lib/types Interaction): id, deal_id, exec_id, kind, occurred_at
 *    (TEXT), summary, created_at. There is NO created_by / outcome /
 *    next-step column on the legacy table, so those take the new
 *    table's defaults (created_by ''). kind maps call/email/meeting/
 *    note straight across; anything else becomes 'note'. exec_id
 *    resolves to a participant person through
 *    core.people.legacy_exec_id (is_primary = true), and the person's
 *    organization_id fills organization_id. The legacy table is only
 *    read, never written.
 * 2. Relationship-profile last_touch_at seeding — ONLY for people
 *    with no migrated interactions:
 *    (a) capital investor profiles: lib/capital/service.ts
 *        listInvestors exposes InvestorListItem.personId +
 *        profile.lastTouchAt — used via dynamic import (service
 *        composition; a static import would cycle, since capital
 *        imports the directory service which imports this module).
 *    (b) operator candidates: lib/candidates-db.ts listCandidates
 *        exposes lastTouch + directoryExecId; directoryExecId is the
 *        legacy executives id, mapped through
 *        core.people.legacy_exec_id.
 *    Each source is best-effort try/catch; a failed source counts 0
 *    and records a note. This function NEVER throws.
 */
async function runCrmMigration(): Promise<CrmMigrationDetail> {
  const db = sql();
  const detail: CrmMigrationDetail = {
    legacyInteractionsSeen: 0,
    legacyInteractionsMigrated: 0,
    legacyParticipantsLinked: 0,
    capitalProfilesSeeded: 0,
    capitalProfilesSkipped: 0,
    candidateProfilesSeeded: 0,
    candidateProfilesSkipped: 0,
    notes: [],
  };

  /* ---- 1. legacy interactions ---- */
  let migratedPersonIds = new Set<string>();
  try {
    const existsRows = await db`
      SELECT to_regclass('public.interactions') AS reg`;
    const exists = Boolean((existsRows[0] as Record<string, unknown>)?.reg);
    if (!exists) {
      detail.notes.push("legacy public.interactions table not present; nothing to migrate");
    } else {
      const seenRows = await db`SELECT count(*)::int AS n FROM interactions`;
      detail.legacyInteractionsSeen = seenRows.length
        ? num((seenRows[0] as Record<string, unknown>).n)
        : 0;
      await db`
        INSERT INTO directory.interactions (
          id, type, direction, occurred_at, summary, outcome, next_step,
          visibility, owner, created_by, deal_id, legacy_id,
          created_at, updated_at
        )
        SELECT
          'legacy_' || li.id,
          CASE WHEN li.kind IN ('call', 'email', 'meeting', 'note')
            THEN li.kind ELSE 'note' END,
          'na',
          coalesce(
            nullif(li.occurred_at, '')::timestamptz,
            li.created_at,
            now()
          ),
          li.summary,
          'none',
          '',
          'shared',
          '',
          '',
          li.deal_id,
          li.id,
          li.created_at,
          li.created_at
        FROM interactions li
        ON CONFLICT (legacy_id) DO NOTHING`;
      const partRows = await db`
        INSERT INTO directory.interaction_participants (
          interaction_id, person_id, is_primary
        )
        SELECT i.id, p.id, true
        FROM directory.interactions i
        JOIN interactions li ON li.id = i.legacy_id
        JOIN core.people p
          ON p.legacy_exec_id = li.exec_id AND p.deleted_at IS NULL
        WHERE i.legacy_id IS NOT NULL AND li.exec_id IS NOT NULL
        ON CONFLICT (interaction_id, person_id) DO NOTHING
        RETURNING person_id`;
      detail.legacyParticipantsLinked = partRows.length;
      // Fill organization from the primary participant's org.
      await db`
        UPDATE directory.interactions i
        SET organization_id = p.organization_id
        FROM directory.interaction_participants ip
        JOIN core.people p ON p.id = ip.person_id
        WHERE ip.interaction_id = i.id AND ip.is_primary = true
          AND i.legacy_id IS NOT NULL
          AND i.organization_id IS NULL
          AND p.organization_id IS NOT NULL`;
      const migRows = await db`
        SELECT count(*)::int AS n FROM directory.interactions
        WHERE legacy_id IS NOT NULL`;
      detail.legacyInteractionsMigrated = migRows.length
        ? num((migRows[0] as Record<string, unknown>).n)
        : 0;
      const personRows = await db`
        SELECT DISTINCT person_id FROM directory.interaction_participants ip
        JOIN directory.interactions i ON i.id = ip.interaction_id
        WHERE i.legacy_id IS NOT NULL`;
      migratedPersonIds = new Set(
        personRows.map((r) => str((r as Record<string, unknown>).person_id))
      );
      // Bring the migrated people's summaries up to date.
      for (const personId of Array.from(migratedPersonIds)) {
        await recountEntitySummaries("person", personId).catch(() => undefined);
      }
    }
  } catch (err) {
    detail.notes.push(
      `legacy interactions migration failed: ${err instanceof Error ? err.message : String(err)}`
    );
    console.error("[crm] legacy interactions migration failed", err);
  }

  const seedLastTouch = async (
    personId: string,
    lastTouchAt: string
  ): Promise<boolean> => {
    if (!personId || !isIsoDateish(lastTouchAt)) return false;
    if (migratedPersonIds.has(personId)) return false;
    const when = new Date(lastTouchAt).toISOString();
    const rows = await db`
      INSERT INTO directory.relationship_profiles (
        entity_kind, entity_id, last_touch_at
      )
      VALUES ('person', ${personId}, ${when}::timestamptz)
      ON CONFLICT (entity_kind, entity_id) DO UPDATE SET
        last_touch_at = EXCLUDED.last_touch_at
      WHERE directory.relationship_profiles.last_touch_at IS NULL
      RETURNING entity_id`;
    if (!rows.length) return false;
    await recountEntitySummaries("person", personId).catch(() => undefined);
    // recount derives last_touch_at from interactions; a seeded
    // person has none, so re-apply the seed + due date after it.
    const profRows = await db`
      SELECT tier, cadence_days FROM directory.relationship_profiles
      WHERE entity_kind = 'person' AND entity_id = ${personId} LIMIT 1`;
    const prof = (profRows[0] ?? {}) as Record<string, unknown>;
    const cadence = effectiveCadenceDays(
      str(prof.tier),
      prof.cadence_days === null || prof.cadence_days === undefined
        ? null
        : num(prof.cadence_days)
    );
    const nextDue = new Date(
      new Date(when).getTime() + cadence * 86_400_000
    ).toISOString();
    await db`
      UPDATE directory.relationship_profiles SET
        last_touch_at = ${when}::timestamptz,
        next_touch_due = ${nextDue}::timestamptz,
        updated_at = now()
      WHERE entity_kind = 'person' AND entity_id = ${personId}`;
    return true;
  };

  /* ---- 2a. capital investor profiles ---- */
  try {
    const capital = await import("../capital/service");
    let offset = 0;
    for (;;) {
      const { items, total } = await capital.listInvestors({
        limit: 50,
        offset,
      });
      for (const item of items) {
        if (!item.profile.lastTouchAt) continue;
        const seeded = await seedLastTouch(item.personId, item.profile.lastTouchAt);
        if (seeded) detail.capitalProfilesSeeded++;
        else detail.capitalProfilesSkipped++;
      }
      offset += items.length;
      if (!items.length || offset >= total) break;
    }
  } catch (err) {
    detail.notes.push(
      `capital seeding skipped: ${err instanceof Error ? err.message : String(err)}`
    );
    console.error("[crm] capital profile seeding failed", err);
  }

  /* ---- 2b. operator candidates ---- */
  try {
    const candidates = await import("../candidates-db");
    const all = await candidates.listCandidates({});
    for (const cand of all) {
      if (!cand.lastTouch || !cand.directoryExecId) continue;
      const rows = await db`
        SELECT id FROM core.people
        WHERE legacy_exec_id = ${cand.directoryExecId} AND deleted_at IS NULL
        LIMIT 1`;
      if (!rows.length) {
        detail.candidateProfilesSkipped++;
        continue;
      }
      const personId = str((rows[0] as Record<string, unknown>).id);
      // candidate last_touch may be a plain date — normalize to ISO.
      const when = isIsoDateish(cand.lastTouch)
        ? new Date(cand.lastTouch).toISOString()
        : "";
      if (!when) {
        detail.candidateProfilesSkipped++;
        continue;
      }
      const seeded = await seedLastTouch(personId, when);
      if (seeded) detail.candidateProfilesSeeded++;
      else detail.candidateProfilesSkipped++;
    }
  } catch (err) {
    detail.notes.push(
      `candidate seeding skipped: ${err instanceof Error ? err.message : String(err)}`
    );
    console.error("[crm] candidate profile seeding failed", err);
  }

  return detail;
}

let crmReady: Promise<void> | null = null;
let lastMigrationCheckAt = 0;
const MIGRATION_CHECK_INTERVAL_MS = 60 * 60 * 1000;

/**
 * Schema + marker-guarded one-time migration. Cheap to call per
 * request (mirrors ensureDirectory's pattern): schema is
 * module-cached; after the marker lands, the marker check runs at
 * most once per hour per process. Migration failures never throw —
 * reads must not break because a seed source failed — and the marker
 * is only written after the migration completes, so a failed run
 * retries on a later process.
 */
export async function ensureCrm(): Promise<void> {
  if (!crmReady) {
    crmReady = (async () => {
      await ensureCrmSchema();
    })().catch((err) => {
      crmReady = null;
      throw err;
    });
  }
  await crmReady;

  if (Date.now() - lastMigrationCheckAt < MIGRATION_CHECK_INTERVAL_MS) return;
  try {
    const db = sql();
    const marker = await db`
      SELECT key FROM core.migration_state WHERE key = ${CRM_MIGRATION_KEY} LIMIT 1`;
    if (marker.length) {
      lastMigrationCheckAt = Date.now();
      return;
    }
    const detail = await runCrmMigration();
    await db`
      INSERT INTO core.migration_state (key, done_at, detail)
      VALUES (${CRM_MIGRATION_KEY}, now(), ${JSON.stringify(detail)})
      ON CONFLICT (key) DO NOTHING`;
    lastMigrationCheckAt = Date.now();
  } catch (err) {
    console.error("[crm] migration failed (will retry)", err);
  }
}

export async function getCrmMigrationStatus(): Promise<{
  done: boolean;
  detail: CrmMigrationDetail | null;
}> {
  await ensureCrmSchema();
  const db = sql();
  const rows = await db`
    SELECT detail FROM core.migration_state WHERE key = ${CRM_MIGRATION_KEY} LIMIT 1`;
  if (!rows.length) return { done: false, detail: null };
  const raw = str((rows[0] as Record<string, unknown>).detail);
  try {
    return { done: true, detail: JSON.parse(raw) as CrmMigrationDetail };
  } catch {
    return { done: true, detail: null };
  }
}

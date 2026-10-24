import { newId, normalizeName, num, sql, str, isoOrNull } from "../platform/db";
import { publishEvent } from "../platform/events";
import { logUsage } from "../platform/usage";
import {
  ensureDirectory,
  isDirectoryType,
  TYPE_TAXONOMY,
} from "./schema";

export { ensureDirectory, TYPE_TAXONOMY };
export type { DirectoryType } from "./schema";

/**
 * Directory service (Phase 2) — the only surface the directory API
 * routes call. Directory-specific state lives in the `directory`
 * schema; people / organizations themselves live in `core` (shared
 * reference data) and linked deals resolve to the legacy public.deals
 * company_name, following Phase 1's pattern in lib/platform/service.ts.
 */

export type DirectoryEntityKind = "person" | "organization";

export function normalizeEntityKind(raw: unknown): DirectoryEntityKind | null {
  const v = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (v === "person" || v === "people" || v === "persons") return "person";
  if (v === "organization" || v === "organizations" || v === "org" || v === "orgs")
    return "organization";
  return null;
}

/** Type tags as displayed everywhere downstream. Legacy "lp" tags
 * fold into "investor" (Ethan, Oct 23, 2026: the Directory only uses
 * "Investor"), and duplicates collapse. */
function normalizeTypes(tags: string[]): string[] {
  const out: string[] = [];
  for (const t of tags) {
    const id = t === "lp" ? "investor" : t;
    if (id && !out.includes(id)) out.push(id);
  }
  return out;
}

function parseTypes(v: unknown): string[] {
  if (Array.isArray(v))
    return normalizeTypes(v.map((t) => String(t)).filter(Boolean));
  if (typeof v === "string") {
    const s = v.trim();
    if (!s) return [];
    if (s.startsWith("{") && s.endsWith("}")) {
      return normalizeTypes(
        s
          .slice(1, -1)
          .split(",")
          .map((t) => t.trim().replace(/^"|"$/g, ""))
          .filter(Boolean)
      );
    }
    return normalizeTypes([s]);
  }
  return [];
}

function validTypes(input: unknown): string[] {
  const raw: string[] = Array.isArray(input)
    ? input.map((t) => String(t).trim().toLowerCase())
    : typeof input === "string"
      ? input
          .split(/[,;|]/)
          .map((t) => t.trim().toLowerCase())
          .filter(Boolean)
      : [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of raw) {
    if (isDirectoryType(t) && !seen.has(t)) {
      seen.add(t);
      out.push(t);
    }
  }
  return out;
}

const pickStr = (obj: Record<string, unknown>, ...keys: string[]): string => {
  for (const k of keys) {
    const v = obj[k];
    if (v !== undefined && v !== null) return String(v).trim();
  }
  return "";
};

/* ------------------------------- list -------------------------------- */

export interface DirectoryListItem {
  id: string;
  kind: DirectoryEntityKind;
  name: string;
  /** Person title; for organizations this carries the org's core kind. */
  title: string;
  kindLabel: string;
  types: string[];
  email: string;
  phone: string;
  photoUrl: string;
  organizationName: string;
  website: string;
  linkedDealCount: number;
  updatedAt: string | null;
}

export interface DirectoryListFilters {
  kind?: string;
  type?: string;
  q?: string;
  limit?: number;
  offset?: number;
}

export async function listDirectory(
  filters: DirectoryListFilters
): Promise<{ items: DirectoryListItem[]; total: number }> {
  await ensureDirectory();
  const db = sql();
  const kindParam = filters.kind ? normalizeEntityKind(filters.kind) ?? "" : "";
  const typeParam = (filters.type ?? "").trim().toLowerCase();
  const q = (filters.q ?? "").trim();
  const like = `%${q}%`;
  const limit = Math.min(50, Math.max(1, filters.limit || 25));
  const offset = Math.max(0, filters.offset || 0);

  const rows = await db`
    SELECT u.kind, u.id, u.name, u.title, u.core_kind, u.email, u.phone,
      u.photo_url, u.organization_name, u.website, u.updated_at,
      u.linked_deal_count, u.types
    FROM (
      SELECT 'person'::text AS kind, p.id, p.name, p.title,
        p.kind AS core_kind, p.email, p.phone, p.photo_url,
        p.organization_name, ''::text AS website, p.updated_at,
        (SELECT count(*)::int FROM core.deal_participants dp
          WHERE dp.entity_kind = 'person' AND dp.entity_id = p.id)
          AS linked_deal_count,
        (SELECT coalesce(array_agg(t.type ORDER BY t.type), ARRAY[]::text[])
          FROM directory.type_tags t
          WHERE t.entity_kind = 'person' AND t.entity_id = p.id) AS types
      FROM core.people p
      WHERE p.deleted_at IS NULL
        AND (${kindParam} = '' OR ${kindParam} = 'person')
        AND (${typeParam} = '' OR EXISTS (
          SELECT 1 FROM directory.type_tags ft
          WHERE ft.entity_kind = 'person' AND ft.entity_id = p.id
            AND (ft.type = ${typeParam} OR (${typeParam} = 'investor' AND ft.type = 'lp'))))
        AND (${q} = '' OR p.normalized_name ILIKE ${like}
          OR p.name ILIKE ${like} OR p.email ILIKE ${like}
          OR p.search_vector @@ plainto_tsquery('english', ${q}))
      UNION ALL
      SELECT 'organization'::text AS kind, o.id, o.name, ''::text AS title,
        o.kind AS core_kind, ''::text AS email, ''::text AS phone,
        ''::text AS photo_url, ''::text AS organization_name, o.website,
        o.updated_at,
        (SELECT count(*)::int FROM core.deal_participants dp
          WHERE dp.entity_kind = 'organization' AND dp.entity_id = o.id)
          AS linked_deal_count,
        (SELECT coalesce(array_agg(t.type ORDER BY t.type), ARRAY[]::text[])
          FROM directory.type_tags t
          WHERE t.entity_kind = 'organization' AND t.entity_id = o.id) AS types
      FROM core.organizations o
      WHERE o.deleted_at IS NULL
        AND (${kindParam} = '' OR ${kindParam} = 'organization')
        AND (${typeParam} = '' OR EXISTS (
          SELECT 1 FROM directory.type_tags ft
          WHERE ft.entity_kind = 'organization' AND ft.entity_id = o.id
            AND (ft.type = ${typeParam} OR (${typeParam} = 'investor' AND ft.type = 'lp'))))
        AND (${q} = '' OR o.normalized_name ILIKE ${like}
          OR o.name ILIKE ${like} OR o.website ILIKE ${like})
    ) u
    ORDER BY u.updated_at DESC, u.name ASC
    LIMIT ${limit} OFFSET ${offset}`;

  const items: DirectoryListItem[] = rows.map((r) => {
    const rec = r as Record<string, unknown>;
    const kind = normalizeEntityKind(rec.kind) ?? "person";
    return {
      id: str(rec.id),
      kind,
      name: str(rec.name),
      title: kind === "person" ? str(rec.title) : str(rec.core_kind),
      kindLabel: str(rec.core_kind),
      types: parseTypes(rec.types),
      email: str(rec.email),
      phone: str(rec.phone),
      photoUrl: str(rec.photo_url),
      organizationName: str(rec.organization_name),
      website: str(rec.website),
      linkedDealCount: num(rec.linked_deal_count),
      updatedAt: isoOrNull(rec.updated_at),
    };
  });

  const countRows = await db`
    SELECT (
      (SELECT count(*)::int FROM core.people p
        WHERE p.deleted_at IS NULL
          AND (${kindParam} = '' OR ${kindParam} = 'person')
          AND (${typeParam} = '' OR EXISTS (
            SELECT 1 FROM directory.type_tags ft
            WHERE ft.entity_kind = 'person' AND ft.entity_id = p.id
              AND (ft.type = ${typeParam} OR (${typeParam} = 'investor' AND ft.type = 'lp'))))
          AND (${q} = '' OR p.normalized_name ILIKE ${like}
            OR p.name ILIKE ${like} OR p.email ILIKE ${like}
            OR p.search_vector @@ plainto_tsquery('english', ${q})))
      +
      (SELECT count(*)::int FROM core.organizations o
        WHERE o.deleted_at IS NULL
          AND (${kindParam} = '' OR ${kindParam} = 'organization')
          AND (${typeParam} = '' OR EXISTS (
            SELECT 1 FROM directory.type_tags ft
            WHERE ft.entity_kind = 'organization' AND ft.entity_id = o.id
              AND (ft.type = ${typeParam} OR (${typeParam} = 'investor' AND ft.type = 'lp'))))
          AND (${q} = '' OR o.normalized_name ILIKE ${like}
            OR o.name ILIKE ${like} OR o.website ILIKE ${like}))
    ) AS n`;
  const total = countRows.length ? num((countRows[0] as Record<string, unknown>).n) : 0;
  logUsage("directory_list", items.length, JSON.stringify(items).length);
  return { items, total };
}

/* ------------------------------ detail ------------------------------- */

export interface DirectoryLinkedDeal {
  dealId: string;
  dealName: string;
  role: string;
  status: string;
}

export interface LegacyInvestorInfo {
  id: string;
  firm: string;
  website: string;
  investmentType: string;
  industry: string;
  /** Alias of `industry` — the sheet's "industry focus" column. */
  industryFocus: string;
  ebitdaSize: string;
  checkSize: string;
  status: string;
}

export interface DirectoryDetail {
  record: Record<string, unknown>;
  types: string[];
  linkedDeals: DirectoryLinkedDeal[];
  legacyInvestor: LegacyInvestorInfo | null;
}

async function getTypes(
  entityKind: DirectoryEntityKind,
  entityId: string
): Promise<string[]> {
  const db = sql();
  const rows = await db`
    SELECT type FROM directory.type_tags
    WHERE entity_kind = ${entityKind} AND entity_id = ${entityId}
    ORDER BY type ASC`;
  return rows.map((r) => str((r as Record<string, unknown>).type)).filter(Boolean);
}

async function getLinkedDeals(
  entityKind: DirectoryEntityKind,
  entityId: string
): Promise<DirectoryLinkedDeal[]> {
  const db = sql();
  const rows = await db`
    SELECT dp.deal_id, dp.role, dp.status,
      coalesce(ld.company_name, '') AS deal_name
    FROM core.deal_participants dp
    LEFT JOIN deals ld ON ld.id = dp.deal_id
    WHERE dp.entity_kind = ${entityKind} AND dp.entity_id = ${entityId}
    ORDER BY dp.created_at ASC
    LIMIT 100`;
  return rows.map((r) => {
    const rec = r as Record<string, unknown>;
    return {
      dealId: str(rec.deal_id),
      dealName: str(rec.deal_name),
      role: str(rec.role),
      status: str(rec.status),
    };
  });
}

export async function getDirectoryDetail(
  kindRaw: string,
  id: string
): Promise<DirectoryDetail | null> {
  await ensureDirectory();
  const kind = normalizeEntityKind(kindRaw);
  if (!kind || !id) return null;
  const db = sql();

  if (kind === "person") {
    const rows = await db`
      SELECT id, legacy_exec_id, legacy_investor_id, legacy_contact_id,
        name, title, email, phone, organization_id, organization_name,
        kind, notes, photo_url, source, created_at, updated_at
      FROM core.people
      WHERE id = ${id} AND deleted_at IS NULL
      LIMIT 1`;
    if (!rows.length) return null;
    const rec = rows[0] as Record<string, unknown>;
    const record: Record<string, unknown> = {
      id: str(rec.id),
      entityKind: "person",
      kind: "person",
      name: str(rec.name),
      title: str(rec.title),
      email: str(rec.email),
      phone: str(rec.phone),
      organizationId: rec.organization_id ? str(rec.organization_id) : null,
      organizationName: str(rec.organization_name),
      coreKind: str(rec.kind),
      type: str(rec.kind),
      notes: str(rec.notes),
      photoUrl: str(rec.photo_url),
      source: str(rec.source),
      legacyExecId: rec.legacy_exec_id ? str(rec.legacy_exec_id) : null,
      legacyInvestorId: rec.legacy_investor_id ? str(rec.legacy_investor_id) : null,
      legacyContactId: rec.legacy_contact_id ? str(rec.legacy_contact_id) : null,
      createdAt: isoOrNull(rec.created_at),
      updatedAt: isoOrNull(rec.updated_at),
    };
    let legacyInvestor: LegacyInvestorInfo | null = null;
    const legacyInvestorId = rec.legacy_investor_id
      ? str(rec.legacy_investor_id)
      : "";
    if (legacyInvestorId) {
      try {
        const invRows = await db`
          SELECT id, firm, website, investment_type, industry,
            ebitda_size, check_size, status
          FROM investors
          WHERE id = ${legacyInvestorId}
          LIMIT 1`;
        if (invRows.length) {
          const inv = invRows[0] as Record<string, unknown>;
          legacyInvestor = {
            id: str(inv.id),
            firm: str(inv.firm),
            website: str(inv.website),
            investmentType: str(inv.investment_type),
            industry: str(inv.industry),
            industryFocus: str(inv.industry),
            ebitdaSize: str(inv.ebitda_size),
            checkSize: str(inv.check_size),
            status: str(inv.status),
          };
        }
      } catch (err) {
        console.error("[directory] legacy investor lookup failed", err);
      }
    }
    const [types, linkedDeals] = await Promise.all([
      getTypes("person", id),
      getLinkedDeals("person", id),
    ]);
    logUsage("directory_detail", 1 + linkedDeals.length, 0);
    return { record, types, linkedDeals, legacyInvestor };
  }

  const rows = await db`
    SELECT id, name, kind, website, notes, source, created_at, updated_at
    FROM core.organizations
    WHERE id = ${id} AND deleted_at IS NULL
    LIMIT 1`;
  if (!rows.length) return null;
  const rec = rows[0] as Record<string, unknown>;
  const record: Record<string, unknown> = {
    id: str(rec.id),
    entityKind: "organization",
    kind: "organization",
    name: str(rec.name),
    title: str(rec.kind),
    email: "",
    phone: "",
    organizationName: str(rec.name),
    coreKind: str(rec.kind),
    type: str(rec.kind),
    website: str(rec.website),
    notes: str(rec.notes),
    photoUrl: "",
    source: str(rec.source),
    legacyExecId: null,
    legacyInvestorId: null,
    legacyContactId: null,
    createdAt: isoOrNull(rec.created_at),
    updatedAt: isoOrNull(rec.updated_at),
  };
  const [types, linkedDeals] = await Promise.all([
    getTypes("organization", id),
    getLinkedDeals("organization", id),
  ]);
  logUsage("directory_detail", 1 + linkedDeals.length, 0);
  return { record, types, linkedDeals, legacyInvestor: null };
}

/* ------------------------------ create ------------------------------- */

export interface CreateRecordInput {
  kind: string;
  name: string;
  title?: string;
  email?: string;
  phone?: string;
  organizationName?: string;
  organization_name?: string;
  organizationId?: string;
  website?: string;
  notes?: string;
  photoUrl?: string;
  types?: string[] | string;
  actor?: string;
  source?: string;
}

async function resolveOrganization(
  organizationName: string,
  organizationId?: string
): Promise<{ id: string | null; name: string }> {
  if (organizationId) return { id: organizationId, name: organizationName };
  if (!organizationName) return { id: null, name: "" };
  const db = sql();
  const rows = await db`
    SELECT id, name FROM core.organizations
    WHERE normalized_name = ${normalizeName(organizationName)}
      AND deleted_at IS NULL
    LIMIT 1`;
  if (rows.length) {
    const rec = rows[0] as Record<string, unknown>;
    return { id: str(rec.id), name: str(rec.name) || organizationName };
  }
  return { id: null, name: organizationName };
}

async function insertTypeTags(
  entityKind: DirectoryEntityKind,
  entityId: string,
  types: string[]
): Promise<void> {
  const db = sql();
  for (const t of types) {
    await db`
      INSERT INTO directory.type_tags (entity_kind, entity_id, type)
      VALUES (${entityKind}, ${entityId}, ${t})
      ON CONFLICT (entity_kind, entity_id, type) DO NOTHING`;
  }
}

export async function createRecord(
  input: CreateRecordInput
): Promise<Record<string, unknown>> {
  await ensureDirectory();
  const kind = normalizeEntityKind(input.kind);
  if (!kind) throw new Error("kind must be 'person' or 'organization'");
  const name = (input.name ?? "").trim();
  if (!name) throw new Error("name is required");
  const actor = input.actor ?? "";
  const source = (input.source ?? "manual").trim() || "manual";
  const types = validTypes(input.types);
  const db = sql();

  if (kind === "person") {
    const orgInput = input.organizationName ?? input.organization_name ?? "";
    const org = await resolveOrganization(orgInput.trim(), input.organizationId);
    const coreKind = types.includes("operator")
      ? "operator"
      : types.includes("investor")
        ? "investor"
        : "contact";
    const id = `pe_${newId()}`;
    const title = (input.title ?? "").trim();
    const email = (input.email ?? "").trim();
    const searchText = [name, title, email, org.name].filter(Boolean).join(" ");
    await db`
      INSERT INTO core.people (
        id, name, normalized_name, title, email, phone,
        organization_id, organization_name, kind, notes, photo_url,
        source, search_vector
      )
      VALUES (
        ${id}, ${name}, ${normalizeName(name)}, ${title}, ${email},
        ${(input.phone ?? "").trim()}, ${org.id}, ${org.name},
        ${coreKind}, ${(input.notes ?? "").trim()},
        ${(input.photoUrl ?? "").trim()}, ${source},
        to_tsvector('english', ${searchText})
      )`;
    const effectiveTypes = types.length ? types : [coreKind];
    await insertTypeTags("person", id, effectiveTypes);
    await publishEvent("contact_updated", {
      entityKind: "person",
      entityId: id,
      payload: { action: "create", types: effectiveTypes },
      actor,
    });
    const detail = await getDirectoryDetail("person", id);
    return detail
      ? { ...detail.record, types: detail.types }
      : { id, entityKind: "person", kind: "person", name, types: effectiveTypes };
  }

  // organization
  const normalized = normalizeName(name);
  const existing = await db`
    SELECT id, deleted_at FROM core.organizations
    WHERE normalized_name = ${normalized}
    LIMIT 1`;
  if (existing.length) {
    const rec = existing[0] as Record<string, unknown>;
    const existingId = str(rec.id);
    if (rec.deleted_at) {
      await db`
        UPDATE core.organizations
        SET deleted_at = NULL, updated_at = now()
        WHERE id = ${existingId}`;
    }
    const effectiveTypes = types.length ? types : ["contact"];
    await insertTypeTags("organization", existingId, effectiveTypes);
    await publishEvent("contact_updated", {
      entityKind: "organization",
      entityId: existingId,
      payload: { action: "create", existing: true, types: effectiveTypes },
      actor,
    });
    const detail = await getDirectoryDetail("organization", existingId);
    return detail
      ? { ...detail.record, types: detail.types }
      : { id: existingId, entityKind: "organization", kind: "organization", name, types: effectiveTypes };
  }

  const coreKind = types.length ? types[0] : "contact";
  const id = `org_${newId()}`;
  await db`
    INSERT INTO core.organizations (
      id, name, normalized_name, kind, website, notes, source
    )
    VALUES (
      ${id}, ${name}, ${normalized}, ${coreKind},
      ${(input.website ?? "").trim()}, ${(input.notes ?? "").trim()}, ${source}
    )`;
  const effectiveTypes = types.length ? types : [coreKind];
  await insertTypeTags("organization", id, effectiveTypes);
  await publishEvent("contact_updated", {
    entityKind: "organization",
    entityId: id,
    payload: { action: "create", types: effectiveTypes },
    actor,
  });
  const detail = await getDirectoryDetail("organization", id);
  return detail
    ? { ...detail.record, types: detail.types }
    : { id, entityKind: "organization", kind: "organization", name, types: effectiveTypes };
}

/* ---------------------------- type tags ------------------------------ */

export async function setTypeTag(input: {
  entityKind?: string;
  entity_kind?: string;
  kind?: string;
  entityId?: string;
  entity_id?: string;
  id?: string;
  type: string;
  action: "add" | "remove";
  actor?: string;
}): Promise<{ ok: boolean; error?: string }> {
  await ensureDirectory();
  const entityKind = normalizeEntityKind(
    input.entityKind ?? input.entity_kind ?? input.kind ?? ""
  );
  const entityId = (input.entityId ?? input.entity_id ?? input.id ?? "").trim();
  const type = (input.type ?? "").trim().toLowerCase();
  if (!entityKind) return { ok: false, error: "entityKind must be 'person' or 'organization'" };
  if (!entityId) return { ok: false, error: "entityId is required" };
  if (!isDirectoryType(type))
    return { ok: false, error: `type must be one of: ${TYPE_TAXONOMY.join(", ")}` };
  if (input.action !== "add" && input.action !== "remove")
    return { ok: false, error: "action must be 'add' or 'remove'" };
  const db = sql();
  if (input.action === "add") {
    await db`
      INSERT INTO directory.type_tags (entity_kind, entity_id, type)
      VALUES (${entityKind}, ${entityId}, ${type})
      ON CONFLICT (entity_kind, entity_id, type) DO NOTHING`;
  } else {
    await db`
      DELETE FROM directory.type_tags
      WHERE entity_kind = ${entityKind} AND entity_id = ${entityId}
        AND type = ${type}`;
  }
  await publishEvent("contact_updated", {
    entityKind,
    entityId,
    payload: { action: `type_${input.action}`, type },
    actor: input.actor ?? "",
  });
  return { ok: true };
}

/* ------------------------------ update ------------------------------- */

export async function updateRecord(
  kindRaw: string,
  id: string,
  patch: Record<string, unknown>,
  actor = ""
): Promise<Record<string, unknown> | null> {
  await ensureDirectory();
  const kind = normalizeEntityKind(kindRaw);
  if (!kind || !id) return null;
  const detail = await getDirectoryDetail(kind, id);
  if (!detail) return null;
  const cur = detail.record;
  const db = sql();
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  const apply = (field: string, from: unknown, to: unknown) => {
    if (String(from ?? "") !== String(to ?? "")) {
      changes[field] = { from: from ?? "", to: to ?? "" };
    }
  };

  if (kind === "person") {
    const name = patch.name !== undefined ? String(patch.name).trim() : str(cur.name);
    if (!name) throw new Error("name cannot be empty");
    const title = patch.title !== undefined ? String(patch.title).trim() : str(cur.title);
    const email = patch.email !== undefined ? String(patch.email).trim() : str(cur.email);
    const phone = patch.phone !== undefined ? String(patch.phone).trim() : str(cur.phone);
    const notes = patch.notes !== undefined ? String(patch.notes) : str(cur.notes);
    const photoUrl =
      patch.photoUrl !== undefined
        ? String(patch.photoUrl).trim()
        : patch.photo_url !== undefined
          ? String(patch.photo_url).trim()
          : str(cur.photoUrl);
    const coreKindRaw =
      patch.coreKind !== undefined
        ? String(patch.coreKind)
        : patch.core_kind !== undefined
          ? String(patch.core_kind)
          : str(cur.coreKind);
    const coreKind = ["operator", "investor", "contact"].includes(coreKindRaw)
      ? coreKindRaw
      : str(cur.coreKind) || "contact";
    let orgId = cur.organizationId ? str(cur.organizationId) : null;
    let orgName = str(cur.organizationName);
    const patchOrgName = patch.organizationName ?? patch.organization_name;
    if (patch.organizationId !== undefined) {
      orgId = patch.organizationId ? String(patch.organizationId) : null;
    }
    if (patchOrgName !== undefined) {
      const resolved = await resolveOrganization(
        String(patchOrgName).trim(),
        patch.organizationId ? String(patch.organizationId) : undefined
      );
      orgId = resolved.id;
      orgName = resolved.name;
    }
    apply("name", cur.name, name);
    apply("title", cur.title, title);
    apply("email", cur.email, email);
    apply("phone", cur.phone, phone);
    apply("notes", cur.notes, notes);
    apply("photoUrl", cur.photoUrl, photoUrl);
    apply("organizationName", cur.organizationName, orgName);
    apply("coreKind", cur.coreKind, coreKind);
    const searchText = [name, title, email, orgName].filter(Boolean).join(" ");
    await db`
      UPDATE core.people SET
        name = ${name},
        normalized_name = ${normalizeName(name)},
        title = ${title},
        email = ${email},
        phone = ${phone},
        organization_id = ${orgId},
        organization_name = ${orgName},
        kind = ${coreKind},
        notes = ${notes},
        photo_url = ${photoUrl},
        search_vector = to_tsvector('english', ${searchText}),
        updated_at = now()
      WHERE id = ${id} AND deleted_at IS NULL`;
  } else {
    const name = patch.name !== undefined ? String(patch.name).trim() : str(cur.name);
    if (!name) throw new Error("name cannot be empty");
    const website =
      patch.website !== undefined ? String(patch.website).trim() : str(cur.website);
    const notes = patch.notes !== undefined ? String(patch.notes) : str(cur.notes);
    const coreKindRaw =
      patch.coreKind !== undefined
        ? String(patch.coreKind)
        : patch.core_kind !== undefined
          ? String(patch.core_kind)
          : patch.kind !== undefined && patch.kind !== "organization"
            ? String(patch.kind)
            : str(cur.coreKind);
    const coreKind = coreKindRaw || str(cur.coreKind);
    apply("name", cur.name, name);
    apply("website", cur.website, website);
    apply("notes", cur.notes, notes);
    apply("coreKind", cur.coreKind, coreKind);
    await db`
      UPDATE core.organizations SET
        name = ${name},
        normalized_name = ${normalizeName(name)},
        kind = ${coreKind},
        website = ${website},
        notes = ${notes},
        updated_at = now()
      WHERE id = ${id} AND deleted_at IS NULL`;
  }

  if (Object.keys(changes).length) {
    await db`
      INSERT INTO core.audit_log (entity_kind, entity_id, actor, action, changes)
      VALUES (${kind}, ${id}, ${actor}, 'update',
        ${JSON.stringify(changes)}::jsonb)`;
  }
  await publishEvent("contact_updated", {
    entityKind: kind,
    entityId: id,
    payload: { action: "update", changes: Object.keys(changes) },
    actor,
  });
  const updated = await getDirectoryDetail(kind, id);
  return updated ? { ...updated.record, types: updated.types } : null;
}

/* ------------------------------ import ------------------------------- */

export interface ImportDuplicate {
  row: Record<string, string>;
  rowIndex: number;
  matchId: string;
  matchName: string;
}

export interface ImportError {
  row: Record<string, string>;
  rowIndex: number;
  error: string;
}

/**
 * Duplicate criteria mirror lib/platform/dedupe.ts findDuplicates for
 * people: same normalized name OR same (case-insensitive) email.
 * Organizations dedupe on normalized name (their unique index).
 */
async function findImportDuplicate(
  kind: DirectoryEntityKind,
  name: string,
  email: string
): Promise<{ id: string; name: string } | null> {
  const db = sql();
  const normalized = normalizeName(name);
  if (kind === "person") {
    const rows = await db`
      SELECT id, name FROM core.people
      WHERE deleted_at IS NULL
        AND (
          (${normalized} <> '' AND normalized_name = ${normalized})
          OR (${email} <> '' AND lower(email) = lower(${email}))
        )
      LIMIT 1`;
    if (!rows.length) return null;
    const rec = rows[0] as Record<string, unknown>;
    return { id: str(rec.id), name: str(rec.name) };
  }
  const rows = await db`
    SELECT id, name FROM core.organizations
    WHERE deleted_at IS NULL AND normalized_name = ${normalized}
      AND ${normalized} <> ''
    LIMIT 1`;
  if (!rows.length) return null;
  const rec = rows[0] as Record<string, unknown>;
  return { id: str(rec.id), name: str(rec.name) };
}

export async function importRows(input: {
  rows: Record<string, string>[];
  mapping: Record<string, string>;
  kind: string;
  actor?: string;
}): Promise<{
  created: number;
  duplicates: ImportDuplicate[];
  errors: ImportError[];
  total: number;
}> {
  await ensureDirectory();
  const kind = normalizeEntityKind(input.kind);
  if (!kind) throw new Error("kind must be 'person' or 'organization'");
  const rows = Array.isArray(input.rows) ? input.rows : [];
  const mapping = input.mapping ?? {};
  let created = 0;
  const duplicates: ImportDuplicate[] = [];
  const errors: ImportError[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] ?? {};
    try {
      const fields: Record<string, string> = {};
      for (const [target, source] of Object.entries(mapping)) {
        if (source && row[source] !== undefined) fields[target] = String(row[source]);
      }
      // Tolerate unmapped sheets that already use target field names.
      for (const target of Object.keys(mapping)) {
        if (!fields[target] && row[target] !== undefined) fields[target] = String(row[target]);
      }
      const name = (fields.name ?? "").trim();
      if (!name) {
        errors.push({ row, rowIndex: i, error: "name is required" });
        continue;
      }
      const email = (fields.email ?? "").trim();
      const organizationName =
        fields.organizationName ?? fields.organization_name ?? fields.organization ?? fields.firm ?? "";
      const typesRaw = fields.types ?? fields.type ?? "";
      const match = await findImportDuplicate(kind, name, email);
      const force = String(row.__force ?? "") === "1";
      if (match && !force) {
        duplicates.push({ row, rowIndex: i, matchId: match.id, matchName: match.name });
        continue;
      }
      if (match && force && kind === "organization") {
        // Organizations cannot duplicate on normalized_name (unique
        // index); a forced org row re-uses the existing record.
        duplicates.push({ row, rowIndex: i, matchId: match.id, matchName: match.name });
        continue;
      }
      await createRecord({
        kind,
        name,
        title: fields.title,
        email,
        phone: fields.phone,
        organizationName,
        website: fields.website,
        notes: fields.notes,
        types: typesRaw ? validTypes(typesRaw) : undefined,
        actor: input.actor ?? "",
        source: "import",
      });
      created++;
    } catch (err) {
      errors.push({
        row,
        rowIndex: i,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  logUsage("directory_import", created, 0);
  return { created, duplicates, errors, total: rows.length };
}

/* ----------------------------- templates ----------------------------- */

export interface EmailTemplate {
  id: string;
  name: string;
  subject: string;
  body: string;
  createdBy: string;
  createdAt: string | null;
  updatedAt: string | null;
}

export async function listTemplates(limit = 50): Promise<EmailTemplate[]> {
  await ensureDirectory();
  const db = sql();
  const lim = Math.min(50, Math.max(1, limit || 50));
  const rows = await db`
    SELECT id, name, subject, body, created_by, created_at, updated_at
    FROM directory.email_templates
    WHERE deleted_at IS NULL
    ORDER BY updated_at DESC
    LIMIT ${lim}`;
  const out = rows.map((r) => {
    const rec = r as Record<string, unknown>;
    return {
      id: str(rec.id),
      name: str(rec.name),
      subject: str(rec.subject),
      body: str(rec.body),
      createdBy: str(rec.created_by),
      createdAt: isoOrNull(rec.created_at),
      updatedAt: isoOrNull(rec.updated_at),
    };
  });
  logUsage("directory_templates_list", out.length, JSON.stringify(out).length);
  return out;
}

export async function createTemplate(input: {
  name?: string;
  subject?: string;
  body?: string;
  createdBy?: string;
  actor?: string;
}): Promise<EmailTemplate> {
  await ensureDirectory();
  const db = sql();
  const id = `tpl_${newId()}`;
  const createdBy = input.createdBy ?? input.actor ?? "";
  await db`
    INSERT INTO directory.email_templates (id, name, subject, body, created_by)
    VALUES (${id}, ${(input.name ?? "").trim()}, ${(input.subject ?? "").trim()},
      ${input.body ?? ""}, ${createdBy})`;
  const rows = await db`
    SELECT id, name, subject, body, created_by, created_at, updated_at
    FROM directory.email_templates WHERE id = ${id} LIMIT 1`;
  const rec = (rows[0] ?? {}) as Record<string, unknown>;
  return {
    id: str(rec.id) || id,
    name: str(rec.name),
    subject: str(rec.subject),
    body: str(rec.body),
    createdBy: str(rec.created_by),
    createdAt: isoOrNull(rec.created_at),
    updatedAt: isoOrNull(rec.updated_at),
  };
}

export async function deleteTemplate(id: string): Promise<boolean> {
  await ensureDirectory();
  const db = sql();
  const rows = await db`
    UPDATE directory.email_templates
    SET deleted_at = now(), updated_at = now()
    WHERE id = ${id} AND deleted_at IS NULL
    RETURNING id`;
  return rows.length > 0;
}

/**
 * Soft-delete a Directory record (Phase 8, Item 0): stamps deleted_at
 * on the core.people / core.organizations row, writes an audit entry
 * the same way updateRecord does, and publishes contact_updated.
 * Returns false when the record does not exist (or is already deleted).
 */
export async function deleteRecord(
  kind: "person" | "organization",
  id: string,
  actor = ""
): Promise<boolean> {
  await ensureDirectory();
  if (!id) return false;
  const db = sql();
  const rows =
    kind === "person"
      ? await db`
          UPDATE core.people
          SET deleted_at = now(), updated_at = now()
          WHERE id = ${id} AND deleted_at IS NULL
          RETURNING id`
      : await db`
          UPDATE core.organizations
          SET deleted_at = now(), updated_at = now()
          WHERE id = ${id} AND deleted_at IS NULL
          RETURNING id`;
  if (!rows.length) return false;
  await db`
    INSERT INTO core.audit_log (entity_kind, entity_id, actor, action, changes)
    VALUES (${kind}, ${id}, ${actor}, 'delete',
      ${JSON.stringify({ deleted_at: { from: null, to: "soft-deleted" } })}::jsonb)`;
  await publishEvent("contact_updated", {
    entityKind: kind,
    entityId: id,
    payload: { action: "delete" },
    actor,
  });
  return true;
}

/* ---------------------------- email links ---------------------------- */

export interface EmailLink {
  id: string;
  emailRef: string;
  subject: string;
  fromAddr: string;
  emailDate: string;
  personId: string | null;
  organizationId: string | null;
  companyId: string | null;
  note: string;
  createdBy: string;
  createdAt: string | null;
}

export async function listEmailLinks(filters: {
  personId?: string;
  organizationId?: string;
  companyId?: string;
  limit?: number;
  offset?: number;
}): Promise<{ items: EmailLink[]; total: number }> {
  await ensureDirectory();
  const db = sql();
  const personId = filters.personId ?? "";
  const organizationId = filters.organizationId ?? "";
  const companyId = filters.companyId ?? "";
  const limit = Math.min(50, Math.max(1, filters.limit || 25));
  const offset = Math.max(0, filters.offset || 0);
  const rows = await db`
    SELECT id, email_ref, subject, from_addr, email_date, person_id,
      organization_id, company_id, note, created_by, created_at
    FROM directory.email_links
    WHERE (${personId} = '' OR person_id = ${personId})
      AND (${organizationId} = '' OR organization_id = ${organizationId})
      AND (${companyId} = '' OR company_id = ${companyId})
    ORDER BY created_at DESC
    LIMIT ${limit} OFFSET ${offset}`;
  const items: EmailLink[] = rows.map((r) => {
    const rec = r as Record<string, unknown>;
    return {
      id: str(rec.id),
      emailRef: str(rec.email_ref),
      subject: str(rec.subject),
      fromAddr: str(rec.from_addr),
      emailDate: str(rec.email_date),
      personId: rec.person_id ? str(rec.person_id) : null,
      organizationId: rec.organization_id ? str(rec.organization_id) : null,
      companyId: rec.company_id ? str(rec.company_id) : null,
      note: str(rec.note),
      createdBy: str(rec.created_by),
      createdAt: isoOrNull(rec.created_at),
    };
  });
  const countRows = await db`
    SELECT count(*)::int AS n FROM directory.email_links
    WHERE (${personId} = '' OR person_id = ${personId})
      AND (${organizationId} = '' OR organization_id = ${organizationId})
      AND (${companyId} = '' OR company_id = ${companyId})`;
  const total = countRows.length ? num((countRows[0] as Record<string, unknown>).n) : 0;
  logUsage("directory_email_links_list", items.length, JSON.stringify(items).length);
  return { items, total };
}

export async function createEmailLink(
  input: Record<string, unknown>
): Promise<EmailLink> {
  await ensureDirectory();
  const db = sql();
  const id = `eml_${newId()}`;
  const emailRef = pickStr(input, "emailRef", "email_ref", "ref");
  const subject = pickStr(input, "subject");
  const fromAddr = pickStr(input, "fromAddr", "from_addr", "from");
  const emailDate = pickStr(input, "emailDate", "email_date", "date");
  const personId = pickStr(input, "personId", "person_id") || null;
  const organizationId =
    pickStr(input, "organizationId", "organization_id") || null;
  const companyId = pickStr(input, "companyId", "company_id") || null;
  const note = pickStr(input, "note");
  const createdBy = pickStr(input, "createdBy", "created_by", "actor");
  await db`
    INSERT INTO directory.email_links (
      id, email_ref, subject, from_addr, email_date, person_id,
      organization_id, company_id, note, created_by
    )
    VALUES (${id}, ${emailRef}, ${subject}, ${fromAddr}, ${emailDate},
      ${personId}, ${organizationId}, ${companyId}, ${note}, ${createdBy})`;
  const rows = await db`
    SELECT id, email_ref, subject, from_addr, email_date, person_id,
      organization_id, company_id, note, created_by, created_at
    FROM directory.email_links WHERE id = ${id} LIMIT 1`;
  const rec = (rows[0] ?? {}) as Record<string, unknown>;
  const out: EmailLink = {
    id: str(rec.id) || id,
    emailRef: str(rec.email_ref),
    subject: str(rec.subject),
    fromAddr: str(rec.from_addr),
    emailDate: str(rec.email_date),
    personId: rec.person_id ? str(rec.person_id) : null,
    organizationId: rec.organization_id ? str(rec.organization_id) : null,
    companyId: rec.company_id ? str(rec.company_id) : null,
    note: str(rec.note),
    createdBy: str(rec.created_by),
    createdAt: isoOrNull(rec.created_at),
  };
  if (out.personId || out.organizationId) {
    await publishEvent("contact_updated", {
      entityKind: out.personId ? "person" : "organization",
      entityId: out.personId ?? out.organizationId ?? "",
      payload: { action: "email_link_created", emailLinkId: id },
      actor: createdBy,
    });
  }
  return out;
}

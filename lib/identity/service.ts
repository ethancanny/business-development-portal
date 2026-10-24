import { sql, str, num, isoOrNull } from "../platform/db";
import { cacheInvalidate } from "../platform/cache";
import { getStorageProvider } from "../storage";
import { ensureIdentitySchema } from "./schema";
import { processLogo, type ProcessedLogo } from "./logo";
import {
  logoKeyPrefix,
  normalizeHex,
  type IdentityInput,
} from "./shared";

/**
 * Deal Identity service — the single server surface for company/deal
 * identity (logos, accent color, codenames, recent deals). All reads
 * and writes for identity go through here; other modules call this
 * service rather than reaching into identity columns themselves
 * (PROJECT_RULES: no cross-module queries).
 */

export interface IdentityRecord {
  entityKind: "company" | "organization";
  entityId: string;
  name: string;
  website: string;
  logoVersion: number;
  logoSource: string;
  logoMime: string;
  logoUpdatedAt: string | null;
  accentColor: string;
  accentSuggested: string;
}

interface IdentityRow {
  id: string;
  name: string;
  website: string;
  logo_key: string;
  logo_renditions: unknown;
  logo_version: number;
  logo_source: string;
  logo_mime: string;
  logo_updated_at: unknown;
  accent_color: string;
  accent_suggested: string;
}

function rowToIdentity(
  kind: "company" | "organization",
  r: IdentityRow
): IdentityRecord {
  return {
    entityKind: kind,
    entityId: r.id,
    name: r.name,
    website: r.website ?? "",
    logoVersion: num(r.logo_version),
    logoSource: str(r.logo_source),
    logoMime: str(r.logo_mime),
    logoUpdatedAt: isoOrNull(r.logo_updated_at),
    accentColor: str(r.accent_color),
    accentSuggested: str(r.accent_suggested),
  };
}

/** Resolve an entity id to its identity record (companies first,
 *  then Directory organizations). Null when the id is unknown. */
export async function getIdentity(
  entityId: string
): Promise<IdentityRecord | null> {
  await ensureIdentitySchema();
  const db = sql();
  const companies = await db`
    SELECT id, name, website, logo_key, logo_renditions,
  logo_version, logo_source, logo_mime, logo_updated_at,
  accent_color, accent_suggested FROM core.companies
    WHERE id = ${entityId} AND deleted_at IS NULL LIMIT 1`;
  if (companies.length) {
    return rowToIdentity("company", companies[0] as unknown as IdentityRow);
  }
  const orgs = await db`
    SELECT id, name, website, logo_key, logo_renditions,
  logo_version, logo_source, logo_mime, logo_updated_at,
  accent_color, accent_suggested FROM core.organizations
    WHERE id = ${entityId} AND deleted_at IS NULL LIMIT 1`;
  if (orgs.length) {
    return rowToIdentity("organization", orgs[0] as unknown as IdentityRow);
  }
  return null;
}

async function getIdentityRow(
  entityId: string
): Promise<{ kind: "company" | "organization"; row: IdentityRow } | null> {
  await ensureIdentitySchema();
  const db = sql();
  const companies = await db`
    SELECT id, name, website, logo_key, logo_renditions,
  logo_version, logo_source, logo_mime, logo_updated_at,
  accent_color, accent_suggested FROM core.companies
    WHERE id = ${entityId} AND deleted_at IS NULL LIMIT 1`;
  if (companies.length) {
    return { kind: "company", row: companies[0] as unknown as IdentityRow };
  }
  const orgs = await db`
    SELECT id, name, website, logo_key, logo_renditions,
  logo_version, logo_source, logo_mime, logo_updated_at,
  accent_color, accent_suggested FROM core.organizations
    WHERE id = ${entityId} AND deleted_at IS NULL LIMIT 1`;
  if (orgs.length) {
    return { kind: "organization", row: orgs[0] as unknown as IdentityRow };
  }
  return null;
}

function tableFor(kind: "company" | "organization"): string {
  return kind === "company" ? "core.companies" : "core.organizations";
}

function renditionsOf(row: IdentityRow): Record<string, string> {
  const raw = row.logo_renditions;
  if (raw && typeof raw === "object") return raw as Record<string, string>;
  if (typeof raw === "string" && raw) {
    try {
      return JSON.parse(raw) as Record<string, string>;
    } catch {
      return {};
    }
  }
  return {};
}

/** Storage key of one rendition (or the original) at a version. */
export function renditionKey(
  entityId: string,
  version: number,
  size: number | "original",
  row: { logo_key: string; logo_renditions: unknown }
): string | null {
  if (size === "original") return row.logo_key || null;
  const map = renditionsOf(row as IdentityRow);
  return map[String(size)] ?? null;
}

export async function getLogoObject(
  entityId: string,
  size: number | "original"
): Promise<{ data: Buffer; mime: string } | null> {
  const found = await getIdentityRow(entityId);
  if (!found || !found.row.logo_key) return null;
  const key = renditionKey(entityId, found.row.logo_version, size, found.row);
  if (!key) return null;
  const provider = getStorageProvider();
  try {
    const data = await provider.get(key);
    const mime = key.endsWith(".webp")
      ? "image/webp"
      : key.endsWith(".svg")
        ? "image/svg+xml"
        : key.endsWith(".jpg")
          ? "image/jpeg"
          : "image/png";
    return { data, mime };
  } catch {
    return null;
  }
}

function bustCaches(entityId: string) {
  cacheInvalidate(`company:${entityId}`);
  cacheInvalidate("overview");
  cacheInvalidate("search");
}

/**
 * Process + store a new logo for an entity. Writes objects under
 * company-logos/<id>/v<n+1>/, then updates the row (version bump is
 * what busts the immutable rendition URLs). The previous version's
 * objects are deleted best-effort afterwards. Sets the accent
 * suggestion from the dominant color; applies it as the accent when
 * no accent has been chosen yet.
 */
export async function setLogo(
  entityId: string,
  data: Buffer,
  source: "upload" | "fetched"
): Promise<IdentityRecord> {
  const found = await getIdentityRow(entityId);
  if (!found) throw new Error("Company not found");
  const { kind, row } = found;
  const processed: ProcessedLogo = await processLogo(data);
  const version = num(row.logo_version) + 1;
  const prefix = logoKeyPrefix(entityId, version);
  const provider = getStorageProvider();

  const originalKey = `${prefix}/original.${processed.ext}`;
  const renditionKeys: Record<string, string> = {};
  await provider.put(originalKey, processed.original);
  for (const [size, r] of Object.entries(processed.renditions)) {
    const key = `${prefix}/${size}.${r.ext}`;
    await provider.put(key, r.data);
    renditionKeys[size] = key;
  }

  const db = sql();
  const table = tableFor(kind);
  const applyAccent = !str(row.accent_color);
  await db.query(
    `UPDATE ${table} SET
       logo_key = $1, logo_renditions = $2::jsonb, logo_version = $3,
       logo_source = $4, logo_mime = $5, logo_updated_at = now(),
       accent_suggested = $6,
       accent_color = CASE WHEN $7 THEN $6 ELSE accent_color END,
       updated_at = now()
     WHERE id = $8`,
    [
      originalKey,
      JSON.stringify(renditionKeys),
      version,
      source,
      processed.mime,
      processed.dominantColor,
      applyAccent,
      entityId,
    ]
  );

  // Best-effort cleanup of the superseded version's objects.
  const oldKeys = [
    row.logo_key,
    ...Object.values(renditionsOf(row)),
  ].filter(Boolean) as string[];
  for (const key of oldKeys) {
    try {
      await provider.delete(key);
    } catch {
      /* leftover objects are harmless */
    }
  }
  bustCaches(entityId);
  const next = await getIdentity(entityId);
  if (!next) throw new Error("Identity vanished after logo update");
  return next;
}

/** Remove a logo entirely (objects + metadata). Accent stays. */
export async function clearLogo(entityId: string): Promise<IdentityRecord> {
  const found = await getIdentityRow(entityId);
  if (!found) throw new Error("Company not found");
  const { kind, row } = found;
  const provider = getStorageProvider();
  const keys = [row.logo_key, ...Object.values(renditionsOf(row))].filter(
    Boolean
  ) as string[];
  for (const key of keys) {
    try {
      await provider.delete(key);
    } catch {
      /* ignore */
    }
  }
  const db = sql();
  await db.query(
    `UPDATE ${tableFor(kind)} SET
       logo_key = '', logo_renditions = '{}'::jsonb, logo_version = 0,
       logo_source = '', logo_mime = '', logo_updated_at = NULL,
       updated_at = now()
     WHERE id = $1`,
    [entityId]
  );
  bustCaches(entityId);
  const next = await getIdentity(entityId);
  if (!next) throw new Error("Identity vanished after logo clear");
  return next;
}

export async function setAccentColor(
  entityId: string,
  color: string
): Promise<IdentityRecord> {
  const hex = normalizeHex(color);
  if (!hex) throw new Error("Accent color must be a #rrggbb hex value");
  const found = await getIdentityRow(entityId);
  if (!found) throw new Error("Company not found");
  const db = sql();
  await db.query(
    `UPDATE ${tableFor(found.kind)} SET accent_color = $1, updated_at = now()
     WHERE id = $2`,
    [hex, entityId]
  );
  bustCaches(entityId);
  const next = await getIdentity(entityId);
  if (!next) throw new Error("Identity vanished after accent update");
  return next;
}

export async function setWebsite(
  entityId: string,
  website: string
): Promise<IdentityRecord> {
  const found = await getIdentityRow(entityId);
  if (!found) throw new Error("Company not found");
  const db = sql();
  await db.query(
    `UPDATE ${tableFor(found.kind)} SET website = $1, updated_at = now()
     WHERE id = $2`,
    [website.trim(), entityId]
  );
  bustCaches(entityId);
  const next = await getIdentity(entityId);
  if (!next) throw new Error("Identity vanished after website update");
  return next;
}

/** Batch identity lookup for list enrichment (one query per table). */
export async function identitiesFor(
  entityIds: string[]
): Promise<Map<string, IdentityRecord>> {
  const out = new Map<string, IdentityRecord>();
  const ids = Array.from(new Set(entityIds.filter(Boolean)));
  if (!ids.length) return out;
  await ensureIdentitySchema();
  const db = sql();
  const companies = await db`
    SELECT id, name, website, logo_key, logo_renditions,
  logo_version, logo_source, logo_mime, logo_updated_at,
  accent_color, accent_suggested FROM core.companies
    WHERE id = ANY(${ids}) AND deleted_at IS NULL`;
  for (const r of companies) {
    const rec = rowToIdentity("company", r as unknown as IdentityRow);
    out.set(rec.entityId, rec);
  }
  const missing = ids.filter((id) => !out.has(id));
  if (missing.length) {
    const orgs = await db`
      SELECT id, name, website, logo_key, logo_renditions,
  logo_version, logo_source, logo_mime, logo_updated_at,
  accent_color, accent_suggested FROM core.organizations
      WHERE id = ANY(${missing}) AND deleted_at IS NULL`;
    for (const r of orgs) {
      const rec = rowToIdentity("organization", r as unknown as IdentityRow);
      out.set(rec.entityId, rec);
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Deal-side identity (codename)                                       */
/* ------------------------------------------------------------------ */

export interface DealIdentity extends IdentityInput {
  dealId: string;
  companyId: string;
  stage: string;
  investmentType: string;
}

/** The deal linked to a core company (latest core.deals row), with its
 *  codename fields from the BD record. */
export async function dealIdentityForCompany(
  companyId: string
): Promise<DealIdentity | null> {
  await ensureIdentitySchema();
  const db = sql();
  const rows = await db`
    SELECT cd.id AS deal_id, cd.company_id, cd.stage AS core_stage,
      ld.company_name, ld.stage, ld.investment_type,
      ld.codename, ld.codename_external
    FROM core.deals cd
    JOIN deals ld ON ld.id = cd.id
    WHERE cd.company_id = ${companyId}
    ORDER BY cd.updated_at DESC
    LIMIT 1`;
  if (!rows.length) return null;
  const r = rows[0] as Record<string, unknown>;
  return {
    dealId: str(r.deal_id),
    companyId,
    name: str(r.company_name),
    stage: str(r.stage) || str(r.core_stage),
    investmentType: str(r.investment_type) || "platform_lbo",
    codename: str(r.codename),
    codenameExternal: r.codename_external !== false,
  };
}

export async function dealIdentityForDeal(
  dealId: string
): Promise<(DealIdentity & { companyName: string }) | null> {
  await ensureIdentitySchema();
  const db = sql();
  const rows = await db`
    SELECT ld.id AS deal_id, ld.company_name, ld.stage, ld.investment_type,
      ld.codename, ld.codename_external, cd.company_id
    FROM deals ld
    LEFT JOIN core.deals cd ON cd.id = ld.id
    WHERE ld.id = ${dealId}
    LIMIT 1`;
  if (!rows.length) return null;
  const r = rows[0] as Record<string, unknown>;
  return {
    dealId,
    companyId: str(r.company_id),
    companyName: str(r.company_name),
    name: str(r.company_name),
    stage: str(r.stage),
    investmentType: str(r.investment_type) || "platform_lbo",
    codename: str(r.codename),
    codenameExternal: r.codename_external !== false,
  };
}

/** Identity summaries for a set of deals (list enrichment): deal id →
 *  its core company + logo version + accent. One query. */
export async function identitySummariesForDeals(
  dealIds: string[]
): Promise<
  Map<string, { companyId: string; logoVersion: number; accentColor: string }>
> {
  const out = new Map<
    string,
    { companyId: string; logoVersion: number; accentColor: string }
  >();
  const ids = Array.from(new Set(dealIds.filter(Boolean)));
  if (!ids.length) return out;
  await ensureIdentitySchema();
  const db = sql();
  const rows = await db`
    SELECT cd.id AS deal_id, cd.company_id,
      coalesce(c.logo_version, 0) AS logo_version,
      coalesce(c.accent_color, '') AS accent_color
    FROM core.deals cd
    LEFT JOIN core.companies c ON c.id = cd.company_id
    WHERE cd.id = ANY(${ids})`;
  for (const raw of rows) {
    const r = raw as Record<string, unknown>;
    out.set(str(r.deal_id), {
      companyId: str(r.company_id),
      logoVersion: num(r.logo_version),
      accentColor: str(r.accent_color),
    });
  }
  return out;
}

/** Active deals for the banner quick-switcher (not Closed/Passed). */
export async function listActiveDealIdentities(): Promise<
  Array<DealIdentity & { logoVersion: number; accentColor: string }>
> {
  await ensureIdentitySchema();
  const db = sql();
  const rows = await db`
    SELECT ld.id AS deal_id, ld.company_name, ld.stage, ld.investment_type,
      ld.codename, ld.codename_external, cd.company_id,
      coalesce(c.logo_version, 0) AS logo_version,
      coalesce(c.accent_color, '') AS accent_color
    FROM deals ld
    JOIN core.deals cd ON cd.id = ld.id
    JOIN core.companies c ON c.id = cd.company_id AND c.deleted_at IS NULL
    WHERE ld.stage NOT IN ('Closed', 'Passed')
    ORDER BY ld.updated_at DESC
    LIMIT 60`;
  return rows.map((raw) => {
    const r = raw as Record<string, unknown>;
    return {
      dealId: str(r.deal_id),
      companyId: str(r.company_id),
      name: str(r.company_name),
      stage: str(r.stage),
      investmentType: str(r.investment_type) || "platform_lbo",
      codename: str(r.codename),
      codenameExternal: r.codename_external !== false,
      logoVersion: num(r.logo_version),
      accentColor: str(r.accent_color),
    };
  });
}

/* ------------------------------------------------------------------ */
/* Recent deals                                                        */
/* ------------------------------------------------------------------ */

export async function recordRecentOpen(
  userKey: string,
  companyId: string,
  dealId: string
): Promise<void> {
  if (!userKey || !companyId) return;
  await ensureIdentitySchema();
  const db = sql();
  const identity = await getIdentity(companyId).catch(() => null);
  const deal = dealId
    ? await dealIdentityForDeal(dealId).catch(() => null)
    : await dealIdentityForCompany(companyId).catch(() => null);
  await db`
    INSERT INTO core.recent_deals
      (user_key, company_id, deal_id, name_snapshot, stage_snapshot, opened_at)
    VALUES (${userKey}, ${companyId}, ${deal?.dealId ?? dealId ?? ""},
      ${deal?.name ?? identity?.name ?? ""}, ${deal?.stage ?? ""}, now())
    ON CONFLICT (user_key, company_id) DO UPDATE SET
      deal_id = EXCLUDED.deal_id,
      name_snapshot = EXCLUDED.name_snapshot,
      stage_snapshot = EXCLUDED.stage_snapshot,
      opened_at = now()`;
}

export interface RecentDeal {
  companyId: string;
  dealId: string;
  name: string;
  stage: string;
  logoVersion: number;
  accentColor: string;
  codename: string;
  openedAt: string | null;
}

export async function listRecentDeals(userKey: string): Promise<RecentDeal[]> {
  await ensureIdentitySchema();
  const db = sql();
  const rows = await db`
    SELECT rd.company_id, rd.deal_id, rd.name_snapshot, rd.stage_snapshot,
      rd.opened_at,
      coalesce(c.name, '') AS company_name,
      coalesce(c.logo_version, 0) AS logo_version,
      coalesce(c.accent_color, '') AS accent_color,
      coalesce(ld.company_name, '') AS deal_name,
      coalesce(ld.stage, '') AS deal_stage,
      coalesce(ld.codename, '') AS codename
    FROM core.recent_deals rd
    LEFT JOIN core.companies c ON c.id = rd.company_id
    LEFT JOIN deals ld ON ld.id = rd.deal_id
    WHERE rd.user_key = ${userKey}
    ORDER BY rd.opened_at DESC
    LIMIT 8`;
  return rows.map((raw) => {
    const r = raw as Record<string, unknown>;
    return {
      companyId: str(r.company_id),
      dealId: str(r.deal_id),
      name: str(r.deal_name) || str(r.company_name) || str(r.name_snapshot),
      stage: str(r.deal_stage) || str(r.stage_snapshot),
      logoVersion: num(r.logo_version),
      accentColor: str(r.accent_color),
      codename: str(r.codename),
      openedAt: isoOrNull(r.opened_at),
    };
  });
}

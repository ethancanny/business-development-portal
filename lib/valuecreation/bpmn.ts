import { gzipSync, gunzipSync } from "node:zlib";
import { sql, newId, str, num, isoOrNull } from "../platform/db";
import { ensureValueCreation } from "./schema";
import { VcError, requirePlan } from "./service";
import {
  starterXml,
  MAX_PRIOR_VERSIONS,
  listDiagrams,
} from "../diligence/bpmn";
import { getWorkspaceByDeal } from "../diligence/service";

/**
 * To-be BPMN process maps (Phase 6, WS-B) — diligence-pattern-faithful.
 *
 * Tables are WS-A's (lib/valuecreation/schema.ts ensureValueCreation):
 *   valuecreation.bpmn_diagrams(id, plan_id, process_key, name,
 *     as_is_diagram_id, as_is_label, current_version, timestamps,
 *     deleted_at)
 *   valuecreation.bpmn_versions(id, diagram_id, version, xml_gzip,
 *     saved_by, created_at)
 *
 * Rules honored (copied from lib/diligence/bpmn.ts):
 * - XML is stored gzip-compressed in ONE bytea field per version row
 *   and is NEVER selected by list or version-list queries — only the
 *   single-map and single-version reads return XML (octet_length
 *   metadata only in lists).
 * - Each map keeps at most MAX_PRIOR_VERSIONS prior versions
 *   (current + 10 prior); older rows are pruned on save.
 * - Saves happen ONLY on an explicit save call (saveMapXml) — there
 *   is no autosave path anywhere in this module.
 * - The starter template and the version cap are IMPORTED from
 *   lib/diligence/bpmn (single source), never duplicated. The XML size
 *   cap matches diligence's MAX_XML_BYTES (5 MB, a module-private
 *   const there, so the same literal is kept here).
 * - As-is candidates are resolved ONLY through diligence service
 *   functions (getWorkspaceByDeal + listDiagrams) — no diligence.*
 *   SQL. The only cross-schema reads here are core.* reference reads
 *   (deals for the company + the legacy_deal_id fallback).
 */

export { MAX_PRIOR_VERSIONS };
export { starterXml };

const MAX_XML_BYTES = 5 * 1024 * 1024;

export interface VcDiagramRow {
  id: string;
  planId: string;
  processKey: string;
  name: string;
  asIsDiagramId: string | null;
  asIsLabel: string;
  currentVersion: number;
  versionCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface VcDiagramVersionMeta {
  version: number;
  savedBy: string;
  createdAt: string;
  xmlBytes: number;
}

function rowToDiagram(r: Record<string, unknown>): VcDiagramRow {
  return {
    id: str(r.id),
    planId: str(r.plan_id),
    processKey: str(r.process_key),
    name: str(r.name),
    asIsDiagramId: r.as_is_diagram_id ? str(r.as_is_diagram_id) : null,
    asIsLabel: str(r.as_is_label),
    currentVersion: num(r.current_version),
    versionCount: num(r.version_count),
    createdAt: isoOrNull(r.created_at) ?? "",
    updatedAt: isoOrNull(r.updated_at) ?? "",
  };
}

const DIAGRAM_COLS = `
  d.id, d.plan_id, d.process_key, d.name, d.as_is_diagram_id,
  d.as_is_label, d.current_version, d.created_at, d.updated_at,
  (SELECT count(*)::int FROM valuecreation.bpmn_versions v
    WHERE v.diagram_id = d.id) AS version_count`;

async function fetchDiagramRow(diagramId: string): Promise<VcDiagramRow> {
  const db = sql();
  const rows = await db`
    SELECT ${db.unsafe(DIAGRAM_COLS)} FROM valuecreation.bpmn_diagrams d
    WHERE d.id = ${diagramId} AND d.deleted_at IS NULL LIMIT 1`;
  if (!rows.length) throw new VcError("diagram_not_found");
  return rowToDiagram(rows[0] as Record<string, unknown>);
}

function slugProcessKey(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return slug || "process";
}

/* --------------------------------- maps -------------------------------- */

/** List to-be maps for a plan. NEVER returns XML. */
export async function listMaps(planId: string): Promise<VcDiagramRow[]> {
  await ensureValueCreation();
  await requirePlan(planId);
  const db = sql();
  const rows = await db`
    SELECT ${db.unsafe(DIAGRAM_COLS)} FROM valuecreation.bpmn_diagrams d
    WHERE d.plan_id = ${planId} AND d.deleted_at IS NULL
    ORDER BY d.created_at ASC`;
  return rows.map((r) => rowToDiagram(r as Record<string, unknown>));
}

export async function createMap(
  planId: string,
  input: {
    name: string;
    processKey?: string;
    asIsDiagramId?: string | null;
    asIsLabel?: string;
  },
  actor: string
): Promise<VcDiagramRow> {
  await ensureValueCreation();
  void actor;
  await requirePlan(planId);
  const name = (input.name ?? "").trim();
  if (!name) throw new VcError("name_required");
  const processKey =
    (input.processKey ?? "").trim() || slugProcessKey(name);
  const db = sql();
  const id = `vcb_${newId()}`;
  await db`
    INSERT INTO valuecreation.bpmn_diagrams
      (id, plan_id, process_key, name, as_is_diagram_id, as_is_label,
        current_version)
    VALUES (${id}, ${planId}, ${processKey}, ${name},
      ${input.asIsDiagramId ?? null}, ${(input.asIsLabel ?? "").trim()}, 0)`;
  return fetchDiagramRow(id);
}

/**
 * Read ONE map with its current XML. When the map has never been
 * explicitly saved (version 0), the starter template (from
 * lib/diligence/bpmn) is returned and saved=false marks that it is
 * not yet a stored version.
 */
export async function getMap(diagramId: string): Promise<{
  id: string;
  planId: string;
  processKey: string;
  name: string;
  asIsDiagramId: string | null;
  asIsLabel: string;
  currentVersion: number;
  xml: string;
  saved: boolean;
}> {
  await ensureValueCreation();
  const d = await fetchDiagramRow(diagramId);
  const db = sql();
  let xml: string;
  let saved = false;
  if (d.currentVersion > 0) {
    const rows = await db`
      SELECT xml_gzip FROM valuecreation.bpmn_versions
      WHERE diagram_id = ${diagramId} AND version = ${d.currentVersion}
      LIMIT 1`;
    if (rows.length) {
      const buf = (rows[0] as Record<string, unknown>).xml_gzip;
      xml = gunzipSync(Buffer.from(buf as Buffer)).toString("utf8");
      saved = true;
    } else {
      xml = starterXml(d.processKey, d.name);
    }
  } else {
    xml = starterXml(d.processKey, d.name);
  }
  return {
    id: d.id,
    planId: d.planId,
    processKey: d.processKey,
    name: d.name,
    asIsDiagramId: d.asIsDiagramId,
    asIsLabel: d.asIsLabel,
    currentVersion: d.currentVersion,
    xml,
    saved,
  };
}

/**
 * EXPLICIT save — the only write path for map XML. Identical
 * validation to diligence: xml_required / xml_not_bpmn /
 * xml_too_large (same 5 MB cap). Stores the XML gzip-compressed as a
 * new version and prunes to the newest (1 + MAX_PRIOR_VERSIONS).
 */
export async function saveMapXml(
  diagramId: string,
  xml: string,
  actor: string
): Promise<{ version: number; pruned: number }> {
  await ensureValueCreation();
  if (typeof xml !== "string" || !xml.trim())
    throw new VcError("xml_required");
  if (!/<(bpmn:)?definitions[\s>]/i.test(xml))
    throw new VcError("xml_not_bpmn");
  if (xml.length > MAX_XML_BYTES) throw new VcError("xml_too_large");
  const db = sql();
  const d = await fetchDiagramRow(diagramId);
  const nextVersion = d.currentVersion + 1;
  const compressed = gzipSync(Buffer.from(xml, "utf8"));
  await db`
    INSERT INTO valuecreation.bpmn_versions (id, diagram_id, version, xml_gzip, saved_by)
    VALUES (${`vcv_${newId()}`}, ${diagramId}, ${nextVersion}, ${compressed}, ${actor})`;
  await db`
    UPDATE valuecreation.bpmn_diagrams
    SET current_version = ${nextVersion}, updated_at = now()
    WHERE id = ${diagramId}`;
  const keepFrom = nextVersion - MAX_PRIOR_VERSIONS;
  const pruned = await db`
    DELETE FROM valuecreation.bpmn_versions
    WHERE diagram_id = ${diagramId} AND version < ${keepFrom}
    RETURNING id`;
  return { version: nextVersion, pruned: pruned.length };
}

/** Version metadata for one map. NEVER returns XML. */
export async function listMapVersions(
  diagramId: string
): Promise<VcDiagramVersionMeta[]> {
  await ensureValueCreation();
  await fetchDiagramRow(diagramId);
  const db = sql();
  const rows = await db`
    SELECT version, saved_by, created_at, octet_length(xml_gzip) AS stored_bytes
    FROM valuecreation.bpmn_versions
    WHERE diagram_id = ${diagramId}
    ORDER BY version DESC`;
  return rows.map((r) => {
    const rec = r as Record<string, unknown>;
    return {
      version: num(rec.version),
      savedBy: str(rec.saved_by),
      createdAt: isoOrNull(rec.created_at) ?? "",
      xmlBytes: num(rec.stored_bytes),
    };
  });
}

/** Read ONE prior version's XML (single-record read — allowed). */
export async function getMapVersionXml(
  diagramId: string,
  version: number
): Promise<{ version: number; xml: string }> {
  await ensureValueCreation();
  await fetchDiagramRow(diagramId);
  const db = sql();
  const rows = await db`
    SELECT xml_gzip FROM valuecreation.bpmn_versions
    WHERE diagram_id = ${diagramId} AND version = ${version} LIMIT 1`;
  if (!rows.length) throw new VcError("version_not_found");
  const buf = (rows[0] as Record<string, unknown>).xml_gzip;
  return {
    version,
    xml: gunzipSync(Buffer.from(buf as Buffer)).toString("utf8"),
  };
}

/** Soft-delete a map. Version rows are retained as history. */
export async function deleteMap(
  diagramId: string,
  actor: string
): Promise<boolean> {
  await ensureValueCreation();
  void actor;
  const db = sql();
  const rows = await db`
    UPDATE valuecreation.bpmn_diagrams
    SET deleted_at = now(), updated_at = now()
    WHERE id = ${diagramId} AND deleted_at IS NULL RETURNING id`;
  return rows.length > 0;
}

/* ---------------------------- as-is candidates -------------------------- */

export interface AsIsCandidate {
  diagramId: string;
  workspaceId: string;
  dealId: string;
  processKey: string;
  name: string;
  currentVersion: number;
}

/**
 * The diligence as-is diagrams available to link as the baseline for
 * a plan's to-be maps. Deals are resolved from core.* reference data
 * (core.deals by company_id, plus the core.companies.legacy_deal_id
 * fallback); each deal's workspace and diagrams come ONLY through
 * the diligence service functions.
 */
export async function listAsIsCandidates(
  companyId: string
): Promise<AsIsCandidate[]> {
  await ensureValueCreation();
  const db = sql();
  const dealIds: string[] = [];
  const seen = new Set<string>();
  const dealRows = await db`
    SELECT id FROM core.deals WHERE company_id = ${companyId}`;
  for (const r of dealRows) {
    const id = str((r as Record<string, unknown>).id);
    if (id && !seen.has(id)) {
      seen.add(id);
      dealIds.push(id);
    }
  }
  const companyRows = await db`
    SELECT legacy_deal_id FROM core.companies
    WHERE id = ${companyId} LIMIT 1`;
  if (companyRows.length) {
    const legacy = (companyRows[0] as Record<string, unknown>)
      .legacy_deal_id;
    const legacyId = legacy ? str(legacy) : "";
    if (legacyId && !seen.has(legacyId)) {
      seen.add(legacyId);
      dealIds.push(legacyId);
    }
  }
  const out: AsIsCandidate[] = [];
  for (const dealId of dealIds) {
    const workspace = await getWorkspaceByDeal(dealId).catch(() => null);
    if (!workspace) continue;
    const diagrams = await listDiagrams(workspace.id).catch(() => []);
    for (const d of diagrams) {
      out.push({
        diagramId: d.id,
        workspaceId: workspace.id,
        dealId,
        processKey: d.processKey,
        name: d.name,
        currentVersion: d.currentVersion,
      });
    }
  }
  return out;
}

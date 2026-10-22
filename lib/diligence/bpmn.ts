import { gzipSync, gunzipSync } from "node:zlib";
import { sql, newId, str, isoOrNull } from "../platform/db";
import { ensureDiligence, PROCESS_DEFS } from "./schema";

/**
 * BPMN 2.0 process maps (Phase 5, spec §12).
 *
 * Rules honored:
 * - XML is stored gzip-compressed in ONE bytea field per version row
 *   (diligence.bpmn_versions.xml_gzip) and is NEVER selected by list or
 *   card queries — only the single-diagram and single-version reads
 *   return XML.
 * - Each diagram keeps at most 10 PRIOR versions (11 rows total:
 *   current + 10 prior); older rows are pruned on save.
 * - Saves happen ONLY on an explicit save call (saveDiagramXml) — there
 *   is no autosave path anywhere in this module.
 */

export const MAX_PRIOR_VERSIONS = 10;
const MAX_XML_BYTES = 5 * 1024 * 1024;

export function starterXml(processKey: string, name: string): string {
  const pid = `Process_${processKey}`;
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" ` +
    `xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" ` +
    `xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" ` +
    `xmlns:di="http://www.omg.org/spec/DD/20100524/DI" ` +
    `id="Defs_${processKey}" targetNamespace="http://cannycapitalpartners.com/bpmn">\n` +
    `  <bpmn:process id="${pid}" isExecutable="false">\n` +
    `    <bpmn:startEvent id="StartEvent_1" name="Start" />\n` +
    `    <bpmn:task id="Task_1" name="${name} — step 1 (as-is)" />\n` +
    `    <bpmn:endEvent id="EndEvent_1" name="End" />\n` +
    `    <bpmn:sequenceFlow id="Flow_1" sourceRef="StartEvent_1" targetRef="Task_1" />\n` +
    `    <bpmn:sequenceFlow id="Flow_2" sourceRef="Task_1" targetRef="EndEvent_1" />\n` +
    `  </bpmn:process>\n` +
    `  <bpmndi:BPMNDiagram id="Diagram_${processKey}">\n` +
    `    <bpmndi:BPMNPlane id="Plane_${processKey}" bpmnElement="${pid}">\n` +
    `      <bpmndi:BPMNShape id="StartEvent_1_di" bpmnElement="StartEvent_1">\n` +
    `        <dc:Bounds x="160" y="100" width="36" height="36" />\n` +
    `      </bpmndi:BPMNShape>\n` +
    `      <bpmndi:BPMNShape id="Task_1_di" bpmnElement="Task_1">\n` +
    `        <dc:Bounds x="250" y="78" width="120" height="80" />\n` +
    `      </bpmndi:BPMNShape>\n` +
    `      <bpmndi:BPMNShape id="EndEvent_1_di" bpmnElement="EndEvent_1">\n` +
    `        <dc:Bounds x="430" y="100" width="36" height="36" />\n` +
    `      </bpmndi:BPMNShape>\n` +
    `      <bpmndi:BPMNEdge id="Flow_1_di" bpmnElement="Flow_1">\n` +
    `        <di:waypoint x="196" y="118" />\n` +
    `        <di:waypoint x="250" y="118" />\n` +
    `      </bpmndi:BPMNEdge>\n` +
    `      <bpmndi:BPMNEdge id="Flow_2_di" bpmnElement="Flow_2">\n` +
    `        <di:waypoint x="370" y="118" />\n` +
    `        <di:waypoint x="430" y="118" />\n` +
    `      </bpmndi:BPMNEdge>\n` +
    `    </bpmndi:BPMNPlane>\n` +
    `  </bpmndi:BPMNDiagram>\n` +
    `</bpmn:definitions>\n`
  );
}

export interface DiagramRow {
  id: string;
  workspaceId: string;
  processKey: string;
  name: string;
  currentVersion: number;
  versionCount: number;
  updatedAt: string;
  createdAt: string;
}

export interface DiagramVersionMeta {
  version: number;
  savedBy: string;
  createdAt: string;
  xmlBytes: number;
}

/** Seed the five spec process diagrams for a workspace (no XML rows
 * until the first explicit save; the starter diagram is served from
 * starterXml when no version exists yet). */
export async function ensureDiagramsForWorkspace(
  workspaceId: string
): Promise<void> {
  await ensureDiligence();
  const db = sql();
  for (const def of PROCESS_DEFS) {
    const existing = await db`
      SELECT id FROM diligence.bpmn_diagrams
      WHERE workspace_id = ${workspaceId} AND process_key = ${def.key}
        AND deleted_at IS NULL LIMIT 1`;
    if (!existing.length) {
      const diagramId = `bpm_${newId()}`;
      await db`
        INSERT INTO diligence.bpmn_diagrams
          (id, workspace_id, process_key, name, current_version)
        VALUES (${diagramId}, ${workspaceId}, ${def.key}, ${def.name}, 0)`;
    }
  }
}

/** List diagrams for a workspace. NEVER returns XML. */
export async function listDiagrams(
  workspaceId: string
): Promise<DiagramRow[]> {
  await ensureDiligence();
  const db = sql();
  const rows = await db`
    SELECT d.id, d.workspace_id, d.process_key, d.name, d.current_version,
      d.created_at, d.updated_at,
      (SELECT count(*)::int FROM diligence.bpmn_versions v
        WHERE v.diagram_id = d.id) AS version_count
    FROM diligence.bpmn_diagrams d
    WHERE d.workspace_id = ${workspaceId} AND d.deleted_at IS NULL
    ORDER BY d.created_at ASC`;
  return rows.map((r) => {
    const rec = r as Record<string, unknown>;
    return {
      id: str(rec.id),
      workspaceId: str(rec.workspace_id),
      processKey: str(rec.process_key),
      name: str(rec.name),
      currentVersion: Number(rec.current_version ?? 0),
      versionCount: Number(rec.version_count ?? 0),
      updatedAt: isoOrNull(rec.updated_at) ?? "",
      createdAt: isoOrNull(rec.created_at) ?? "",
    };
  });
}

async function fetchDiagramRow(diagramId: string) {
  const db = sql();
  const rows = await db`
    SELECT id, workspace_id, process_key, name, current_version
    FROM diligence.bpmn_diagrams
    WHERE id = ${diagramId} AND deleted_at IS NULL LIMIT 1`;
  if (!rows.length) throw new Error("diagram_not_found");
  return rows[0] as Record<string, unknown>;
}

/**
 * Read ONE diagram with its current XML. When the diagram has never
 * been explicitly saved (version 0), the starter template is returned
 * and saved=false marks that it is not yet a stored version.
 */
export async function getDiagram(
  diagramId: string
): Promise<{
  id: string;
  workspaceId: string;
  processKey: string;
  name: string;
  currentVersion: number;
  xml: string;
  saved: boolean;
}> {
  await ensureDiligence();
  const db = sql();
  const d = await fetchDiagramRow(diagramId);
  const currentVersion = Number(d.current_version ?? 0);
  let xml: string;
  let saved = false;
  if (currentVersion > 0) {
    const rows = await db`
      SELECT xml_gzip FROM diligence.bpmn_versions
      WHERE diagram_id = ${diagramId} AND version = ${currentVersion}
      LIMIT 1`;
    if (rows.length) {
      const buf = (rows[0] as Record<string, unknown>).xml_gzip;
      xml = gunzipSync(Buffer.from(buf as Buffer)).toString("utf8");
      saved = true;
    } else {
      xml = starterXml(str(d.process_key), str(d.name));
    }
  } else {
    xml = starterXml(str(d.process_key), str(d.name));
  }
  return {
    id: str(d.id),
    workspaceId: str(d.workspace_id),
    processKey: str(d.process_key),
    name: str(d.name),
    currentVersion,
    xml,
    saved,
  };
}

/**
 * EXPLICIT save — the only write path for diagram XML. Stores the XML
 * gzip-compressed as a new version and prunes to the newest
 * (1 + MAX_PRIOR_VERSIONS) versions.
 */
export async function saveDiagramXml(
  diagramId: string,
  xml: string,
  actor: string
): Promise<{ version: number; pruned: number }> {
  await ensureDiligence();
  if (typeof xml !== "string" || !xml.trim())
    throw new Error("xml_required");
  if (!/<(bpmn:)?definitions[\s>]/i.test(xml))
    throw new Error("xml_not_bpmn");
  if (xml.length > MAX_XML_BYTES) throw new Error("xml_too_large");
  const db = sql();
  const d = await fetchDiagramRow(diagramId);
  const nextVersion = Number(d.current_version ?? 0) + 1;
  const compressed = gzipSync(Buffer.from(xml, "utf8"));
  await db`
    INSERT INTO diligence.bpmn_versions (id, diagram_id, version, xml_gzip, saved_by)
    VALUES (${`bpv_${newId()}`}, ${diagramId}, ${nextVersion}, ${compressed}, ${actor})`;
  await db`
    UPDATE diligence.bpmn_diagrams
    SET current_version = ${nextVersion}, updated_at = now()
    WHERE id = ${diagramId}`;
  const keepFrom = nextVersion - MAX_PRIOR_VERSIONS;
  const pruned = await db`
    DELETE FROM diligence.bpmn_versions
    WHERE diagram_id = ${diagramId} AND version < ${keepFrom}
    RETURNING id`;
  return { version: nextVersion, pruned: pruned.length };
}

/** Version metadata for one diagram. NEVER returns XML. */
export async function listDiagramVersions(
  diagramId: string
): Promise<DiagramVersionMeta[]> {
  await ensureDiligence();
  await fetchDiagramRow(diagramId);
  const db = sql();
  const rows = await db`
    SELECT version, saved_by, created_at, octet_length(xml_gzip) AS stored_bytes
    FROM diligence.bpmn_versions
    WHERE diagram_id = ${diagramId}
    ORDER BY version DESC`;
  return rows.map((r) => {
    const rec = r as Record<string, unknown>;
    return {
      version: Number(rec.version ?? 0),
      savedBy: str(rec.saved_by),
      createdAt: isoOrNull(rec.created_at) ?? "",
      xmlBytes: Number(rec.stored_bytes ?? 0),
    };
  });
}

/** Read ONE prior version's XML (single-record read — allowed). */
export async function getDiagramVersionXml(
  diagramId: string,
  version: number
): Promise<{ version: number; xml: string }> {
  await ensureDiligence();
  await fetchDiagramRow(diagramId);
  const db = sql();
  const rows = await db`
    SELECT xml_gzip FROM diligence.bpmn_versions
    WHERE diagram_id = ${diagramId} AND version = ${version} LIMIT 1`;
  if (!rows.length) throw new Error("version_not_found");
  const buf = (rows[0] as Record<string, unknown>).xml_gzip;
  return {
    version,
    xml: gunzipSync(Buffer.from(buf as Buffer)).toString("utf8"),
  };
}

import { sql, newId, str, num, numOrNull, isoOrNull } from "../platform/db";
import { ensureValueCreation } from "./schema";
import { VcError, requirePlan } from "./service";
import { TEMPLATE_LINES_BY_KEY } from "../financials/template";

/**
 * Driver trees (Phase 6, WS-B) — value-creation driver trees per plan.
 *
 * Tables are WS-A's (lib/valuecreation/schema.ts ensureValueCreation):
 *   valuecreation.driver_trees(id, plan_id, name, timestamps, deleted_at)
 *   valuecreation.driver_nodes(id, tree_id, parent_id, label, node_kind,
 *     line_key, target_value, unit, notes, sort, timestamps, deleted_at)
 *
 * Rules honored:
 * - List payloads carry node COUNTS only — never the deep node payload;
 *   the full flat node list is returned only by getTree (single record).
 * - line_key validation is anchored to the financials template, the
 *   single source of truth (TEMPLATE_LINES_BY_KEY in
 *   lib/financials/template.ts — a pure constants module; all financial
 *   DATA still flows through lib/financials/service.ts).
 * - Soft delete everywhere; deleting a node reparents its children to
 *   the deleted node's parent so the tree never orphans a subtree.
 */

export type DriverNodeKind = "metric" | "driver" | "line";

export interface DriverTreeRow {
  id: string;
  planId: string;
  name: string;
  nodeCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface DriverNodeRow {
  id: string;
  treeId: string;
  parentId: string | null;
  label: string;
  nodeKind: DriverNodeKind;
  lineKey: string | null;
  targetValue: number | null;
  unit: string;
  notes: string;
  sort: number;
  createdAt: string;
  updatedAt: string;
}

const NODE_KINDS: readonly string[] = ["metric", "driver", "line"];

function rowToTree(r: Record<string, unknown>): DriverTreeRow {
  return {
    id: str(r.id),
    planId: str(r.plan_id),
    name: str(r.name),
    nodeCount: num(r.node_count),
    createdAt: isoOrNull(r.created_at) ?? "",
    updatedAt: isoOrNull(r.updated_at) ?? "",
  };
}

function rowToNode(r: Record<string, unknown>): DriverNodeRow {
  const kind = str(r.node_kind);
  return {
    id: str(r.id),
    treeId: str(r.tree_id),
    parentId: r.parent_id ? str(r.parent_id) : null,
    label: str(r.label),
    nodeKind: (NODE_KINDS.includes(kind) ? kind : "driver") as DriverNodeKind,
    lineKey: r.line_key ? str(r.line_key) : null,
    targetValue: numOrNull(r.target_value),
    unit: str(r.unit),
    notes: str(r.notes),
    sort: num(r.sort),
    createdAt: isoOrNull(r.created_at) ?? "",
    updatedAt: isoOrNull(r.updated_at) ?? "",
  };
}

const TREE_COLS = `
  t.id, t.plan_id, t.name, t.created_at, t.updated_at,
  (SELECT count(*)::int FROM valuecreation.driver_nodes n
    WHERE n.tree_id = t.id AND n.deleted_at IS NULL) AS node_count`;

async function fetchTreeRow(treeId: string): Promise<DriverTreeRow> {
  const db = sql();
  const rows = await db`
    SELECT ${db.unsafe(TREE_COLS)} FROM valuecreation.driver_trees t
    WHERE t.id = ${treeId} AND t.deleted_at IS NULL LIMIT 1`;
  if (!rows.length) throw new VcError("tree_not_found");
  return rowToTree(rows[0] as Record<string, unknown>);
}

async function fetchNodeRow(nodeId: string): Promise<DriverNodeRow | null> {
  const db = sql();
  const rows = await db`
    SELECT * FROM valuecreation.driver_nodes
    WHERE id = ${nodeId} AND deleted_at IS NULL LIMIT 1`;
  return rows.length ? rowToNode(rows[0] as Record<string, unknown>) : null;
}

async function requireNode(nodeId: string): Promise<DriverNodeRow> {
  const node = await fetchNodeRow(nodeId);
  if (!node) throw new VcError("node_not_found");
  return node;
}

/** Any provided lineKey must exist in the financials template. */
function validateLineKey(lineKey: string | null): void {
  if (lineKey === null || lineKey === "") return;
  if (!Object.prototype.hasOwnProperty.call(TEMPLATE_LINES_BY_KEY, lineKey)) {
    throw new VcError("invalid_line_key");
  }
}

function validateKindAndLine(
  nodeKind: string,
  lineKey: string | null
): DriverNodeKind {
  if (!NODE_KINDS.includes(nodeKind)) throw new VcError("invalid_node_kind");
  if (nodeKind === "line" && !lineKey) throw new VcError("line_key_required");
  validateLineKey(lineKey);
  return nodeKind as DriverNodeKind;
}

/* -------------------------------- trees -------------------------------- */

/** List trees for a plan with node counts. NO deep node payload. */
export async function listTrees(planId: string): Promise<DriverTreeRow[]> {
  await ensureValueCreation();
  await requirePlan(planId);
  const db = sql();
  const rows = await db`
    SELECT ${db.unsafe(TREE_COLS)} FROM valuecreation.driver_trees t
    WHERE t.plan_id = ${planId} AND t.deleted_at IS NULL
    ORDER BY t.created_at ASC`;
  return rows.map((r) => rowToTree(r as Record<string, unknown>));
}

export async function createTree(
  planId: string,
  input: { name: string },
  actor: string
): Promise<DriverTreeRow> {
  await ensureValueCreation();
  await requirePlan(planId);
  void actor;
  const name = (input.name ?? "").trim();
  if (!name) throw new VcError("name_required");
  const db = sql();
  const id = `vct_${newId()}`;
  await db`
    INSERT INTO valuecreation.driver_trees (id, plan_id, name)
    VALUES (${id}, ${planId}, ${name})`;
  return fetchTreeRow(id);
}

/** One tree with its full flat node list (parentId links). */
export async function getTree(
  treeId: string
): Promise<{ tree: DriverTreeRow; nodes: DriverNodeRow[] }> {
  await ensureValueCreation();
  const tree = await fetchTreeRow(treeId);
  const db = sql();
  const rows = await db`
    SELECT * FROM valuecreation.driver_nodes
    WHERE tree_id = ${treeId} AND deleted_at IS NULL
    ORDER BY sort ASC, created_at ASC`;
  return {
    tree,
    nodes: rows.map((r) => rowToNode(r as Record<string, unknown>)),
  };
}

export async function updateTree(
  treeId: string,
  input: { name?: string },
  actor: string
): Promise<DriverTreeRow> {
  await ensureValueCreation();
  void actor;
  const cur = await fetchTreeRow(treeId);
  const name =
    input.name !== undefined ? input.name.trim() : cur.name;
  if (!name) throw new VcError("name_required");
  const db = sql();
  await db`
    UPDATE valuecreation.driver_trees
    SET name = ${name}, updated_at = now()
    WHERE id = ${treeId}`;
  return fetchTreeRow(treeId);
}

/** Soft-delete a tree and all of its nodes. */
export async function deleteTree(
  treeId: string,
  actor: string
): Promise<boolean> {
  await ensureValueCreation();
  void actor;
  const db = sql();
  const rows = await db`
    UPDATE valuecreation.driver_trees
    SET deleted_at = now(), updated_at = now()
    WHERE id = ${treeId} AND deleted_at IS NULL RETURNING id`;
  if (!rows.length) return false;
  await db`
    UPDATE valuecreation.driver_nodes
    SET deleted_at = now(), updated_at = now()
    WHERE tree_id = ${treeId} AND deleted_at IS NULL`;
  return true;
}

/* -------------------------------- nodes -------------------------------- */

export interface CreateNodeInput {
  parentId?: string | null;
  label: string;
  nodeKind: DriverNodeKind | string;
  lineKey?: string | null;
  targetValue?: number | null;
  unit?: string;
  notes?: string;
}

export async function createNode(
  treeId: string,
  input: CreateNodeInput,
  actor: string
): Promise<DriverNodeRow> {
  await ensureValueCreation();
  void actor;
  await fetchTreeRow(treeId);
  const label = (input.label ?? "").trim();
  if (!label) throw new VcError("label_required");
  const lineKey = input.lineKey ? String(input.lineKey) : null;
  const nodeKind = validateKindAndLine(String(input.nodeKind ?? ""), lineKey);
  const parentId = input.parentId ?? null;
  if (parentId !== null) {
    const parent = await fetchNodeRow(parentId);
    if (!parent || parent.treeId !== treeId) {
      throw new VcError("node_parent_not_found");
    }
  }
  const db = sql();
  const maxRows = await db`
    SELECT coalesce(max(sort), 0)::int AS m FROM valuecreation.driver_nodes
    WHERE tree_id = ${treeId} AND deleted_at IS NULL`;
  const sort = num((maxRows[0] as Record<string, unknown>).m) + 10;
  const id = `vcn_${newId()}`;
  await db`
    INSERT INTO valuecreation.driver_nodes
      (id, tree_id, parent_id, label, node_kind, line_key, target_value,
        unit, notes, sort)
    VALUES (${id}, ${treeId}, ${parentId}, ${label}, ${nodeKind}, ${lineKey},
      ${input.targetValue ?? null}, ${(input.unit ?? "").trim()},
      ${input.notes ?? ""}, ${sort})`;
  const created = await fetchNodeRow(id);
  if (!created) throw new VcError("node_not_found");
  return created;
}

export interface UpdateNodePatch {
  parentId?: string | null;
  label?: string;
  nodeKind?: DriverNodeKind | string;
  lineKey?: string | null;
  targetValue?: number | null;
  unit?: string;
  notes?: string;
  sort?: number;
}

export async function updateNode(
  nodeId: string,
  patch: UpdateNodePatch,
  actor: string
): Promise<DriverNodeRow> {
  await ensureValueCreation();
  void actor;
  const cur = await requireNode(nodeId);
  const nextLabel =
    patch.label !== undefined ? patch.label.trim() : cur.label;
  if (!nextLabel) throw new VcError("label_required");
  const nextLineKey =
    patch.lineKey !== undefined
      ? patch.lineKey
        ? String(patch.lineKey)
        : null
      : cur.lineKey;
  const nextKind = validateKindAndLine(
    patch.nodeKind !== undefined ? String(patch.nodeKind) : cur.nodeKind,
    nextLineKey
  );
  const nextParent =
    patch.parentId !== undefined ? patch.parentId : cur.parentId;
  if (patch.parentId !== undefined && nextParent !== cur.parentId) {
    if (nextParent !== null) {
      if (nextParent === nodeId) throw new VcError("node_cycle");
      const parent = await fetchNodeRow(nextParent);
      if (!parent || parent.treeId !== cur.treeId) {
        throw new VcError("node_parent_not_found");
      }
      // Walk up from the proposed parent: reaching this node would
      // close a cycle.
      let cursor: string | null = nextParent;
      const seen = new Set<string>();
      while (cursor) {
        if (cursor === nodeId) throw new VcError("node_cycle");
        if (seen.has(cursor)) break;
        seen.add(cursor);
        const row = await fetchNodeRow(cursor);
        cursor = row ? row.parentId : null;
      }
    }
  }
  const db = sql();
  await db`
    UPDATE valuecreation.driver_nodes
    SET parent_id = ${nextParent},
        label = ${nextLabel},
        node_kind = ${nextKind},
        line_key = ${nextLineKey},
        target_value = ${patch.targetValue !== undefined ? patch.targetValue : cur.targetValue},
        unit = ${patch.unit !== undefined ? patch.unit : cur.unit},
        notes = ${patch.notes !== undefined ? patch.notes : cur.notes},
        sort = ${patch.sort !== undefined ? patch.sort : cur.sort},
        updated_at = now()
    WHERE id = ${nodeId}`;
  return requireNode(nodeId);
}

/**
 * Soft-delete a node. Its children are reparented to the deleted
 * node's parent (NULL → they become roots) so no subtree is orphaned.
 */
export async function deleteNode(
  nodeId: string,
  actor: string
): Promise<boolean> {
  await ensureValueCreation();
  void actor;
  const node = await fetchNodeRow(nodeId);
  if (!node) return false;
  const db = sql();
  await db`
    UPDATE valuecreation.driver_nodes
    SET parent_id = ${node.parentId}, updated_at = now()
    WHERE parent_id = ${nodeId} AND deleted_at IS NULL`;
  const rows = await db`
    UPDATE valuecreation.driver_nodes
    SET deleted_at = now(), updated_at = now()
    WHERE id = ${nodeId} AND deleted_at IS NULL RETURNING id`;
  return rows.length > 0;
}

/* --------------------------- margin template ---------------------------- */

/**
 * Seed the standard "Margin improvement" driver tree:
 *   Margin improvement (metric)
 *   ├─ Gross margin (line: gross_profit)
 *   │   ├─ Price (driver: revenue)
 *   │   ├─ Volume (driver: revenue)
 *   │   └─ Mix (driver: cogs)
 *   └─ Operating leverage (driver: operating_expenses)
 * Returns the created tree with its nodes (getTree shape).
 */
export async function createMarginTemplateTree(
  planId: string,
  actor: string
): Promise<{ tree: DriverTreeRow; nodes: DriverNodeRow[] }> {
  const tree = await createTree(planId, { name: "Margin improvement" }, actor);
  const root = await createNode(
    tree.id,
    { label: "Margin improvement", nodeKind: "metric" },
    actor
  );
  const grossMargin = await createNode(
    tree.id,
    {
      parentId: root.id,
      label: "Gross margin",
      nodeKind: "line",
      lineKey: "gross_profit",
    },
    actor
  );
  await createNode(
    tree.id,
    { parentId: grossMargin.id, label: "Price", nodeKind: "driver", lineKey: "revenue" },
    actor
  );
  await createNode(
    tree.id,
    { parentId: grossMargin.id, label: "Volume", nodeKind: "driver", lineKey: "revenue" },
    actor
  );
  await createNode(
    tree.id,
    { parentId: grossMargin.id, label: "Mix", nodeKind: "driver", lineKey: "cogs" },
    actor
  );
  await createNode(
    tree.id,
    {
      parentId: root.id,
      label: "Operating leverage",
      nodeKind: "driver",
      lineKey: "operating_expenses",
    },
    actor
  );
  return getTree(tree.id);
}

import { sql, str, isoOrNull, num } from "./db";
import { logUsage } from "./usage";
import type { SearchItem, SearchItemKind } from "./types";

/**
 * Global search across companies, people, documents, legacy tasks, and
 * notes (activity). Postgres FTS (search_vector @@ plainto_tsquery) with
 * a normalized-name ILIKE fallback; list queries select only the columns
 * the result rows render (rules: no SELECT *, paginate everything).
 */

const KINDS: SearchItemKind[] = ["company", "person", "document", "task", "note"];

/**
 * Phase 2 (Directory): organizations are searchable as kind
 * "organization". SearchItemKind in types.ts does not yet include it,
 * so it is carried here as a local extension and cast at the push site;
 * runtime consumers (GlobalSearch) treat kind as a plain string.
 */
type SearchKind = SearchItemKind | "organization";
const ALL_KINDS: SearchKind[] = [...KINDS, "organization"];

export async function searchAll(
  q: string,
  type?: string,
  limit = 20
): Promise<SearchItem[]> {
  const query = (q ?? "").trim();
  if (!query) return [];
  const lim = Math.min(50, Math.max(1, limit || 20));
  const want = (k: SearchKind): boolean =>
    !type || type === "all" || type === k || !ALL_KINDS.includes(type as SearchKind);
  const like = `%${query}%`;
  const db = sql();
  const items: SearchItem[] = [];

  if (want("company")) {
    const rows = await db`
      SELECT id, name, vertical, city, state, updated_at,
        coalesce(logo_version, 0) AS logo_version
      FROM core.companies
      WHERE deleted_at IS NULL
        AND (search_vector @@ plainto_tsquery('english', ${query})
          OR normalized_name ILIKE ${like})
      ORDER BY updated_at DESC
      LIMIT ${lim}`;
    for (const r of rows) {
      const rec = r as Record<string, unknown>;
      items.push({
        kind: "company",
        id: str(rec.id),
        title: str(rec.name),
        subtitle: [str(rec.vertical), str(rec.city), str(rec.state)]
          .filter(Boolean)
          .join(" · "),
        href: `/companies/${str(rec.id)}`,
        updatedAt: isoOrNull(rec.updated_at),
        logoVersion: num(rec.logo_version),
      });
    }
  }

  if (want("person")) {
    const rows = await db`
      SELECT id, name, title, organization_name, kind, updated_at
      FROM core.people
      WHERE deleted_at IS NULL
        AND (search_vector @@ plainto_tsquery('english', ${query})
          OR normalized_name ILIKE ${like})
      ORDER BY updated_at DESC
      LIMIT ${lim}`;
    for (const r of rows) {
      const rec = r as Record<string, unknown>;
      items.push({
        kind: "person",
        id: str(rec.id),
        title: str(rec.name),
        subtitle: [str(rec.title), str(rec.organization_name), str(rec.kind)]
          .filter(Boolean)
          .join(" · "),
        href: `/directory?q=${encodeURIComponent(str(rec.name))}`,
        updatedAt: isoOrNull(rec.updated_at),
      });
    }
  }

  if (want("organization")) {
    const rows = await db`
      SELECT id, name, kind, website, updated_at,
        coalesce(logo_version, 0) AS logo_version
      FROM core.organizations
      WHERE deleted_at IS NULL
        AND (normalized_name ILIKE ${like} OR name ILIKE ${like})
      ORDER BY updated_at DESC
      LIMIT ${lim}`;
    for (const r of rows) {
      const rec = r as Record<string, unknown>;
      items.push({
        kind: "organization" as SearchItemKind,
        id: str(rec.id),
        title: str(rec.name),
        subtitle: [str(rec.kind), str(rec.website)]
          .filter(Boolean)
          .join(" · "),
        href: `/directory?q=${encodeURIComponent(str(rec.name))}`,
        updatedAt: isoOrNull(rec.updated_at),
        logoVersion: num(rec.logo_version),
      });
    }
  }

  if (want("document")) {
    // Phase 3: the search_vector now includes extracted document text
    // (folded in by the extraction job), so content matches land here.
    // Results open the Documents library focused on the document.
    const rows = await db`
      SELECT d.id, d.name, d.mime, d.company_id, d.updated_at,
        coalesce(co.name, '') AS company_name,
        coalesce(ld.company_name, '') AS deal_name
      FROM core.documents d
      LEFT JOIN core.companies co ON co.id = d.company_id
      LEFT JOIN deals ld ON ld.id = d.deal_id
      WHERE d.deleted_at IS NULL
        AND (d.search_vector @@ plainto_tsquery('english', ${query})
          OR d.name ILIKE ${like})
      ORDER BY d.updated_at DESC
      LIMIT ${lim}`;
    for (const r of rows) {
      const rec = r as Record<string, unknown>;
      items.push({
        kind: "document",
        id: str(rec.id),
        title: str(rec.name),
        subtitle: [
          str(rec.mime),
          str(rec.deal_name) || str(rec.company_name),
        ]
          .filter(Boolean)
          .join(" · "),
        href: `/documents?doc=${str(rec.id)}`,
        updatedAt: isoOrNull(rec.updated_at),
      });
    }
  }

  if (want("task")) {
    const rows = await db`
      SELECT id, title, due_date, done, owner, updated_at
      FROM tasks
      WHERE title ILIKE ${like}
      ORDER BY updated_at DESC
      LIMIT ${lim}`;
    for (const r of rows) {
      const rec = r as Record<string, unknown>;
      items.push({
        kind: "task",
        id: str(rec.id),
        title: str(rec.title),
        subtitle: [
          rec.done ? "Done" : "Open",
          str(rec.due_date) ? `due ${str(rec.due_date)}` : "",
          str(rec.owner),
        ]
          .filter(Boolean)
          .join(" · "),
        href: "/overview",
        updatedAt: isoOrNull(rec.updated_at),
      });
    }
  }

  if (want("note")) {
    const coreRows = await db`
      SELECT id, entity_kind, entity_id, message, created_at
      FROM core.activity_log
      WHERE message ILIKE ${like}
      ORDER BY created_at DESC
      LIMIT ${lim}`;
    for (const r of coreRows) {
      const rec = r as Record<string, unknown>;
      const entityId = str(rec.entity_id);
      items.push({
        kind: "note",
        id: str(rec.id),
        title: str(rec.message),
        subtitle: "Note",
        href: entityId.startsWith("co_") ? `/companies/${entityId}` : "/overview",
        updatedAt: isoOrNull(rec.created_at),
      });
    }
    const legacyRows = await db`
      SELECT id, deal_id, message, created_at
      FROM activity
      WHERE message ILIKE ${like}
      ORDER BY created_at DESC
      LIMIT ${lim}`;
    for (const r of legacyRows) {
      const rec = r as Record<string, unknown>;
      items.push({
        kind: "note",
        id: `legacy_${str(rec.id)}`,
        title: str(rec.message),
        subtitle: "Note",
        href: rec.deal_id ? `/companies/co_${str(rec.deal_id)}` : "/overview",
        updatedAt: isoOrNull(rec.created_at),
      });
    }
  }

  // Dedupe identical hits (e.g. an activity row and its backfilled
  // core.activity_log copy surface the same note twice).
  const seen = new Set<string>();
  const deduped = items.filter((it) => {
    const key = `${it.kind}|${it.title}|${it.updatedAt ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  deduped.sort((a, b) => {
    const ta = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
    const tb = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
    return tb - ta;
  });
  const out = deduped.slice(0, lim);
  logUsage("search", out.length, num(JSON.stringify(out).length));
  return out;
}

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

export async function searchAll(
  q: string,
  type?: string,
  limit = 20
): Promise<SearchItem[]> {
  const query = (q ?? "").trim();
  if (!query) return [];
  const lim = Math.min(50, Math.max(1, limit || 20));
  const want = (k: SearchItemKind): boolean =>
    !type || type === "all" || type === k || !KINDS.includes(type as SearchItemKind);
  const like = `%${query}%`;
  const db = sql();
  const items: SearchItem[] = [];

  if (want("company")) {
    const rows = await db`
      SELECT id, name, vertical, city, state, updated_at
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

  if (want("document")) {
    const rows = await db`
      SELECT id, name, mime, company_id, updated_at
      FROM core.documents
      WHERE search_vector @@ plainto_tsquery('english', ${query})
        OR name ILIKE ${like}
      ORDER BY updated_at DESC
      LIMIT ${lim}`;
    for (const r of rows) {
      const rec = r as Record<string, unknown>;
      items.push({
        kind: "document",
        id: str(rec.id),
        title: str(rec.name),
        subtitle: str(rec.mime),
        href: rec.company_id ? `/companies/${str(rec.company_id)}` : "/directory",
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

import { sql, newId, str, num, isoOrNull } from "./db";
import { logUsage } from "./usage";
import { getDealFlow, getTasks } from "../db";

/**
 * Collaboration service (Phase 2, workstream D) — comments + @mentions,
 * the platform activity feed, the notification center's data, and the
 * unified tasks read model. This is the ONE collab module (comments.ts
 * + notifications.ts were folded together — they share the mention →
 * notification write path).
 *
 * Storage:
 *  - core.comments / core.activity_log already exist (Phase 1 schema).
 *  - core.notifications is created here by ensureNotificationsSchema()
 *    (db.ts is owned by another workstream and is not edited).
 *
 * Mention model decision:
 *  - Mentionables are the three partners (PARTNER_NAMES in lib/types)
 *    plus core.people names. The auth model (lib/auth.ts) only seeds a
 *    login for Ethan Canny (ethan@cannycapitalpartners.com); Ronan
 *    Canny and Ian Canny have NO email/login anywhere in the codebase,
 *    so no email is invented for them.
 *  - @Name parsing matches full names case-insensitively against the
 *    mentionable list (the composer inserts "@Full Name"), with a
 *    first-name fallback only when that first name is unambiguous.
 *    Matched names are stored on core.comments.mentions (JSONB).
 *  - A core.notifications row (kind "mention") is written ONLY for a
 *    mentioned partner who has a known email and is not the author —
 *    an email-less partner's mention is still stored on the comment,
 *    it just has no deliverable inbox row yet.
 *
 * Notifications merge (notification center):
 *  - Platform notifications: UNREAD core.notifications rows addressed
 *    to the session user (user_email = their email, or '' = all
 *    internal). The center is an inbox, not a history: clearing an
 *    item stamps read_at and the row leaves the list for good
 *    (Ethan, Oct 24, 2026 — clearing must be able to reach an EMPTY
 *    list; a dismissal stays gone). Read rows remain in the table
 *    as history but are never re-listed.
 *  - Activity notifications: UNREAD deal_flow items (status "new",
 *    readAt null) — the exact set lib/badge.ts counts. They are
 *    presented read=false, link to /activity, and are NOT marked read
 *    here: their read flow already exists (POST /api/deal-flow/read,
 *    driven by the Activity page). No duplication, no fork.
 *  - NO web push is sent for mentions in this phase (center entry
 *    only) — that avoids double-notifying alongside the existing
 *    push/badge system.
 */

export interface PartnerRef {
  name: string;
  email: string;
}

/** Partners from the auth model + PARTNER_NAMES. Only Ethan's email is
 * known (the sole seeded login in lib/auth.ts); the others are "". */
export const PARTNERS: PartnerRef[] = [
  { name: "Ethan Canny", email: "ethan@cannycapitalpartners.com" },
  { name: "Ronan Canny", email: "" },
  { name: "Ian Canny", email: "" },
];

/* --------------------- notifications schema --------------------- */

let notifSchemaReady: Promise<void> | null = null;

export function ensureNotificationsSchema(): Promise<void> {
  if (!notifSchemaReady) {
    notifSchemaReady = (async () => {
      const db = sql();
      await db`
        CREATE TABLE IF NOT EXISTS core.notifications (
          id TEXT PRIMARY KEY,
          user_email TEXT NOT NULL DEFAULT '',
          kind TEXT NOT NULL DEFAULT '',
          title TEXT NOT NULL DEFAULT '',
          body TEXT NOT NULL DEFAULT '',
          href TEXT NOT NULL DEFAULT '',
          entity_kind TEXT NOT NULL DEFAULT '',
          entity_id TEXT NOT NULL DEFAULT '',
          read_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )`;
      await db`
        CREATE INDEX IF NOT EXISTS core_notifications_user_idx
        ON core.notifications (user_email, read_at, created_at DESC)`;
    })().catch((err) => {
      notifSchemaReady = null;
      throw err;
    });
  }
  return notifSchemaReady;
}

/* --------------------------- mentions --------------------------- */

export interface Mentionable {
  name: string;
  email: string;
  kind: "partner" | "person";
}

export async function listMentionables(): Promise<Mentionable[]> {
  const out: Mentionable[] = PARTNERS.map((p) => ({
    name: p.name,
    email: p.email,
    kind: "partner" as const,
  }));
  try {
    const db = sql();
    const rows = await db`
      SELECT name, email FROM core.people
      WHERE deleted_at IS NULL AND name <> ''
      ORDER BY name ASC
      LIMIT 50`;
    const seen = new Set(out.map((m) => m.name.toLowerCase()));
    for (const r of rows) {
      const rec = r as Record<string, unknown>;
      const name = str(rec.name);
      if (!name || seen.has(name.toLowerCase())) continue;
      seen.add(name.toLowerCase());
      out.push({ name, email: str(rec.email), kind: "person" });
    }
  } catch {
    /* people lookup is an enhancement — partners alone still work */
  }
  return out;
}

/** Names the parser matches against: partners + a wider people slice
 * than the autocomplete list, so @mentions of any known person store. */
async function mentionCandidateNames(): Promise<string[]> {
  const names = PARTNERS.map((p) => p.name);
  try {
    const db = sql();
    const rows = await db`
      SELECT name FROM core.people
      WHERE deleted_at IS NULL AND name <> ''
      ORDER BY name ASC
      LIMIT 500`;
    for (const r of rows) {
      const name = str((r as Record<string, unknown>).name);
      if (name) names.push(name);
    }
  } catch {
    /* fall through with partners only */
  }
  return names;
}

export function parseMentions(body: string, candidates: string[]): string[] {
  const hay = ` ${body.toLowerCase()} `;
  const matched: string[] = [];
  const seen = new Set<string>();
  // Longest names first so "Ian Canny" wins over a shorter overlap.
  const sorted = [...candidates].sort((a, b) => b.length - a.length);
  for (const name of sorted) {
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    if (hay.includes(`@${key}`)) {
      matched.push(name);
      seen.add(key);
    }
  }
  // First-name fallback: "@Ethan" counts only if exactly one
  // candidate carries that first name.
  if (matched.length === 0) {
    const tokens = body.match(/@([A-Za-z][A-Za-z.'-]*)/g) ?? [];
    for (const tok of tokens) {
      const first = tok.slice(1).toLowerCase();
      const hits = candidates.filter(
        (n) => n.split(/\s+/)[0]?.toLowerCase() === first
      );
      const unique = Array.from(new Set(hits.map((h) => h.toLowerCase())));
      if (unique.length === 1) {
        const name = hits[0];
        if (!seen.has(name.toLowerCase())) {
          matched.push(name);
          seen.add(name.toLowerCase());
        }
      }
    }
  }
  return matched;
}

/* ------------------------- entity hrefs ------------------------- */

async function entityName(entityKind: string, entityId: string): Promise<string> {
  try {
    const db = sql();
    if (entityKind === "company") {
      const rows = await db`
        SELECT name FROM core.companies WHERE id = ${entityId} LIMIT 1`;
      return rows.length ? str(rows[0].name) : "";
    }
    if (entityKind === "person" || entityKind === "executive") {
      const rows = await db`
        SELECT name FROM core.people WHERE id = ${entityId} LIMIT 1`;
      return rows.length ? str(rows[0].name) : "";
    }
    if (entityKind === "deal") {
      const rows = await db`
        SELECT c.name AS name FROM core.deals d
        LEFT JOIN core.companies c ON c.id = d.company_id
        WHERE d.id = ${entityId} LIMIT 1`;
      return rows.length ? str(rows[0].name) : "";
    }
  } catch {
    /* name resolution is best-effort */
  }
  return "";
}

export async function entityHref(
  entityKind: string,
  entityId: string
): Promise<string> {
  if (!entityId) return "/overview";
  if (entityKind === "company") return `/companies/${entityId}`;
  if (entityKind === "deal") return `/deals/${entityId}`;
  if (entityKind === "person" || entityKind === "executive") {
    const name = await entityName(entityKind, entityId);
    return name ? `/directory?q=${encodeURIComponent(name)}` : "/directory";
  }
  return "/overview";
}

/* --------------------------- comments --------------------------- */

export interface CommentRow {
  id: string;
  entityKind: string;
  entityId: string;
  author: string;
  body: string;
  mentions: string[];
  source: string;
  createdAt: string;
  updatedAt: string;
}

function parseMentionsField(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x)).filter(Boolean);
  if (typeof v === "string" && v.trim()) {
    try {
      const p = JSON.parse(v) as unknown;
      if (Array.isArray(p)) return p.map((x) => String(x)).filter(Boolean);
    } catch {
      /* not JSON — treat as no mentions */
    }
  }
  return [];
}

function rowToComment(r: Record<string, unknown>): CommentRow {
  return {
    id: str(r.id),
    entityKind: str(r.entity_kind),
    entityId: str(r.entity_id),
    author: str(r.author),
    body: str(r.body),
    mentions: parseMentionsField(r.mentions),
    source: str(r.source),
    createdAt: isoOrNull(r.created_at) ?? "",
    updatedAt: isoOrNull(r.updated_at) ?? "",
  };
}

export async function listComments(
  entityKind: string,
  entityId: string,
  limit = 50
): Promise<CommentRow[]> {
  const db = sql();
  const lim = Math.min(50, Math.max(1, limit || 50));
  const rows = await db`
    SELECT id, entity_kind, entity_id, author, body, mentions, source,
      created_at, updated_at
    FROM core.comments
    WHERE entity_kind = ${entityKind} AND entity_id = ${entityId}
      AND deleted_at IS NULL
    ORDER BY created_at DESC
    LIMIT ${lim}`;
  const items = rows.map((r) => rowToComment(r as Record<string, unknown>));
  logUsage("comments_list", items.length, JSON.stringify(items).length);
  return items;
}

export async function createComment(opts: {
  entityKind: string;
  entityId: string;
  body: string;
  author: string;
  actorEmail: string;
}): Promise<CommentRow> {
  const db = sql();
  await ensureNotificationsSchema();
  const body = opts.body.trim();
  const candidates = await mentionCandidateNames();
  const mentions = parseMentions(body, candidates);
  const id = newId();
  const rows = await db`
    INSERT INTO core.comments (id, entity_kind, entity_id, author, body, mentions, source)
    VALUES (${id}, ${opts.entityKind}, ${opts.entityId}, ${opts.author},
      ${body}, ${JSON.stringify(mentions)}::jsonb, 'manual')
    RETURNING id, entity_kind, entity_id, author, body, mentions, source,
      created_at, updated_at`;
  const comment = rowToComment(rows[0] as Record<string, unknown>);

  // Activity log row for the entity feed.
  try {
    await db`
      INSERT INTO core.activity_log (id, entity_kind, entity_id, actor, kind, message, source)
      VALUES (${newId()}, ${opts.entityKind}, ${opts.entityId}, ${opts.author},
        'comment', ${`Comment: ${body.slice(0, 140)}`}, 'manual')`;
  } catch (err) {
    console.error("[collab] activity_log write failed", err);
  }

  // Mention notifications — partners with a known email only, never
  // the author notifying themselves. No web push (see header note).
  const href = await entityHref(opts.entityKind, opts.entityId);
  const excerpt = body.slice(0, 140);
  for (const name of mentions) {
    const partner = PARTNERS.find(
      (p) => p.name.toLowerCase() === name.toLowerCase()
    );
    if (!partner || !partner.email) continue;
    if (
      partner.email.toLowerCase() === opts.actorEmail.toLowerCase() ||
      partner.name.toLowerCase() === opts.author.toLowerCase()
    ) {
      continue;
    }
    try {
      await db`
        INSERT INTO core.notifications
          (id, user_email, kind, title, body, href, entity_kind, entity_id)
        VALUES (${newId()}, ${partner.email}, 'mention', 'You were mentioned',
          ${excerpt}, ${href}, ${opts.entityKind}, ${opts.entityId})`;
    } catch (err) {
      console.error("[collab] mention notification write failed", err);
    }
  }
  return comment;
}

/** Soft-delete a comment; only its author may delete it. */
export async function deleteComment(
  id: string,
  authorName: string
): Promise<{ ok: boolean; error?: string }> {
  const db = sql();
  const rows = await db`
    SELECT id, author FROM core.comments
    WHERE id = ${id} AND deleted_at IS NULL LIMIT 1`;
  if (!rows.length) return { ok: false, error: "Comment not found" };
  const rec = rows[0] as Record<string, unknown>;
  if (str(rec.author).toLowerCase() !== authorName.toLowerCase()) {
    return { ok: false, error: "Only the author can delete this comment" };
  }
  await db`
    UPDATE core.comments SET deleted_at = now(), updated_at = now()
    WHERE id = ${id}`;
  return { ok: true };
}

/* --------------------------- activity --------------------------- */

export interface ActivityRow {
  id: string;
  entityKind: string;
  entityId: string;
  actor: string;
  kind: string;
  message: string;
  source: string;
  createdAt: string;
}

export async function listActivity(opts: {
  entityKind?: string;
  entityId?: string;
  limit?: number;
}): Promise<ActivityRow[]> {
  const db = sql();
  const kind = (opts.entityKind ?? "").trim();
  const eid = (opts.entityId ?? "").trim();
  const lim = Math.min(50, Math.max(1, opts.limit || 25));
  const rows = await db`
    SELECT id, entity_kind, entity_id, actor, kind, message, source, created_at
    FROM core.activity_log
    WHERE (${kind} = '' OR entity_kind = ${kind})
      AND (${eid} = '' OR entity_id = ${eid})
    ORDER BY created_at DESC
    LIMIT ${lim}`;
  const items: ActivityRow[] = rows.map((r) => {
    const rec = r as Record<string, unknown>;
    return {
      id: str(rec.id),
      entityKind: str(rec.entity_kind),
      entityId: str(rec.entity_id),
      actor: str(rec.actor),
      kind: str(rec.kind),
      message: str(rec.message),
      source: str(rec.source),
      createdAt: isoOrNull(rec.created_at) ?? "",
    };
  });
  logUsage("activity_list", items.length, JSON.stringify(items).length);
  return items;
}

/* ------------------------- notifications ------------------------ */

export interface NotificationItem {
  id: string;
  source: "platform" | "activity";
  kind: string;
  title: string;
  body: string;
  href: string;
  read: boolean;
  createdAt: string;
}

export async function listNotifications(
  userEmail: string,
  limit = 50
): Promise<{ items: NotificationItem[]; unreadCount: number }> {
  await ensureNotificationsSchema();
  const db = sql();
  const email = userEmail.trim().toLowerCase();
  const lim = Math.min(50, Math.max(1, limit || 50));
  // Unread only — see the header note. Returning read rows here is
  // what made the center impossible to empty: clearing stamped
  // read_at, but the rows kept rendering (dimmed) forever.
  const rows = await db`
    SELECT id, kind, title, body, href, read_at, created_at
    FROM core.notifications
    WHERE (user_email = ${email} OR user_email = '') AND read_at IS NULL
    ORDER BY created_at DESC
    LIMIT ${lim}`;
  const platform: NotificationItem[] = rows.map((r) => {
    const rec = r as Record<string, unknown>;
    return {
      id: str(rec.id),
      source: "platform" as const,
      kind: str(rec.kind),
      title: str(rec.title),
      body: str(rec.body),
      href: str(rec.href) || "/overview",
      read: Boolean(rec.read_at),
      createdAt: isoOrNull(rec.created_at) ?? "",
    };
  });
  const countRows = await db`
    SELECT count(*)::int AS n FROM core.notifications
    WHERE (user_email = ${email} OR user_email = '') AND read_at IS NULL`;
  const platformUnread = countRows.length
    ? num((countRows[0] as Record<string, unknown>).n)
    : 0;

  // Unread deal_flow items — the existing notification concept
  // (lib/badge.ts). Presented, never marked read here.
  let activity: NotificationItem[] = [];
  try {
    const flow = await getDealFlow();
    activity = flow
      .filter((i) => i.status === "new" && !i.readAt)
      .map((i) => ({
        id: i.id,
        source: "activity" as const,
        kind: i.kind,
        title: i.title,
        body: i.why || i.sourceDetail || i.source || "",
        href: "/activity",
        read: false,
        createdAt: i.createdAt,
      }));
  } catch {
    /* deal_flow unavailable — platform notifications still render */
  }

  const items = [...platform, ...activity]
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))
    .slice(0, 50);
  const unreadCount = platformUnread + activity.length;
  logUsage("notifications_list", items.length, JSON.stringify(items).length);
  return { items, unreadCount };
}

export async function markNotificationRead(
  id: string,
  userEmail: string
): Promise<boolean> {
  await ensureNotificationsSchema();
  const db = sql();
  const email = userEmail.trim().toLowerCase();
  const rows = await db`
    UPDATE core.notifications SET read_at = now()
    WHERE id = ${id} AND (user_email = ${email} OR user_email = '')
      AND read_at IS NULL
    RETURNING id`;
  return rows.length > 0;
}

export async function markAllNotificationsRead(
  userEmail: string
): Promise<number> {
  await ensureNotificationsSchema();
  const db = sql();
  const email = userEmail.trim().toLowerCase();
  const rows = await db`
    UPDATE core.notifications SET read_at = now()
    WHERE (user_email = ${email} OR user_email = '') AND read_at IS NULL
    RETURNING id`;
  return rows.length;
}

/* ------------------------- unified tasks ------------------------ */

export interface UnifiedTask {
  id: string;
  title: string;
  dueAt: string;
  type: string;
  priority: string;
  status: "open" | "completed";
  assignee: string;
  linked: {
    kind: string;
    id: string;
    label: string;
    href: string;
  } | null;
  onCalendar: boolean;
}

/**
 * Unified tasks read model: legacy follow-up tasks (lib/db getTasks)
 * enriched with core linkage — a deal task resolves through
 * core.deals → core.companies for its label/href, an executive task
 * through core.people.legacy_exec_id. Both resolutions are single
 * batched queries (no N+1); failures fall back to the task's stored
 * relatedName so the list still renders.
 */
export async function getUnifiedTasks(): Promise<UnifiedTask[]> {
  const tasks = await getTasks();
  const dealIds = Array.from(
    new Set(
      tasks
        .filter((t) => t.relatedKind === "deal" && t.relatedId)
        .map((t) => t.relatedId as string)
    )
  );
  const execIds = Array.from(
    new Set(
      tasks
        .filter((t) => t.relatedKind === "executive" && t.relatedId)
        .map((t) => t.relatedId as string)
    )
  );

  const dealMap = new Map<string, { companyId: string; name: string }>();
  const execMap = new Map<string, { personId: string; name: string }>();
  try {
    const db = sql();
    if (dealIds.length) {
      const rows = await db`
        SELECT d.id AS deal_id, c.id AS company_id, c.name AS company_name
        FROM core.deals d
        LEFT JOIN core.companies c ON c.id = d.company_id
        WHERE d.id = ANY(${dealIds})`;
      for (const r of rows) {
        const rec = r as Record<string, unknown>;
        dealMap.set(str(rec.deal_id), {
          companyId: str(rec.company_id),
          name: str(rec.company_name),
        });
      }
    }
    if (execIds.length) {
      const rows = await db`
        SELECT id, legacy_exec_id, name FROM core.people
        WHERE legacy_exec_id = ANY(${execIds})`;
      for (const r of rows) {
        const rec = r as Record<string, unknown>;
        execMap.set(str(rec.legacy_exec_id), {
          personId: str(rec.id),
          name: str(rec.name),
        });
      }
    }
  } catch (err) {
    console.error("[collab] task linkage resolution failed", err);
  }

  const items: UnifiedTask[] = tasks.map((t) => {
    let linked: UnifiedTask["linked"] = null;
    if (t.relatedKind === "deal" && t.relatedId) {
      const hit = dealMap.get(t.relatedId);
      const label = hit?.name || t.relatedName || "Deal";
      linked = hit?.companyId
        ? { kind: "company", id: hit.companyId, label, href: `/companies/${hit.companyId}` }
        : { kind: "deal", id: t.relatedId, label, href: `/deals/${t.relatedId}` };
    } else if (t.relatedKind === "executive" && t.relatedId) {
      const hit = execMap.get(t.relatedId);
      const label = hit?.name || t.relatedName || "Operator";
      linked = {
        kind: "person",
        id: hit?.personId || t.relatedId,
        label,
        href: `/directory?q=${encodeURIComponent(label)}`,
      };
    }
    const dueAt = t.dueDate
      ? t.dueTime
        ? `${t.dueDate}T${t.dueTime}:00`
        : t.dueDate
      : "";
    return {
      id: t.id,
      title: t.title,
      dueAt,
      type: t.type,
      priority: t.priority,
      status: t.done ? ("completed" as const) : ("open" as const),
      assignee: t.owner || "",
      linked,
      onCalendar: Boolean(t.calendarEventId),
    };
  });

  items.sort((a, b) => {
    if (a.dueAt && b.dueAt) return a.dueAt < b.dueAt ? -1 : a.dueAt > b.dueAt ? 1 : 0;
    if (a.dueAt) return -1;
    if (b.dueAt) return 1;
    return 0;
  });
  logUsage("unified_tasks", items.length, JSON.stringify(items).length);
  return items;
}

"use client";

/**
 * Comments with @mentions (Phase 2, workstream D) for any platform
 * entity (company / person / deal / …). Reads and posts through
 * /api/platform/comments; the composer autocompletes @Full Name from
 * /api/platform/comments/mentionables (partners + core.people).
 * Mentioned partners with a known email get a notification-center
 * entry server-side — no push in this phase. Fetched on mount and
 * after posting only — no polling. 375px-safe, ES5-ish syntax.
 */

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui";
import { fmtRelTime } from "@/lib/format";

interface CommentItem {
  id: string;
  author: string;
  body: string;
  mentions: string[];
  createdAt: string;
}

interface Mentionable {
  name: string;
  email: string;
  kind: "partner" | "person";
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Render a comment body with its stored @mentions highlighted. */
function renderBody(c: CommentItem) {
  const names = (c.mentions || []).filter(Boolean);
  if (!names.length) return c.body;
  const pattern = new RegExp(
    `(@(?:${names
      .slice()
      .sort((a, b) => b.length - a.length)
      .map(escapeRegExp)
      .join("|")}))`,
    "gi"
  );
  const parts = c.body.split(pattern);
  return parts.map((part, i) =>
    i % 2 === 1 ? (
      <span key={i} className="font-semibold text-gold-700 dark:text-gold-400">
        {part}
      </span>
    ) : (
      <span key={i}>{part}</span>
    )
  );
}

export default function Comments({
  entityKind,
  entityId,
}: {
  entityKind: string;
  entityId: string;
}) {
  const [comments, setComments] = useState<CommentItem[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [draft, setDraft] = useState("");
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState("");
  const [me, setMe] = useState("");
  const [mentionables, setMentionables] = useState<Mentionable[]>([]);
  const [suggestions, setSuggestions] = useState<Mentionable[]>([]);
  const [tokenStart, setTokenStart] = useState(-1);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const load = async () => {
    try {
      const params = new URLSearchParams({ entityKind, entityId });
      const res = await fetch(`/api/platform/comments?${params.toString()}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { comments?: CommentItem[] };
      setComments(Array.isArray(data.comments) ? data.comments : []);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await load();
      if (cancelled) return;
    })();
    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!cancelled && d?.user?.name) setMe(String(d.user.name));
      })
      .catch(() => {});
    fetch("/api/platform/comments/mentionables")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const list = Array.isArray(d) ? d : d?.mentionables;
        if (!cancelled && Array.isArray(list)) setMentionables(list);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityKind, entityId]);

  /** Track the @token immediately before the caret for autocomplete. */
  const updateSuggestions = (value: string, caret: number) => {
    const before = value.slice(0, caret);
    const match = before.match(/@([A-Za-z][A-Za-z .'-]*)$/);
    if (!match) {
      setSuggestions([]);
      setTokenStart(-1);
      return;
    }
    const query = match[1].trim().toLowerCase();
    const hits = mentionables
      .filter((m) => !query || m.name.toLowerCase().includes(query))
      .slice(0, 6);
    setSuggestions(hits);
    setTokenStart(caret - match[0].length);
  };

  const pickSuggestion = (m: Mentionable) => {
    const el = textareaRef.current;
    const caret = el ? el.selectionStart : draft.length;
    const start = tokenStart >= 0 ? tokenStart : caret;
    const next = `${draft.slice(0, start)}@${m.name} ${draft.slice(caret)}`;
    setDraft(next);
    setSuggestions([]);
    setTokenStart(-1);
    requestAnimationFrame(() => {
      if (el) {
        const pos = start + m.name.length + 2;
        el.focus();
        el.setSelectionRange(pos, pos);
      }
    });
  };

  const post = async () => {
    const body = draft.trim();
    if (!body || posting) return;
    setPosting(true);
    setError("");
    try {
      const res = await fetch("/api/platform/comments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entityKind, entityId, body }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setDraft("");
      setSuggestions([]);
      await load();
    } catch {
      setError("Could not post the comment. Try again.");
    } finally {
      setPosting(false);
    }
  };

  const remove = async (id: string) => {
    try {
      const res = await fetch(
        `/api/platform/comments?id=${encodeURIComponent(id)}`,
        { method: "DELETE" }
      );
      if (res.ok) {
        setComments((prev) =>
          prev ? prev.filter((c) => c.id !== id) : prev
        );
      }
    } catch {
      /* delete is best-effort in the UI; the server enforces authorship */
    }
  };

  return (
    <div>
      {/* Composer */}
      <div className="relative">
        <textarea
          ref={textareaRef}
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            updateSuggestions(e.target.value, e.target.selectionStart ?? e.target.value.length);
          }}
          onClick={(e) =>
            updateSuggestions(
              draft,
              (e.target as HTMLTextAreaElement).selectionStart ?? draft.length
            )
          }
          placeholder="Add a comment… use @ to mention a partner or contact"
          rows={3}
          className="w-full min-w-0 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none transition focus:border-[#b8975a] focus:ring-2 focus:ring-[#b8975a]/40 dark:border-white/10 dark:bg-white/5 dark:text-white/90"
        />
        {suggestions.length > 0 && (
          <ul className="absolute inset-x-0 top-full z-20 mt-1 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg dark:border-white/10 dark:bg-[#12294d]">
            {suggestions.map((m) => (
              <li key={`${m.kind}-${m.name}`}>
                <button
                  type="button"
                  onClick={() => pickSuggestion(m)}
                  className="flex min-h-[44px] w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-800 transition hover:bg-[#f0f4fa] dark:text-white/90 dark:hover:bg-white/5"
                >
                  <span className="min-w-0 flex-1 truncate font-medium">
                    {m.name}
                  </span>
                  <span className="badge badge-neutral shrink-0">
                    {m.kind === "partner" ? "Partner" : "Contact"}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {error && (
        <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-500/15 dark:text-red-300">
          {error}
        </p>
      )}
      <div className="mt-2 flex justify-end">
        <Button size="sm" onClick={post} loading={posting} disabled={!draft.trim()}>
          Post comment
        </Button>
      </div>

      {/* Thread */}
      <div className="mt-4">
        {failed ? (
          <p className="text-sm text-caption">Comments could not be loaded.</p>
        ) : comments === null ? (
          <div className="space-y-3" aria-busy="true">
            <div className="skel h-12" />
            <div className="skel h-12" />
            <span className="sr-only">Loading comments…</span>
          </div>
        ) : comments.length === 0 ? (
          <p className="text-sm text-caption">
            No comments yet — start the discussion above.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-white/5">
            {comments.map((c) => (
              <li key={c.id} className="py-3 first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                  <span className="text-sm font-semibold text-[#0d1f3c] dark:text-white">
                    {c.author || "Unknown"}
                  </span>
                  <span className="text-xs text-caption">
                    {c.createdAt ? fmtRelTime(c.createdAt) : ""}
                  </span>
                  {me && c.author.toLowerCase() === me.toLowerCase() && (
                    <button
                      type="button"
                      onClick={() => remove(c.id)}
                      className="ml-auto shrink-0 rounded px-1.5 py-0.5 text-xs text-slate-400 transition hover:bg-red-50 hover:text-red-600 dark:text-white/40 dark:hover:bg-red-500/15 dark:hover:text-red-300"
                    >
                      Delete
                    </button>
                  )}
                </div>
                <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-slate-700 dark:text-white/80">
                  {renderBody(c)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

"use client";

/**
 * Shared right-side drawer for the redesigned diligence tables
 * (checklist, requests, findings). Full-screen on mobile, 440px
 * panel on desktop. Delete lives here — and only here — behind an
 * inline confirmation. Comments reuse the platform collab comments
 * (core.comments) with @mentions.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { api, fmtDateShort } from "@/components/diligence/types";

export function DrawerShell({
  title,
  subtitle,
  onClose,
  onDelete,
  deleteLabel = "Delete",
  children,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  /** When provided, a Delete action renders in the drawer footer. */
  onDelete?: () => Promise<void>;
  deleteLabel?: string;
  children: React.ReactNode;
}) {
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true">
      <button
        type="button"
        aria-label="Close details"
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
      />
      <div className="absolute inset-y-0 right-0 flex w-full flex-col bg-white shadow-2xl dark:bg-[#0d1f3c] sm:w-[440px]">
        <div className="flex items-start justify-between gap-3 border-b-2 border-[#b8975a] px-4 py-3">
          <div className="min-w-0">
            <h3 className="truncate text-base font-semibold text-[#0d1f3c] dark:text-white">
              {title}
            </h3>
            {subtitle && (
              <p className="truncate text-xs text-slate-500 dark:text-white/50">
                {subtitle}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-2 py-1 text-lg leading-none text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-white/10"
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">{children}</div>
        {onDelete && (
          <div className="border-t border-slate-100 px-4 py-3 dark:border-white/10">
            {confirming ? (
              <div className="flex items-center gap-2">
                <span className="flex-1 text-sm text-red-600 dark:text-red-300">
                  Delete this item? This cannot be undone from here.
                </span>
                <button
                  type="button"
                  className="btn btn-sm bg-red-600 text-white hover:bg-red-500"
                  disabled={deleting}
                  onClick={() => {
                    setDeleting(true);
                    void onDelete().finally(() => setDeleting(false));
                  }}
                >
                  {deleting ? "Deleting…" : "Confirm delete"}
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => setConfirming(false)}
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                type="button"
                className="text-sm font-semibold text-red-600 hover:underline dark:text-red-300"
                onClick={() => setConfirming(true)}
              >
                {deleteLabel}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export const drawerLabelCls =
  "mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-white/40";
export const drawerInputCls =
  "w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-[#0d1f3c] outline-none placeholder:text-slate-300 focus:border-[#b8975a] dark:border-white/10 dark:bg-white/5 dark:text-white dark:placeholder:text-white/30";

interface CommentRow {
  id: string;
  author: string;
  body: string;
  mentions: string[];
  createdAt: string;
  mine: boolean;
}

export function CommentsPanel({
  entityKind,
  entityId,
}: {
  entityKind: string;
  entityId: string;
}) {
  const [comments, setComments] = useState<CommentRow[]>([]);
  const [mentionables, setMentionables] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState("");
  const loadedFor = useRef("");

  const load = useCallback(async () => {
    try {
      const data = await api<{ comments: CommentRow[] }>(
        `/api/platform/comments?entityKind=${encodeURIComponent(entityKind)}&entityId=${encodeURIComponent(entityId)}&limit=50`
      );
      setComments(data.comments ?? []);
    } catch {
      setComments([]);
    }
  }, [entityKind, entityId]);

  useEffect(() => {
    if (loadedFor.current === entityId) return;
    loadedFor.current = entityId;
    void load();
    void (async () => {
      try {
        const data = await api<{ mentionables: string[] }>(
          "/api/platform/comments/mentionables"
        );
        setMentionables(data.mentionables ?? []);
      } catch {
        setMentionables([]);
      }
    })();
  }, [entityId, load]);

  const post = async () => {
    const body = draft.trim();
    if (!body || posting) return;
    setPosting(true);
    setError("");
    try {
      await api("/api/platform/comments", {
        method: "POST",
        body: JSON.stringify({ entityKind, entityId, body }),
      });
      setDraft("");
      await load();
    } catch {
      setError("Could not post the comment.");
    } finally {
      setPosting(false);
    }
  };

  return (
    <div>
      {comments.length === 0 ? (
        <p className="text-sm text-slate-500 dark:text-white/50">
          No comments yet.
        </p>
      ) : (
        <ul className="space-y-3">
          {comments.map((c) => (
            <li key={c.id} className="text-sm">
              <span className="font-semibold text-[#0d1f3c] dark:text-white">
                {c.author}
              </span>{" "}
              <span className="text-xs text-slate-400">
                {fmtDateShort(c.createdAt)}
              </span>
              <p className="whitespace-pre-wrap text-[#0d1f3c] dark:text-white/85">
                {c.body}
              </p>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-3">
        <textarea
          className={drawerInputCls}
          rows={3}
          placeholder="Add a comment… use @ to mention a partner"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        {mentionables.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {mentionables.map((name) => (
              <button
                key={name}
                type="button"
                className="rounded-full border border-slate-200 px-2 py-0.5 text-[11px] text-slate-500 hover:border-[#b8975a] dark:border-white/15 dark:text-white/60"
                onClick={() =>
                  setDraft((d) => `${d}${d && !d.endsWith(" ") ? " " : ""}@${name} `)
                }
              >
                @{name.split(" ")[0]}
              </button>
            ))}
          </div>
        )}
        {error && (
          <p className="mt-1 text-xs text-red-600 dark:text-red-300">{error}</p>
        )}
        <button
          type="button"
          className="btn btn-primary btn-sm mt-2"
          disabled={posting || !draft.trim()}
          onClick={() => void post()}
        >
          {posting ? "Posting…" : "Post comment"}
        </button>
      </div>
    </div>
  );
}

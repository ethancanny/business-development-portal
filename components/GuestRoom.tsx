"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, SkeletonRows } from "@/components/ui";
import { fmtDate, fmtRelTime } from "@/lib/format";

interface IndexDoc {
  documentId: string;
  name: string;
  mime: string;
  sizeBytes: number;
  version: number;
  uploadedAt: string;
}
interface FolderRow {
  id: string;
  roomId?: string;
  parentId?: string | null;
  name: string;
  sort?: number;
  isTemplate?: boolean;
  createdAt?: string;
}
interface QaMessage {
  id: string;
  author: string;
  authorKind: string;
  body: string;
  createdAt: string;
}
interface QaThread {
  id: string;
  roomId: string;
  documentId: string | null;
  documentName: string;
  title: string;
  status: string;
  createdBy: string;
  createdByKind: string;
  createdAt: string;
  updatedAt: string;
  messages: QaMessage[];
}
interface GuestPayload {
  guest: { email: string; name: string; accessLevel: string; expiresAt: string };
  room: { id: string; name: string; dealName: string; status: string };
  folders: { folder: FolderRow; documents: IndexDoc[] }[];
  unfiled: IndexDoc[];
  checklist: { id: string; folderId: string | null; label: string; required: boolean; status: string }[];
  completeness: { total: number; satisfied: number; pct: number };
  qa: QaThread[];
}

const cardCls =
  "rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-[#132847]/60 sm:p-6";
const inputCls =
  "w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-[#0d1f3c] outline-none placeholder:text-slate-300 focus:border-[#b8975a] dark:border-white/10 dark:bg-[#132847]/60 dark:text-white dark:placeholder:text-white/30";
const labelCls =
  "mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-white/40";

function fmtBytes(n: number): string {
  if (!n || n <= 0) return "0 B";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export default function GuestRoom({ token }: { token: string }) {
  const [data, setData] = useState<GuestPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorInfo, setErrorInfo] = useState<{ code: string; message: string } | null>(null);
  const [newTitle, setNewTitle] = useState("");
  const [newBody, setNewBody] = useState("");
  const [asking, setAsking] = useState(false);
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setErrorInfo(null);
    try {
      const res = await fetch(`/api/guest/${encodeURIComponent(token)}`);
      const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
      if (!res.ok) {
        const code = json && typeof json.error === "string" ? json.error : "not_found";
        const message =
          json && typeof json.message === "string"
            ? json.message
            : code === "expired"
              ? "This data room link has expired."
              : code === "revoked"
                ? "This data room link has been revoked."
                : code === "room_inactive"
                  ? "This data room is not currently available."
                  : "This data room link is not valid.";
        setErrorInfo({ code, message });
        setData(null);
        return;
      }
      setData(json as unknown as GuestPayload);
    } catch {
      setErrorInfo({ code: "not_found", message: "This data room link is not valid." });
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const ask = async () => {
    if (!newTitle.trim() || !newBody.trim() || asking) return;
    setAsking(true);
    try {
      const res = await fetch(`/api/guest/${encodeURIComponent(token)}/qa`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: newTitle.trim(), body: newBody.trim() }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setNewTitle("");
      setNewBody("");
      await load();
    } catch {
      /* keep drafts */
    } finally {
      setAsking(false);
    }
  };

  const reply = async (threadId: string) => {
    const body = (replyDrafts[threadId] || "").trim();
    if (!body) return;
    try {
      const res = await fetch(`/api/guest/${encodeURIComponent(token)}/qa/${encodeURIComponent(threadId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setReplyDrafts((prev) => ({ ...prev, [threadId]: "" }));
      await load();
    } catch {
      /* keep draft */
    }
  };

  if (loading) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10">
        <SkeletonRows rows={5} />
      </div>
    );
  }

  if (errorInfo || !data) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0d1f3c] px-4 py-10">
        <div className="w-full max-w-md rounded-2xl bg-white p-6 text-center shadow-xl">
          <p className="font-display text-2xl font-semibold text-[#0d1f3c]">Canny Capital Partners</p>
          <p className="mt-3 text-sm text-slate-600">{errorInfo?.message || "This data room link is not valid."}</p>
          <p className="mt-2 text-xs text-slate-400">If you believe this is a mistake, contact the person who shared this link.</p>
        </div>
      </div>
    );
  }

  const { guest, room, completeness } = data;
  const pct = completeness?.pct ?? 0;
  const canDownload = guest.accessLevel === "download";

  const folderNameById = new Map<string, string>();
  data.folders.forEach((f) => folderNameById.set(f.folder.id, f.folder.name));

  const renderDoc = (doc: IndexDoc) => (
    <li key={doc.documentId} className="flex flex-wrap items-center gap-2 py-2.5">
      <span className="min-w-0 flex-1 truncate text-sm font-medium text-[#0d1f3c] dark:text-white">{doc.name}</span>
      <span className="text-xs text-slate-400 dark:text-white/40">{fmtBytes(doc.sizeBytes)}</span>
      <span className="flex gap-1.5">
        <a href={`/api/guest/${encodeURIComponent(token)}/file/${encodeURIComponent(doc.documentId)}`} target="_blank" rel="noreferrer" className="btn btn-secondary btn-sm min-h-[44px]">
          View
        </a>
        {canDownload && (
          <a href={`/api/guest/${encodeURIComponent(token)}/file/${encodeURIComponent(doc.documentId)}?dl=1`} className="btn btn-ghost btn-sm min-h-[44px]">
            Download
          </a>
        )}
      </span>
    </li>
  );

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-[#0a1930]">
      <header className="bg-[#0d1f3c]">
        <div className="mx-auto max-w-[1100px] px-4 py-5 sm:px-6">
          <p className="font-display text-2xl font-semibold text-white">Canny Capital Partners</p>
          <p className="mt-1 text-sm text-[#e8dfc8]">{room.name}</p>
          {room.dealName && <p className="text-xs text-[#c8bfa8]">{room.dealName}</p>}
        </div>
        <div className="h-0.5 bg-[#b8975a]" />
      </header>

      <main className="mx-auto max-w-[1100px] space-y-5 px-4 py-6 sm:px-6">
        <section className={cardCls}>
          <p className="text-sm text-slate-600 dark:text-white/75">
            Access for {guest.email} · {guest.accessLevel} · expires {guest.expiresAt ? fmtDate(guest.expiresAt) : "—"}
          </p>
          {!canDownload && (
            <p className="mt-2 rounded-xl bg-slate-100 px-3 py-2 text-sm text-slate-600 dark:bg-white/5 dark:text-white/70">You have view-only access — downloads are disabled.</p>
          )}
          <div className="mt-4 flex flex-wrap items-end gap-3">
            <span className="font-display text-4xl font-semibold text-[#0d1f3c] dark:text-white">{pct}%</span>
            <span className="pb-1 text-sm text-slate-500 dark:text-white/60">
              {completeness.satisfied} of {completeness.total} items complete
            </span>
          </div>
          <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-slate-100 dark:bg-white/10">
            <div className="h-full bg-[#b8975a]" style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
          </div>
        </section>

        <section className={cardCls}>
          <h2 className="text-sm font-bold uppercase tracking-wide text-[#0d1f3c] dark:text-white">Documents</h2>
          <div className="mt-3 space-y-6">
            {data.folders.map(({ folder, documents }) => (
              <div key={folder.id}>
                <h3 className="font-display text-lg font-semibold text-[#0d1f3c] dark:text-white">{folder.name}</h3>
                {documents.length === 0 ? (
                  <p className="mt-1 text-sm text-slate-400 dark:text-white/40">No documents in this folder.</p>
                ) : (
                  <ul className="divide-y divide-slate-100 dark:divide-white/5">{documents.map(renderDoc)}</ul>
                )}
              </div>
            ))}
            <div>
              <h3 className="font-display text-lg font-semibold text-[#0d1f3c] dark:text-white">Unfiled</h3>
              {data.unfiled.length === 0 ? (
                <p className="mt-1 text-sm text-slate-400 dark:text-white/40">No unfiled documents.</p>
              ) : (
                <ul className="divide-y divide-slate-100 dark:divide-white/5">{data.unfiled.map(renderDoc)}</ul>
              )}
            </div>
          </div>
        </section>

        <section className={cardCls}>
          <h2 className="text-sm font-bold uppercase tracking-wide text-[#0d1f3c] dark:text-white">Checklist</h2>
          {data.checklist.length === 0 ? (
            <p className="mt-3 text-sm text-slate-400 dark:text-white/40">No checklist items.</p>
          ) : (
            <ul className="mt-3 divide-y divide-slate-100 dark:divide-white/5">
              {data.checklist.map((item) => (
                <li key={item.id} className="flex flex-wrap items-center gap-2 py-2.5">
                  <span className="min-w-0 flex-1 text-sm text-[#0d1f3c] dark:text-white">{item.label}</span>
                  {item.folderId && <span className="text-xs text-slate-400 dark:text-white/40">{folderNameById.get(item.folderId) || ""}</span>}
                  {item.required && <span className="text-xs text-slate-400 dark:text-white/40">Required</span>}
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold capitalize text-slate-600 dark:bg-white/10 dark:text-white/70">{item.status}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className={cardCls}>
          <h2 className="text-sm font-bold uppercase tracking-wide text-[#0d1f3c] dark:text-white">Questions &amp; answers</h2>
          {data.qa.length === 0 ? (
            <p className="mt-3 text-sm text-slate-400 dark:text-white/40">No questions yet. Ask the first one below.</p>
          ) : (
            <div className="mt-4 space-y-5">
              {data.qa.map((thread) => (
                <div key={thread.id} className="rounded-xl border border-slate-100 px-4 py-3 dark:border-white/5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-[#0d1f3c] dark:text-white">{thread.title}</span>
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold capitalize text-slate-600 dark:bg-white/10 dark:text-white/70">{thread.status}</span>
                    <span className="text-xs text-slate-400 dark:text-white/40">{thread.createdBy} · {thread.createdAt ? fmtRelTime(thread.createdAt) : ""}</span>
                  </div>
                  <div className="mt-3 space-y-2.5">
                    {(thread.messages || []).map((m) => (
                      <div key={m.id} className="text-sm">
                        <span className="font-semibold text-[#0d1f3c] dark:text-white">{m.author}</span>{" "}
                        <span className="text-xs text-slate-400 dark:text-white/40">{m.createdAt ? fmtRelTime(m.createdAt) : ""}</span>
                        <p className="mt-0.5 whitespace-pre-wrap text-slate-600 dark:text-white/75">{m.body}</p>
                      </div>
                    ))}
                  </div>
                  <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                    <textarea
                      value={replyDrafts[thread.id] || ""}
                      onChange={(e) => setReplyDrafts((prev) => ({ ...prev, [thread.id]: e.target.value }))}
                      placeholder="Write a reply..."
                      rows={2}
                      className={`${inputCls} min-w-0 flex-1`}
                      aria-label={`Reply to ${thread.title}`}
                    />
                    <Button variant="secondary" onClick={() => void reply(thread.id)} disabled={!(replyDrafts[thread.id] || "").trim()} className="min-h-[44px]">
                      Reply
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="mt-5 border-t border-slate-100 pt-4 dark:border-white/5">
            <p className={labelCls}>Ask a question</p>
            <div className="space-y-2">
              <input value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="Question title" className={inputCls} />
              <textarea value={newBody} onChange={(e) => setNewBody(e.target.value)} placeholder="Details..." rows={3} className={inputCls} />
              <Button onClick={() => void ask()} disabled={asking || !newTitle.trim() || !newBody.trim()} className="min-h-[44px]">
                {asking ? "Posting..." : "Ask question"}
              </Button>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

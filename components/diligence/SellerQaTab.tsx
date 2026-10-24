"use client";

/**
 * Seller Q&A — a thread view over the SAME request_items data as the
 * Requests tab (Workplan group, redesign spec §2). Each request is a
 * question to the seller; the seller's answer is its response notes /
 * received status. No separate store, no new endpoints — answers are
 * edited through the existing request-item PATCH, and reminders use
 * the same compose/send plumbing as Requests.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { EmptyState, ErrorState, SkeletonRows } from "@/components/ui";
import {
  api,
  cardCls,
  fmtDateShort,
  type ChecklistItem,
  type RequestItem,
  type TabProps,
} from "@/components/diligence/types";

function daysOutstanding(item: RequestItem): number | null {
  if (item.status !== "requested") return null;
  const ref = item.lastRequestedAt ?? item.createdAt;
  const t = new Date(ref).getTime();
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((Date.now() - t) / 86400000));
}

export default function SellerQaTab(props: TabProps) {
  const { workspaceId } = props;
  const [items, setItems] = useState<RequestItem[]>([]);
  const [checklist, setChecklist] = useState<ChecklistItem[]>([]);
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const [filter, setFilter] = useState<"all" | "awaiting" | "answered">("all");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    try {
      const [r, c] = await Promise.all([
        api<{ items: RequestItem[] }>(
          `/api/platform/diligence/workspaces/${encodeURIComponent(workspaceId)}/requests`
        ),
        api<{ items: ChecklistItem[] }>(
          `/api/platform/diligence/workspaces/${encodeURIComponent(workspaceId)}/checklist`
        ).catch(() => ({ items: [] as ChecklistItem[] })),
      ]);
      setItems(r.items ?? []);
      setChecklist(c.items ?? []);
      setPhase("ready");
    } catch {
      setPhase("error");
    }
  }, [workspaceId]);

  useEffect(() => {
    void load();
  }, [load]);

  const sorted = useMemo(
    () =>
      [...items].sort((a, b) =>
        a.createdAt === b.createdAt
          ? a.id.localeCompare(b.id)
          : a.createdAt.localeCompare(b.createdAt)
      ),
    [items]
  );
  const shown = sorted.filter((i) =>
    filter === "all"
      ? true
      : filter === "awaiting"
        ? i.status === "requested"
        : i.status !== "requested"
  );
  const awaiting = items.filter((i) => i.status === "requested").length;
  const answered = items.length - awaiting;
  const checklistTitle = (id: string | null) =>
    id ? checklist.find((c) => c.id === id)?.title ?? null : null;

  const saveAnswer = async (item: RequestItem) => {
    const notes = drafts[item.id];
    if (notes === undefined || notes === item.responseNotes) return;
    await api(
      `/api/platform/diligence/request-items/${encodeURIComponent(item.id)}`,
      {
        method: "PATCH",
        body: JSON.stringify({ responseNotes: notes, status: "received" }),
      }
    );
    setMsg("Answer recorded.");
    await load();
    void props.reload();
  };

  const remind = async (item: RequestItem) => {
    try {
      const composed = await api<{
        mailto: string;
        subject: string;
        body: string;
      }>(
        `/api/platform/diligence/workspaces/${encodeURIComponent(workspaceId)}/requests/compose`,
        { method: "POST", body: JSON.stringify({ itemIds: [item.id] }) }
      );
      // Record the reminder send (same log the Requests tab writes on
      // "Mark as sent"), then hand off to the mail app.
      await api(
        `/api/platform/diligence/workspaces/${encodeURIComponent(workspaceId)}/requests/send`,
        {
          method: "POST",
          body: JSON.stringify({
            recipient: "",
            subject: composed.subject,
            body: composed.body,
            itemIds: [item.id],
            channel: "mailto",
          }),
        }
      ).catch(() => null);
      window.location.href = composed.mailto;
      await load();
    } catch {
      setMsg("Could not compose a reminder for that question.");
    }
  };

  if (phase === "loading") return <SkeletonRows rows={6} />;
  if (phase === "error") return <ErrorState onRetry={() => void load()} />;

  return (
    <div className={cardCls}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-display text-lg font-semibold text-[#0d1f3c] dark:text-white">
            Seller Q&amp;A
          </h3>
          <p className="mt-0.5 text-sm text-slate-500 dark:text-white/50">
            Questions are the request list; answers are recorded against
            each request. {awaiting} awaiting · {answered} answered/waived.
          </p>
        </div>
        <div className="flex gap-1">
          {(
            [
              ["all", "All"],
              ["awaiting", "Awaiting"],
              ["answered", "Answered"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              className={`chip ${filter === key ? "chip-active" : ""}`}
              onClick={() => setFilter(key)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {msg && (
        <p className="mt-3 rounded-xl bg-[#b8975a]/10 px-4 py-2.5 text-sm text-[#0d1f3c] dark:text-white/90">
          {msg}
        </p>
      )}
      {items.length === 0 ? (
        <div className="mt-4">
          <EmptyState
            title="No questions yet"
            message="Questions appear here once the request list is generated from the data room (Requests tab)."
          />
        </div>
      ) : shown.length === 0 ? (
        <p className="mt-4 text-sm text-slate-500 dark:text-white/50">
          Nothing in this view.
        </p>
      ) : (
        <ul className="mt-4 space-y-3">
          {shown.map((item, idx) => {
            const days = daysOutstanding(item);
            const linked = checklistTitle(item.checklistItemId);
            return (
              <li
                key={item.id}
                className="rounded-2xl border border-slate-100 p-4 dark:border-white/10"
              >
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="text-xs font-bold text-slate-400">
                    Q{idx + 1}
                  </span>
                  <span className="min-w-0 flex-1 text-sm font-medium text-[#0d1f3c] dark:text-white/90">
                    {item.label}
                  </span>
                  {item.status === "requested" ? (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800 dark:bg-amber-500/20 dark:text-amber-300">
                      Awaiting response{days !== null ? ` · ${days}d` : ""}
                    </span>
                  ) : (
                    <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold capitalize text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300">
                      {item.status}
                      {item.respondedAt
                        ? ` · ${fmtDateShort(item.respondedAt)}`
                        : ""}
                    </span>
                  )}
                </div>
                {linked && (
                  <p className="mt-1 text-xs text-slate-400">
                    Checklist: {linked} · Asked{" "}
                    {fmtDateShort(item.lastRequestedAt ?? item.createdAt)}
                  </p>
                )}
                <div className="mt-2">
                  <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-white/40">
                    Seller answer
                  </label>
                  <textarea
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none placeholder:text-slate-300 focus:border-[#b8975a] dark:border-white/10 dark:bg-white/5 dark:text-white"
                    rows={2}
                    placeholder="No answer recorded yet — type the seller's response and save."
                    value={drafts[item.id] ?? item.responseNotes}
                    onChange={(e) =>
                      setDrafts((d) => ({ ...d, [item.id]: e.target.value }))
                    }
                  />
                </div>
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => void saveAnswer(item)}
                  >
                    Save answer
                  </button>
                  {item.status === "requested" && (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => void remind(item)}
                    >
                      Remind
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

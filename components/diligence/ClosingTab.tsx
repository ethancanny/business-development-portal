"use client";

/**
 * Closing checklist — items grouped by category with an
 * open → done toggle, due dates, and an add form. Post-closing
 * items with a due date surface on the Calendar automatically
 * (server-side projection), which the tab states explicitly.
 */

import { useCallback, useEffect, useState } from "react";
import { Button, EmptyState } from "@/components/ui";
import {
  api,
  cardCls,
  inputCls,
  labelCls,
  selectCls,
  fmtDateShort,
  CLOSING_CATEGORIES,
  labelOf,
  type ClosingItem,
  type TabProps,
} from "@/components/diligence/types";

export default function ClosingTab({ workspaceId, reload }: TabProps) {
  const [form, setForm] = useState({ category: "funds_flow", title: "", dueDate: "", notes: "" });
  const [adding, setAdding] = useState(false);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");

  // Redesigned shell: section data is fetched per tab (the shell
  // passes a slim bundle — identity + counts only).
  const [items, setItems] = useState<ClosingItem[]>([]);
  const loadSection = useCallback(async () => {
    try {
      const d = await api<{ items: ClosingItem[] }>(
        `/api/platform/diligence/workspaces/${encodeURIComponent(workspaceId)}/closing`
      );
      setItems(d.items ?? []);
    } catch {
      /* keep the current list on a transient failure */
    }
  }, [workspaceId]);
  useEffect(() => {
    void loadSection();
  }, [loadSection]);
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));

  const patch = async (item: ClosingItem, body: Record<string, unknown>) => {
    setBusyId(item.id);
    setError("");
    try {
      await api(`/api/platform/diligence/closing/${encodeURIComponent(item.id)}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      await loadSection();
      void reload();
    } catch {
      setError("Could not update that closing item. Please try again.");
    } finally {
      setBusyId("");
    }
  };

  const remove = async (item: ClosingItem) => {
    setBusyId(item.id);
    setError("");
    try {
      await api(`/api/platform/diligence/closing/${encodeURIComponent(item.id)}`, {
        method: "DELETE",
      });
      await loadSection();
      void reload();
    } catch {
      setError("Could not delete that closing item. Please try again.");
    } finally {
      setBusyId("");
    }
  };

  const add = async () => {
    if (!form.title.trim() || adding) return;
    setAdding(true);
    setError("");
    try {
      await api(`/api/platform/diligence/workspaces/${encodeURIComponent(workspaceId)}/closing`, {
        method: "POST",
        body: JSON.stringify({
          category: form.category,
          title: form.title.trim(),
          dueDate: form.dueDate || null,
          notes: form.notes,
        }),
      });
      setForm({ category: "funds_flow", title: "", dueDate: "", notes: "" });
      await loadSection();
      void reload();
    } catch {
      setError("Could not add that closing item. Please try again.");
    } finally {
      setAdding(false);
    }
  };

  return (
    <div className="space-y-5">
      {error && (
        <p className="rounded-xl bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-300">
          {error}
        </p>
      )}

      <p className="rounded-xl bg-[#b8975a]/10 px-4 py-3 text-sm text-[#0d1f3c] dark:text-white/90">
        Post-closing items with a due date appear on the Calendar automatically
        — no separate calendar entry is needed.
      </p>

      {items.length === 0 && (
        <EmptyState
          title="No closing items yet"
          message="Add the first closing item below — funds flow, signature pages, consents, payoffs, escrow and post-closing obligations."
        />
      )}

      {CLOSING_CATEGORIES.map((cat) => {
        const group = items.filter((i) => i.category === cat.key);
        if (group.length === 0) return null;
        const done = group.filter((i) => i.status === "done" || i.status === "waived").length;
        return (
          <div key={cat.key} className={cardCls}>
            <div className="flex items-baseline justify-between gap-3">
              <h3 className="font-display text-lg font-semibold text-[#0d1f3c] dark:text-white">
                {cat.label}
              </h3>
              <span className="text-xs text-slate-500 dark:text-white/50">
                {done}/{group.length} complete
              </span>
            </div>
            <ul className="mt-3 divide-y divide-slate-100 dark:divide-white/5">
              {group.map((item) => (
                <li key={item.id} className="flex flex-wrap items-center gap-2 py-3">
                  <p
                    className={`min-w-[200px] flex-1 text-sm font-medium ${
                      item.status === "done"
                        ? "text-slate-400 line-through dark:text-white/40"
                        : "text-[#0d1f3c] dark:text-white"
                    }`}
                  >
                    {item.title}
                    {item.notes && (
                      <span className="block text-xs font-normal text-slate-500 no-underline dark:text-white/50">
                        {item.notes}
                      </span>
                    )}
                  </p>
                  <span
                    className={`badge ${
                      item.status === "done"
                        ? "badge-fit"
                        : item.status === "waived"
                          ? "badge-neutral"
                          : "badge-warn"
                    }`}
                  >
                    {item.status}
                  </span>
                  <input
                    type="date"
                    className={`${inputCls} w-40`}
                    value={item.dueDate ?? ""}
                    disabled={busyId === item.id}
                    onChange={(e) =>
                      void patch(item, { dueDate: e.target.value || null })
                    }
                    aria-label={`Due date for ${item.title}`}
                  />
                  {item.status === "open" && (
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      disabled={busyId === item.id}
                      onClick={() => void patch(item, { status: "done" })}
                    >
                      Mark done
                    </button>
                  )}
                  {item.status === "done" && (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      disabled={busyId === item.id}
                      onClick={() => void patch(item, { status: "open" })}
                    >
                      Reopen
                    </button>
                  )}
                  {item.status !== "waived" && (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      disabled={busyId === item.id}
                      onClick={() => void patch(item, { status: "waived" })}
                    >
                      Waive
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn btn-danger btn-sm"
                    disabled={busyId === item.id}
                    onClick={() => void remove(item)}
                  >
                    Delete
                  </button>
                  {item.completedAt && (
                    <span className="w-full text-xs text-slate-400 dark:text-white/40">
                      Completed {fmtDateShort(item.completedAt)}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        );
      })}

      {/* Items with an unrecognized category still surface. */}
      {items.some((i) => !CLOSING_CATEGORIES.some((c) => c.key === i.category)) && (
        <div className={cardCls}>
          <h3 className="font-display text-lg font-semibold text-[#0d1f3c] dark:text-white">
            Other
          </h3>
          <ul className="mt-2 space-y-1 text-sm text-[#0d1f3c] dark:text-white/90">
            {items
              .filter((i) => !CLOSING_CATEGORIES.some((c) => c.key === i.category))
              .map((i) => (
                <li key={i.id}>
                  {i.title} · {labelOf(CLOSING_CATEGORIES, i.category)} · {i.status}
                </li>
              ))}
          </ul>
        </div>
      )}

      <div className={cardCls}>
        <h3 className="font-display text-lg font-semibold text-[#0d1f3c] dark:text-white">
          Add closing item
        </h3>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <label className={labelCls}>Category</label>
            <select className={selectCls} value={form.category} onChange={(e) => set({ category: e.target.value })}>
              {CLOSING_CATEGORIES.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls}>Due date</label>
            <input type="date" className={inputCls} value={form.dueDate} onChange={(e) => set({ dueDate: e.target.value })} />
          </div>
          <div className="sm:col-span-2">
            <label className={labelCls}>Title</label>
            <input className={inputCls} value={form.title} onChange={(e) => set({ title: e.target.value })} placeholder="e.g. Seller payoff letter — First Bank term loan" />
          </div>
          <div className="sm:col-span-2">
            <label className={labelCls}>Notes</label>
            <input className={inputCls} value={form.notes} onChange={(e) => set({ notes: e.target.value })} />
          </div>
        </div>
        {form.category === "post_closing" && (
          <p className="mt-3 text-xs text-slate-500 dark:text-white/50">
            Post-closing items with a due date appear on the Calendar
            automatically.
          </p>
        )}
        <div className="mt-4">
          <Button onClick={() => void add()} loading={adding} disabled={!form.title.trim()}>
            Add closing item
          </Button>
        </div>
      </div>
    </div>
  );
}

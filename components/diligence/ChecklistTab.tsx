"use client";

/**
 * Diligence checklist — items grouped by workstream. Owner, status
 * and due date edit inline; every change PATCHes the item and the
 * shell reloads the bundle. Items linked to the data room show a
 * link marker.
 */

import { useState } from "react";
import { Button, EmptyState } from "@/components/ui";
import {
  api,
  cardCls,
  inputCls,
  selectCls,
  CHECKLIST_STATUSES,
  WORKSTREAMS,
  labelOf,
  type TabProps,
} from "@/components/diligence/types";

export default function ChecklistTab({ workspaceId, bundle, reload }: TabProps) {
  const [newWorkstream, setNewWorkstream] = useState("financial");
  const [newTitle, setNewTitle] = useState("");
  const [adding, setAdding] = useState(false);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");

  const patch = async (itemId: string, body: Record<string, unknown>) => {
    setBusyId(itemId);
    setError("");
    try {
      await api(`/api/platform/diligence/checklist/${encodeURIComponent(itemId)}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      await reload();
    } catch {
      setError("Could not save that change. Please try again.");
    } finally {
      setBusyId("");
    }
  };

  const remove = async (itemId: string) => {
    setBusyId(itemId);
    setError("");
    try {
      await api(`/api/platform/diligence/checklist/${encodeURIComponent(itemId)}`, {
        method: "DELETE",
      });
      await reload();
    } catch {
      setError("Could not delete that item. Please try again.");
    } finally {
      setBusyId("");
    }
  };

  const add = async () => {
    const title = newTitle.trim();
    if (!title || adding) return;
    setAdding(true);
    setError("");
    try {
      await api(`/api/platform/diligence/workspaces/${encodeURIComponent(workspaceId)}/checklist`, {
        method: "POST",
        body: JSON.stringify({ workstream: newWorkstream, title }),
      });
      setNewTitle("");
      await reload();
    } catch {
      setError("Could not add that item. Please try again.");
    } finally {
      setAdding(false);
    }
  };

  const items = bundle.checklist;

  return (
    <div className="space-y-5">
      {error && (
        <p className="rounded-xl bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-300">
          {error}
        </p>
      )}

      {/* Add item */}
      <div className={cardCls}>
        <h3 className="font-display text-lg font-semibold text-[#0d1f3c] dark:text-white">
          Add checklist item
        </h3>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <select
            className={`${selectCls} sm:w-52`}
            value={newWorkstream}
            onChange={(e) => setNewWorkstream(e.target.value)}
            aria-label="Workstream"
          >
            {WORKSTREAMS.map((w) => (
              <option key={w.key} value={w.key}>
                {w.label}
              </option>
            ))}
          </select>
          <input
            className={inputCls}
            placeholder="Item title — e.g. Quality of earnings report"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void add();
            }}
          />
          <Button onClick={() => void add()} loading={adding} className="shrink-0">
            Add item
          </Button>
        </div>
      </div>

      {items.length === 0 && (
        <EmptyState
          title="No checklist items"
          message="Add the first diligence item above."
        />
      )}

      {WORKSTREAMS.map((ws) => {
        const group = items
          .filter((i) => i.workstream === ws.key)
          .sort((a, b) => a.sort - b.sort);
        if (group.length === 0) return null;
        const done = group.filter((i) =>
          ["received", "reviewed", "approved", "waived", "na"].includes(i.status)
        ).length;
        return (
          <div key={ws.key} className={cardCls}>
            <div className="flex items-baseline justify-between gap-3">
              <h3 className="font-display text-lg font-semibold text-[#0d1f3c] dark:text-white">
                {ws.label}
              </h3>
              <span className="text-xs text-slate-500 dark:text-white/50">
                {done}/{group.length} complete
              </span>
            </div>
            <div className="mt-3 divide-y divide-slate-100 dark:divide-white/5">
              {group.map((item) => (
                <div key={item.id} className="py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="min-w-[200px] flex-1 text-sm font-medium text-[#0d1f3c] dark:text-white">
                      {item.title}
                      {(item.dataroomChecklistItemId || item.dataroomDocumentId) && (
                        <span
                          className="ml-2 align-middle text-[#b8975a]"
                          title={
                            item.dataroomDocumentId
                              ? "Linked to a data room document"
                              : "Linked to a data room checklist item"
                          }
                        >
                          🔗
                        </span>
                      )}
                    </p>
                    <input
                      className={`${inputCls} w-36`}
                      placeholder="Owner"
                      defaultValue={item.owner}
                      disabled={busyId === item.id}
                      onBlur={(e) => {
                        if (e.target.value !== item.owner)
                          void patch(item.id, { owner: e.target.value });
                      }}
                      aria-label={`Owner for ${item.title}`}
                    />
                    <select
                      className={`${selectCls} w-40`}
                      value={item.status}
                      disabled={busyId === item.id}
                      onChange={(e) =>
                        void patch(item.id, { status: e.target.value })
                      }
                      aria-label={`Status for ${item.title}`}
                    >
                      {CHECKLIST_STATUSES.map((s) => (
                        <option key={s.key} value={s.key}>
                          {s.label}
                        </option>
                      ))}
                    </select>
                    <input
                      type="date"
                      className={`${inputCls} w-40`}
                      value={item.dueDate ?? ""}
                      disabled={busyId === item.id}
                      onChange={(e) =>
                        void patch(item.id, {
                          dueDate: e.target.value || null,
                        })
                      }
                      aria-label={`Due date for ${item.title}`}
                    />
                    <button
                      type="button"
                      className="btn btn-danger btn-sm"
                      disabled={busyId === item.id}
                      onClick={() => void remove(item.id)}
                    >
                      Delete
                    </button>
                  </div>
                  <input
                    className={`${inputCls} mt-2`}
                    placeholder="Notes"
                    defaultValue={item.notes}
                    disabled={busyId === item.id}
                    onBlur={(e) => {
                      if (e.target.value !== item.notes)
                        void patch(item.id, { notes: e.target.value });
                    }}
                    aria-label={`Notes for ${item.title}`}
                  />
                </div>
              ))}
            </div>
          </div>
        );
      })}

      {/* Any items with an unrecognized workstream still surface. */}
      {items.some(
        (i) => !WORKSTREAMS.some((w) => w.key === i.workstream)
      ) && (
        <div className={cardCls}>
          <h3 className="font-display text-lg font-semibold text-[#0d1f3c] dark:text-white">
            Other
          </h3>
          <ul className="mt-2 space-y-1 text-sm text-[#0d1f3c] dark:text-white/90">
            {items
              .filter((i) => !WORKSTREAMS.some((w) => w.key === i.workstream))
              .map((i) => (
                <li key={i.id}>
                  {i.title} · {labelOf(CHECKLIST_STATUSES, i.status)}
                </li>
              ))}
          </ul>
        </div>
      )}
    </div>
  );
}

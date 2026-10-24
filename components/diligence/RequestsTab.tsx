"use client";

/**
 * Requests — REDESIGNED Oct 2026 (spec §5). Same data and actions as
 * before (generate from the data room, ONE composed request email,
 * mailto send + mark-as-sent recording, send history), presented as
 * the standard table + drawer: request number, description, date
 * requested, days outstanding, seller response, status, linked
 * checklist item, document link, and a per-item Remind action
 * (compose scoped to that item). Seller Q&A is a second view over
 * this same data (Workplan group).
 *
 * Data: this tab fetches its own section only
 * (GET workspaces/[id]/requests + the checklist for link titles).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Button, EmptyState, ErrorState, SkeletonRows } from "@/components/ui";
import {
  api,
  cardCls,
  fmtDateShort,
  inputCls,
  labelCls,
  selectCls,
  type ChecklistItem,
  type RequestItem,
  type RequestSend,
  type TabProps,
} from "@/components/diligence/types";
import {
  CommentsPanel,
  DrawerShell,
  drawerInputCls,
  drawerLabelCls,
} from "@/components/diligence/ItemDrawer";

interface EmailTemplate {
  id: string;
  name: string;
  subject: string;
  body: string;
}

interface Composed {
  subject: string;
  body: string;
  mailto: string;
  itemCount: number;
  templateName: string | null;
}

const STATUS_PILL: Record<string, string> = {
  requested:
    "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300",
  received:
    "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300",
  waived: "bg-slate-100 text-slate-500 dark:bg-white/10 dark:text-white/50",
};

function daysOutstanding(item: RequestItem): number | null {
  if (item.status !== "requested") return null;
  const ref = item.lastRequestedAt ?? item.createdAt;
  const t = new Date(ref).getTime();
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((Date.now() - t) / 86400000));
}

export default function RequestsTab(props: TabProps) {
  const { workspaceId, bundle } = props;
  const [items, setItems] = useState<RequestItem[]>([]);
  const [sends, setSends] = useState<RequestSend[]>([]);
  const [checklist, setChecklist] = useState<ChecklistItem[]>([]);
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const [generating, setGenerating] = useState(false);
  const [genMsg, setGenMsg] = useState("");
  const [error, setError] = useState("");
  const [drawerId, setDrawerId] = useState<string | null>(null);

  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [recipient, setRecipient] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [composed, setComposed] = useState<Composed | null>(null);
  const [composing, setComposing] = useState(false);
  const [markingSent, setMarkingSent] = useState(false);
  const [sentMsg, setSentMsg] = useState("");
  /** Item ids the current composition covers (all = null). */
  const [composedFor, setComposedFor] = useState<string[] | null>(null);

  const load = useCallback(async () => {
    try {
      const [r, c] = await Promise.all([
        api<{ items: RequestItem[]; sends: RequestSend[] }>(
          `/api/platform/diligence/workspaces/${encodeURIComponent(workspaceId)}/requests`
        ),
        api<{ items: ChecklistItem[] }>(
          `/api/platform/diligence/workspaces/${encodeURIComponent(workspaceId)}/checklist`
        ).catch(() => ({ items: [] as ChecklistItem[] })),
      ]);
      setItems(r.items ?? []);
      setSends(r.sends ?? []);
      setChecklist(c.items ?? []);
      setPhase("ready");
    } catch {
      setPhase("error");
    }
  }, [workspaceId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void (async () => {
      try {
        const data = await api<{
          templates?: EmailTemplate[];
          items?: EmailTemplate[];
        }>("/api/platform/directory/templates");
        const list = data.templates ?? data.items ?? [];
        setTemplates(Array.isArray(list) ? list : []);
      } catch {
        setTemplates([]);
      }
    })();
  }, []);

  const sorted = useMemo(
    () =>
      [...items].sort((a, b) =>
        a.createdAt === b.createdAt
          ? a.id.localeCompare(b.id)
          : a.createdAt.localeCompare(b.createdAt)
      ),
    [items]
  );
  const numberOf = useMemo(() => {
    const map = new Map<string, number>();
    sorted.forEach((i, idx) => map.set(i.id, idx + 1));
    return map;
  }, [sorted]);
  const outstanding = items.filter((i) => i.status === "requested");
  const checklistTitle = (id: string | null) =>
    id ? checklist.find((c) => c.id === id)?.title ?? null : null;
  const drawerItem = drawerId ? items.find((i) => i.id === drawerId) ?? null : null;

  const refresh = async () => {
    await load();
    void props.reload();
  };

  const generate = async () => {
    setGenerating(true);
    setGenMsg("");
    setError("");
    try {
      const data = await api<{ roomId: string | null; created: number; updated: number }>(
        `/api/platform/diligence/workspaces/${encodeURIComponent(workspaceId)}/requests`,
        { method: "POST" }
      );
      setGenMsg(
        data.roomId
          ? `Generated from the data room: ${data.created} new request(s), ${data.updated} updated.`
          : "No data room is linked to this deal yet, so there is nothing to generate from. Create a data room for the deal first."
      );
      await refresh();
    } catch {
      setError("Could not generate the request list. Please try again.");
    } finally {
      setGenerating(false);
    }
  };

  const patchItem = async (itemId: string, body: Record<string, unknown>) => {
    setError("");
    setItems((cur) =>
      cur.map((i) => (i.id === itemId ? ({ ...i, ...body } as RequestItem) : i))
    );
    try {
      await api(
        `/api/platform/diligence/request-items/${encodeURIComponent(itemId)}`,
        { method: "PATCH", body: JSON.stringify(body) }
      );
      await refresh();
    } catch {
      setError("Could not update that request item. Please try again.");
      void load();
    }
  };

  const compose = async (itemIds?: string[]) => {
    setComposing(true);
    setError("");
    setSentMsg("");
    try {
      const data = await api<Composed>(
        `/api/platform/diligence/workspaces/${encodeURIComponent(workspaceId)}/requests/compose`,
        {
          method: "POST",
          body: JSON.stringify({
            templateId: templateId || undefined,
            recipient: recipient.trim() || undefined,
            itemIds,
          }),
        }
      );
      setComposed(data);
      setComposedFor(itemIds ?? null);
    } catch {
      setError("Could not compose the request email. Please try again.");
    } finally {
      setComposing(false);
    }
  };

  const markSent = async () => {
    if (!composed) return;
    setMarkingSent(true);
    setError("");
    try {
      const ids = composedFor ?? outstanding.map((i) => i.id);
      await api(
        `/api/platform/diligence/workspaces/${encodeURIComponent(workspaceId)}/requests/send`,
        {
          method: "POST",
          body: JSON.stringify({
            recipient: recipient.trim(),
            subject: composed.subject,
            body: composed.body,
            itemIds: ids,
            channel: "mailto",
          }),
        }
      );
      setSentMsg("Send recorded. The item(s) now show as last requested just now.");
      setComposed(null);
      setComposedFor(null);
      await refresh();
    } catch {
      setError("Could not record the send. Please try again.");
    } finally {
      setMarkingSent(false);
    }
  };

  if (phase === "loading") return <SkeletonRows rows={6} />;
  if (phase === "error") return <ErrorState onRetry={() => void load()} />;

  return (
    <div className="space-y-5">
      {error && (
        <p className="rounded-xl bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-300">
          {error}
        </p>
      )}

      <div className={cardCls}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="font-display text-lg font-semibold text-[#0d1f3c] dark:text-white">
              Requests
            </h3>
            <p className="mt-0.5 text-sm text-slate-500 dark:text-white/50">
              {bundle.room
                ? `Linked data room: ${bundle.room.name}`
                : "No data room linked to this deal yet."}{" "}
              {outstanding.length} outstanding · {items.length} tracked in total.
            </p>
          </div>
          <Button onClick={() => void generate()} loading={generating}>
            Generate from data room
          </Button>
        </div>
        {genMsg && (
          <p className="mt-3 rounded-xl bg-[#b8975a]/10 px-4 py-2.5 text-sm text-[#0d1f3c] dark:text-white/90">
            {genMsg}
          </p>
        )}

        {items.length === 0 ? (
          <div className="mt-4">
            <EmptyState
              title="No request items yet"
              message="Generate the list from the data room checklist to populate outstanding requests."
            />
          </div>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[880px] border-collapse">
              <thead>
                <tr className="bg-[#0d1f3c] text-[#f5efe0]">
                  <th className="w-10 px-2 py-2 text-left text-[11px] font-semibold uppercase tracking-wider">#</th>
                  <th className="px-2 py-2 text-left text-[11px] font-semibold uppercase tracking-wider">Request</th>
                  <th className="w-28 px-2 py-2 text-left text-[11px] font-semibold uppercase tracking-wider">Requested</th>
                  <th className="w-16 px-2 py-2 text-left text-[11px] font-semibold uppercase tracking-wider">Days out</th>
                  <th className="px-2 py-2 text-left text-[11px] font-semibold uppercase tracking-wider">Seller response</th>
                  <th className="w-28 px-2 py-2 text-left text-[11px] font-semibold uppercase tracking-wider">Status</th>
                  <th className="w-28 px-2 py-2 text-left text-[11px] font-semibold uppercase tracking-wider">Checklist</th>
                  <th className="w-16 px-2 py-2 text-left text-[11px] font-semibold uppercase tracking-wider">Doc</th>
                  <th className="w-24 px-2 py-2" />
                </tr>
              </thead>
              <tbody>
                {sorted.map((item) => {
                  const days = daysOutstanding(item);
                  const linked = checklistTitle(item.checklistItemId);
                  return (
                    <tr
                      key={item.id}
                      className="cursor-pointer border-b border-slate-100 hover:bg-[#f0f4fa] dark:border-white/5 dark:hover:bg-white/5"
                      onClick={() => setDrawerId(item.id)}
                    >
                      <td className="px-2 py-2 text-[13px] text-slate-400">
                        {numberOf.get(item.id)}
                      </td>
                      <td className="max-w-0 px-2 py-2">
                        <span className="block truncate text-[13px] font-medium text-[#0d1f3c] dark:text-white/90">
                          {item.label}
                        </span>
                      </td>
                      <td className="px-2 py-2 text-[13px] text-slate-500 dark:text-white/60">
                        {fmtDateShort(item.lastRequestedAt ?? item.createdAt)}
                      </td>
                      <td className="px-2 py-2 text-[13px] text-slate-500 dark:text-white/60">
                        {days === null ? "—" : `${days}d`}
                      </td>
                      <td className="max-w-0 px-2 py-2">
                        <span className="block truncate text-[13px] text-slate-500 dark:text-white/60">
                          {item.responseNotes ||
                            (item.respondedAt
                              ? `Responded ${fmtDateShort(item.respondedAt)}`
                              : "—")}
                        </span>
                      </td>
                      <td className="px-2 py-2" onClick={(e) => e.stopPropagation()}>
                        <select
                          aria-label="Status"
                          className={`cursor-pointer rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize outline-none ${STATUS_PILL[item.status] ?? ""}`}
                          value={item.status}
                          onChange={(e) =>
                            void patchItem(item.id, { status: e.target.value })
                          }
                        >
                          <option value="requested">Requested</option>
                          <option value="received">Received</option>
                          <option value="waived">Waived</option>
                        </select>
                      </td>
                      <td className="max-w-0 px-2 py-2">
                        <span className="block truncate text-[13px] text-slate-500 dark:text-white/60">
                          {linked ?? "—"}
                        </span>
                      </td>
                      <td className="px-2 py-2 text-[13px]">
                        {item.dataroomChecklistItemId && bundle.room ? (
                          <Link
                            className="font-semibold text-[#8a6d3b] hover:underline dark:text-[#b8975a]"
                            href={`/data-rooms/${bundle.room.id}`}
                            onClick={(e) => e.stopPropagation()}
                          >
                            Room
                          </Link>
                        ) : (
                          <span className="text-slate-300 dark:text-white/30">—</span>
                        )}
                      </td>
                      <td className="px-2 py-2" onClick={(e) => e.stopPropagation()}>
                        {item.status === "requested" && (
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            onClick={() => {
                              setDrawerId(null);
                              void compose([item.id]);
                            }}
                          >
                            Remind
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Compose (all outstanding, or the item chosen via Remind) */}
      <div className={cardCls}>
        <h3 className="font-display text-lg font-semibold text-[#0d1f3c] dark:text-white">
          Compose request email
        </h3>
        <p className="mt-1 text-sm text-slate-500 dark:text-white/50">
          One email covering all {outstanding.length} outstanding item(s) —
          or use a row&apos;s Remind button to compose for a single item.
          Sending happens in your mail app — the Microsoft Graph mail scope
          is not yet consented, so the portal cannot send directly. After
          sending, use “Mark as sent” to record it here.
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div>
            <label className={labelCls} htmlFor="req-recipient">
              Recipient
            </label>
            <input
              id="req-recipient"
              className={inputCls}
              placeholder="seller@example.com"
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
            />
          </div>
          <div>
            <label className={labelCls} htmlFor="req-template">
              Template (optional)
            </label>
            <select
              id="req-template"
              className={selectCls}
              value={templateId}
              onChange={(e) => setTemplateId(e.target.value)}
            >
              <option value="">Default request email</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="mt-4">
          <Button
            onClick={() => void compose()}
            loading={composing}
            disabled={outstanding.length === 0}
          >
            Compose
          </Button>
        </div>

        {composed && (
          <div className="mt-5 space-y-3">
            <p className="text-sm text-slate-500 dark:text-white/50">
              {composed.itemCount} item(s) included
              {composedFor
                ? " · single-item reminder"
                : " · all outstanding"}
              {composed.templateName
                ? ` · template: ${composed.templateName}`
                : " · default template"}
              .
            </p>
            <div>
              <label className={labelCls}>Subject</label>
              <input className={inputCls} value={composed.subject} readOnly />
            </div>
            <div>
              <label className={labelCls}>Body</label>
              <textarea
                className={`${inputCls} min-h-[220px] font-mono text-[13px]`}
                value={composed.body}
                readOnly
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <a href={composed.mailto} className="btn btn-primary btn-sm">
                Open in mail app
              </a>
              <Button
                size="sm"
                variant="accent"
                onClick={() => void markSent()}
                loading={markingSent}
              >
                Mark as sent
              </Button>
            </div>
          </div>
        )}
        {sentMsg && (
          <p className="mt-3 rounded-xl bg-emerald-500/10 px-4 py-2.5 text-sm text-emerald-700 dark:text-emerald-300">
            {sentMsg}
          </p>
        )}
      </div>

      {/* Send history */}
      <div className={cardCls}>
        <h3 className="font-display text-lg font-semibold text-[#0d1f3c] dark:text-white">
          Send history
        </h3>
        {sends.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500 dark:text-white/50">
            No request emails recorded yet.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-slate-100 dark:divide-white/5">
            {sends.map((s) => (
              <li key={s.id} className="py-3">
                <p className="text-sm font-medium text-[#0d1f3c] dark:text-white">
                  {s.subject || "(no subject)"}
                </p>
                <p className="mt-0.5 text-xs text-slate-500 dark:text-white/50">
                  To {s.recipient || "—"} · {fmtDateShort(s.createdAt)} · via{" "}
                  {s.channel} · {s.itemIds.length} item(s) · sent by{" "}
                  {s.sentBy || "—"}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>

      {drawerItem && (
        <RequestDrawer
          key={drawerItem.id}
          item={drawerItem}
          number={numberOf.get(drawerItem.id) ?? 0}
          checklistTitle={checklistTitle(drawerItem.checklistItemId)}
          roomId={bundle.room?.id ?? null}
          onClose={() => setDrawerId(null)}
          onPatch={(body) => patchItem(drawerItem.id, body)}
          onRemind={() => {
            setDrawerId(null);
            void compose([drawerItem.id]);
          }}
        />
      )}
    </div>
  );
}

function RequestDrawer({
  item,
  number,
  checklistTitle,
  roomId,
  onClose,
  onPatch,
  onRemind,
}: {
  item: RequestItem;
  number: number;
  checklistTitle: string | null;
  roomId: string | null;
  onClose: () => void;
  onPatch: (body: Record<string, unknown>) => Promise<void>;
  onRemind: () => void;
}) {
  const [notes, setNotes] = useState(item.responseNotes);
  const days = daysOutstanding(item);
  return (
    <DrawerShell
      title={`#${number} · ${item.label}`}
      subtitle={`Requested ${fmtDateShort(item.lastRequestedAt ?? item.createdAt)}${
        days !== null ? ` · ${days} days outstanding` : ""
      }`}
      onClose={onClose}
    >
      <div className="space-y-4">
        <div>
          <label className={drawerLabelCls}>Status</label>
          <select
            className={drawerInputCls}
            value={item.status}
            onChange={(e) => void onPatch({ status: e.target.value })}
          >
            <option value="requested">Requested</option>
            <option value="received">Received</option>
            <option value="waived">Waived</option>
          </select>
        </div>
        <div>
          <label className={drawerLabelCls}>Seller response</label>
          <textarea
            className={drawerInputCls}
            rows={4}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            onBlur={() => {
              if (notes !== item.responseNotes)
                void onPatch({ responseNotes: notes });
            }}
            placeholder="What the seller said, or where the document landed…"
          />
          {item.respondedAt && (
            <p className="mt-1 text-xs text-slate-400">
              Responded {fmtDateShort(item.respondedAt)}
            </p>
          )}
        </div>
        <div className="text-sm">
          <span className={drawerLabelCls}>Linked checklist item</span>
          <p className="text-[#0d1f3c] dark:text-white/85">
            {checklistTitle ?? "—"}
          </p>
        </div>
        <div className="text-sm">
          <span className={drawerLabelCls}>Document</span>
          {item.dataroomChecklistItemId && roomId ? (
            <Link
              className="font-semibold text-[#8a6d3b] hover:underline dark:text-[#b8975a]"
              href={`/data-rooms/${roomId}`}
            >
              Open in data room →
            </Link>
          ) : (
            <p className="text-[#0d1f3c] dark:text-white/85">
              No data room document linked.
            </p>
          )}
        </div>
        {item.status === "requested" && (
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={onRemind}
          >
            Remind — compose email for this item
          </button>
        )}
        <div>
          <span className={drawerLabelCls}>Comments</span>
          <CommentsPanel
            entityKind="diligence_request_item"
            entityId={item.id}
          />
        </div>
      </div>
    </DrawerShell>
  );
}

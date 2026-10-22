"use client";

/**
 * Request list — generated from the deal's data room checklist
 * (every unsatisfied room item becomes an outstanding request), and
 * the ONE request email composed from those items. Sending happens
 * through the user's mail app via the mailto link (Microsoft Graph
 * mail scope is not consented); "Mark as sent" records the send.
 */

import { useCallback, useEffect, useState } from "react";
import { Button, EmptyState } from "@/components/ui";
import {
  api,
  cardCls,
  inputCls,
  labelCls,
  selectCls,
  tdCls,
  thCls,
  fmtDateShort,
  type TabProps,
} from "@/components/diligence/types";

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

export default function RequestsTab({ workspaceId, bundle, reload }: TabProps) {
  const [generating, setGenerating] = useState(false);
  const [genMsg, setGenMsg] = useState("");
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");

  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [recipient, setRecipient] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [composed, setComposed] = useState<Composed | null>(null);
  const [composing, setComposing] = useState(false);
  const [markingSent, setMarkingSent] = useState(false);
  const [sentMsg, setSentMsg] = useState("");

  const loadTemplates = useCallback(async () => {
    try {
      const data = await api<{ templates?: EmailTemplate[]; items?: EmailTemplate[] }>(
        "/api/platform/directory/templates"
      );
      const list = data.templates ?? data.items ?? [];
      setTemplates(Array.isArray(list) ? list : []);
    } catch {
      setTemplates([]);
    }
  }, []);

  useEffect(() => {
    void loadTemplates();
  }, [loadTemplates]);

  const items = bundle.requestItems;
  const outstanding = items.filter((i) => i.status === "requested");
  const sends = bundle.requestSends;

  const generate = async () => {
    setGenerating(true);
    setGenMsg("");
    setError("");
    try {
      const data = await api<{
        roomId: string | null;
        created: number;
        updated: number;
      }>(`/api/platform/diligence/workspaces/${encodeURIComponent(workspaceId)}/requests`, {
        method: "POST",
      });
      if (data.roomId) {
        setGenMsg(
          `Generated from data room ${data.roomId}: ${data.created} new request(s), ${data.updated} updated.`
        );
      } else {
        setGenMsg(
          "No data room is linked to this deal yet, so there is nothing to generate from. Create a data room for the deal first."
        );
      }
      await reload();
    } catch {
      setError("Could not generate the request list. Please try again.");
    } finally {
      setGenerating(false);
    }
  };

  const patchItem = async (itemId: string, body: Record<string, unknown>) => {
    setBusyId(itemId);
    setError("");
    try {
      await api(`/api/platform/diligence/request-items/${encodeURIComponent(itemId)}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      await reload();
    } catch {
      setError("Could not update that request item. Please try again.");
    } finally {
      setBusyId("");
    }
  };

  const compose = async () => {
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
          }),
        }
      );
      setComposed(data);
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
      await api(`/api/platform/diligence/workspaces/${encodeURIComponent(workspaceId)}/requests/send`, {
        method: "POST",
        body: JSON.stringify({
          recipient: recipient.trim(),
          subject: composed.subject,
          body: composed.body,
          itemIds: outstanding.map((i) => i.id),
          channel: "mailto",
        }),
      });
      setSentMsg("Send recorded. The outstanding items now show as last requested just now.");
      setComposed(null);
      await reload();
    } catch {
      setError("Could not record the send. Please try again.");
    } finally {
      setMarkingSent(false);
    }
  };

  return (
    <div className="space-y-5">
      {error && (
        <p className="rounded-xl bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-300">
          {error}
        </p>
      )}

      {/* Generate + outstanding list */}
      <div className={cardCls}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="font-display text-lg font-semibold text-[#0d1f3c] dark:text-white">
              Outstanding requests
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
            <table className="w-full min-w-[720px] border-collapse">
              <thead>
                <tr className="border-b border-slate-200 dark:border-white/10">
                  <th className={thCls}>Item</th>
                  <th className={thCls}>Status</th>
                  <th className={thCls}>Last requested</th>
                  <th className={thCls}>Response notes</th>
                  <th className={thCls}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr
                    key={item.id}
                    className="border-b border-slate-100 dark:border-white/5"
                  >
                    <td className={`${tdCls} font-medium`}>{item.label}</td>
                    <td className={tdCls}>
                      <span
                        className={`badge ${
                          item.status === "received"
                            ? "badge-fit"
                            : item.status === "waived"
                              ? "badge-neutral"
                              : "badge-warn"
                        }`}
                      >
                        {item.status}
                      </span>
                    </td>
                    <td className={tdCls}>{fmtDateShort(item.lastRequestedAt)}</td>
                    <td className={tdCls}>
                      <input
                        className={inputCls}
                        placeholder="Response notes"
                        defaultValue={item.responseNotes}
                        disabled={busyId === item.id}
                        onBlur={(e) => {
                          if (e.target.value !== item.responseNotes)
                            void patchItem(item.id, {
                              responseNotes: e.target.value,
                            });
                        }}
                        aria-label={`Response notes for ${item.label}`}
                      />
                    </td>
                    <td className={tdCls}>
                      <div className="flex gap-1.5">
                        {item.status !== "received" && (
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            disabled={busyId === item.id}
                            onClick={() =>
                              void patchItem(item.id, { status: "received" })
                            }
                          >
                            Mark received
                          </button>
                        )}
                        {item.status !== "waived" && (
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            disabled={busyId === item.id}
                            onClick={() =>
                              void patchItem(item.id, { status: "waived" })
                            }
                          >
                            Waive
                          </button>
                        )}
                        {item.status !== "requested" && (
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            disabled={busyId === item.id}
                            onClick={() =>
                              void patchItem(item.id, { status: "requested" })
                            }
                          >
                            Reopen
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Compose */}
      <div className={cardCls}>
        <h3 className="font-display text-lg font-semibold text-[#0d1f3c] dark:text-white">
          Compose request email
        </h3>
        <p className="mt-1 text-sm text-slate-500 dark:text-white/50">
          One email covering all {outstanding.length} outstanding item(s).
          Sending happens in your mail app — the Microsoft Graph mail scope is
          not yet consented, so the portal cannot send directly. After sending,
          use “Mark as sent” to record it here.
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
              <Button size="sm" variant="accent" onClick={() => void markSent()} loading={markingSent}>
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
                  {s.channel} · {s.itemIds.length} item(s) · sent by {s.sentBy || "—"}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

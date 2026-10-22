"use client";

/**
 * Board tab (Phase 9, internal) — board meetings for one portfolio
 * company: list + create (title/date/status), a minutes + decisions
 * editor per meeting (PATCH), and Generate pack (POST …/pack), which
 * stamps pack_document_id on the meeting; the pack opens through the
 * Phase 3 document file route.
 */

import { useCallback, useEffect, useState } from "react";
import { Button, EmptyState, ErrorState, SkeletonRows } from "@/components/ui";
import { ErrorBanner, Section, SimpleTable } from "@/components/monitoring/shared";
import {
  dateOnly,
  fmtDateShort,
  inputCls,
  labelCls,
  selectCls,
  statusBadge,
  type MonitoringTabProps,
} from "@/components/monitoring/types";
import { api, pick, pmCompany, rowsFrom, str, type Rec } from "@/components/portmgmt/pm";

const STATUSES = ["scheduled", "held", "cancelled"] as const;

function decisionsText(r: Rec): string {
  const d = pick(r, "decisions");
  if (Array.isArray(d)) return d.map(String).join("\n");
  return str(d);
}

export default function BoardTab({ companyId }: MonitoringTabProps) {
  const base = `${pmCompany(companyId)}/meetings`;
  const [meetings, setMeetings] = useState<Rec[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState("");

  const [form, setForm] = useState({ title: "", date: "", status: "scheduled" });
  const [creating, setCreating] = useState(false);

  const [editingId, setEditingId] = useState("");
  const [minutes, setMinutes] = useState("");
  const [decisions, setDecisions] = useState("");
  const [savingNotes, setSavingNotes] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadFailed(false);
    try {
      const d = await api<Rec>(base);
      const list = rowsFrom(d, "meetings", "items");
      setMeetings(
        [...list].sort((a, b) =>
          (dateOnly(pick(b, "scheduledAt", "date", "meetingDate")) || "").localeCompare(
            dateOnly(pick(a, "scheduledAt", "date", "meetingDate")) || ""
          )
        )
      );
    } catch {
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, [base]);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async () => {
    if (!form.title.trim() || creating) return;
    setCreating(true);
    setError("");
    try {
      await api(base, {
        method: "POST",
        body: JSON.stringify({
          title: form.title.trim(),
          scheduledAt: form.date || undefined,
          date: form.date || undefined,
          status: form.status,
        }),
      });
      setForm({ title: "", date: "", status: "scheduled" });
      await load();
    } catch {
      setError("Could not create that meeting.");
    } finally {
      setCreating(false);
    }
  };

  const setStatus = async (m: Rec, status: string) => {
    const id = str(pick(m, "id"));
    if (!id) return;
    setBusyId(id);
    setError("");
    try {
      await api(`${base}/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      await load();
    } catch {
      setError("Could not update that meeting.");
    } finally {
      setBusyId("");
    }
  };

  const saveNotes = async () => {
    if (!editingId || savingNotes) return;
    setSavingNotes(true);
    setError("");
    try {
      await api(`${base}/${encodeURIComponent(editingId)}`, {
        method: "PATCH",
        body: JSON.stringify({
          minutes,
          decisions: decisions
            .split("\n")
            .map((s) => s.trim())
            .filter(Boolean),
        }),
      });
      setEditingId("");
      await load();
    } catch {
      setError("Could not save the minutes / decisions.");
    } finally {
      setSavingNotes(false);
    }
  };

  const generatePack = async (m: Rec) => {
    const id = str(pick(m, "id"));
    if (!id) return;
    setBusyId(id);
    setError("");
    try {
      await api(`${base}/${encodeURIComponent(id)}/pack`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      await load();
    } catch {
      setError("Could not generate the board pack for that meeting.");
    } finally {
      setBusyId("");
    }
  };

  if (loading) return <SkeletonRows rows={5} />;
  if (loadFailed) return <ErrorState onRetry={() => void load()} />;

  return (
    <div className="space-y-5">
      <ErrorBanner message={error} />
      <Section
        title="Board meetings"
        caption="Meetings for this company. Generate pack assembles the board pack document and stamps it on the meeting; minutes and decisions are edited in place."
      >
        {meetings.length === 0 ? (
          <EmptyState
            title="No board meetings yet"
            message="Schedule the first meeting below — title, date and status are all the pack generator needs to get started."
          />
        ) : (
          <SimpleTable
            rows={meetings}
            rowKey={(r, i) => str(pick(r, "id")) || String(i)}
            columns={[
              { key: "title", label: "Meeting", value: (r) => str(pick(r, "title")) || "—" },
              {
                key: "date",
                label: "Date",
                value: (r) =>
                  fmtDateShort(dateOnly(pick(r, "scheduledAt", "date", "meetingDate")) || str(pick(r, "scheduledAt"))),
              },
              {
                key: "status",
                label: "Status",
                render: (r) => {
                  const s = str(pick(r, "status"));
                  return s ? <span className={`badge ${statusBadge(s)}`}>{s}</span> : "—";
                },
              },
              {
                key: "pack",
                label: "Pack",
                render: (r) => {
                  const packId = str(pick(r, "pack_document_id", "packDocumentId"));
                  return packId ? (
                    <a
                      href={`/api/platform/documents/${encodeURIComponent(packId)}/file`}
                      className="text-sm font-semibold text-gold-700 hover:underline dark:text-gold-400"
                    >
                      Download pack
                    </a>
                  ) : (
                    "—"
                  );
                },
              },
              {
                key: "actions",
                label: "Actions",
                render: (r) => {
                  const id = str(pick(r, "id"));
                  const s = str(pick(r, "status"));
                  return (
                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant="secondary"
                        className="min-h-[44px]"
                        onClick={() => {
                          setEditingId(id);
                          setMinutes(str(pick(r, "minutes")));
                          setDecisions(decisionsText(r));
                        }}
                      >
                        Minutes
                      </Button>
                      <Button
                        size="sm"
                        className="min-h-[44px]"
                        loading={busyId === id}
                        onClick={() => void generatePack(r)}
                      >
                        Generate pack
                      </Button>
                      {STATUSES.filter((x) => x !== s).map((x) => (
                        <Button
                          key={x}
                          size="sm"
                          variant="ghost"
                          className="min-h-[44px]"
                          disabled={busyId === id}
                          onClick={() => void setStatus(r, x)}
                        >
                          Mark {x}
                        </Button>
                      ))}
                    </div>
                  );
                },
              },
            ]}
          />
        )}

        {editingId && (
          <div className="mt-5 rounded-xl border border-slate-200 p-4 dark:border-white/10">
            <h4 className="text-sm font-semibold text-[#0d1f3c] dark:text-white">
              Minutes &amp; decisions
            </h4>
            <div className="mt-3 grid gap-3">
              <div>
                <label className={labelCls} htmlFor="board-minutes">Minutes</label>
                <textarea
                  id="board-minutes"
                  className={`${inputCls} min-h-[110px]`}
                  value={minutes}
                  onChange={(e) => setMinutes(e.target.value)}
                  placeholder="What was discussed…"
                />
              </div>
              <div>
                <label className={labelCls} htmlFor="board-decisions">Decisions (one per line)</label>
                <textarea
                  id="board-decisions"
                  className={`${inputCls} min-h-[80px]`}
                  value={decisions}
                  onChange={(e) => setDecisions(e.target.value)}
                  placeholder={"Approved the Q3 budget\nDeclared a distribution"}
                />
              </div>
            </div>
            <div className="mt-3 flex gap-2">
              <Button className="min-h-[44px]" loading={savingNotes} onClick={() => void saveNotes()}>
                Save minutes
              </Button>
              <Button variant="ghost" className="min-h-[44px]" onClick={() => setEditingId("")}>
                Cancel
              </Button>
            </div>
          </div>
        )}

        <div className="mt-5 border-t border-slate-100 pt-4 dark:border-white/5">
          <h4 className="text-sm font-semibold text-[#0d1f3c] dark:text-white">New meeting</h4>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_180px_160px_auto] lg:items-end">
            <div>
              <label className={labelCls}>Title</label>
              <input
                className={`${inputCls} min-h-[44px]`}
                value={form.title}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                placeholder="Q3 board meeting"
              />
            </div>
            <div>
              <label className={labelCls}>Date</label>
              <input
                type="date"
                className={`${inputCls} min-h-[44px]`}
                value={form.date}
                onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
              />
            </div>
            <div>
              <label className={labelCls}>Status</label>
              <select
                className={`${selectCls} min-h-[44px]`}
                value={form.status}
                onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}
              >
                {STATUSES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
            <Button className="min-h-[44px]" loading={creating} disabled={!form.title.trim()} onClick={() => void create()}>
              Add meeting
            </Button>
          </div>
        </div>
      </Section>
    </div>
  );
}

"use client";

/**
 * SchedulesPanel — the Communications home Schedules tab: recurring
 * report schedules with cadence, next run, status (pause reason
 * shown verbatim), and approve / run-now / pause / resume / delete
 * actions, plus the New schedule dialog. A schedule only auto-sends
 * after its one-time routine approval; the server enforces that.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Button, EmptyState, ErrorState, SkeletonRows } from "@/components/ui";
import {
  COMMS_API,
  SUBJECT_KINDS,
  api,
  bool,
  fmtDate,
  inputCls,
  labelCls,
  labelOf,
  listFrom,
  num,
  pick,
  selectCls,
  str,
  type CommsSchedule,
  type CommsTemplate,
  type Rec,
} from "@/components/comms/types";

export default function SchedulesPanel() {
  const [schedules, setSchedules] = useState<CommsSchedule[]>([]);
  const [templates, setTemplates] = useState<CommsTemplate[]>([]);
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const [showNew, setShowNew] = useState(false);
  const [busyId, setBusyId] = useState("");
  const [note, setNote] = useState("");

  const load = useCallback(async () => {
    setPhase("loading");
    try {
      const [sData, tData] = await Promise.all([
        api<Record<string, unknown>>(`${COMMS_API}/schedules`),
        api<Record<string, unknown>>(`${COMMS_API}/templates`),
      ]);
      setSchedules(listFrom<CommsSchedule>(sData, "items", "schedules"));
      setTemplates(listFrom<CommsTemplate>(tData, "items", "templates"));
      setPhase("ready");
    } catch {
      setPhase("error");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const templateName = (s: CommsSchedule): string => {
    const direct = str(pick(s as Rec, "templateName", "template_name"));
    if (direct) return direct;
    const tid = str(pick(s as Rec, "templateId", "template_id"));
    return templates.find((t) => t.id === tid)?.name ?? tid ?? "—";
  };

  const act = async (s: CommsSchedule, action: "approve" | "run" | "pause" | "resume" | "delete") => {
    if (busyId) return;
    if (action === "delete" && !window.confirm("Delete this schedule?")) return;
    setBusyId(s.id);
    setNote("");
    try {
      if (action === "approve") {
        await api(`${COMMS_API}/schedules/${encodeURIComponent(s.id)}/approve`, { method: "POST" });
        setNote("Schedule approved for routine runs.");
      } else if (action === "run") {
        await api(`${COMMS_API}/schedules/${encodeURIComponent(s.id)}/run`, { method: "POST" });
        setNote("Run queued — the schedule job will apply its data checks before generating anything.");
      } else if (action === "pause") {
        await api(`${COMMS_API}/schedules/${encodeURIComponent(s.id)}`, {
          method: "PATCH",
          body: JSON.stringify({ status: "paused" }),
        });
      } else if (action === "resume") {
        await api(`${COMMS_API}/schedules/${encodeURIComponent(s.id)}`, {
          method: "PATCH",
          body: JSON.stringify({ status: "active" }),
        });
      } else {
        await api(`${COMMS_API}/schedules/${encodeURIComponent(s.id)}`, { method: "DELETE" });
      }
      void load();
    } catch (err) {
      const code =
        err && typeof err === "object" && "body" in err
          ? String((err as { body: Rec }).body?.error ?? "")
          : "";
      setNote(
        code === "routine_not_allowed"
          ? "This schedule's template is not routine-eligible (memo purpose or a narrative block), so it cannot be approved for routine runs."
          : "That action failed. Please try again."
      );
    } finally {
      setBusyId("");
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-slate-500 dark:text-white/50">
          Recurring reports. A failed data check pauses the schedule —
          nothing is generated or sent until it is resumed.
        </p>
        <Button variant="primary" size="sm" className="min-h-[44px] shrink-0" onClick={() => setShowNew(true)}>
          New schedule
        </Button>
      </div>

      {note && (
        <p className="mt-3 rounded-xl bg-slate-500/10 px-4 py-3 text-sm text-slate-700 dark:text-white/80">
          {note}
        </p>
      )}

      <div className="mt-4">
        {phase === "loading" && <SkeletonRows rows={4} />}
        {phase === "error" && <ErrorState onRetry={() => void load()} />}
        {phase === "ready" && schedules.length === 0 && (
          <EmptyState
            title="No schedules yet"
            message="Schedule a routine template to generate (and, once approved, send) reports automatically."
            actionLabel="New schedule"
            onAction={() => setShowNew(true)}
          />
        )}
        {phase === "ready" && schedules.length > 0 && (
          <div className="overflow-x-auto">
            <table className="tbl-grad w-full min-w-[760px] text-sm">
              <thead>
                <tr>
                  <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide">Template</th>
                  <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide">Subject</th>
                  <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide">Cadence</th>
                  <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide">Next run</th>
                  <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide">Status</th>
                  <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase tracking-wide">Actions</th>
                </tr>
              </thead>
              <tbody>
                {schedules.map((s) => {
                  const approved = bool(pick(s as Rec, "routineApproved", "routine_approved"));
                  const paused = s.status === "paused";
                  const pauseReason = str(pick(s as Rec, "pauseReason", "pause_reason"));
                  const nextRun = pick(s as Rec, "nextRunAt", "next_run_at");
                  const lastReportId = str(pick(s as Rec, "lastReportId", "last_report_id"));
                  const busy = busyId === s.id;
                  return (
                    <tr key={s.id} className="border-t border-slate-100 align-top dark:border-white/5">
                      <td className="px-3 py-2.5 font-medium text-navy-900 dark:text-white">
                        {templateName(s)}
                        {!approved && (
                          <span className="mt-1 block"><span className="badge badge-warn">Not routine-approved</span></span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-slate-600 dark:text-white/70">
                        {labelOf(SUBJECT_KINDS, str(pick(s as Rec, "subjectKind", "subject_kind")))}
                      </td>
                      <td className="px-3 py-2.5 text-slate-600 dark:text-white/70">
                        {str(pick(s as Rec, "cadence"))}
                        {num(pick(s as Rec, "dayOfMonth", "day_of_month"))
                          ? ` · day ${num(pick(s as Rec, "dayOfMonth", "day_of_month"))}`
                          : ""}
                      </td>
                      <td className="px-3 py-2.5 text-slate-500 dark:text-white/50">
                        {typeof nextRun === "string" && nextRun ? fmtDate(nextRun) : "—"}
                      </td>
                      <td className="px-3 py-2.5">
                        <span className={`badge ${paused ? "badge-warn" : "badge-fit"}`}>
                          {s.status}
                        </span>
                        {paused && pauseReason && (
                          <span className="mt-1 block max-w-[220px] text-xs text-amber-700 dark:text-amber-300">
                            {pauseReason}
                          </span>
                        )}
                        {lastReportId && (
                          <Link
                            href={`/communications/reports/${encodeURIComponent(lastReportId)}`}
                            className="mt-1 block text-xs font-semibold text-gold-700 hover:underline dark:text-gold-400"
                          >
                            Last report →
                          </Link>
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        <span className="flex flex-wrap justify-end gap-1.5">
                          {!approved && (
                            <Button variant="secondary" size="sm" disabled={busy} onClick={() => void act(s, "approve")}>
                              Approve
                            </Button>
                          )}
                          <Button variant="secondary" size="sm" disabled={busy} onClick={() => void act(s, "run")}>
                            Run now
                          </Button>
                          {paused ? (
                            <Button variant="secondary" size="sm" disabled={busy} onClick={() => void act(s, "resume")}>
                              Resume
                            </Button>
                          ) : (
                            <Button variant="secondary" size="sm" disabled={busy} onClick={() => void act(s, "pause")}>
                              Pause
                            </Button>
                          )}
                          <Button variant="ghost" size="sm" disabled={busy} onClick={() => void act(s, "delete")}>
                            Delete
                          </Button>
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showNew && (
        <NewScheduleDialog
          templates={templates}
          onClose={() => setShowNew(false)}
          onCreated={() => {
            setShowNew(false);
            void load();
          }}
        />
      )}
    </div>
  );
}

function NewScheduleDialog({
  templates,
  onClose,
  onCreated,
}: {
  templates: CommsTemplate[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? "");
  const [subjectKind, setSubjectKind] = useState("company");
  const [subjectId, setSubjectId] = useState("");
  const [cadence, setCadence] = useState("monthly");
  const [dayOfMonth, setDayOfMonth] = useState("1");
  const [recipientsText, setRecipientsText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const create = async () => {
    if (!templateId || busy) return;
    const recipients = recipientsText
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const m = line.match(/^(.*?)\s*<([^>]+)>$/);
        if (m) return { name: m[1].trim(), email: m[2].trim() };
        return { name: line, email: line.includes("@") ? line : "" };
      })
      .filter((r) => r.email);
    setBusy(true);
    setError("");
    try {
      const body: Record<string, unknown> = {
        templateId,
        subjectKind,
        cadence,
        dayOfMonth: Number(dayOfMonth) || 1,
        recipients,
      };
      if (subjectKind === "company" || subjectKind === "portfolio_company") body.companyId = subjectId || undefined;
      else if (subjectKind === "deal") body.dealId = subjectId || undefined;
      else if (subjectKind === "investor") body.personId = subjectId || undefined;
      await api(`${COMMS_API}/schedules`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      onCreated();
    } catch {
      setError("Could not create the schedule. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-navy-950/60 p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label="New schedule"
      onClick={() => !busy && onClose()}
    >
      <div className="card-surface max-h-[90vh] w-full max-w-md overflow-y-auto p-5" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-display text-xl font-semibold text-navy-900 dark:text-white">
          New schedule
        </h3>
        <p className="mt-0.5 text-sm text-slate-500 dark:text-white/50">
          The schedule generates drafts on cadence. Auto-send needs a
          routine-eligible template plus the one-time approval after
          creation.
        </p>
        <div className="mt-4 space-y-3">
          <div>
            <label className={labelCls} htmlFor="ns-template">Template</label>
            <select id="ns-template" className={`${selectCls} min-h-[44px]`} value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
              {templates.length === 0 && <option value="">No templates available</option>}
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}{bool(pick(t as Rec, "routine")) ? " (routine)" : ""}
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls} htmlFor="ns-kind">Subject type</label>
              <select id="ns-kind" className={`${selectCls} min-h-[44px]`} value={subjectKind} onChange={(e) => setSubjectKind(e.target.value)}>
                {SUBJECT_KINDS.map((k) => (
                  <option key={k.key} value={k.key}>{k.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls} htmlFor="ns-subject">Subject ID</label>
              <input
                id="ns-subject"
                className={`${inputCls} min-h-[44px]`}
                value={subjectId}
                onChange={(e) => setSubjectId(e.target.value)}
                placeholder="Company / deal / person id"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls} htmlFor="ns-cadence">Cadence</label>
              <select id="ns-cadence" className={`${selectCls} min-h-[44px]`} value={cadence} onChange={(e) => setCadence(e.target.value)}>
                <option value="monthly">Monthly</option>
                <option value="quarterly">Quarterly</option>
              </select>
            </div>
            <div>
              <label className={labelCls} htmlFor="ns-day">Day of month</label>
              <input
                id="ns-day"
                type="number"
                min={1}
                max={28}
                className={`${inputCls} min-h-[44px]`}
                value={dayOfMonth}
                onChange={(e) => setDayOfMonth(e.target.value)}
              />
            </div>
          </div>
          <div>
            <label className={labelCls} htmlFor="ns-recipients">
              Recipients (one per line, “Name &lt;email&gt;”)
            </label>
            <textarea
              id="ns-recipients"
              className={`${inputCls} min-h-[88px]`}
              value={recipientsText}
              onChange={(e) => setRecipientsText(e.target.value)}
              placeholder={"Jane Investor <jane@example.com>"}
            />
          </div>
        </div>
        {error && (
          <p role="alert" className="mt-3 rounded-xl bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-300">
            {error}
          </p>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="primary" size="sm" onClick={() => void create()} disabled={!templateId || busy} loading={busy}>
            Create schedule
          </Button>
        </div>
      </div>
    </div>
  );
}

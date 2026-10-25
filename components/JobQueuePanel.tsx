"use client";

/**
 * Settings → Background jobs (Phase 1): the platform job queue from
 * GET /api/platform/jobs, with Retry for failed jobs and Run now
 * for queued ones (POST /api/platform/jobs). Failure renders a
 * clean error state — never a crash.
 */

import { useCallback, useEffect, useState } from "react";
import { ErrorState, SkeletonRows } from "@/components/ui";

interface JobStep {
  key: string;
  label: string;
  status: string;
  detail?: string;
  error?: string;
}

interface Job {
  id: string;
  kind: string;
  status: string;
  attempts?: number;
  lastError?: string | null;
  createdAt?: string;
  updatedAt?: string;
  payload?: { steps?: JobStep[] };
}

function fmtWhen(iso?: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/Phoenix",
  });
}

function statusBadge(status: string): string {
  if (status === "succeeded" || status === "done" || status === "completed")
    return "badge-fit";
  if (status === "failed" || status === "error") return "badge-danger";
  if (status === "running" || status === "processing") return "badge-warn";
  return "badge-neutral";
}

/** Group ordering for status-count badges: problems first, then
 * in-flight, then the quiet tail. */
const STATUS_ORDER = [
  "failed",
  "error",
  "running",
  "processing",
  "queued",
  "pending",
  "registered",
  "cancelled",
  "succeeded",
  "done",
  "completed",
];

interface JobGroup {
  kind: string;
  jobs: Job[];
  /** Most recently updated entry — the group's headline state. */
  latest: Job;
  counts: { status: string; n: number }[];
}

/**
 * Plain-English names for every job kind (Ethan, Oct 24, 2026):
 * the panel showed raw kind strings (push_meeting60, db_backup…)
 * and "we know what's going on" requires real names. Each entry
 * was verified against the kind's handler in lib/platform/jobs.ts
 * (executeJob) and its enqueue sites — this map covers every kind
 * the system can produce. An unmapped kind falls back to its raw
 * string with no blurb; the raw kind always stays visible in the
 * muted meta line for debugging.
 */
const JOB_KIND_INFO: Record<string, { name: string; blurb: string }> = {
  refresh_overview_summary: {
    name: "Overview summary refresh",
    blurb:
      "Rebuilds the Overview page's stored totals after deals, companies, or events change.",
  },
  db_backup: {
    name: "Daily backup check",
    blurb:
      "Daily checkpoint for database backups — the snapshots themselves are Neon's point-in-time recovery; this records the verification in the audit log.",
  },
  refresh_generated_events: {
    name: "Calendar items refresh",
    blurb:
      "Regenerates the calendar's built-in items — task due dates, deadlines, reporting dates, closings — from their source records.",
  },
  push_reminder: {
    name: "Follow-up & event reminders",
    blurb:
      "Push alert for one follow-up task or calendar event at its chosen reminder time, including snooze re-fires.",
  },
  push_meeting60: {
    name: "Meeting reminder — 1 hour before",
    blurb: "Push alert sent an hour before a calendar meeting starts.",
  },
  push_morning_digest: {
    name: "Morning digest — 8:00 AM daily",
    blurb:
      "The daily 8:00 AM Phoenix bundle: morning digest, stalled deals, quiet contacts, and feed checks in one push.",
  },
  extract_financials: {
    name: "Financial statement extraction",
    blurb:
      "Extracts the figures from a large uploaded financial statement (over the 5 MB quick limit) in the background.",
  },
  analyze_financials: {
    name: "Financial analysis",
    blurb:
      "Runs a company's financial analysis after new financials are posted or adjustment decisions are made.",
  },
  extract_document_terms: {
    name: "Contract terms extraction",
    blurb:
      "Reads an uploaded document and pulls its key contract terms into the diligence contract register.",
  },
  extract_document_text: {
    name: "Document text extraction",
    blurb:
      "Extracts an uploaded document's text so its contents become searchable.",
  },
  generate_memo: {
    name: "Diligence memo draft",
    blurb:
      "Regenerates a deal's diligence summary / IC memo draft from its current records.",
  },
  compute_risk_score: {
    name: "Deal risk score",
    blurb:
      "Recomputes a deal's risk score and adds the result to its score history.",
  },
  refresh_record_checks: {
    name: "Public record checks — monthly",
    blurb:
      "Monthly refresh of the automatable public record checks for tracked companies.",
  },
  deal_close_cascade: {
    name: "Deal closing sequence",
    blurb:
      "Runs a closed deal's follow-through steps: monitoring record and baseline financials, value-creation plan shell, reporting calendar, data-room archive, and the close-out notification.",
  },
  monitoring_handoff: {
    name: "Portfolio monitoring handoff",
    blurb: "Copies a closed deal's closing baseline into Portfolio Monitoring.",
  },
  monitoring_period_due: {
    name: "Reporting period due check",
    blurb:
      "Checks one portfolio reporting period; if it is overdue it flips to Late and raises the alert.",
  },
  dedupe_scan: {
    name: "Duplicate auto-merge — daily",
    blurb:
      "Daily scan that automatically merges exact-duplicate companies and people.",
  },
  comms_generate_report: {
    name: "Report generation",
    blurb: "Builds one report in Reporting from its source data.",
  },
  comms_schedule_run: {
    name: "Scheduled report run",
    blurb:
      "One occurrence of a recurring report schedule: data checks, draft generation, and delivery when the schedule is approved for it.",
  },
  comms_purge_discarded: {
    name: "Discarded report cleanup — daily",
    blurb:
      "Permanently deletes reports that have sat in Discarded for more than 30 days.",
  },
};

function kindInfo(kind: string): { name: string; blurb?: string } {
  const info = JOB_KIND_INFO[kind];
  return info ? info : { name: kind };
}

/**
 * Collapse repeated queue entries by kind (Ethan, Oct 24, 2026):
 * scheduled kinds like push_meeting60 leave a row per tick, most of
 * them cancelled, and the flat list drowned everything else. Group
 * order follows first appearance in the API's newest-first list.
 */
function groupJobs(list: Job[]): JobGroup[] {
  const byKind = new Map<string, Job[]>();
  for (const job of list) {
    const arr = byKind.get(job.kind);
    if (arr) arr.push(job);
    else byKind.set(job.kind, [job]);
  }
  const groups: JobGroup[] = [];
  byKind.forEach((jobs, kind) => {
    const latest = jobs.reduce((a: Job, b: Job) =>
      (b.updatedAt ?? "") > (a.updatedAt ?? "") ? b : a
    );
    const tally = new Map<string, number>();
    for (const j of jobs) tally.set(j.status, (tally.get(j.status) ?? 0) + 1);
    const counts: { status: string; n: number }[] = [];
    tally.forEach((n, status) => counts.push({ status, n }));
    counts.sort(
      (a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status)
    );
    groups.push({ kind, jobs, latest, counts });
  });
  return groups;
}

export default function JobQueuePanel() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState("");
  const [showHistory, setShowHistory] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggleGroup = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const r = await fetch("/api/platform/jobs");
      if (!r.ok) throw new Error(`Request failed (${r.status})`);
      const d = (await r.json()) as { jobs?: Job[] };
      setJobs(Array.isArray(d.jobs) ? d.jobs : []);
    } catch {
      setError(
        "The job queue couldn't be loaded. The platform API or database may be unavailable."
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const act = async (job: Job, action?: "run") => {
    setBusyId(job.id);
    setActionError("");
    try {
      const body: Record<string, unknown> = { id: job.id };
      if (action) body.action = action;
      const r = await fetch("/api/platform/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error(`Request failed (${r.status})`);
      await load();
    } catch {
      setActionError("That action didn't go through — the queue may be unavailable.");
    } finally {
      setBusyId(null);
    }
  };

  if (loading) return <SkeletonRows rows={3} />;
  if (error) {
    return <ErrorState title="Couldn't load background jobs" message={error} onRetry={load} />;
  }

  // Filed view (Ethan, Oct 23, 2026): what needs attention or is in
  // flight stays on top with the latest few completed; the long tail
  // of finished runs is history, one tap away — not the page.
  const TERMINAL = ["succeeded", "done", "completed"];
  const attention = jobs.filter((j) => !TERMINAL.includes(j.status));
  const history = jobs.filter((j) => TERMINAL.includes(j.status));
  const failedCount = jobs.filter(
    (j) => j.status === "failed" || j.status === "error"
  ).length;
  // Truthful header counts (Ethan, Oct 24, 2026): "active or queued"
  // used to count every non-terminal row, so cancelled reminders
  // and standing 'registered' placeholders inflated it. Active now
  // means genuinely queued or running; cancelled/registered rows
  // get their own count instead of masquerading as live work.
  const ACTIVE = ["queued", "pending", "running", "processing"];
  const activeCount = jobs.filter((j) => ACTIVE.includes(j.status)).length;
  const filedCount = attention.length - activeCount - failedCount;
  // Collapsed view (Ethan, Oct 24, 2026): within each filed section,
  // repeated kinds render as ONE group row — kind, per-status counts,
  // latest update — with an expander for the individual entries. The
  // history preview counts groups, so a chatty kind costs one row.
  const HISTORY_PREVIEW = 5;
  const attentionGroups = groupJobs(attention);
  const historyGroups = groupJobs(history);
  const visibleHistoryGroups = showHistory
    ? historyGroups
    : historyGroups.slice(0, HISTORY_PREVIEW);
  const visibleHistoryJobs = visibleHistoryGroups.reduce(
    (n, g) => n + g.jobs.length,
    0
  );

  const renderJobRow = (job: Job, standalone = false) => {
    const failed = job.status === "failed" || job.status === "error";
    const queued = job.status === "queued" || job.status === "pending";
    const info = kindInfo(job.kind);
    return (
      <li key={job.id} className="flex flex-wrap items-center gap-3 py-3">
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-[#0d1f3c] dark:text-white">
            {info.name}
            <span className={`badge ${statusBadge(job.status)}`}>
              {job.status}
            </span>
          </p>
          {standalone && info.blurb && (
            <p className="mt-0.5 text-xs text-slate-500 dark:text-white/50">
              {info.blurb}
            </p>
          )}
          <p className="mt-0.5 text-xs text-slate-400 dark:text-white/40">
            {job.kind} · Attempts: {job.attempts ?? 0} · Updated{" "}
            {fmtWhen(job.updatedAt)}
          </p>
          {job.lastError && (
            <p className="mt-0.5 text-xs text-red-600 dark:text-red-300">
              {job.lastError}
            </p>
          )}
          {Array.isArray(job.payload?.steps) &&
            job.payload.steps.length > 0 && (
              <ul className="mt-1.5 space-y-0.5">
                {job.payload.steps.map((s) => (
                  <li
                    key={s.key}
                    className="flex flex-wrap items-center gap-1.5 text-xs text-slate-500 dark:text-white/50"
                  >
                    <span
                      className={`badge ${
                        s.status === "done"
                          ? "badge-fit"
                          : s.status === "failed"
                            ? "badge-danger"
                            : s.status === "skipped"
                              ? "badge-neutral"
                              : "badge-warn"
                      }`}
                    >
                      {s.status}
                    </span>
                    <span className="font-medium">{s.label}</span>
                    {s.detail && <span>— {s.detail}</span>}
                    {s.error && (
                      <span className="text-red-600 dark:text-red-300">
                        {s.error}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
        </div>
        {failed && (
          <button
            onClick={() => act(job)}
            disabled={busyId === job.id}
            className="btn btn-secondary btn-sm shrink-0"
          >
            {busyId === job.id ? "Retrying…" : "Retry"}
          </button>
        )}
        {queued && (
          <button
            onClick={() => act(job, "run")}
            disabled={busyId === job.id}
            className="btn btn-secondary btn-sm shrink-0"
          >
            {busyId === job.id ? "Starting…" : "Run now"}
          </button>
        )}
      </li>
    );
  };

  const renderGroup = (section: string, group: JobGroup) => {
    if (group.jobs.length === 1) return renderJobRow(group.jobs[0], true);
    const info = kindInfo(group.kind);
    const key = `${section}:${group.kind}`;
    const isOpen = expanded.has(key);
    // The newest queued instance keeps its Run now action on the
    // group row — it is the live one; older entries sit inside.
    const queuedJob = group.jobs.find(
      (j) => j.status === "queued" || j.status === "pending"
    );
    // A failure never hides inside a collapsed group: the newest
    // failure's error shows on the group row itself.
    const failedJob = group.jobs.find(
      (j) => (j.status === "failed" || j.status === "error") && j.lastError
    );
    return (
      <li key={key} className="py-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-[#0d1f3c] dark:text-white">
              {info.name}
              {group.counts.map((c) => (
                <span key={c.status} className={`badge ${statusBadge(c.status)}`}>
                  {c.status}
                  {c.n > 1 ? ` ×${c.n}` : ""}
                </span>
              ))}
            </p>
            {info.blurb && (
              <p className="mt-0.5 text-xs text-slate-500 dark:text-white/50">
                {info.blurb}
              </p>
            )}
            <p className="mt-0.5 text-xs text-slate-400 dark:text-white/40">
              {group.kind} · <span className="tnum">{group.jobs.length}</span>{" "}
              entries · latest {group.latest.status} · Updated{" "}
              {fmtWhen(group.latest.updatedAt)}
            </p>
            {failedJob && (
              <p className="mt-0.5 text-xs text-red-600 dark:text-red-300">
                {failedJob.lastError}
              </p>
            )}
          </div>
          {queuedJob && (
            <button
              onClick={() => act(queuedJob, "run")}
              disabled={busyId === queuedJob.id}
              className="btn btn-secondary btn-sm shrink-0"
            >
              {busyId === queuedJob.id ? "Starting…" : "Run now"}
            </button>
          )}
          <button
            type="button"
            onClick={() => toggleGroup(key)}
            aria-expanded={isOpen}
            className="shrink-0 text-xs font-semibold text-[#8a6f3c] hover:underline dark:text-[#d4b37a]"
          >
            {isOpen ? "Hide entries" : `Show ${group.jobs.length} entries`}
          </button>
        </div>
        {isOpen && (
          <ul className="mt-1 divide-y divide-slate-100 border-t border-slate-100 pl-3 dark:divide-white/5 dark:border-white/5">
            {group.jobs.map((job) => renderJobRow(job))}
          </ul>
        )}
      </li>
    );
  };

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-3">
        {actionError ? (
          <p className="text-xs text-red-600 dark:text-red-300">{actionError}</p>
        ) : (
          <span />
        )}
        <button onClick={load} className="btn btn-secondary btn-sm shrink-0">
          Refresh
        </button>
      </div>
      {jobs.length === 0 ? (
        <p className="text-sm text-slate-400 dark:text-white/40">
          No background jobs yet.
        </p>
      ) : (
        <>
          <p className="mb-1 text-xs text-slate-400 dark:text-white/40">
            <span className="tnum font-semibold">{activeCount}</span>{" "}
            active or queued
            {failedCount > 0 && (
              <>
                {" · "}
                <span className="tnum font-semibold text-red-600 dark:text-red-300">
                  {failedCount}
                </span>{" "}
                failed
              </>
            )}
            {" · "}
            <span className="tnum font-semibold">{history.length}</span>{" "}
            completed
            {filedCount > 0 && (
              <>
                {" · "}
                <span className="tnum font-semibold">{filedCount}</span>{" "}
                cancelled or registered
              </>
            )}
          </p>
          <ul className="divide-y divide-slate-100 dark:divide-white/5">
            {attentionGroups.map((g) => renderGroup("attention", g))}
            {visibleHistoryGroups.map((g) => renderGroup("history", g))}
          </ul>
          {(showHistory || visibleHistoryJobs < history.length) && (
            <button
              type="button"
              onClick={() => setShowHistory((v) => !v)}
              className="mt-3 text-xs font-semibold text-[#8a6f3c] hover:underline dark:text-[#d4b37a]"
            >
              {showHistory
                ? "Show less history"
                : `Show full history (${history.length} completed)`}
            </button>
          )}
        </>
      )}
    </div>
  );
}

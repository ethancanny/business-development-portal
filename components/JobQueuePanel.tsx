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

export default function JobQueuePanel() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState("");
  const [showHistory, setShowHistory] = useState(false);

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
  const HISTORY_PREVIEW = 5;
  const visible = [
    ...attention,
    ...(showHistory ? history : history.slice(0, HISTORY_PREVIEW)),
  ];

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
            <span className="tnum font-semibold">{attention.length}</span>{" "}
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
          </p>
          <ul className="divide-y divide-slate-100 dark:divide-white/5">
            {visible.map((job) => {
            const failed = job.status === "failed" || job.status === "error";
            const queued = job.status === "queued" || job.status === "pending";
            return (
              <li key={job.id} className="flex flex-wrap items-center gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-[#0d1f3c] dark:text-white">
                    {job.kind}
                    <span className={`badge ${statusBadge(job.status)}`}>
                      {job.status}
                    </span>
                  </p>
                  <p className="mt-0.5 text-xs text-slate-400 dark:text-white/40">
                    Attempts: {job.attempts ?? 0} · Updated {fmtWhen(job.updatedAt)}
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
            })}
          </ul>
          {history.length > HISTORY_PREVIEW && (
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

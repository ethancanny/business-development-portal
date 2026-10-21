"use client";

/**
 * Settings → Background jobs (Phase 1): the platform job queue from
 * GET /api/platform/jobs, with Retry for failed jobs and Run now
 * for queued ones (POST /api/platform/jobs). Failure renders a
 * clean error state — never a crash.
 */

import { useCallback, useEffect, useState } from "react";
import { ErrorState, SkeletonRows } from "@/components/ui";

interface Job {
  id: string;
  kind: string;
  status: string;
  attempts?: number;
  lastError?: string | null;
  createdAt?: string;
  updatedAt?: string;
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
        <ul className="divide-y divide-slate-100 dark:divide-white/5">
          {jobs.map((job) => {
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
      )}
    </div>
  );
}

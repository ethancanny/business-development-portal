import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { ensurePlatform } from "@/lib/platform/service";
import { getLatestCascadeJob } from "@/lib/platform/cascade";
import { retryJob, runJobNow } from "@/lib/platform/jobs";

interface CascadeStepView {
  key: string;
  label: string;
  status: string;
  detail?: string;
  error?: string;
}

/**
 * Deal-close cascade status + retry (Phase 10).
 * GET  /api/platform/deals/[id]/cascade — the latest deal_close_cascade
 *      job for the deal: { job: { id, status, attempts, lastError,
 *      steps, createdAt, updatedAt } | null }.
 * POST /api/platform/deals/[id]/cascade — retry: resets the latest job
 *      to queued (payload/steps preserved) and runs it via runJobNow,
 *      so only incomplete steps re-run. Returns the refreshed job.
 */

type Params = { params: { id: string } };

export async function GET(_req: NextRequest, { params }: Params) {
  if (!getSessionUser()) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await ensurePlatform();
  const job = await getLatestCascadeJob(params.id);
  return NextResponse.json({ job: job ? toView(job) : null });
}

export async function POST(_req: NextRequest, { params }: Params) {
  if (!getSessionUser()) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await ensurePlatform();
  const job = await getLatestCascadeJob(params.id);
  if (!job) {
    return NextResponse.json(
      { error: "No cascade job for this deal" },
      { status: 404 }
    );
  }
  await retryJob(job.id);
  const result = await runJobNow(job.id);
  const refreshed = await getLatestCascadeJob(params.id);
  return NextResponse.json(
    {
      ok: result.ok,
      ...(result.error ? { error: result.error } : {}),
      job: refreshed ? toView(refreshed) : null,
    },
    { status: result.ok ? 200 : 400 }
  );
}

function toView(job: {
  id: string;
  status: string;
  attempts: number;
  lastError: string;
  payload: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}): {
  id: string;
  status: string;
  attempts: number;
  lastError: string;
  steps: CascadeStepView[];
  createdAt: string;
  updatedAt: string;
} {
  const raw = job.payload.steps;
  const steps: CascadeStepView[] = Array.isArray(raw)
    ? raw
        .filter(
          (s): s is Record<string, unknown> =>
            typeof s === "object" && s !== null
        )
        .map((s) => ({
          key: String(s.key ?? ""),
          label: String(s.label ?? s.key ?? ""),
          status: String(s.status ?? "pending"),
          ...(s.detail ? { detail: String(s.detail) } : {}),
          ...(s.error ? { error: String(s.error) } : {}),
        }))
    : [];
  return {
    id: job.id,
    status: job.status,
    attempts: job.attempts,
    lastError: job.lastError,
    steps,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  };
}

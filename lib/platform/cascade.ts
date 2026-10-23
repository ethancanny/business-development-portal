import { sql, newId, str } from "./db";
import { enqueueJob } from "./jobs";
import type { JobRow } from "./types";
import { ensureNotificationsSchema } from "./collab";

/**
 * Deal-close cascade (Phase 10) — the ordered, resumable sequence that
 * runs when a deal reaches Closed Won, replacing the single
 * monitoring_handoff job. Executed as a core.jobs row of kind
 * 'deal_close_cascade' (see executeJob in lib/platform/jobs.ts); step
 * progress is persisted back into the job payload after EVERY step, so
 * a retry (POST /api/platform/deals/[id]/cascade) re-runs only the
 * incomplete steps.
 *
 * Steps (services only — never another module's tables):
 *  1. monitoring_record   — monitoring handoffDealClosed()
 *  2. baseline_financials — verify the copied baseline on the portfolio
 *     record (absence of posted financials is done-with-note)
 *  3. vc_plan_shell       — valuecreation getPlanByCompany()/createPlan()
 *  4. reporting_calendar  — monitoring listPeriods()/createPeriod() +
 *     a refresh_generated_events job so the due date lands in the
 *     merged calendar
 *  5. room_archive        — dataroom getRoomResolutionByDeal() /
 *     updateRoom(status 'archived'); no room → skipped
 *  6. notify              — core.notifications summary for Ethan
 *
 * Failure semantics: a throwing step is marked failed (error kept on
 * the step), remaining steps stay pending, Ethan gets a notification
 * naming the deal + failed step, and runCascadeJob THROWS so
 * runJobNow records the job failed with last_error naming the step.
 * Payloads carry ids, names, and step state only — never figures.
 */

export interface CascadeStep {
  key: string;
  label: string;
  status: "pending" | "done" | "skipped" | "failed";
  detail?: string;
  error?: string;
}

export const CASCADE_STEPS: Array<{ key: string; label: string }> = [
  { key: "monitoring_record", label: "Portfolio Monitoring record + baseline" },
  { key: "baseline_financials", label: "Baseline financials copied" },
  { key: "vc_plan_shell", label: "Value Creation plan shell" },
  { key: "reporting_calendar", label: "Reporting calendar generated" },
  { key: "room_archive", label: "Data room archived" },
  { key: "notify", label: "Close-out notification" },
];

const ETHAN_EMAIL = "ethan@cannycapitalpartners.com";

/* ------------------------------ payload ----------------------------- */

function freshSteps(): CascadeStep[] {
  return CASCADE_STEPS.map((s) => ({ ...s, status: "pending" as const }));
}

function parseSteps(raw: unknown): CascadeStep[] {
  if (!Array.isArray(raw)) return freshSteps();
  const byKey = new Map<string, CascadeStep>();
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const key = str(rec.key);
    if (!key) continue;
    const status = str(rec.status);
    byKey.set(key, {
      key,
      label: str(rec.label) || key,
      status:
        status === "done" || status === "skipped" || status === "failed"
          ? status
          : "pending",
      detail: rec.detail ? str(rec.detail) : undefined,
      error: rec.error ? str(rec.error) : undefined,
    });
  }
  // Rebuild in canonical order so older payloads gain any new steps.
  return CASCADE_STEPS.map(
    (s) => byKey.get(s.key) ?? { ...s, status: "pending" as const }
  );
}

async function persistSteps(
  jobId: string,
  payload: Record<string, unknown>,
  steps: CascadeStep[]
): Promise<void> {
  const db = sql();
  await db`
    UPDATE core.jobs
    SET payload = ${JSON.stringify({ ...payload, steps })}::jsonb,
        updated_at = now()
    WHERE id = ${jobId}`;
}

/* ------------------------------ enqueue ----------------------------- */

export async function enqueueCloseCascade(
  dealId: string,
  actor: string
): Promise<string> {
  const db = sql();
  const existing = await db`
    SELECT id FROM core.jobs
    WHERE kind = 'deal_close_cascade' AND status IN ('queued', 'running')
      AND payload->>'dealId' = ${dealId}
    ORDER BY created_at ASC
    LIMIT 1`;
  if (existing.length) {
    return str((existing[0] as Record<string, unknown>).id);
  }
  return enqueueJob("deal_close_cascade", {
    dealId,
    actor,
    steps: freshSteps(),
  });
}

/** Latest cascade job row for a deal (any status), or null. */
export async function getLatestCascadeJob(
  dealId: string
): Promise<JobRow | null> {
  const db = sql();
  const rows = await db`
    SELECT id, kind, payload, status, attempts, last_error, run_after,
      created_at, updated_at
    FROM core.jobs
    WHERE kind = 'deal_close_cascade' AND payload->>'dealId' = ${dealId}
    ORDER BY created_at DESC
    LIMIT 1`;
  if (!rows.length) return null;
  const r = rows[0] as Record<string, unknown>;
  const payload =
    r.payload && typeof r.payload === "object"
      ? (r.payload as Record<string, unknown>)
      : {};
  return {
    id: str(r.id),
    kind: str(r.kind),
    payload,
    status: str(r.status) || "queued",
    attempts: Number(r.attempts ?? 0) || 0,
    lastError: str(r.last_error),
    runAfter: r.run_after
      ? r.run_after instanceof Date
        ? r.run_after.toISOString()
        : String(r.run_after)
      : null,
    createdAt: r.created_at
      ? r.created_at instanceof Date
        ? r.created_at.toISOString()
        : String(r.created_at)
      : "",
    updatedAt: r.updated_at
      ? r.updated_at instanceof Date
        ? r.updated_at.toISOString()
        : String(r.updated_at)
      : "",
  };
}

/* --------------------------- reference data ------------------------- */

async function resolveCompany(dealId: string): Promise<{
  companyId: string;
  companyName: string;
}> {
  const db = sql();
  const rows = await db`
    SELECT cd.company_id, coalesce(co.name, '') AS company_name
    FROM core.deals cd
    LEFT JOIN core.companies co ON co.id = cd.company_id
    WHERE cd.id = ${dealId} LIMIT 1`;
  if (!rows.length) return { companyId: "", companyName: "" };
  const rec = rows[0] as Record<string, unknown>;
  return {
    companyId: rec.company_id ? str(rec.company_id) : "",
    companyName: str(rec.company_name),
  };
}

async function notifyEthan(opts: {
  kind: string;
  title: string;
  body: string;
  href: string;
  dealId: string;
}): Promise<void> {
  const db = sql();
  await ensureNotificationsSchema();
  await db`
    INSERT INTO core.notifications
      (id, user_email, kind, title, body, href, entity_kind, entity_id)
    VALUES (${newId()}, ${ETHAN_EMAIL}, ${opts.kind}, ${opts.title},
      ${opts.body}, ${opts.href}, 'deal', ${opts.dealId})`;
}

/* ------------------------------ date math --------------------------- */

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function closeMonthWindow(now: Date): {
  periodStart: string;
  periodEnd: string;
  dueDate: string;
} {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const start = new Date(Date.UTC(y, m, 1));
  const end = new Date(Date.UTC(y, m + 1, 0));
  const due = new Date(end.getTime() + 30 * 86400000);
  return { periodStart: ymd(start), periodEnd: ymd(end), dueDate: ymd(due) };
}

/* ------------------------------ execution --------------------------- */

export async function runCascadeJob(job: JobRow): Promise<void> {
  const dealId = str(job.payload.dealId);
  const actor = str(job.payload.actor) || "system";
  if (!dealId) throw new Error("Cascade job is missing dealId");
  const steps = parseSteps(job.payload.steps);
  const payload: Record<string, unknown> = { ...job.payload, dealId, actor };

  const { companyId, companyName } = await resolveCompany(dealId);
  const dealLabel = companyName || dealId;

  const runStep = async (
    key: string,
    fn: () => Promise<{ status: "done" | "skipped"; detail: string }>
  ): Promise<void> => {
    const step = steps.find((s) => s.key === key);
    if (!step) return;
    if (step.status === "done" || step.status === "skipped") return;
    try {
      const out = await fn();
      step.status = out.status;
      step.detail = out.detail;
      delete step.error;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      step.status = "failed";
      step.error = message;
      await persistSteps(job.id, payload, steps);
      // Failure notification — deal + failed step named, no figures.
      try {
        await notifyEthan({
          kind: "deal_close_cascade_failed",
          title: `Deal-close cascade failed: ${dealLabel}`,
          body: `Step "${step.label}" failed for ${dealLabel}: ${message}. Retry the cascade from the deal's cascade status to resume the remaining steps.`,
          href: companyId
            ? `/portfolio-monitoring/${companyId}`
            : "/overview",
          dealId,
        });
      } catch {
        /* the throw below is the record of failure */
      }
      throw new Error(`Cascade step ${key} failed: ${message}`);
    }
    await persistSteps(job.id, payload, steps);
  };

  // 1. Portfolio Monitoring record + baseline (idempotent handoff).
  await runStep("monitoring_record", async () => {
    const { handoffDealClosed } = await import("../monitoring/service");
    await handoffDealClosed(dealId, actor);
    return {
      status: "done",
      detail: "Portfolio Monitoring record ready (handoff is idempotent)",
    };
  });

  // The portfolio record now exists — company link is resolvable.
  const resolved = companyId
    ? { companyId, companyName }
    : await resolveCompany(dealId);
  const cid = resolved.companyId;
  const cname = resolved.companyName || dealLabel;

  // 2. Baseline financials — verify what the handoff copied.
  await runStep("baseline_financials", async () => {
    if (!cid) throw new Error("company_not_found");
    const { getPortfolioCompany } = await import("../monitoring/service");
    const pc = await getPortfolioCompany(cid);
    if (!pc) throw new Error("portfolio_company_not_found");
    // PortfolioCompanyDetail verified in lib/monitoring/service.ts:
    // baselineFinancials / underwriting are copied JSON objects; the
    // handoff sets underwriting.periodEnd only when a posted period
    // existed at close. Presence is checked — never the figures.
    const uw = pc.underwriting;
    const hasUnderwriting = Boolean(
      uw && typeof uw === "object" && uw.periodEnd
    );
    if (pc.baselineFinancials && hasUnderwriting) {
      return {
        status: "done",
        detail: "Underwriting figures copied from closing financials",
      };
    }
    return {
      status: "done",
      detail: "no posted financials at close",
    };
  });

  // 3. Value Creation plan shell.
  await runStep("vc_plan_shell", async () => {
    if (!cid) throw new Error("company_not_found");
    const { getPlanByCompany, createPlan, VcError } = await import(
      "../valuecreation/service"
    );
    const existing = await getPlanByCompany(cid);
    if (existing) return { status: "done", detail: "existing plan" };
    try {
      await createPlan(
        {
          companyId: cid,
          name: `Value Creation Plan — ${cname}`,
          planStartDate: ymd(new Date()),
        },
        actor
      );
    } catch (err) {
      // A concurrent close created it first — that is success here.
      if (
        err instanceof VcError &&
        (err.error === "plan_exists" || err.message === "plan_exists")
      ) {
        return { status: "done", detail: "existing plan" };
      }
      throw err;
    }
    return { status: "done", detail: "plan shell created" };
  });

  // 4. Reporting calendar — first monthly period for the close month.
  await runStep("reporting_calendar", async () => {
    if (!cid) throw new Error("company_not_found");
    const { listPeriods, createPeriod } = await import(
      "../monitoring/service"
    );
    const periods = await listPeriods(cid);
    if (periods.length) {
      return { status: "done", detail: "existing periods" };
    }
    const win = closeMonthWindow(new Date());
    await createPeriod(
      cid,
      {
        cadence: "monthly",
        periodStart: win.periodStart,
        periodEnd: win.periodEnd,
        dueDate: win.dueDate,
        source: "cascade",
        notes: "Initial reporting period created by the deal-close cascade",
      },
      actor
    );
    // Land the due date in the merged calendar (calgen regeneration).
    await enqueueJob("refresh_generated_events", {
      reason: "deal_close_cascade",
      dealId,
    });
    return {
      status: "done",
      detail: `initial monthly period ending ${win.periodEnd} created`,
    };
  });

  // 5. Data room archive.
  await runStep("room_archive", async () => {
    const { getRoomResolutionByDeal, updateRoom } = await import(
      "../dataroom/service"
    );
    const res = await getRoomResolutionByDeal(dealId);
    if (!res.roomId || !res.room) {
      return { status: "skipped", detail: "no data room for this deal" };
    }
    if (res.room.status === "archived") {
      return { status: "done", detail: "already archived" };
    }
    // updateRoom verified in lib/dataroom/service.ts (line 398):
    // updateRoom(id, patch { name?, domainAllowlist?, status? }, actor).
    await updateRoom(res.roomId, { status: "archived" }, actor);
    return { status: "done", detail: "data room archived" };
  });

  // 6. Close-out notification for Ethan.
  await runStep("notify", async () => {
    // +1: this notify step itself completes the sequence.
    const doneCount =
      steps.filter((s) => s.status === "done" || s.status === "skipped")
        .length + 1;
    await notifyEthan({
      kind: "deal_close_cascade",
      title: `Deal closed: ${cname}`,
      body: `The deal-close cascade completed for ${cname} (${doneCount}/${CASCADE_STEPS.length} steps finished). Portfolio Monitoring, baseline, value-creation plan, reporting calendar, and data-room archive are in place.`,
      href: cid ? `/portfolio-monitoring/${cid}` : "/overview",
      dealId,
    });
    return { status: "done", detail: "close-out notification sent" };
  });

  // All steps done/skipped (failures throw above) — succeed quietly.
  await persistSteps(job.id, payload, steps);
}

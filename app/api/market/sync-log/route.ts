import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { logSync } from "@/lib/market-db";

/**
 * Sync-log write endpoint for the external spine builders (Oct 28,
 * 2026). The Python builders run outside the app and previously had no
 * way to record their runs or cross-check verdicts in mi_sync_log —
 * Ethan's cross-reference rule requires a `<dataset>-xcheck` row on
 * EVERY run, including failed checks, so the builders POST their
 * verdicts here (spine-ad-<st>-xcheck, spine-sam-<st>-xcheck, plus the
 * plain per-state run rows). Auth mirrors the companies import
 * endpoint: session cookie OR Bearer CRON_SECRET when configured.
 * Body: { job, status: ok|error|skipped|check, added, message }.
 */
export async function POST(req: NextRequest) {
  const authed =
    !!getSessionUser() ||
    (() => {
      const secret = process.env.CRON_SECRET;
      return !secret || req.headers.get("authorization") === `Bearer ${secret}`;
    })();
  if (!authed) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const job = String(body.job ?? "").trim().slice(0, 120);
  if (!job) {
    return NextResponse.json({ ok: false, error: "job required" }, { status: 400 });
  }
  const statusRaw = String(body.status ?? "ok");
  const status = (["ok", "error", "skipped", "check"].includes(statusRaw)
    ? statusRaw
    : "ok") as "ok" | "error" | "skipped" | "check";
  const added = Number.isFinite(Number(body.added)) ? Number(body.added) : 0;
  const message = String(body.message ?? "").slice(0, 4000);
  await logSync(job, status, added, message);
  return NextResponse.json({ ok: true });
}

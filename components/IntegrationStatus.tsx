"use client";

/**
 * Settings → Integrations (Phase 1): live status for every platform
 * integration from GET /api/platform/integrations. Failure (API or
 * DB down) renders a clean error state with Retry — never a crash.
 */

import { useCallback, useEffect, useState } from "react";
import { ErrorState, SkeletonRows } from "@/components/ui";

interface Integration {
  key: string;
  name: string;
  status: string;
  lastSuccessAt?: string | null;
  lastError?: string | null;
  detail?: string | null;
}

function fmtWhen(iso?: string | null): string {
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

function dotClass(status: string): string {
  if (status === "ok") return "bg-emerald-500";
  if (status === "error") return "bg-red-500";
  return "bg-slate-400";
}

export default function IntegrationStatus() {
  const [items, setItems] = useState<Integration[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [provisionBusy, setProvisionBusy] = useState(false);
  const [provisionMsg, setProvisionMsg] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const r = await fetch("/api/platform/integrations");
      if (!r.ok) throw new Error(`Request failed (${r.status})`);
      const d = (await r.json()) as { integrations?: Integration[] };
      setItems(Array.isArray(d.integrations) ? d.integrations : []);
    } catch {
      setError(
        "Integration status couldn't be loaded. The platform API or database may be unavailable."
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // SharePoint provisioning (Oct 23, 2026): creates the portal's
  // document library on the "Canny Capital — Deals" site and stamps
  // every data room to the SharePoint provider. Lives on the
  // microsoft_sharepoint row below; the endpoint explains setup
  // problems (no consent / no reconnect / site missing) itself.
  const provisionSharePoint = useCallback(async () => {
    setProvisionBusy(true);
    setProvisionMsg("");
    try {
      const r = await fetch("/api/platform/storage/provision", {
        method: "POST",
      });
      const d = (await r.json().catch(() => null)) as {
        ok?: boolean;
        report?: {
          siteName: string;
          driveName: string;
          roomsStamped: number;
          roomsTotal: number;
        };
        detail?: string;
        error?: string;
      } | null;
      if (r.ok && d?.report) {
        setProvisionMsg(
          `Provisioned — site "${d.report.siteName}", library "${d.report.driveName}", ${d.report.roomsStamped} of ${d.report.roomsTotal} data rooms stamped to SharePoint.`
        );
        await load();
      } else {
        setProvisionMsg(
          d?.detail || d?.error || `Provisioning failed (${r.status})`
        );
      }
    } catch {
      setProvisionMsg("Provisioning request failed — the portal API may be unavailable.");
    } finally {
      setProvisionBusy(false);
    }
  }, [load]);

  if (loading) return <SkeletonRows rows={3} />;
  if (error) {
    return <ErrorState title="Couldn't load integrations" message={error} onRetry={load} />;
  }

  return (
    <div>
      <div className="mb-3 flex justify-end">
        <button onClick={load} className="btn btn-secondary btn-sm">
          Refresh
        </button>
      </div>
      {items.length === 0 ? (
        <p className="text-sm text-slate-400 dark:text-white/40">
          No integrations are registered yet.
        </p>
      ) : (
        <ul className="divide-y divide-slate-100 dark:divide-white/5">
          {items.map((it) => (
            <li key={it.key} className="flex items-start gap-3 py-3">
              <span
                aria-hidden
                className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${dotClass(it.status)}`}
              />
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-baseline gap-x-2 text-sm font-semibold text-[#0d1f3c] dark:text-white">
                  {it.name}
                  <span className="text-xs font-medium capitalize text-slate-400 dark:text-white/40">
                    {it.status}
                  </span>
                </p>
                {it.detail && (
                  <p className="mt-0.5 text-sm text-slate-500 dark:text-white/60">
                    {it.detail}
                  </p>
                )}
                <p className="mt-0.5 text-xs text-slate-400 dark:text-white/40">
                  Last success: {fmtWhen(it.lastSuccessAt)}
                </p>
                {it.lastError && (
                  <p className="mt-0.5 text-xs text-red-600 dark:text-red-300">
                    Last error: {it.lastError}
                  </p>
                )}
                {it.key === "microsoft_sharepoint" && (
                  <div className="mt-2">
                    <button
                      onClick={provisionSharePoint}
                      disabled={provisionBusy}
                      className="btn btn-secondary btn-sm"
                    >
                      {provisionBusy
                        ? "Provisioning…"
                        : "Provision SharePoint library"}
                    </button>
                    {provisionMsg && (
                      <p className="mt-1.5 text-xs text-slate-500 dark:text-white/60">
                        {provisionMsg}
                      </p>
                    )}
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

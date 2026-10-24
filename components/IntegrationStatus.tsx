"use client";

/**
 * Settings → Integrations (Phase 1): live status for every platform
 * integration from GET /api/platform/integrations. Failure (API or
 * DB down) renders a clean error state with Retry — never a crash.
 */

import { Fragment, useCallback, useEffect, useState } from "react";
import { ErrorState, SkeletonRows } from "@/components/ui";

interface Integration {
  key: string;
  name: string;
  status: string;
  lastSuccessAt?: string | null;
  lastError?: string | null;
  detail?: string | null;
  children?: Integration[];
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
  if (status === "check") return "bg-amber-500";
  if (status === "skipped") return "bg-slate-300 dark:bg-white/25";
  return "bg-slate-400";
}

function errorTextClass(status: string): string {
  return status === "check"
    ? "text-amber-700 dark:text-amber-300"
    : "text-red-600 dark:text-red-300";
}

export default function IntegrationStatus() {
  const [items, setItems] = useState<Integration[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
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

  // Rows grouped under labeled subheads (Ethan's Settings organization
  // pass, Oct 24, 2026). API order is preserved within each group;
  // unrecognized keys collect under Platform.
  const GROUPS: Array<{ label: string; match: (key: string) => boolean }> = [
    {
      label: "Microsoft 365",
      match: (k) => k === "microsoft_calendar" || k === "microsoft_sharepoint",
    },
    {
      label: "Documents & storage",
      match: (k) => k === "document_storage" || k === "azure_docint",
    },
    { label: "Market data", match: (k) => k === "mi" || k.startsWith("mi:") },
    {
      label: "Accounting",
      match: (k) => k === "accounting" || k.startsWith("accounting:"),
    },
    {
      label: "Reporting",
      match: (k) => k === "comms" || k.startsWith("comms_"),
    },
  ];
  const grouped = [
    ...GROUPS.map((g) => ({
      label: g.label,
      rows: items.filter((it) => g.match(it.key)),
    })),
    {
      label: "Platform",
      rows: items.filter((it) => !GROUPS.some((g) => g.match(it.key))),
    },
  ].filter((g) => g.rows.length > 0);

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
        <div className="space-y-6">
          {grouped.map((g) => (
            <div key={g.label}>
              <h3 className="mb-1 text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-white/40">
                {g.label}
              </h3>
              <ul className="divide-y divide-slate-100 dark:divide-white/5">
                {g.rows.map((it) => {
                  const kids = it.children ?? [];
                  const hasKids = kids.length > 0;
                  const hasAlert = kids.some(
                    (c) => c.status === "error" || c.status === "check"
                  );
                  const open = expanded[it.key] ?? hasAlert;
                  return (
                  <Fragment key={it.key}>
            <li className="flex items-start gap-3 py-3">
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
                  <p className={`mt-0.5 text-xs ${errorTextClass(it.status)}`}>
                    {it.status === "check" ? "Check" : "Last error"}: {it.lastError}
                  </p>
                )}
                {hasKids && (
                  <button
                    type="button"
                    onClick={() =>
                      setExpanded((prev) => ({ ...prev, [it.key]: !open }))
                    }
                    className="mt-2 text-xs font-semibold text-[#0d1f3c] underline decoration-[#b8975a] decoration-2 underline-offset-2 dark:text-white"
                  >
                    {open ? "Hide datasets" : `Show ${kids.length} datasets`}
                  </button>
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
            {hasKids && open && (
              <li className="pb-2">
                <ul className="ml-2 divide-y divide-slate-100 border-l border-slate-200 pl-4 dark:divide-white/5 dark:border-white/10">
                  {kids.map((c) => (
                    <li key={c.key} className="flex items-start gap-3 py-2.5">
                      <span
                        aria-hidden
                        className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${dotClass(c.status)}`}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="flex flex-wrap items-baseline gap-x-2 text-sm font-medium text-[#0d1f3c] dark:text-white">
                          {c.name}
                          <span className="text-xs font-medium capitalize text-slate-400 dark:text-white/40">
                            {c.status}
                          </span>
                        </p>
                        {c.detail && (
                          <p className="mt-0.5 text-xs text-slate-500 dark:text-white/60">
                            {c.detail}
                          </p>
                        )}
                        <p className="mt-0.5 text-xs text-slate-400 dark:text-white/40">
                          Last success: {fmtWhen(c.lastSuccessAt)}
                        </p>
                        {c.lastError && (
                          <p className={`mt-0.5 text-xs ${errorTextClass(c.status)}`}>
                            {c.status === "check" ? "Check" : "Last error"}: {c.lastError}
                          </p>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </li>
            )}
                  </Fragment>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

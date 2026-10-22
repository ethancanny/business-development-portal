"use client";

/**
 * Accounting integrations (Phase 9, Settings) — per-company accounting
 * provider cards from GET /api/portmgmt/companies/[companyId]/
 * accounting: provider name, status chip, missing env vars, setup
 * steps, the company's connection, a Dry-run sync button (POST
 * …/accounting/[connectionId]/sync {dryRun:true}) and the last run
 * result. Lives in Settings because integrations live in Settings by
 * platform convention. The catalog shape is backend-owned; every
 * field is read defensively and a provider with unmet env vars says
 * exactly which ones are missing — nothing is faked as connected.
 */

import { useCallback, useEffect, useState } from "react";
import { Button, EmptyState, SkeletonRows } from "@/components/ui";
import { ErrorBanner } from "@/components/monitoring/shared";
import {
  api as monApi,
  dateOnly,
  fmtDateShort,
  labelCls,
  listFrom,
  selectCls,
  type Rec,
} from "@/components/monitoring/types";
import { api, pick, pmCompany, rowsFrom, str } from "@/components/portmgmt/pm";

interface CompanyOption {
  id: string;
  name: string;
}

function providerStatus(p: Rec, connection: Rec | null): { label: string; cls: string } {
  const s = str(pick(connection ?? p, "status", "state")).toLowerCase();
  if (s === "connected" || s === "active" || s === "ok") return { label: s, cls: "badge-fit" };
  if (s === "error" || s === "failed") return { label: s, cls: "badge-danger" };
  if (connection) return { label: s || "connected", cls: "badge-fit" };
  const missing = pick(p, "missingEnv", "missingEnvVars", "missing");
  if (Array.isArray(missing) && missing.length > 0) return { label: "setup required", cls: "badge-warn" };
  return { label: s || "not connected", cls: "badge-neutral" };
}

export default function AccountingSettings() {
  const [companies, setCompanies] = useState<CompanyOption[]>([]);
  const [companyId, setCompanyId] = useState("");
  const [catalog, setCatalog] = useState<Rec | null>(null);
  const [loadingCompanies, setLoadingCompanies] = useState(true);
  const [loading, setLoading] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [error, setError] = useState("");
  const [busyKey, setBusyKey] = useState("");
  const [lastRuns, setLastRuns] = useState<Record<string, string>>({});

  useEffect(() => {
    let live = true;
    monApi<Rec>(`/api/platform/monitoring/companies`)
      .then((c) => {
        if (!live) return;
        const list = listFrom(c, "items", "companies").map((r) => {
          const baseline = (pick(r, "baselineCompany") ?? {}) as Rec;
          return {
            id: str(pick(r, "companyId", "id")),
            name:
              str(pick(baseline, "name", "companyName")) ||
              str(pick(r, "companyName", "name")) ||
              str(pick(r, "companyId", "id")),
          };
        }).filter((x) => x.id);
        setCompanies(list);
        setCompanyId(list[0]?.id ?? "");
      })
      .catch(() => {
        if (live) setLoadFailed(true);
      })
      .finally(() => {
        if (live) setLoadingCompanies(false);
      });
    return () => {
      live = false;
    };
  }, []);

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    setLoadFailed(false);
    try {
      const d = await api<Rec>(`${pmCompany(companyId)}/accounting`);
      setCatalog(d);
    } catch {
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => {
    void load();
  }, [load]);

  const connect = async (providerKey: string) => {
    setBusyKey(`connect-${providerKey}`);
    setError("");
    try {
      await api(`${pmCompany(companyId)}/accounting`, {
        method: "POST",
        body: JSON.stringify({ provider: providerKey }),
      });
      await load();
    } catch {
      setError("Could not create that connection. Check the provider's setup steps and env vars first.");
    } finally {
      setBusyKey("");
    }
  };

  const dryRun = async (providerKey: string, connectionId: string) => {
    setBusyKey(`sync-${providerKey}`);
    setError("");
    try {
      const d = await api<Rec>(
        `${pmCompany(companyId)}/accounting/${encodeURIComponent(connectionId)}/sync`,
        { method: "POST", body: JSON.stringify({ dryRun: true }) }
      );
      const summary =
        str(pick(d, "summary", "message", "result")) ||
        `Dry run finished (${str(pick(d, "status")) || "ok"}).`;
      setLastRuns((r) => ({ ...r, [providerKey]: summary }));
      await load();
    } catch {
      setLastRuns((r) => ({ ...r, [providerKey]: "Dry run failed — see the provider status above." }));
    } finally {
      setBusyKey("");
    }
  };

  if (loadingCompanies) return <SkeletonRows rows={3} />;

  const providers = catalog ? rowsFrom(catalog, "providers", "catalog", "items") : [];
  const connections = catalog ? rowsFrom(catalog, "connections") : [];
  const connectionFor = (p: Rec): Rec | null => {
    const key = str(pick(p, "key", "provider", "id"));
    return (
      connections.find(
        (c) => str(pick(c, "provider", "providerKey", "key")) === key
      ) ??
      ((pick(p, "connection") as Rec | null) ?? null)
    );
  };

  return (
    <div>
      <ErrorBanner message={error} />
      {companies.length === 0 ? (
        <EmptyState
          title="No portfolio companies yet"
          message="Accounting connections are per portfolio company — once a deal closes into monitoring, its providers can be connected here."
        />
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-end gap-2">
            <div>
              <label className={labelCls} htmlFor="acct-company">Company</label>
              <select
                id="acct-company"
                className={`${selectCls} min-h-[44px] w-auto`}
                value={companyId}
                onChange={(e) => setCompanyId(e.target.value)}
              >
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
            <Button variant="secondary" size="sm" className="min-h-[44px]" onClick={() => void load()}>
              Refresh
            </Button>
          </div>

          {loading ? (
            <SkeletonRows rows={3} />
          ) : loadFailed ? (
            <div>
              <ErrorBanner message="Accounting providers could not be loaded for that company." />
              <Button variant="secondary" size="sm" className="min-h-[44px]" onClick={() => void load()}>
                Retry
              </Button>
            </div>
          ) : providers.length === 0 ? (
            <EmptyState
              title="No accounting providers in the catalog"
              message="The backend returned no providers for this company. Providers appear here once their server configuration is in place."
            />
          ) : (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {providers.map((p, i) => {
                const key = str(pick(p, "key", "provider", "id")) || String(i);
                const conn = connectionFor(p);
                const status = providerStatus(p, conn);
                const missingRaw = pick(p, "missingEnv", "missingEnvVars", "missing");
                const missing = Array.isArray(missingRaw) ? missingRaw.map(String) : [];
                const stepsRaw = pick(p, "setupSteps", "steps");
                const steps = Array.isArray(stepsRaw) ? stepsRaw.map(String) : [];
                const connId = conn ? str(pick(conn, "id", "connectionId")) : "";
                const lastSync = conn
                  ? str(pick(conn, "lastSyncAt", "lastRunAt", "updatedAt"))
                  : "";
                const lastResult =
                  lastRuns[key] ||
                  (conn ? str(pick(conn, "lastRunResult", "lastSyncResult", "lastError")) : "");
                return (
                  <div key={key} className="rounded-2xl border border-slate-200 p-4 dark:border-white/10">
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="font-display text-lg font-semibold text-[#0d1f3c] dark:text-white">
                        {str(pick(p, "name", "label")) || key}
                      </h3>
                      <span className={`badge ${status.cls}`}>{status.label}</span>
                    </div>
                    {str(pick(p, "description")) && (
                      <p className="mt-1 text-sm text-slate-500 dark:text-white/50">
                        {str(pick(p, "description"))}
                      </p>
                    )}
                    {missing.length > 0 && (
                      <p className="mt-2 rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
                        Missing env vars: {missing.join(", ")}
                      </p>
                    )}
                    {steps.length > 0 && (
                      <ol className="mt-3 list-inside list-decimal space-y-1 text-sm text-slate-600 dark:text-white/70">
                        {steps.map((s, j) => (
                          <li key={j}>{s}</li>
                        ))}
                      </ol>
                    )}
                    <div className="mt-3 border-t border-slate-100 pt-3 text-xs text-slate-400 dark:border-white/5 dark:text-white/40">
                      {conn ? (
                        <>
                          Connected for {companies.find((c) => c.id === companyId)?.name ?? "this company"}
                          {lastSync ? ` · last sync ${fmtDateShort(dateOnly(lastSync) || lastSync)}` : ""}
                        </>
                      ) : (
                        "Not connected for this company."
                      )}
                      {lastResult && <p className="mt-1 text-slate-500 dark:text-white/50">Last run: {lastResult}</p>}
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {!conn && (
                        <Button
                          size="sm"
                          className="min-h-[44px]"
                          loading={busyKey === `connect-${key}`}
                          disabled={missing.length > 0}
                          onClick={() => void connect(key)}
                        >
                          Connect
                        </Button>
                      )}
                      {conn && connId && (
                        <Button
                          size="sm"
                          variant="secondary"
                          className="min-h-[44px]"
                          loading={busyKey === `sync-${key}`}
                          onClick={() => void dryRun(key, connId)}
                        >
                          Dry-run sync
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}

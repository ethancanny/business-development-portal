"use client";

/**
 * Alerts tab (Phase 8) — the company's monitoring alerts (GET /alerts;
 * statuses open | acked | resolved) with acknowledge / resolve /
 * reopen actions (PATCH /alerts/[alertId]), and the alert-rules
 * editor: the merged rule view from GET /alert-rules (company override
 * over global over defaults, with the winning source shown) written
 * back per rule through PUT /alert-rules as a company override.
 * Rule keys: kpi_miss, late_reporting, covenant_headroom (+ any stored
 * key the API returns, e.g. covenant_breach).
 */

import { useCallback, useEffect, useState } from "react";
import { Button, EmptyState, ErrorState, SkeletonRows } from "@/components/ui";
import { ErrorBanner, Section } from "@/components/monitoring/shared";
import {
  companyBase,
  api,
  dateOnly,
  fmtDateShort,
  inputCls,
  labelCls,
  listFrom,
  parseNum,
  pick,
  severityBadge,
  statusBadge,
  str,
  type MonitoringTabProps,
  type Rec,
} from "@/components/monitoring/types";

const FILTERS = [
  { key: "open", label: "Open" },
  { key: "acked", label: "Acknowledged" },
  { key: "resolved", label: "Resolved" },
  { key: "all", label: "All" },
] as const;

const RULE_LABELS: Record<string, string> = {
  kpi_miss: "KPI miss",
  late_reporting: "Late reporting",
  covenant_headroom: "Covenant headroom",
  covenant_breach: "Covenant breach",
};

const PARAM_LABELS: Record<string, string> = {
  thresholdPct: "Threshold (%)",
  metrics: "Metrics (comma-separated)",
  minHeadroomPct: "Min headroom (%)",
  graceDays: "Grace days",
};

function prettify(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .replace(/^\w/, (c) => c.toUpperCase());
}

export default function AlertsTab({ companyId, refreshHeader }: MonitoringTabProps) {
  const base = companyBase(companyId);
  const [alerts, setAlerts] = useState<Rec[]>([]);
  const [filter, setFilter] = useState<string>("open");
  const [rules, setRules] = useState<Rec[]>([]);
  const [ruleDrafts, setRuleDrafts] = useState<Record<string, { enabled: boolean; params: Record<string, string> }>>({});
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState("");
  const [savingRule, setSavingRule] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setLoadFailed(false);
    try {
      const [alertsD, rulesD] = await Promise.all([
        api<Rec>(`${base}/alerts?limit=100`),
        api<Rec>(`${base}/alert-rules`).catch(() => null),
      ]);
      setAlerts(listFrom(alertsD, "items", "alerts"));
      const ruleList = rulesD ? listFrom(rulesD, "rules") : [];
      setRules(ruleList);
      const drafts: Record<string, { enabled: boolean; params: Record<string, string> }> = {};
      for (const r of ruleList) {
        const key = str(pick(r, "ruleKey"));
        if (!key) continue;
        const params = (pick(r, "params") ?? {}) as Rec;
        const p: Record<string, string> = {};
        for (const [k, v] of Object.entries(params)) {
          p[k] = Array.isArray(v) ? v.map(String).join(", ") : String(v ?? "");
        }
        drafts[key] = { enabled: pick(r, "enabled") === true, params: p };
      }
      setRuleDrafts(drafts);
    } catch {
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, [base]);

  useEffect(() => {
    void load();
  }, [load]);

  const setStatus = async (alert: Rec, status: string) => {
    const id = str(pick(alert, "id"));
    if (!id) return;
    setBusyId(id);
    setError("");
    try {
      await api(`${base}/alerts/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      await load();
      refreshHeader?.();
    } catch {
      setError("Could not update that alert.");
    } finally {
      setBusyId("");
    }
  };

  const saveRule = async (ruleKey: string) => {
    const draft = ruleDrafts[ruleKey];
    if (!draft || savingRule) return;
    setSavingRule(ruleKey);
    setError("");
    try {
      const params: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(draft.params)) {
        if (k === "metrics") {
          params[k] = v.split(",").map((x) => x.trim()).filter(Boolean);
        } else {
          const n = parseNum(v);
          params[k] = n !== null ? n : v;
        }
      }
      await api(`${base}/alert-rules`, {
        method: "PUT",
        body: JSON.stringify({ ruleKey, enabled: draft.enabled, params }),
      });
      await load();
    } catch {
      setError("Could not save that alert rule.");
    } finally {
      setSavingRule("");
    }
  };

  if (loading) return <SkeletonRows rows={5} />;
  if (loadFailed) return <ErrorState onRetry={() => void load()} />;

  const shown = alerts.filter((a) => filter === "all" || str(pick(a, "status")) === filter);
  const openCount = alerts.filter((a) => str(pick(a, "status")) === "open").length;

  return (
    <div className="space-y-5">
      <ErrorBanner message={error} />

      <Section
        title="Alerts"
        caption={`${openCount} open alert${openCount === 1 ? "" : "s"} on this company. Alerts are created by the monitoring evaluators (KPI miss, late reporting, covenant headroom/breach) — acknowledging or resolving one never deletes its history.`}
        actions={
          <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Alert status filter">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                role="tab"
                aria-selected={filter === f.key}
                onClick={() => setFilter(f.key)}
                className={`chip min-h-[44px] ${filter === f.key ? "chip-active" : ""}`}
              >
                {f.label}
              </button>
            ))}
          </div>
        }
      >
        {shown.length === 0 ? (
          <EmptyState
            title={filter === "open" ? "No open alerts" : "Nothing in this view"}
            message={
              filter === "open"
                ? "Nothing needs attention on this company right now."
                : "No alerts carry this status for this company."
            }
          />
        ) : (
          <div className="space-y-2">
            {shown.map((a, i) => {
              const id = str(pick(a, "id"));
              const status = str(pick(a, "status"));
              const severity = str(pick(a, "severity"));
              return (
                <div
                  key={id || i}
                  className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-slate-100 px-3 py-3 dark:border-white/10"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <p className="text-sm font-semibold text-[#0d1f3c] dark:text-white">
                        {str(pick(a, "title")) || "Alert"}
                      </p>
                      {severity && (
                        <span className={`badge ${severityBadge(severity)}`}>{severity}</span>
                      )}
                      {status && (
                        <span className={`badge ${statusBadge(status)}`}>{status}</span>
                      )}
                      {str(pick(a, "ruleKey")) && (
                        <span className="badge badge-neutral">{str(pick(a, "ruleKey"))}</span>
                      )}
                    </div>
                    {str(pick(a, "detail")) && (
                      <p className="mt-1 text-sm text-slate-500 dark:text-white/50">
                        {str(pick(a, "detail"))}
                      </p>
                    )}
                    <p className="mt-1 text-xs text-slate-400 dark:text-white/40">
                      {fmtDateShort(dateOnly(pick(a, "createdAt")) || str(pick(a, "createdAt")))}
                      {str(pick(a, "resolvedAt"))
                        ? ` · resolved ${fmtDateShort(dateOnly(pick(a, "resolvedAt")) || str(pick(a, "resolvedAt")))}`
                        : ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2">
                    {status === "open" && (
                      <Button
                        variant="secondary"
                        size="sm"
                        className="min-h-[44px]"
                        loading={busyId === id}
                        onClick={() => void setStatus(a, "acked")}
                      >
                        Acknowledge
                      </Button>
                    )}
                    {(status === "open" || status === "acked") && (
                      <Button
                        size="sm"
                        className="min-h-[44px]"
                        loading={busyId === id}
                        onClick={() => void setStatus(a, "resolved")}
                      >
                        Resolve
                      </Button>
                    )}
                    {status === "resolved" && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="min-h-[44px]"
                        loading={busyId === id}
                        onClick={() => void setStatus(a, "open")}
                      >
                        Reopen
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Section>

      <Section
        title="Alert rules"
        caption="Effective rules for this company — a company override wins over the global rule, which wins over the built-in default (the source badge shows which). Saving writes a company override."
      >
        {rules.length === 0 ? (
          <EmptyState
            title="No rules returned"
            message="The alert-rule view is unavailable for this company right now."
          />
        ) : (
          <div className="space-y-4">
            {rules.map((r, i) => {
              const key = str(pick(r, "ruleKey"));
              const draft = ruleDrafts[key];
              if (!key || !draft) return null;
              const source = str(pick(r, "source"));
              return (
                <div key={key || i} className="rounded-xl border border-slate-100 p-4 dark:border-white/10">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <h4 className="font-display text-base font-semibold text-[#0d1f3c] dark:text-white">
                        {RULE_LABELS[key] ?? prettify(key)}
                      </h4>
                      {source && <span className="badge badge-neutral">source: {source}</span>}
                    </div>
                    <label className="flex min-h-[44px] items-center gap-2 text-sm text-[#0d1f3c] dark:text-white">
                      <input
                        type="checkbox"
                        className="h-5 w-5 accent-[#b8975a]"
                        checked={draft.enabled}
                        onChange={(e) =>
                          setRuleDrafts((d) => ({ ...d, [key]: { ...draft, enabled: e.target.checked } }))
                        }
                      />
                      Enabled
                    </label>
                  </div>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {Object.entries(draft.params).map(([pk, pv]) => (
                      <div key={pk}>
                        <label className={labelCls}>{PARAM_LABELS[pk] ?? prettify(pk)}</label>
                        <input
                          className={`${inputCls} min-h-[44px]`}
                          value={pv}
                          onChange={(e) =>
                            setRuleDrafts((d) => ({
                              ...d,
                              [key]: { ...draft, params: { ...draft.params, [pk]: e.target.value } },
                            }))
                          }
                        />
                      </div>
                    ))}
                    {Object.keys(draft.params).length === 0 && (
                      <p className="text-sm text-slate-500 dark:text-white/50">
                        This rule has no tunable parameters.
                      </p>
                    )}
                  </div>
                  <div className="mt-3">
                    <Button
                      variant="secondary"
                      size="sm"
                      className="min-h-[44px]"
                      loading={savingRule === key}
                      onClick={() => void saveRule(key)}
                    >
                      Save company override
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Section>
    </div>
  );
}

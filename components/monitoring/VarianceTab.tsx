"use client";

/**
 * Variance tab (Phase 8) — the four-way comparison for one period:
 * Actual vs Budget vs Underwriting vs Value-Creation target, from
 * GET /variance (the server joins the four sources; this tab only
 * renders). Commentary is edited inline per row and saved through
 * PUT /variance/notes; the period's budget figures are maintained
 * through GET/PUT /budgets.
 */

import { useCallback, useEffect, useState } from "react";
import { Button, EmptyState, ErrorState, SkeletonRows } from "@/components/ui";
import { ErrorBanner, Section, SimpleTable } from "@/components/monitoring/shared";
import {
  companyBase,
  api,
  dateOnly,
  fmtMoneyN,
  fmtPctPoints,
  inputCls,
  labelCls,
  listFrom,
  num,
  parseNum,
  pick,
  selectCls,
  str,
  type MonitoringTabProps,
  type Rec,
} from "@/components/monitoring/types";

export default function VarianceTab({ companyId }: MonitoringTabProps) {
  const base = companyBase(companyId);
  const [periods, setPeriods] = useState<Rec[]>([]);
  const [periodKey, setPeriodKey] = useState("");
  const [rows, setRows] = useState<Rec[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [error, setError] = useState("");
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [savingNote, setSavingNote] = useState("");

  const [budget, setBudget] = useState({ revenue: "", grossProfit: "", ebitda: "" });
  const [savingBudget, setSavingBudget] = useState(false);

  // Budget versions (Phase 9): the budgets payload carries versions[]
  // + approvedVersionId / draftVersionId. Line editing binds to the
  // selected DRAFT version; approved versions are read-only.
  const [budgetFy, setBudgetFy] = useState<number | null>(null);
  const [versions, setVersions] = useState<Rec[]>([]);
  const [selectedVersionId, setSelectedVersionId] = useState("");
  const [versionBusy, setVersionBusy] = useState("");
  const selectedVersion = versions.find((v) => str(pick(v, "id")) === selectedVersionId) ?? null;
  const selectedStatus = selectedVersion
    ? str(pick(selectedVersion, "status")).toLowerCase()
    : "";
  const budgetLocked = versions.length > 0 && selectedStatus !== "draft";

  const applyBudgetPayload = useCallback((b: Rec, preferVersionId?: string) => {
    const vs = listFrom(b, "versions");
    setVersions(vs);
    const draftId = str(pick(b, "draftVersionId"));
    const approvedId = str(pick(b, "approvedVersionId"));
    const chosen =
      (preferVersionId && vs.some((v) => str(pick(v, "id")) === preferVersionId)
        ? preferVersionId
        : "") ||
      (vs.some((v) => str(pick(v, "id")) === draftId) ? draftId : "") ||
      (vs.some((v) => str(pick(v, "id")) === approvedId) ? approvedId : "") ||
      (vs[0] ? str(pick(vs[0], "id")) : "");
    setSelectedVersionId(chosen);
    const lines = listFrom(b, "lines", "budgets");
    const amt = (key: string) =>
      num(pick(lines.find((l) => str(pick(l, "lineKey")) === key) ?? {}, "amount"));
    setBudget({
      revenue: String(amt("revenue") ?? ""),
      grossProfit: String(amt("gross_profit") ?? ""),
      ebitda: String(amt("ebitda") ?? ""),
    });
  }, []);

  const periodOf = useCallback(
    (r: Rec) => str(pick(r, "id", "periodId")) || dateOnly(pick(r, "periodEnd")),
    []
  );

  const loadVariance = useCallback(
    async (key: string, periodRec: Rec | undefined) => {
      const periodEnd = dateOnly(pick(periodRec ?? {}, "periodEnd")) ||
        (/^\d{4}-\d{2}-\d{2}$/.test(key) ? key : "");
      const periodId = periodRec ? str(pick(periodRec, "id", "periodId")) : "";
      const qs = new URLSearchParams();
      if (periodEnd) qs.set("periodEnd", periodEnd);
      if (periodId) qs.set("periodId", periodId);
      const d = await api<Rec>(`${base}/variance${qs.toString() ? `?${qs}` : ""}`);
      const list = listFrom(d, "rows", "variance", "items", "lines");
      setRows(list);
      const n: Record<string, string> = {};
      for (const r of list) {
        const metric = str(pick(r, "metric", "key", "label"));
        if (metric) n[metric] = str(pick(r, "notes", "commentary", "note"));
      }
      setNotes(n);
      // Budget editor for the period's fiscal year: budgets are
      // fiscal-year line items ({ lines: [{ lineKey, amount }] })
      // grouped into versions (Phase 9 payload adds versions[]).
      try {
        const fy = periodEnd ? Number(periodEnd.slice(0, 4)) : NaN;
        if (Number.isFinite(fy)) {
          setBudgetFy(fy);
          const b = await api<Rec>(`${base}/budgets?fiscalYear=${fy}`);
          applyBudgetPayload(b);
        }
      } catch {
        /* budgets are an editor convenience — variance still renders */
      }
      return periodEnd;
    },
    [base, applyBudgetPayload]
  );

  const load = useCallback(async () => {
    setLoading(true);
    setLoadFailed(false);
    try {
      const d = await api<Rec>(`${base}/periods`);
      const list = listFrom(d, "periods", "items");
      setPeriods(list);
      const latest = [...list].sort((a, b) =>
        dateOnly(pick(b, "periodEnd")).localeCompare(dateOnly(pick(a, "periodEnd")))
      )[0];
      if (latest) {
        const key = periodOf(latest);
        setPeriodKey(key);
        await loadVariance(key, latest);
      } else {
        setRows([]);
      }
    } catch {
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, [base, loadVariance, periodOf]);

  useEffect(() => {
    void load();
  }, [load]);

  const selectPeriod = async (key: string) => {
    setPeriodKey(key);
    const rec = periods.find((p) => periodOf(p) === key);
    setError("");
    try {
      await loadVariance(key, rec);
    } catch {
      setError("Could not load variance for that period.");
    }
  };

  const saveNote = async (metric: string) => {
    const rec = periods.find((p) => periodOf(p) === periodKey);
    const periodEnd = dateOnly(pick(rec ?? {}, "periodEnd")) ||
      (/^\d{4}-\d{2}-\d{2}$/.test(periodKey) ? periodKey : "");
    setSavingNote(metric);
    setError("");
    try {
      await api(`${base}/variance/notes`, {
        method: "PUT",
        body: JSON.stringify({
          periodEnd: periodEnd || undefined,
          metricKey: metric,
          commentary: notes[metric] ?? "",
        }),
      });
    } catch {
      setError("Could not save that commentary.");
    } finally {
      setSavingNote("");
    }
  };

  const saveBudget = async () => {
    const rec = periods.find((p) => periodOf(p) === periodKey);
    const periodEnd = dateOnly(pick(rec ?? {}, "periodEnd"));
    if (!periodEnd || savingBudget || budgetLocked) return;
    const fiscalYear = Number(periodEnd.slice(0, 4));
    if (!Number.isFinite(fiscalYear)) return;
    setSavingBudget(true);
    setError("");
    try {
      await api(`${base}/budgets`, {
        method: "PUT",
        body: JSON.stringify({
          fiscalYear,
          versionId: selectedVersionId || undefined,
          lines: [
            { lineKey: "revenue", amount: parseNum(budget.revenue) },
            { lineKey: "gross_profit", amount: parseNum(budget.grossProfit) },
            { lineKey: "ebitda", amount: parseNum(budget.ebitda) },
          ].filter((l) => l.amount !== null),
        }),
      });
      await loadVariance(periodKey, rec);
    } catch {
      setError("Could not save that budget.");
    } finally {
      setSavingBudget(false);
    }
  };

  const selectVersion = async (versionId: string) => {
    setSelectedVersionId(versionId);
    if (budgetFy === null) return;
    setError("");
    try {
      const b = await api<Rec>(
        `${base}/budgets?fiscalYear=${budgetFy}&versionId=${encodeURIComponent(versionId)}`
      );
      applyBudgetPayload(b, versionId);
    } catch {
      setError("Could not load that budget version.");
    }
  };

  const createVersion = async (kind: "annual" | "reforecast") => {
    if (budgetFy === null || versionBusy) return;
    setVersionBusy(`create-${kind}`);
    setError("");
    try {
      const d = await api<Rec>(`${base}/budgets/versions`, {
        method: "POST",
        body: JSON.stringify({ fiscalYear: budgetFy, kind }),
      });
      const created = (pick(d, "version") ?? d) as Rec;
      const rec = periods.find((p) => periodOf(p) === periodKey);
      await loadVariance(periodKey, rec);
      const newId = str(pick(created, "id"));
      if (newId) await selectVersion(newId);
    } catch {
      setError("Could not create that budget version.");
    } finally {
      setVersionBusy("");
    }
  };

  const setVersionStatus = async (status: string) => {
    if (!selectedVersionId || versionBusy) return;
    setVersionBusy(`status-${status}`);
    setError("");
    try {
      await api(`${base}/budgets/versions/${encodeURIComponent(selectedVersionId)}`, {
        method: "POST",
        body: JSON.stringify({ status }),
      });
      const rec = periods.find((p) => periodOf(p) === periodKey);
      await loadVariance(periodKey, rec);
      await selectVersion(selectedVersionId);
    } catch {
      setError("Could not change that version's status.");
    } finally {
      setVersionBusy("");
    }
  };

  if (loading) return <SkeletonRows rows={5} />;
  if (loadFailed) return <ErrorState onRetry={() => void load()} />;

  const metricOf = (r: Rec) => str(pick(r, "metric", "key", "label")) || "—";
  const isPctRow = (r: Rec) => /margin|pct|percent/i.test(metricOf(r));
  const fmtCell = (r: Rec, ...keys: string[]) => {
    const n = num(pick(r, ...keys));
    return isPctRow(r) ? fmtPctPoints(n) : fmtMoneyN(n);
  };

  return (
    <div className="space-y-5">
      <ErrorBanner message={error} />
      <Section
        title="Variance — actual vs plan"
        caption="Four-way comparison for the selected period: actuals against budget, the underwriting copy, and the value-creation target. Variance figures are the server's; commentary is yours."
        actions={
          periods.length > 0 ? (
            <select
              className={`${selectCls} min-h-[44px] w-auto`}
              value={periodKey}
              onChange={(e) => void selectPeriod(e.target.value)}
              aria-label="Variance period"
            >
              {periods.map((p, i) => (
                <option key={periodOf(p) || i} value={periodOf(p)}>
                  {dateOnly(pick(p, "periodEnd")) || str(pick(p, "periodLabel")) || `Period ${i + 1}`}
                </option>
              ))}
            </select>
          ) : undefined
        }
      >
        {rows.length === 0 ? (
          <EmptyState
            title="No variance data for this period"
            message="Variance needs a received period with posted actuals. Budgets, the underwriting copy and VC targets each fill their own column — a missing column means that source has no figure for the period, not zero."
          />
        ) : (
          <SimpleTable
            rows={rows}
            rowKey={(r, i) => metricOf(r) || String(i)}
            columns={[
              { key: "metric", label: "Metric", value: (r) => str(pick(r, "label", "metric", "key")) || "—" },
              { key: "actual", label: "Actual", align: "right", value: (r) => fmtCell(r, "actual") },
              { key: "budget", label: "Budget", align: "right", value: (r) => fmtCell(r, "budget") },
              { key: "underwriting", label: "Underwriting", align: "right", value: (r) => fmtCell(r, "underwriting") },
              { key: "vcTarget", label: "VC target", align: "right", value: (r) => fmtCell(r, "vcTarget", "target") },
              { key: "variance", label: "Var. vs budget", align: "right", value: (r) => fmtCell(r, "variance", "varianceVsBudget", "varianceAmount") },
              {
                key: "commentary",
                label: "Commentary",
                render: (r) => {
                  const metric = metricOf(r);
                  return (
                    <div className="flex min-w-[200px] items-center gap-2">
                      <input
                        className={`${inputCls} min-h-[44px]`}
                        value={notes[metric] ?? ""}
                        onChange={(e) =>
                          setNotes((n) => ({ ...n, [metric]: e.target.value }))
                        }
                        placeholder="Why the variance?"
                        aria-label={`Commentary for ${metric}`}
                      />
                      <Button
                        size="sm"
                        variant="secondary"
                        className="min-h-[44px] shrink-0"
                        loading={savingNote === metric}
                        onClick={() => void saveNote(metric)}
                      >
                        Save
                      </Button>
                    </div>
                  );
                },
              },
            ]}
          />
        )}

        <div className="mt-5 border-t border-slate-100 pt-4 dark:border-white/5">
          <h4 className="text-sm font-semibold text-[#0d1f3c] dark:text-white">
            Budget for this period&apos;s fiscal year
          </h4>

          {/* Version bar (Phase 9) */}
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            {versions.length === 0 ? (
              <span className="text-xs text-slate-400 dark:text-white/40">
                No versions yet — lines save to the working budget; create a version to start the approve flow.
              </span>
            ) : (
              versions.map((v) => {
                const id = str(pick(v, "id"));
                const st = str(pick(v, "status")).toLowerCase();
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => void selectVersion(id)}
                    aria-pressed={id === selectedVersionId}
                    className={`chip min-h-[44px] ${id === selectedVersionId ? "chip-active" : ""}`}
                  >
                    v{str(pick(v, "versionNo")) || "?"} · {str(pick(v, "kind")) || "annual"} ·{" "}
                    <span
                      className={`badge ${
                        st === "approved"
                          ? "badge-fit"
                          : st === "draft"
                            ? "badge-warn"
                            : "badge-neutral"
                      }`}
                    >
                      {st || "—"}
                    </span>
                  </button>
                );
              })
            )}
            <span className="mx-1 hidden h-6 w-px bg-slate-200 dark:bg-white/10 sm:block" />
            <Button
              size="sm"
              variant="secondary"
              className="min-h-[44px]"
              loading={versionBusy === "create-annual"}
              disabled={budgetFy === null}
              onClick={() => void createVersion("annual")}
            >
              New annual version
            </Button>
            <Button
              size="sm"
              variant="secondary"
              className="min-h-[44px]"
              loading={versionBusy === "create-reforecast"}
              disabled={budgetFy === null}
              onClick={() => void createVersion("reforecast")}
            >
              New reforecast
            </Button>
            {selectedVersion && selectedStatus === "draft" && (
              <Button
                size="sm"
                className="min-h-[44px]"
                loading={versionBusy === "status-submitted"}
                onClick={() => void setVersionStatus("submitted")}
              >
                Submit for approval
              </Button>
            )}
            {selectedVersion && selectedStatus === "submitted" && (
              <>
                <Button
                  size="sm"
                  className="min-h-[44px]"
                  loading={versionBusy === "status-approved"}
                  onClick={() => void setVersionStatus("approved")}
                >
                  Approve
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="min-h-[44px]"
                  loading={versionBusy === "status-draft"}
                  onClick={() => void setVersionStatus("draft")}
                >
                  Return to draft
                </Button>
              </>
            )}
          </div>
          {selectedVersion && (
            <p className="mt-2 text-xs text-slate-400 dark:text-white/40">
              {budgetLocked
                ? `🔒 Version ${str(pick(selectedVersion, "versionNo"))} is ${selectedStatus || "locked"} — read-only. Create a reforecast to change figures.`
                : `Editing draft version ${str(pick(selectedVersion, "versionNo"))} (${str(pick(selectedVersion, "kind"))}).`}
              {str(pick(selectedVersion, "approvedBy"))
                ? ` Approved by ${str(pick(selectedVersion, "approvedBy"))}.`
                : ""}
            </p>
          )}

          <fieldset disabled={budgetLocked} className="mt-3">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1fr_auto] lg:items-end">
              <div>
                <label className={labelCls}>Revenue budget ($)</label>
                <input inputMode="numeric" className={`${inputCls} min-h-[44px]`} value={budget.revenue} onChange={(e) => setBudget((b) => ({ ...b, revenue: e.target.value }))} />
              </div>
              <div>
                <label className={labelCls}>Gross profit budget ($)</label>
                <input inputMode="numeric" className={`${inputCls} min-h-[44px]`} value={budget.grossProfit} onChange={(e) => setBudget((b) => ({ ...b, grossProfit: e.target.value }))} />
              </div>
              <div>
                <label className={labelCls}>EBITDA budget ($)</label>
                <input inputMode="numeric" className={`${inputCls} min-h-[44px]`} value={budget.ebitda} onChange={(e) => setBudget((b) => ({ ...b, ebitda: e.target.value }))} />
              </div>
              <Button onClick={() => void saveBudget()} loading={savingBudget} className="min-h-[44px]">
                Save budget
              </Button>
            </div>
          </fieldset>
        </div>
      </Section>
    </div>
  );
}

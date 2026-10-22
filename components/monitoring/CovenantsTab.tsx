"use client";

/**
 * Covenants tab (Phase 8) — covenant definitions (the four computable
 * keys from lib/monitoring/schema.ts COVENANT_KEYS), their latest
 * tests with headroom and pass/fail chips, and the Compute action
 * (POST /covenants/compute), which derives tests from the latest
 * posted financials at or before the chosen period and reports
 * skipped covenants with their missing inputs — never a fabricated
 * value. Definition edits go through POST /covenants with the row id.
 */

import { useCallback, useEffect, useState } from "react";
import { Button, EmptyState, ErrorState, SkeletonRows } from "@/components/ui";
import { ErrorBanner, Section, SimpleTable } from "@/components/monitoring/shared";
import {
  companyBase,
  api,
  dateOnly,
  fmtDateShort,
  fmtPctPoints,
  inputCls,
  labelCls,
  listFrom,
  num,
  parseNum,
  pick,
  selectCls,
  statusBadge,
  str,
  type MonitoringTabProps,
  type Rec,
} from "@/components/monitoring/types";

/** Mirrors COVENANT_KEYS / COVENANT_LABELS in the monitoring module. */
const COVENANT_KEYS = [
  { key: "max_total_leverage", label: "Max total leverage", operator: "<=" },
  { key: "min_ebitda", label: "Min EBITDA", operator: ">=" },
  { key: "min_cash", label: "Min cash", operator: ">=" },
  { key: "min_current_ratio", label: "Min current ratio", operator: ">=" },
];

function fmtCovenantValue(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return "—";
  return Math.abs(v) >= 1000
    ? v.toLocaleString("en-US", { maximumFractionDigits: 0 })
    : String(Math.round(v * 100) / 100);
}

export default function CovenantsTab({ companyId, summary }: MonitoringTabProps) {
  const base = companyBase(companyId);
  const [covenants, setCovenants] = useState<Rec[]>([]);
  const [tests, setTests] = useState<Rec[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState("");

  const [form, setForm] = useState({ covenantKey: "max_total_leverage", label: "", operator: "<=", threshold: "", nextTestDate: "" });
  const [creating, setCreating] = useState(false);

  const [computePeriod, setComputePeriod] = useState(
    dateOnly(pick(summary ?? {}, "latestPeriodEnd"))
  );
  const [computing, setComputing] = useState(false);
  const [computeResult, setComputeResult] = useState<Rec | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadFailed(false);
    try {
      const d = await api<Rec>(`${base}/covenants`);
      setCovenants(listFrom(d, "covenants", "items"));
      setTests(listFrom(d, "tests"));
    } catch {
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, [base]);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async () => {
    const threshold = parseNum(form.threshold);
    if (threshold === null || creating) return;
    setCreating(true);
    setError("");
    try {
      await api(`${base}/covenants`, {
        method: "POST",
        body: JSON.stringify({
          covenantKey: form.covenantKey,
          label:
            form.label.trim() ||
            COVENANT_KEYS.find((k) => k.key === form.covenantKey)?.label ||
            form.covenantKey,
          operator: form.operator,
          threshold,
          nextTestDate: form.nextTestDate || null,
        }),
      });
      setForm({ covenantKey: "max_total_leverage", label: "", operator: "<=", threshold: "", nextTestDate: "" });
      await load();
    } catch {
      setError("Could not save that covenant definition.");
    } finally {
      setCreating(false);
    }
  };

  const toggleActive = async (covenant: Rec) => {
    const id = str(pick(covenant, "id"));
    if (!id) return;
    setBusyId(id);
    setError("");
    try {
      await api(`${base}/covenants`, {
        method: "POST",
        body: JSON.stringify({ id, active: pick(covenant, "active") !== true }),
      });
      await load();
    } catch {
      setError("Could not update that covenant.");
    } finally {
      setBusyId("");
    }
  };

  const compute = async () => {
    if (!computePeriod || computing) return;
    setComputing(true);
    setError("");
    try {
      const d = await api<Rec>(`${base}/covenants/compute`, {
        method: "POST",
        body: JSON.stringify({ periodEnd: computePeriod }),
      });
      setComputeResult(d);
      await load();
    } catch {
      setError("Could not compute covenant tests for that period. It needs a valid period end and posted financials.");
    } finally {
      setComputing(false);
    }
  };

  if (loading) return <SkeletonRows rows={5} />;
  if (loadFailed) return <ErrorState onRetry={() => void load()} />;

  const skipped = computeResult ? listFrom(computeResult, "skipped") : [];
  const computedTests = computeResult ? listFrom(computeResult, "tests") : [];

  return (
    <div className="space-y-5">
      <ErrorBanner message={error} />

      <Section
        title="Covenant definitions"
        caption="The tests the credit agreement requires. Compute derives each test from the latest posted financials — a covenant whose inputs are missing is skipped with the reason shown, never estimated."
        actions={
          <div className="flex items-end gap-2">
            <div>
              <label className={labelCls}>Compute for period end</label>
              <input
                type="date"
                className={`${inputCls} min-h-[44px] w-[170px]`}
                value={computePeriod}
                onChange={(e) => setComputePeriod(e.target.value)}
              />
            </div>
            <Button onClick={() => void compute()} loading={computing} disabled={!computePeriod} className="min-h-[44px]">
              Compute tests
            </Button>
          </div>
        }
      >
        {computeResult && (
          <div className="mb-4 rounded-xl bg-slate-50 px-4 py-3 text-sm text-[#0d1f3c] dark:bg-white/5 dark:text-white/90" role="status">
            Computed {computedTests.length} test{computedTests.length === 1 ? "" : "s"}
            {skipped.length > 0 && (
              <>
                {" "}· skipped {skipped.length}:{" "}
                {skipped
                  .map((s) => {
                    const missing = pick(s, "missing");
                    const m = Array.isArray(missing) ? (missing as unknown[]).map(String).join(", ") : "";
                    return `${str(pick(s, "covenantKey")) || "covenant"}${m ? ` (missing ${m})` : ""}`;
                  })
                  .join("; ")}
              </>
            )}
          </div>
        )}

        {covenants.length === 0 ? (
          <EmptyState
            title="No covenants defined"
            message="Add the first covenant below — pick the test, its operator and threshold, and monitoring computes it from posted financials."
          />
        ) : (
          <SimpleTable
            rows={covenants}
            rowKey={(r, i) => str(pick(r, "id")) || String(i)}
            columns={[
              { key: "label", label: "Covenant", value: (r) => str(pick(r, "label", "covenantKey")) || "—" },
              {
                key: "test",
                label: "Test",
                value: (r) =>
                  `${str(pick(r, "operator")) || ""} ${fmtCovenantValue(num(pick(r, "threshold")))}`.trim() || "—",
              },
              {
                key: "nextTestDate",
                label: "Next test",
                value: (r) => fmtDateShort(dateOnly(pick(r, "nextTestDate"))),
              },
              {
                key: "active",
                label: "Active",
                render: (r) => (
                  <span className={`badge ${pick(r, "active") === true ? "badge-fit" : "badge-neutral"}`}>
                    {pick(r, "active") === true ? "active" : "inactive"}
                  </span>
                ),
              },
              {
                key: "latest",
                label: "Latest result",
                render: (r) => {
                  const t = (pick(r, "latestTest") ?? {}) as Rec;
                  const s = str(pick(t, "status"));
                  if (!s) return "—";
                  const head = num(pick(t, "headroomPct"));
                  return (
                    <span className="inline-flex items-center gap-2">
                      <span className={`badge ${statusBadge(s)}`}>{s}</span>
                      {head !== null && (
                        <span className="tnum text-xs text-slate-400 dark:text-white/40">
                          headroom {fmtPctPoints(head)}
                        </span>
                      )}
                    </span>
                  );
                },
              },
              {
                key: "actions",
                label: "Actions",
                render: (r) => (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm min-h-[44px]"
                    disabled={busyId === str(pick(r, "id"))}
                    onClick={() => void toggleActive(r)}
                  >
                    {pick(r, "active") === true ? "Deactivate" : "Activate"}
                  </button>
                ),
              },
            ]}
          />
        )}

        <div className="mt-5 border-t border-slate-100 pt-4 dark:border-white/5">
          <h4 className="text-sm font-semibold text-[#0d1f3c] dark:text-white">New covenant</h4>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_110px_1fr_1fr_auto] lg:items-end">
            <div>
              <label className={labelCls}>Test</label>
              <select
                className={`${selectCls} min-h-[44px]`}
                value={form.covenantKey}
                onChange={(e) => {
                  const hit = COVENANT_KEYS.find((k) => k.key === e.target.value);
                  setForm((f) => ({
                    ...f,
                    covenantKey: e.target.value,
                    operator: hit?.operator ?? f.operator,
                  }));
                }}
              >
                {COVENANT_KEYS.map((k) => (
                  <option key={k.key} value={k.key}>{k.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls}>Label (optional)</label>
              <input className={`${inputCls} min-h-[44px]`} value={form.label} onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))} placeholder="Defaults to the test name" />
            </div>
            <div>
              <label className={labelCls}>Operator</label>
              <select className={`${selectCls} min-h-[44px]`} value={form.operator} onChange={(e) => setForm((f) => ({ ...f, operator: e.target.value }))}>
                <option value="<=">≤</option>
                <option value=">=">≥</option>
              </select>
            </div>
            <div>
              <label className={labelCls}>Threshold</label>
              <input inputMode="numeric" className={`${inputCls} min-h-[44px]`} value={form.threshold} onChange={(e) => setForm((f) => ({ ...f, threshold: e.target.value }))} placeholder="e.g. 4.5 or 500000" />
            </div>
            <div>
              <label className={labelCls}>Next test date</label>
              <input type="date" className={`${inputCls} min-h-[44px]`} value={form.nextTestDate} onChange={(e) => setForm((f) => ({ ...f, nextTestDate: e.target.value }))} />
            </div>
            <Button onClick={() => void create()} loading={creating} disabled={parseNum(form.threshold) === null} className="min-h-[44px]">
              Add covenant
            </Button>
          </div>
        </div>
      </Section>

      <Section title="Latest tests" caption="The latest computed test per covenant — computed value against threshold with headroom.">
        {tests.length === 0 ? (
          <EmptyState title="No tests computed yet" message="Run Compute above for a period with posted financials and the results land here." />
        ) : (
          <SimpleTable
            rows={tests}
            rowKey={(r, i) => str(pick(r, "id")) || String(i)}
            columns={[
              { key: "label", label: "Covenant", value: (r) => str(pick(r, "label", "covenantKey")) || "—" },
              { key: "periodEnd", label: "Period end", value: (r) => fmtDateShort(dateOnly(pick(r, "periodEnd"))) },
              { key: "computedValue", label: "Computed", align: "right", value: (r) => fmtCovenantValue(num(pick(r, "computedValue"))) },
              { key: "threshold", label: "Threshold", align: "right", value: (r) => fmtCovenantValue(num(pick(r, "threshold"))) },
              { key: "headroomPct", label: "Headroom", align: "right", value: (r) => fmtPctPoints(num(pick(r, "headroomPct"))) },
              {
                key: "status",
                label: "Status",
                render: (r) => {
                  const s = str(pick(r, "status"));
                  return s ? <span className={`badge ${statusBadge(s)}`}>{s}</span> : "—";
                },
              },
            ]}
          />
        )}
      </Section>
    </div>
  );
}

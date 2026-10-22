"use client";

/**
 * KPIs tab (Phase 8) — per-period KPI rows from GET /kpis (revenue,
 * EBITDA, margins, cash come from posted financials server-side; this
 * tab never recomputes them), a recharts revenue/EBITDA trend built
 * from those same rows, and the manual-KPI form (headcount, customer
 * count, or a custom metric) written through PUT /kpis.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Button, EmptyState, ErrorState, SkeletonRows } from "@/components/ui";
import { ErrorBanner, Section, SimpleTable } from "@/components/monitoring/shared";
import { useTheme } from "@/components/ThemeProvider";
import {
  companyBase,
  api,
  dateOnly,
  fmtMoneyC,
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

const MANUAL_METRICS = [
  { key: "headcount", label: "Headcount" },
  { key: "customer_count", label: "Customer count" },
  { key: "custom", label: "Custom metric…" },
];

export default function KpisTab({ companyId }: MonitoringTabProps) {
  const base = companyBase(companyId);
  const { theme } = useTheme();
  const dark = theme === "dark";
  const [rows, setRows] = useState<Rec[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [error, setError] = useState("");

  const [form, setForm] = useState({ periodEnd: "", metric: "headcount", customKey: "", value: "" });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadFailed(false);
    try {
      const d = await api<Rec>(`${base}/kpis`);
      const list = listFrom(d, "kpis", "rows", "items", "periods");
      setRows(
        [...list].sort((a, b) =>
          dateOnly(pick(a, "periodEnd")).localeCompare(dateOnly(pick(b, "periodEnd")))
        )
      );
    } catch {
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, [base]);

  useEffect(() => {
    void load();
  }, [load]);

  const chartData = useMemo(
    () =>
      rows.map((r) => ({
        label: dateOnly(pick(r, "periodEnd")) || str(pick(r, "periodLabel")) || "—",
        revenue: num(pick(r, "revenue")),
        ebitda: num(pick(r, "ebitda")),
        grossMarginPct: num(pick(r, "grossMarginPct", "grossMargin")),
      })),
    [rows]
  );

  const saveManual = async () => {
    const value = parseNum(form.value);
    const metric = form.metric === "custom" ? form.customKey.trim() : form.metric;
    if (value === null || !metric || !form.periodEnd || saving) return;
    setSaving(true);
    setError("");
    try {
      await api(`${base}/kpis`, {
        method: "PUT",
        body: JSON.stringify({
          periodEnd: form.periodEnd,
          kpiKey: metric,
          label: metric,
          value,
          unit:
            metric === "headcount" || metric === "customer_count"
              ? "count"
              : undefined,
          source: "manual",
        }),
      });
      setForm((f) => ({ ...f, value: "", customKey: "" }));
      await load();
    } catch {
      setError("Could not save that KPI. Check the period and value and try again.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <SkeletonRows rows={5} />;
  if (loadFailed) return <ErrorState onRetry={() => void load()} />;

  const grid = dark ? "rgba(255,255,255,0.08)" : "#e2e8f0";
  const tick = dark ? "rgba(255,255,255,0.55)" : "#64748b";
  const periodEnds = rows.map((r) => dateOnly(pick(r, "periodEnd"))).filter(Boolean);

  return (
    <div className="space-y-5">
      <ErrorBanner message={error} />
      <Section title="KPI trend" caption="Revenue and EBITDA by reported period, with gross margin — plotted from the KPI rows below, nothing recomputed.">
        {chartData.length === 0 ? (
          <EmptyState
            title="No KPI periods yet"
            message="KPIs appear here once the first reporting period is received and its financials are posted."
          />
        ) : (
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                <CartesianGrid stroke={grid} strokeDasharray="3 3" />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: tick }} minTickGap={30} />
                <YAxis
                  yAxisId="left"
                  tick={{ fontSize: 11, fill: tick }}
                  tickFormatter={(v: number) => fmtMoneyC(v)}
                />
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  tick={{ fontSize: 11, fill: tick }}
                  tickFormatter={(v: number) => `${v}%`}
                />
                <Tooltip
                  contentStyle={{
                    background: dark ? "#0d1f3c" : "#fff",
                    border: `1px solid ${grid}`,
                    fontSize: 12,
                  }}
                  formatter={(v, name) => [
                    name === "Gross margin %"
                      ? fmtPctPoints(typeof v === "number" ? v : null)
                      : fmtMoneyN(typeof v === "number" ? v : null),
                    name,
                  ]}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar yAxisId="left" dataKey="revenue" name="Revenue" fill="#0d1f3c" radius={[2, 2, 0, 0]} />
                <Bar yAxisId="left" dataKey="ebitda" name="EBITDA" fill="#b8975a" radius={[2, 2, 0, 0]} />
                <Line yAxisId="right" type="monotone" dataKey="grossMarginPct" name="Gross margin %" stroke="#54708f" strokeWidth={2} dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}
      </Section>

      <Section title="KPI periods" caption="Financial KPIs come from posted statements; headcount, customer count and custom metrics are entered manually below.">
        {rows.length === 0 ? (
          <EmptyState
            title="No KPI rows yet"
            message="Once a period is received and posted, its revenue, EBITDA, margin and cash land here."
          />
        ) : (
          <SimpleTable
            rows={rows}
            rowKey={(r, i) => dateOnly(pick(r, "periodEnd")) || String(i)}
            columns={[
              { key: "periodEnd", label: "Period end", value: (r) => dateOnly(pick(r, "periodEnd")) || "—" },
              { key: "revenue", label: "Revenue", align: "right", value: (r) => fmtMoneyN(num(pick(r, "revenue"))) },
              { key: "ebitda", label: "EBITDA", align: "right", value: (r) => fmtMoneyN(num(pick(r, "ebitda"))) },
              {
                key: "grossMarginPct",
                label: "Gross margin",
                align: "right",
                value: (r) => fmtPctPoints(num(pick(r, "grossMarginPct", "grossMargin"))),
              },
              { key: "cash", label: "Cash", align: "right", value: (r) => fmtMoneyN(num(pick(r, "cash", "cashBalance"))) },
              {
                key: "headcount",
                label: "Headcount",
                align: "right",
                value: (r) => {
                  const n = num(pick(r, "headcount"));
                  return n === null ? "—" : String(Math.round(n));
                },
              },
              {
                key: "customerCount",
                label: "Customers",
                align: "right",
                value: (r) => {
                  const n = num(pick(r, "customerCount", "customer_count", "customers"));
                  return n === null ? "—" : String(Math.round(n));
                },
              },
            ]}
          />
        )}

        <div className="mt-5 border-t border-slate-100 pt-4 dark:border-white/5">
          <h4 className="text-sm font-semibold text-[#0d1f3c] dark:text-white">
            Add a manual KPI
          </h4>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1fr_1fr_auto] lg:items-end">
            <div>
              <label className={labelCls}>Period end</label>
              {periodEnds.length ? (
                <select
                  className={`${selectCls} min-h-[44px]`}
                  value={form.periodEnd}
                  onChange={(e) => setForm((f) => ({ ...f, periodEnd: e.target.value }))}
                >
                  <option value="">Select period…</option>
                  {periodEnds.map((p) => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
              ) : (
                <input
                  type="date"
                  className={`${inputCls} min-h-[44px]`}
                  value={form.periodEnd}
                  onChange={(e) => setForm((f) => ({ ...f, periodEnd: e.target.value }))}
                />
              )}
            </div>
            <div>
              <label className={labelCls}>Metric</label>
              <select
                className={`${selectCls} min-h-[44px]`}
                value={form.metric}
                onChange={(e) => setForm((f) => ({ ...f, metric: e.target.value }))}
              >
                {MANUAL_METRICS.map((m) => (
                  <option key={m.key} value={m.key}>{m.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls}>Custom metric name</label>
              <input
                className={`${inputCls} min-h-[44px]`}
                value={form.customKey}
                disabled={form.metric !== "custom"}
                onChange={(e) => setForm((f) => ({ ...f, customKey: e.target.value }))}
                placeholder="e.g. Locations"
              />
            </div>
            <div>
              <label className={labelCls}>Value</label>
              <input
                inputMode="numeric"
                className={`${inputCls} min-h-[44px]`}
                value={form.value}
                onChange={(e) => setForm((f) => ({ ...f, value: e.target.value }))}
                placeholder="e.g. 145"
              />
            </div>
            <Button
              onClick={() => void saveManual()}
              loading={saving}
              disabled={
                parseNum(form.value) === null ||
                !form.periodEnd ||
                (form.metric === "custom" && !form.customKey.trim())
              }
              className="min-h-[44px]"
            >
              Save KPI
            </Button>
          </div>
        </div>
      </Section>
    </div>
  );
}

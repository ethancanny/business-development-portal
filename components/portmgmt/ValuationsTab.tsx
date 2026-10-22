"use client";

/**
 * Valuations tab (Phase 9, internal) — valuation marks for one
 * portfolio company: history list, an add-mark form, delete, and a
 * recharts line chart of value over time (the platform's only chart
 * library). Values are the server's marks — nothing is appraised here.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Button, EmptyState, ErrorState, SkeletonRows } from "@/components/ui";
import { ErrorBanner, Section, SimpleTable } from "@/components/monitoring/shared";
import { useTheme } from "@/components/ThemeProvider";
import {
  dateOnly,
  fmtDateShort,
  fmtMoneyC,
  fmtMoneyN,
  inputCls,
  labelCls,
  parseNum,
  selectCls,
  type MonitoringTabProps,
} from "@/components/monitoring/types";
import { api, num, pick, pmCompany, rowsFrom, str, type Rec } from "@/components/portmgmt/pm";

const METHODS = ["mark", "multiple", "dcf", "comparable", "appraisal", "other"] as const;

export default function ValuationsTab({ companyId }: MonitoringTabProps) {
  const base = `${pmCompany(companyId)}/valuations`;
  const { theme } = useTheme();
  const dark = theme === "dark";
  const [marks, setMarks] = useState<Rec[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState("");

  const [form, setForm] = useState({ asOf: "", value: "", method: "mark", basis: "", notes: "" });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadFailed(false);
    try {
      const d = await api<Rec>(base);
      const list = rowsFrom(d, "valuations", "marks", "items");
      setMarks(
        [...list].sort((a, b) =>
          (dateOnly(pick(a, "asOf", "valuedAt", "date")) || "").localeCompare(
            dateOnly(pick(b, "asOf", "valuedAt", "date")) || ""
          )
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

  const add = async () => {
    const value = parseNum(form.value);
    if (value === null || !form.asOf || saving) return;
    setSaving(true);
    setError("");
    try {
      await api(base, {
        method: "POST",
        body: JSON.stringify({
          asOf: form.asOf,
          value,
          method: form.method,
          basis: form.basis.trim() || undefined,
          notes: form.notes.trim() || undefined,
        }),
      });
      setForm({ asOf: "", value: "", method: "mark", basis: "", notes: "" });
      await load();
    } catch {
      setError("Could not record that valuation mark.");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    if (!window.confirm("Delete this valuation mark?")) return;
    setBusyId(id);
    setError("");
    try {
      await api(`${base}/${encodeURIComponent(id)}`, { method: "DELETE" });
      await load();
    } catch {
      setError("Could not delete that mark.");
    } finally {
      setBusyId("");
    }
  };

  const chartData = useMemo(
    () =>
      marks
        .map((m) => ({
          label: dateOnly(pick(m, "asOf", "valuedAt", "date")) || str(pick(m, "asOf")),
          value: num(pick(m, "value", "amount", "enterpriseValue")),
        }))
        .filter((d) => d.value !== null),
    [marks]
  );

  if (loading) return <SkeletonRows rows={5} />;
  if (loadFailed) return <ErrorState onRetry={() => void load()} />;

  const grid = dark ? "rgba(255,255,255,0.08)" : "#e2e8f0";
  const tick = dark ? "rgba(255,255,255,0.55)" : "#64748b";

  return (
    <div className="space-y-5">
      <ErrorBanner message={error} />
      <Section title="Value history" caption="Recorded valuation marks over time — the chart plots exactly the marks in the table below.">
        {chartData.length < 2 ? (
          <EmptyState
            title={chartData.length === 1 ? "One mark recorded" : "No valuation marks yet"}
            message="The trend line appears once at least two marks exist. Record the first mark below."
          />
        ) : (
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                <CartesianGrid stroke={grid} strokeDasharray="3 3" />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: tick }} minTickGap={30} />
                <YAxis tick={{ fontSize: 11, fill: tick }} tickFormatter={(v: number) => fmtMoneyC(v)} />
                <Tooltip
                  contentStyle={{ background: dark ? "#0d1f3c" : "#fff", border: `1px solid ${grid}`, fontSize: 12 }}
                  formatter={(v) => [fmtMoneyN(typeof v === "number" ? v : null), "Value"]}
                />
                <Line type="monotone" dataKey="value" name="Value" stroke="#b8975a" strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </Section>

      <Section title="Marks" caption="Every recorded mark for this company, oldest first.">
        {marks.length === 0 ? (
          <EmptyState title="No marks yet" message="Add the first valuation mark below." />
        ) : (
          <SimpleTable
            rows={marks}
            rowKey={(r, i) => str(pick(r, "id")) || String(i)}
            columns={[
              { key: "asOf", label: "As of", value: (r) => fmtDateShort(dateOnly(pick(r, "asOf", "valuedAt", "date"))) },
              { key: "value", label: "Value", align: "right", value: (r) => fmtMoneyN(num(pick(r, "value", "amount", "enterpriseValue"))) },
              { key: "method", label: "Method", value: (r) => str(pick(r, "method")) || "—" },
              { key: "basis", label: "Basis", value: (r) => str(pick(r, "basis")) || "—" },
              { key: "notes", label: "Notes", value: (r) => str(pick(r, "notes")) || "—" },
              {
                key: "actions",
                label: "Actions",
                render: (r) => {
                  const id = str(pick(r, "id"));
                  return (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm min-h-[44px]"
                      disabled={busyId === id}
                      onClick={() => void remove(id)}
                    >
                      Delete
                    </button>
                  );
                },
              },
            ]}
          />
        )}

        <div className="mt-5 border-t border-slate-100 pt-4 dark:border-white/5">
          <h4 className="text-sm font-semibold text-[#0d1f3c] dark:text-white">Add a mark</h4>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-[170px_1fr_150px_1fr_auto] lg:items-end">
            <div>
              <label className={labelCls}>As of</label>
              <input type="date" className={`${inputCls} min-h-[44px]`} value={form.asOf} onChange={(e) => setForm((f) => ({ ...f, asOf: e.target.value }))} />
            </div>
            <div>
              <label className={labelCls}>Value ($)</label>
              <input inputMode="numeric" className={`${inputCls} min-h-[44px]`} value={form.value} onChange={(e) => setForm((f) => ({ ...f, value: e.target.value }))} />
            </div>
            <div>
              <label className={labelCls}>Method</label>
              <select className={`${selectCls} min-h-[44px]`} value={form.method} onChange={(e) => setForm((f) => ({ ...f, method: e.target.value }))}>
                {METHODS.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls}>Basis (optional)</label>
              <input className={`${inputCls} min-h-[44px]`} value={form.basis} onChange={(e) => setForm((f) => ({ ...f, basis: e.target.value }))} placeholder="e.g. 6.0× TTM EBITDA" />
            </div>
            <Button className="min-h-[44px]" loading={saving} disabled={parseNum(form.value) === null || !form.asOf} onClick={() => void add()}>
              Add mark
            </Button>
          </div>
          <div className="mt-3">
            <label className={labelCls}>Notes (optional)</label>
            <input className={`${inputCls} min-h-[44px]`} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
          </div>
        </div>
      </Section>
    </div>
  );
}

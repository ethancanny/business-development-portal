"use client";

/**
 * VC Plan tab (Phase 8) — value-creation tracking for the company:
 * initiatives with planned vs realized EBITDA impact from GET /vc
 * (which reads the Phase 6 plan through the value-creation service —
 * targets are never re-entered here), and realized-impact entry
 * through PUT /vc/realized.
 */

import { useCallback, useEffect, useState } from "react";
import { Button, EmptyState, ErrorState, SkeletonRows, StatTile } from "@/components/ui";
import { ErrorBanner, Section, SimpleTable } from "@/components/monitoring/shared";
import {
  companyBase,
  api,
  fmtMoneyC,
  fmtMoneyN,
  inputCls,
  listFrom,
  num,
  parseNum,
  pick,
  statusBadge,
  str,
  type MonitoringTabProps,
  type Rec,
} from "@/components/monitoring/types";

export default function VcTab({ companyId }: MonitoringTabProps) {
  const base = companyBase(companyId);
  const [initiatives, setInitiatives] = useState<Rec[]>([]);
  const [totals, setTotals] = useState<Rec>({});
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [error, setError] = useState("");
  const [realizedForm, setRealizedForm] = useState<Record<string, string>>({});
  const [periodForm, setPeriodForm] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setLoadFailed(false);
    try {
      const d = await api<Rec>(`${base}/vc`);
      setInitiatives(listFrom(d, "initiatives", "rows", "items"));
      setTotals((pick(d, "totals") ?? {}) as Rec);
    } catch {
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, [base]);

  useEffect(() => {
    void load();
  }, [load]);

  const saveRealized = async (initiative: Rec) => {
    const id = str(pick(initiative, "initiativeId", "id"));
    const amount = parseNum(realizedForm[id] ?? "");
    // Realized impact is recorded per period — the server requires a
    // valid period end (defaults to the initiative's last realized
    // period or its target end date; editable in the row).
    const periodEnd =
      periodForm[id] ||
      str(pick(initiative, "realizedPeriodEnd")) ||
      str(pick(initiative, "endDate"));
    if (!id || amount === null || !periodEnd || savingId) return;
    setSavingId(id);
    setError("");
    try {
      await api(`${base}/vc/realized`, {
        method: "PUT",
        body: JSON.stringify({
          initiativeId: id,
          periodEnd,
          realizedImpact: amount,
          notes: "",
        }),
      });
      setRealizedForm((f) => ({ ...f, [id]: "" }));
      await load();
    } catch {
      setError("Could not record that realized impact.");
    } finally {
      setSavingId("");
    }
  };

  if (loading) return <SkeletonRows rows={5} />;
  if (loadFailed) return <ErrorState onRetry={() => void load()} />;

  const plannedTotal =
    num(pick(totals, "plannedImpact", "planned", "plannedTotal")) ??
    initiatives.reduce(
      (s, r) => s + (num(pick(r, "plannedImpact", "plannedEbitdaImpact", "planned")) ?? 0),
      0
    );
  const realizedTotal =
    num(pick(totals, "realizedImpact", "realized", "realizedTotal")) ??
    initiatives.reduce(
      (s, r) => s + (num(pick(r, "realizedImpact", "realized", "realizedAmount")) ?? 0),
      0
    );

  return (
    <div className="space-y-5">
      <ErrorBanner message={error} />
      <div className="grid grid-cols-2 gap-4">
        <div className="card-surface p-4">
          <StatTile
            label="Planned EBITDA impact"
            display={fmtMoneyC(plannedTotal)}
            title={fmtMoneyN(plannedTotal)}
            caption="Across tracked initiatives"
          />
        </div>
        <div className="card-surface p-4">
          <StatTile
            label="Realized to date"
            display={fmtMoneyC(realizedTotal)}
            title={fmtMoneyN(realizedTotal)}
            caption={
              plannedTotal
                ? `${Math.round((realizedTotal / Math.abs(plannedTotal)) * 100)}% of plan`
                : "No planned impact recorded"
            }
          />
        </div>
      </div>

      <Section
        title="Initiatives — planned vs realized"
        caption="Planned impact comes from the value-creation plan; realized impact is recorded here as initiatives deliver. Enter a realized amount and save to update an initiative."
      >
        {initiatives.length === 0 ? (
          <EmptyState
            title="No initiatives tracked"
            message="This company has no value-creation initiatives in its plan yet, or the plan hasn't been linked to monitoring. Initiatives are authored in Value Creation — monitoring tracks their delivery."
          />
        ) : (
          <SimpleTable
            rows={initiatives}
            rowKey={(r, i) => str(pick(r, "initiativeId", "id")) || String(i)}
            columns={[
              { key: "name", label: "Initiative", value: (r) => str(pick(r, "name", "title")) || "—" },
              {
                key: "status",
                label: "Status",
                render: (r) => {
                  const s = str(pick(r, "status"));
                  return s ? <span className={`badge ${statusBadge(s)}`}>{s}</span> : "—";
                },
              },
              {
                key: "planned",
                label: "Planned",
                align: "right",
                value: (r) => fmtMoneyN(num(pick(r, "plannedImpact", "plannedEbitdaImpact", "planned"))),
              },
              {
                key: "realized",
                label: "Realized",
                align: "right",
                value: (r) => fmtMoneyN(num(pick(r, "realizedImpact", "realized", "realizedAmount"))),
              },
              {
                key: "progress",
                label: "Progress",
                render: (r) => {
                  const planned = num(pick(r, "plannedImpact", "plannedEbitdaImpact", "planned"));
                  const realized = num(pick(r, "realizedImpact", "realized", "realizedAmount"));
                  if (!planned || realized === null) return "—";
                  const pct = Math.max(0, Math.min(100, (realized / Math.abs(planned)) * 100));
                  return (
                    <div className="min-w-[120px]">
                      <div className="h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-white/10">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-[#b8975a] to-[#d4b37a]"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <p className="tnum mt-1 text-xs text-slate-400 dark:text-white/40">
                        {Math.round((realized / Math.abs(planned)) * 100)}%
                      </p>
                    </div>
                  );
                },
              },
              {
                key: "record",
                label: "Record realized ($)",
                render: (r) => {
                  const id = str(pick(r, "initiativeId", "id"));
                  const defaultPeriod =
                    str(pick(r, "realizedPeriodEnd")) || str(pick(r, "endDate"));
                  return (
                    <div className="flex min-w-[260px] flex-wrap items-center gap-2">
                      <input
                        type="date"
                        className={`${inputCls} min-h-[44px] w-[150px]`}
                        value={periodForm[id] ?? defaultPeriod}
                        onChange={(e) =>
                          setPeriodForm((f) => ({ ...f, [id]: e.target.value }))
                        }
                        aria-label={`Period end for ${str(pick(r, "name", "title")) || "initiative"}`}
                      />
                      <input
                        inputMode="numeric"
                        className={`${inputCls} min-h-[44px] w-[130px]`}
                        value={realizedForm[id] ?? ""}
                        onChange={(e) =>
                          setRealizedForm((f) => ({ ...f, [id]: e.target.value }))
                        }
                        placeholder="e.g. 120,000"
                        aria-label={`Realized impact for ${str(pick(r, "name", "title")) || "initiative"}`}
                      />
                      <Button
                        size="sm"
                        variant="secondary"
                        className="min-h-[44px] shrink-0"
                        loading={savingId === id}
                        disabled={
                          parseNum(realizedForm[id] ?? "") === null ||
                          !(periodForm[id] ?? defaultPeriod)
                        }
                        onClick={() => void saveRealized(r)}
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
      </Section>
    </div>
  );
}

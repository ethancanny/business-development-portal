"use client";

/**
 * Exit tab (Phase 9, internal) — the company's exit plan: a readiness
 * summary rendered from GET …/exit-plan exactly as served (score when
 * the server provides one, otherwise its qualitative fields), plus
 * editors for target timing, buyer types and notes, and the broker
 * contacts list. Saving writes the whole plan back with PUT.
 */

import { useCallback, useEffect, useState } from "react";
import { Button, EmptyState, ErrorState, SkeletonRows, StatTile } from "@/components/ui";
import { ErrorBanner, KeyValues, Section, SimpleTable } from "@/components/monitoring/shared";
import {
  fmtMoneyC,
  fmtMoneyN,
  inputCls,
  labelCls,
  parseNum,
  type MonitoringTabProps,
} from "@/components/monitoring/types";
import { api, num, pick, pmCompany, rowsFrom, scalarEntries, str, type Rec } from "@/components/portmgmt/pm";

interface Broker {
  name: string;
  firm: string;
  email: string;
  phone: string;
}

const BROKER_EMPTY: Broker = { name: "", firm: "", email: "", phone: "" };

export default function ExitTab({ companyId }: MonitoringTabProps) {
  const base = `${pmCompany(companyId)}/exit-plan`;
  const [plan, setPlan] = useState<Rec | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [timing, setTiming] = useState("");
  const [buyerTypes, setBuyerTypes] = useState("");
  const [notes, setNotes] = useState("");
  const [targetValue, setTargetValue] = useState("");
  const [brokers, setBrokers] = useState<Broker[]>([]);
  const [draft, setDraft] = useState<Broker>(BROKER_EMPTY);
  const [saving, setSaving] = useState(false);

  const hydrate = useCallback((p: Rec) => {
    setTiming(str(pick(p, "targetTiming", "timing", "targetExitTiming")));
    const bt = pick(p, "buyerTypes", "targetBuyerTypes");
    setBuyerTypes(Array.isArray(bt) ? bt.map(String).join(", ") : str(bt));
    setNotes(str(pick(p, "notes")));
    const tv = num(pick(p, "targetValue", "targetEnterpriseValue"));
    setTargetValue(tv === null ? "" : String(tv));
    setBrokers(
      rowsFrom(p, "brokerContacts", "brokers").map((b) => ({
        name: str(pick(b, "name")),
        firm: str(pick(b, "firm", "company")),
        email: str(pick(b, "email")),
        phone: str(pick(b, "phone")),
      }))
    );
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadFailed(false);
    try {
      const d = await api<Rec>(base);
      const p = (pick(d, "exitPlan", "plan") ?? d) as Rec;
      setPlan(p);
      hydrate(p);
    } catch {
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, [base, hydrate]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    if (saving) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const d = await api<Rec>(base, {
        method: "PUT",
        body: JSON.stringify({
          targetTiming: timing.trim() || undefined,
          buyerTypes: buyerTypes
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
          notes,
          targetValue: parseNum(targetValue),
          brokerContacts: brokers.filter((b) => b.name.trim()),
        }),
      });
      const p = (pick(d, "exitPlan", "plan") ?? d) as Rec;
      setPlan(p);
      hydrate(p);
      setNotice("Exit plan saved.");
    } catch {
      setError("Could not save the exit plan.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <SkeletonRows rows={5} />;
  if (loadFailed) return <ErrorState onRetry={() => void load()} />;

  const readiness = plan ? num(pick(plan, "readinessScore", "readiness")) : null;
  const planTarget = plan ? num(pick(plan, "targetValue", "targetEnterpriseValue")) : null;
  const summaryRows = plan
    ? scalarEntries(
        Object.fromEntries(
          Object.entries(plan).filter(
            ([k]) =>
              ![
                "buyerTypes",
                "targetBuyerTypes",
                "brokerContacts",
                "brokers",
                "notes",
                "readinessScore",
                "readiness",
                "targetValue",
                "targetEnterpriseValue",
              ].includes(k)
          )
        ) as Rec,
        fmtMoneyN
      )
    : [];
  const hasPlan = Boolean(plan && Object.keys(plan).length > 0);

  return (
    <div className="space-y-5">
      <ErrorBanner message={error} />
      {notice && (
        <p role="status" className="rounded-xl bg-emerald-500/10 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-300">
          {notice}
        </p>
      )}

      <Section title="Exit readiness" caption="The plan as the server holds it — readiness and targets are rendered as served, never scored here.">
        {!hasPlan ? (
          <EmptyState
            title="No exit plan yet"
            message="Draft the first plan below — timing, likely buyer types, a target value and broker contacts."
          />
        ) : (
          <div className="space-y-4">
            {(readiness !== null || planTarget !== null) && (
              <div className="grid grid-cols-2 gap-4">
                {readiness !== null && (
                  <div className="card-surface p-4">
                    <StatTile
                      label="Readiness"
                      display={String(Math.round(readiness))}
                      numericValue={Math.round(readiness)}
                      format={(n) => String(n)}
                      caption="Server-scored, 0–100"
                    />
                  </div>
                )}
                {planTarget !== null && (
                  <div className="card-surface p-4">
                    <StatTile
                      label="Target value"
                      display={fmtMoneyC(planTarget)}
                      title={fmtMoneyN(planTarget)}
                      caption="Target enterprise value"
                    />
                  </div>
                )}
              </div>
            )}
            {summaryRows.length > 0 && <KeyValues rows={summaryRows} />}
            {str(pick(plan ?? {}, "notes")) && (
              <p className="whitespace-pre-wrap text-sm text-slate-600 dark:text-white/70">
                {str(pick(plan ?? {}, "notes"))}
              </p>
            )}
          </div>
        )}
      </Section>

      <Section title="Plan editor" caption="Timing, buyer types and notes — saved together with the broker list below.">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className={labelCls}>Target timing</label>
            <input className={`${inputCls} min-h-[44px]`} value={timing} onChange={(e) => setTiming(e.target.value)} placeholder="e.g. Q2 2028" />
          </div>
          <div>
            <label className={labelCls}>Target value ($)</label>
            <input inputMode="numeric" className={`${inputCls} min-h-[44px]`} value={targetValue} onChange={(e) => setTargetValue(e.target.value)} />
          </div>
          <div className="sm:col-span-2">
            <label className={labelCls}>Buyer types (comma-separated)</label>
            <input className={`${inputCls} min-h-[44px]`} value={buyerTypes} onChange={(e) => setBuyerTypes(e.target.value)} placeholder="Strategic, sponsor platform, sponsor add-on" />
          </div>
          <div className="sm:col-span-2">
            <label className={labelCls}>Notes</label>
            <textarea className={`${inputCls} min-h-[96px]`} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Process notes, preparation workstreams, sensitivities…" />
          </div>
        </div>

        <div className="mt-5 border-t border-slate-100 pt-4 dark:border-white/5">
          <h4 className="text-sm font-semibold text-[#0d1f3c] dark:text-white">Broker contacts</h4>
          {brokers.length === 0 ? (
            <p className="mt-2 text-sm text-slate-500 dark:text-white/50">No broker contacts recorded.</p>
          ) : (
            <div className="mt-2">
              <SimpleTable
                rows={brokers as unknown as Rec[]}
                rowKey={(_, i) => String(i)}
                columns={[
                  { key: "name", label: "Name", value: (r) => str(pick(r, "name")) || "—" },
                  { key: "firm", label: "Firm", value: (r) => str(pick(r, "firm")) || "—" },
                  { key: "email", label: "Email", value: (r) => str(pick(r, "email")) || "—" },
                  { key: "phone", label: "Phone", value: (r) => str(pick(r, "phone")) || "—" },
                  {
                    key: "actions",
                    label: "Actions",
                    render: (r) => (
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm min-h-[44px]"
                        onClick={() =>
                          setBrokers((bs) => bs.filter((b) => !(b.name === str(pick(r, "name")) && b.email === str(pick(r, "email")))))
                        }
                      >
                        Remove
                      </button>
                    ),
                  },
                ]}
              />
            </div>
          )}
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1fr_1fr_auto] lg:items-end">
            <div>
              <label className={labelCls}>Name</label>
              <input className={`${inputCls} min-h-[44px]`} value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} />
            </div>
            <div>
              <label className={labelCls}>Firm</label>
              <input className={`${inputCls} min-h-[44px]`} value={draft.firm} onChange={(e) => setDraft((d) => ({ ...d, firm: e.target.value }))} />
            </div>
            <div>
              <label className={labelCls}>Email</label>
              <input type="email" className={`${inputCls} min-h-[44px]`} value={draft.email} onChange={(e) => setDraft((d) => ({ ...d, email: e.target.value }))} />
            </div>
            <div>
              <label className={labelCls}>Phone</label>
              <input className={`${inputCls} min-h-[44px]`} value={draft.phone} onChange={(e) => setDraft((d) => ({ ...d, phone: e.target.value }))} />
            </div>
            <Button
              variant="secondary"
              className="min-h-[44px]"
              disabled={!draft.name.trim()}
              onClick={() => {
                setBrokers((bs) => [...bs, draft]);
                setDraft(BROKER_EMPTY);
              }}
            >
              Add broker
            </Button>
          </div>
          <p className="mt-2 text-xs text-slate-400 dark:text-white/40">
            Brokers are staged locally — they save with the plan when you click Save exit plan.
          </p>
        </div>

        <div className="mt-5">
          <Button className="min-h-[44px]" loading={saving} onClick={() => void save()}>
            Save exit plan
          </Button>
        </div>
      </Section>
    </div>
  );
}

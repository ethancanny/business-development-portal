"use client";

/**
 * Workspace Overview (redesign Step 1) — one raise at a glance:
 * segmented progress with the math shown, the raise-settings form
 * (moved here from the old Raise tab), key dates, needs-attention
 * items derived from THIS deal's bundle, and a recent-activity feed
 * built only from sources the bundle actually carries (bundle
 * activity when present, otherwise commitment/report timestamps —
 * labeled as such, never invented).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, EmptyState, ErrorState, SkeletonRows, StatTile } from "@/components/ui";
import {
  cardCls,
  fmtDateShort,
  fmtMoneyCompact,
  fmtMoneyN,
  fmtPct,
  fmtUpdated,
  inputCls,
  labelCls,
  parseNum,
  selectCls,
  type CapitalTabProps,
} from "@/components/capital/types";
import {
  bucketAmount,
  createRaise,
  docStatusOf,
  fetchBundle,
  lastTouchOf,
  pipelineStageOf,
  saveRaise,
  type WorkspaceBundle,
} from "@/components/capital/workspace/shared";

const SEGMENTS = [
  { key: "funded", label: "Funded", cls: "bg-[#0d1f3c] dark:bg-[#b8975a]" },
  { key: "hard", label: "Hard (unfunded)", cls: "bg-[#b8975a]" },
  { key: "soft", label: "Soft-circled", cls: "bg-[#d4b37a]" },
  { key: "indicated", label: "Indicated", cls: "bg-slate-300 dark:bg-white/25" },
] as const;

export default function WorkspaceOverview({ dealId, refreshSummary }: CapitalTabProps) {
  const [bundle, setBundle] = useState<WorkspaceBundle | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");

  const [form, setForm] = useState({
    targetRaise: "",
    status: "open",
    entityName: "",
    nextMilestone: "",
    nextMilestoneDate: "",
    notes: "",
  });
  const [saving, setSaving] = useState(false);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadFailed(false);
    try {
      const b = await fetchBundle(dealId);
      setBundle(b);
      if (b.raise) {
        setForm({
          targetRaise: String(b.raise.targetRaise ?? b.summary?.targetRaise ?? ""),
          status: b.raise.status ?? "open",
          entityName: b.raise.entityName ?? "",
          nextMilestone: b.raise.nextMilestone ?? "",
          nextMilestoneDate: (b.raise.nextMilestoneDate ?? "").slice(0, 10),
          notes: b.raise.notes ?? "",
        });
      }
    } catch {
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, [dealId]);

  useEffect(() => {
    void load();
  }, [load]);

  const derived = useMemo(() => {
    if (!bundle) return null;
    const { commitments, summary, raise } = bundle;
    const target = summary?.targetRaise ?? raise?.targetRaise ?? 0;
    // Bar segments count each dollar once, by the investor's current
    // pipeline stage bucket; the figures are the stored summary's.
    const seg = { indicated: 0, soft: 0, hard: 0, funded: 0 };
    for (const c of commitments) {
      const stage = pipelineStageOf(c);
      if (stage === "passed") continue;
      if (stage === "funded") seg.funded += bucketAmount(c, "funded") || bucketAmount(c, "hard");
      else if (stage === "committed") seg.hard += bucketAmount(c, "hard");
      else if (stage === "soft_circled") seg.soft += bucketAmount(c, "soft");
      else seg.indicated += bucketAmount(c, "indicated") || bucketAmount(c, "soft");
    }
    const totals = {
      indicated: summary?.indicatedTotal ?? commitments.reduce((s, c) => s + bucketAmount(c, "indicated"), 0),
      soft: summary?.softTotal ?? 0,
      hard: summary?.hardTotal ?? 0,
      funded: summary?.fundedTotal ?? 0,
    };
    const attention: Array<{ kind: string; text: string }> = [];
    const now = Date.now();
    for (const c of commitments) {
      if (pipelineStageOf(c) === "passed") continue;
      const name = c.investorName || "Investor";
      const doc = docStatusOf(c);
      if (doc === "draft" || doc === "sent") {
        attention.push({ kind: "doc", text: `${name} — document ${doc}, awaiting signature` });
      }
      const hard = bucketAmount(c, "hard");
      const funded = bucketAmount(c, "funded");
      if (hard > 0 && funded < hard) {
        attention.push({
          kind: "funding",
          text: `${name} — ${fmtMoneyN(hard - funded)} of ${fmtMoneyN(hard)} hard commitment not yet funded`,
        });
      }
      const touch = lastTouchOf(bundle, c);
      if (touch) {
        const days = Math.floor((now - new Date(touch).getTime()) / 86400000);
        if (days >= 14) {
          attention.push({
            kind: "stale",
            text: `${name} — last touch ${days} days ago (${fmtDateShort(touch)})`,
          });
        }
      }
    }
    const keyDates: Array<{ label: string; date: string }> = [];
    if (raise?.nextMilestoneDate) {
      keyDates.push({
        label: raise.nextMilestone ? `Milestone — ${raise.nextMilestone}` : "Next milestone",
        date: raise.nextMilestoneDate,
      });
    }
    for (const c of commitments) {
      if (c.expectedFundingDate) {
        keyDates.push({
          label: `Expected funding — ${c.investorName || "Investor"}`,
          date: c.expectedFundingDate,
        });
      }
    }
    const dealRec = (bundle.deal ?? {}) as Record<string, unknown>;
    const targetClose =
      (typeof dealRec.targetCloseDate === "string" && dealRec.targetCloseDate) ||
      (typeof dealRec.targetClose === "string" && dealRec.targetClose) ||
      (typeof dealRec.closingDate === "string" && dealRec.closingDate) ||
      "";
    if (targetClose) keyDates.push({ label: "Target close (deal)", date: targetClose });
    const icRec = bundle.ic as Record<string, unknown> | null;
    const icDate =
      (typeof icRec?.nextDate === "string" && (icRec.nextDate as string)) ||
      (typeof dealRec.icDate === "string" && (dealRec.icDate as string)) ||
      "";
    if (icDate) keyDates.push({ label: "IC date", date: icDate });
    keyDates.sort((a, b) => a.date.localeCompare(b.date));

    // Activity: bundle activity verbatim when present; otherwise the
    // commitments' own update stamps + reporting entries, labeled.
    const feed: Array<{ text: string; at: string; source: string }> = [];
    if (bundle.activity.length > 0) {
      for (const a of bundle.activity) {
        feed.push({
          text: String(a.message ?? a.text ?? a.kind ?? "Activity"),
          at: String(a.createdAt ?? a.at ?? ""),
          source: "bundle activity",
        });
      }
    } else {
      for (const c of commitments) {
        if (c.updatedAt) {
          feed.push({
            text: `Commitment updated — ${c.investorName || "Investor"}`,
            at: c.updatedAt,
            source: "commitment record",
          });
        }
      }
      const entries = (bundle.reporting?.entries ?? []) as Array<Record<string, unknown>>;
      if (Array.isArray(entries)) {
        for (const e of entries) {
          feed.push({
            text: `Reporting — ${String(e.entryType ?? "entry")}${e.investorName ? ` · ${String(e.investorName)}` : ""}`,
            at: String(e.asOf ?? e.createdAt ?? ""),
            source: "reporting entry",
          });
        }
      }
    }
    feed.sort((a, b) => b.at.localeCompare(a.at));
    return { target, seg, totals, attention, keyDates, feed: feed.slice(0, 8) };
  }, [bundle]);

  if (loading) return <SkeletonRows rows={5} />;
  if (loadFailed || !bundle || !derived) return <ErrorState onRetry={() => void load()} />;

  const { raise, summary } = bundle;
  const { target, seg, totals } = derived;
  const segTotal = seg.indicated + seg.soft + seg.hard + seg.funded;
  const remainingHard = Math.max(0, target - totals.hard);

  const onSave = async () => {
    if (saving) return;
    setSaving(true);
    setError("");
    setNote("");
    try {
      if (raise) {
        await saveRaise(dealId, {
          targetRaise: parseNum(form.targetRaise) ?? undefined,
          status: form.status,
          entityName: form.entityName.trim(),
          nextMilestone: form.nextMilestone.trim(),
          nextMilestoneDate: form.nextMilestoneDate || null,
          notes: form.notes.trim(),
        });
        setNote("Raise settings saved.");
      } else {
        setCreating(true);
        await createRaise(dealId, {
          targetRaise: parseNum(form.targetRaise) ?? 0,
          entityName: form.entityName.trim() || undefined,
          nextMilestone: form.nextMilestone.trim() || undefined,
          nextMilestoneDate: form.nextMilestoneDate || undefined,
          notes: form.notes.trim(),
        });
        setNote("Raise opened.");
      }
      await load();
      refreshSummary?.();
    } catch {
      setError(raise ? "Could not save the raise settings." : "Could not open the raise — this deal may already have one.");
    } finally {
      setSaving(false);
      setCreating(false);
    }
  };

  const pct = (v: number) => (target > 0 ? v / target : 0);

  return (
    <div className="space-y-5">
      {error && (
        <p role="alert" className="rounded-xl bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-300">{error}</p>
      )}
      {note && (
        <p className="rounded-xl bg-emerald-500/10 px-4 py-3 text-sm text-emerald-800 dark:text-emerald-200">{note}</p>
      )}

      {!raise ? (
        <div className={cardCls}>
          <h3 className="font-display text-lg font-semibold text-[#0d1f3c] dark:text-white">No raise open for this deal</h3>
          <p className="mt-2 max-w-2xl text-sm text-slate-500 dark:text-white/50">
            Opening a raise sets the target and starts the commitment book. Fill in the settings below and open it.
          </p>
        </div>
      ) : (
        <>
          {/* Progress */}
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
            <div className="card-surface p-4"><StatTile label="Target raise" display={fmtMoneyN(target)} caption={`Raise is ${raise.status}`} /></div>
            <div className="card-surface p-4"><StatTile label="Indicated" display={fmtMoneyCompact(totals.indicated)} title={fmtMoneyN(totals.indicated)} caption={`${fmtPct(pct(totals.indicated))} of target`} /></div>
            <div className="card-surface p-4"><StatTile label="Soft-circled" display={fmtMoneyCompact(totals.soft)} title={fmtMoneyN(totals.soft)} caption={`${fmtPct(pct(totals.soft))} of target`} /></div>
            <div className="card-surface p-4"><StatTile label="Hard-committed" display={fmtMoneyCompact(totals.hard)} title={fmtMoneyN(totals.hard)} caption={`${fmtPct(pct(totals.hard))} of target`} /></div>
            <div className="card-surface p-4"><StatTile label="Funded" display={fmtMoneyCompact(totals.funded)} title={fmtMoneyN(totals.funded)} caption={`${fmtPct(pct(totals.funded))} of target · ${summary?.investorCount ?? bundle.commitments.length} investors`} /></div>
          </div>
          <div className="card-surface p-4" aria-label="Raise progress by stage">
            <div className="flex h-3 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-white/10">
              {SEGMENTS.map((s) => {
                const v = s.key === "funded" ? seg.funded : s.key === "hard" ? seg.hard : s.key === "soft" ? seg.soft : seg.indicated;
                const w = target > 0 ? Math.min(100, (v / target) * 100) : 0;
                return v > 0 ? <div key={s.key} className={`h-full ${s.cls}`} style={{ width: `${w}%` }} title={`${s.label}: ${fmtMoneyN(v)}`} /> : null;
              })}
            </div>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500 dark:text-white/50">
              {SEGMENTS.map((s) => {
                const v = s.key === "funded" ? seg.funded : s.key === "hard" ? seg.hard : s.key === "soft" ? seg.soft : seg.indicated;
                return <span key={s.key}>{s.label} {fmtMoneyN(v)} ({fmtPct(pct(v))})</span>;
              })}
              <span>Remaining vs hard {fmtMoneyN(remainingHard)}</span>
            </div>
            <p className="mt-1 text-xs text-slate-400 dark:text-white/40">
              Math: each segment is that stage bucket ÷ {fmtMoneyN(target)} target. The bar counts each
              investor&apos;s dollars once, at their current stage (stage buckets from the commitment
              book sum to {fmtMoneyN(segTotal)}); the tiles are the stored raise summary totals.
            </p>
          </div>
        </>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        {/* Key dates */}
        <div className={cardCls}>
          <h3 className="font-display text-lg font-semibold text-[#0d1f3c] dark:text-white">Key dates</h3>
          {derived.keyDates.length === 0 ? (
            <p className="mt-2 text-sm text-slate-500 dark:text-white/50">
              No key dates on this raise yet — set the next milestone below, and expected funding dates in the Book.
            </p>
          ) : (
            <ul className="mt-3 space-y-2">
              {derived.keyDates.map((d, i) => (
                <li key={`${d.label}-${i}`} className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2 text-sm dark:border-white/5">
                  <span className="text-slate-600 dark:text-white/80">{d.label}</span>
                  <span className="font-semibold text-[#0d1f3c] dark:text-white">{fmtDateShort(d.date)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Needs attention */}
        <div className={cardCls}>
          <h3 className="font-display text-lg font-semibold text-[#0d1f3c] dark:text-white">Needs attention</h3>
          {derived.attention.length === 0 ? (
            <div className="mt-3">
              <EmptyState title="Nothing flagged" message="No unsigned documents, unfunded hard commitments, or stale touches (14+ days) among this raise's participants in the current bundle." />
            </div>
          ) : (
            <ul className="mt-3 space-y-2">
              {derived.attention.map((a, i) => (
                <li key={i} className="rounded-xl bg-amber-500/10 px-3 py-2 text-sm text-amber-900 dark:text-amber-200">{a.text}</li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Recent activity */}
      <div className={cardCls}>
        <h3 className="font-display text-lg font-semibold text-[#0d1f3c] dark:text-white">Recent activity</h3>
        {derived.feed.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500 dark:text-white/50">No activity recorded in this bundle yet.</p>
        ) : (
          <ul className="mt-3 space-y-2.5">
            {derived.feed.map((f, i) => (
              <li key={i} className="border-l-2 border-[#b8975a]/50 pl-3">
                <p className="text-sm text-slate-600 dark:text-white/80">{f.text}</p>
                <p className="text-xs text-slate-400 dark:text-white/40">
                  {f.at ? fmtUpdated(f.at) : "—"} · source: {f.source}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Raise settings (moved from the old Raise tab) */}
      <div className={cardCls}>
        <h3 className="font-display text-lg font-semibold text-[#0d1f3c] dark:text-white">Raise settings</h3>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <label className={labelCls}>Target raise ($)</label>
            <input inputMode="numeric" className={`${inputCls} min-h-[44px]`} value={form.targetRaise} onChange={(e) => setForm((f) => ({ ...f, targetRaise: e.target.value }))} placeholder="5,000,000" />
          </div>
          <div>
            <label className={labelCls}>Status</label>
            <select className={`${selectCls} min-h-[44px]`} value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}>
              <option value="open">Open</option>
              <option value="closed">Closed</option>
            </select>
          </div>
          <div>
            <label className={labelCls}>Entity / SPV name</label>
            <input className={`${inputCls} min-h-[44px]`} value={form.entityName} onChange={(e) => setForm((f) => ({ ...f, entityName: e.target.value }))} placeholder="Canny … SPV LLC" />
          </div>
          <div>
            <label className={labelCls}>Next milestone</label>
            <input className={`${inputCls} min-h-[44px]`} value={form.nextMilestone} onChange={(e) => setForm((f) => ({ ...f, nextMilestone: e.target.value }))} placeholder="First close, IC, signing…" />
          </div>
          <div>
            <label className={labelCls}>Milestone date</label>
            <input type="date" className={`${inputCls} min-h-[44px]`} value={form.nextMilestoneDate} onChange={(e) => setForm((f) => ({ ...f, nextMilestoneDate: e.target.value }))} />
          </div>
          <div>
            <label className={labelCls}>Notes</label>
            <input className={`${inputCls} min-h-[44px]`} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} placeholder="Structure, timing, minimum check…" />
          </div>
        </div>
        <div className="mt-4">
          <Button onClick={() => void onSave()} loading={saving || creating} className="min-h-[44px]">
            {raise ? "Save raise" : "Open raise"}
          </Button>
        </div>
      </div>
    </div>
  );
}

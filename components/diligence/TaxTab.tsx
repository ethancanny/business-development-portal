"use client";

/**
 * Tax diligence profile — entity/elections/nexus/exposures, NOLs and
 * credits, the live missing-return-years check (recomputed server
 * side from data room evidence on every read), and the §338(h)(10)
 * election-readiness checklist.
 */

import { useCallback, useEffect, useState } from "react";
import { Button, ErrorState, SkeletonRows } from "@/components/ui";
import {
  api,
  cardCls,
  inputCls,
  labelCls,
  splitList,
  type TabProps,
} from "@/components/diligence/types";

export const SECTION_338_ITEMS: Array<{ key: string; label: string }> = [
  { key: "target_is_corp", label: "Target is a corporation (C or S corp)" },
  { key: "buyer_is_corp", label: "Purchasing party is a corporation" },
  {
    key: "qsp",
    label: "Qualified stock purchase (≥80% vote & value) within 12 months",
  },
  {
    key: "election_deadline",
    label:
      "Election filed by the 15th day of the 9th month after the acquisition month",
  },
  {
    key: "s_corp_consent",
    label: "For an S corp: all shareholders consent to the election",
  },
  {
    key: "form_8023",
    label: "Form 8023 prepared / reviewed by tax counsel",
  },
];

interface TaxProfile {
  entityType: string;
  elections: string[];
  nexusStates: string[];
  salesTaxExposure: string;
  nolAmount: number | null;
  nolNotes: string;
  credits: string;
  rdCredits: string;
  section338: Record<string, boolean>;
  missingReturnYears: number[];
  notes: string;
}

interface TaxResponse {
  profile: TaxProfile;
  missingYearsLive: number[];
  roomId: string | null;
}

export default function TaxTab({ workspaceId }: TabProps) {
  const [data, setData] = useState<TaxResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);

  const [entityType, setEntityType] = useState("");
  const [elections, setElections] = useState("");
  const [nexusStates, setNexusStates] = useState("");
  const [salesTaxExposure, setSalesTaxExposure] = useState("");
  const [nolAmount, setNolAmount] = useState("");
  const [nolNotes, setNolNotes] = useState("");
  const [credits, setCredits] = useState("");
  const [rdCredits, setRdCredits] = useState("");
  const [notes, setNotes] = useState("");
  const [section338, setSection338] = useState<Record<string, boolean>>({});

  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setLoadFailed(false);
    try {
      const d = await api<TaxResponse>(
        `/api/platform/diligence/workspaces/${encodeURIComponent(workspaceId)}/tax`
      );
      setData(d);
      const p = d.profile;
      setEntityType(p.entityType ?? "");
      setElections((p.elections ?? []).join(", "));
      setNexusStates((p.nexusStates ?? []).join(", "));
      setSalesTaxExposure(p.salesTaxExposure ?? "");
      setNolAmount(p.nolAmount === null || p.nolAmount === undefined ? "" : String(p.nolAmount));
      setNolNotes(p.nolNotes ?? "");
      setCredits(p.credits ?? "");
      setRdCredits(p.rdCredits ?? "");
      setNotes(p.notes ?? "");
      setSection338(p.section338 ?? {});
    } catch {
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    setSaving(true);
    setError("");
    setSavedMsg("");
    try {
      const d = await api<TaxResponse>(
        `/api/platform/diligence/workspaces/${encodeURIComponent(workspaceId)}/tax`,
        {
          method: "PUT",
          body: JSON.stringify({
            entityType,
            elections: splitList(elections),
            nexusStates: splitList(nexusStates),
            salesTaxExposure,
            nolAmount: nolAmount.trim() === "" ? null : Number(nolAmount),
            nolNotes,
            credits,
            rdCredits,
            section338,
            notes,
          }),
        }
      );
      setData((cur) => (cur ? { ...cur, profile: d.profile } : cur));
      setSavedMsg("Tax profile saved.");
    } catch {
      setError("Could not save the tax profile. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <SkeletonRows rows={5} />;
  if (loadFailed || !data) return <ErrorState onRetry={() => void load()} />;

  const missing = data.missingYearsLive ?? [];
  const s338Done = SECTION_338_ITEMS.filter((i) => section338[i.key]).length;

  return (
    <div className="space-y-5">
      {error && (
        <p className="rounded-xl bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-300">
          {error}
        </p>
      )}

      {/* Missing return years — live from data room evidence */}
      {data.roomId === null ? (
        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-5 py-4 text-sm text-slate-600 dark:border-white/10 dark:bg-white/5 dark:text-white/60">
          <strong>No data room linked</strong> — the missing-year check is
          unavailable until this deal has a data room with tax return evidence.
        </div>
      ) : missing.length > 0 ? (
        <div className="rounded-2xl border border-red-300 bg-red-50 px-5 py-4 dark:border-red-500/40 dark:bg-red-500/10">
          <p className="font-display text-lg font-semibold text-red-800 dark:text-red-200">
            Missing tax returns: {missing.join(", ")}
          </p>
          <p className="mt-1 text-sm text-red-700 dark:text-red-300">
            No return evidence for these years was found in the data room.
            Request the returns from the seller before relying on the tax
            profile below.
          </p>
          <p className="mt-1 text-xs text-red-600/80 dark:text-red-300/70">
            From data room evidence — recomputed live on every read.
          </p>
        </div>
      ) : (
        <div className="rounded-2xl border border-emerald-300 bg-emerald-50 px-5 py-4 dark:border-emerald-500/40 dark:bg-emerald-500/10">
          <p className="font-display text-lg font-semibold text-emerald-800 dark:text-emerald-200">
            No missing return years detected
          </p>
          <p className="mt-1 text-xs text-emerald-700/80 dark:text-emerald-300/70">
            From data room evidence — recomputed live on every read.
          </p>
        </div>
      )}

      <div className={cardCls}>
        <h3 className="font-display text-lg font-semibold text-[#0d1f3c] dark:text-white">
          Tax profile
        </h3>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <label className={labelCls}>Entity type</label>
            <input className={inputCls} value={entityType} onChange={(e) => setEntityType(e.target.value)} placeholder="S corp / C corp / LLC (partnership) / LLC (disregarded)…" />
          </div>
          <div>
            <label className={labelCls}>Elections (comma-separated)</label>
            <input className={inputCls} value={elections} onChange={(e) => setElections(e.target.value)} placeholder="S election, §83(b), …" />
          </div>
          <div>
            <label className={labelCls}>Nexus states (comma-separated)</label>
            <input className={inputCls} value={nexusStates} onChange={(e) => setNexusStates(e.target.value)} placeholder="AZ, CA, NV" />
          </div>
          <div>
            <label className={labelCls}>NOL amount (USD)</label>
            <input type="number" className={inputCls} value={nolAmount} onChange={(e) => setNolAmount(e.target.value)} placeholder="0" />
          </div>
          <div className="sm:col-span-2">
            <label className={labelCls}>Sales & use tax exposure</label>
            <textarea className={`${inputCls} min-h-[70px]`} value={salesTaxExposure} onChange={(e) => setSalesTaxExposure(e.target.value)} placeholder="Nexus without registration, uncollected tax periods, marketplace sales…" />
          </div>
          <div className="sm:col-span-2">
            <label className={labelCls}>NOL notes</label>
            <textarea className={`${inputCls} min-h-[60px]`} value={nolNotes} onChange={(e) => setNolNotes(e.target.value)} placeholder="Vintage, §382 limits, state conformity…" />
          </div>
          <div>
            <label className={labelCls}>Credits</label>
            <textarea className={`${inputCls} min-h-[60px]`} value={credits} onChange={(e) => setCredits(e.target.value)} placeholder="Carryforwards, transferability, expiry" />
          </div>
          <div>
            <label className={labelCls}>R&D credits</label>
            <textarea className={`${inputCls} min-h-[60px]`} value={rdCredits} onChange={(e) => setRdCredits(e.target.value)} placeholder="Federal/state R&D credit studies and amounts" />
          </div>
          <div className="sm:col-span-2">
            <label className={labelCls}>Notes</label>
            <textarea className={`${inputCls} min-h-[60px]`} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>
      </div>

      <div className={cardCls}>
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="font-display text-lg font-semibold text-[#0d1f3c] dark:text-white">
            §338(h)(10) election readiness
          </h3>
          <span className="text-xs text-slate-500 dark:text-white/50">
            {s338Done}/{SECTION_338_ITEMS.length} confirmed
          </span>
        </div>
        <ul className="mt-3 space-y-2.5">
          {SECTION_338_ITEMS.map((item) => (
            <li key={item.key}>
              <label className="flex cursor-pointer items-start gap-2.5 text-sm text-[#0d1f3c] dark:text-white/90">
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 shrink-0 accent-[#b8975a]"
                  checked={Boolean(section338[item.key])}
                  onChange={(e) =>
                    setSection338((s) => ({ ...s, [item.key]: e.target.checked }))
                  }
                />
                {item.label}
              </label>
            </li>
          ))}
        </ul>
      </div>

      <div className="flex items-center gap-3">
        <Button onClick={() => void save()} loading={saving}>
          Save tax profile
        </Button>
        {savedMsg && (
          <span className="text-sm text-emerald-700 dark:text-emerald-300">{savedMsg}</span>
        )}
      </div>
    </div>
  );
}

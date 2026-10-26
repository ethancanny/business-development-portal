"use client";

/**
 * New raise dialog (Step 1 redesign) — pick a deal that has no open
 * raise, set an optional target, and create the raise through the
 * existing route (POST /api/platform/capital/deals/[dealId]/raise,
 * the same contract RaiseTab uses), then land in the raise
 * workspace. A 409 from the API means the deal already has a raise.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import CompanyMark from "@/components/identity/CompanyMark";
import {
  API,
  api,
  inputCls,
  labelCls,
  parseNum,
  selectCls,
} from "@/components/capital/types";
import type { ExtCapitalDeal } from "./shared";

export default function NewRaiseDialog({
  open,
  candidates,
  onClose,
}: {
  open: boolean;
  candidates: ExtCapitalDeal[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [dealId, setDealId] = useState("");
  const [target, setTarget] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) {
      setDealId(candidates[0]?.dealId ?? "");
      setTarget("");
      setError("");
      setCreating(false);
    }
  }, [open, candidates]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const selected = candidates.find((c) => c.dealId === dealId) ?? null;

  const create = async () => {
    if (!dealId || creating) return;
    setCreating(true);
    setError("");
    try {
      await api(`${API}/deals/${encodeURIComponent(dealId)}/raise`, {
        method: "POST",
        body: JSON.stringify({ targetRaise: parseNum(target) ?? 0 }),
      });
      onClose();
      router.push(`/investors-capital/${encodeURIComponent(dealId)}`);
    } catch {
      setError("Could not open the raise. This deal may already have an open raise.");
      setCreating(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-[#0d1f3c]/50 p-0 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label="New raise"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-t-2xl bg-white p-5 shadow-xl dark:bg-[#101b30] sm:rounded-2xl sm:p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <h2 className="font-display text-2xl font-semibold text-[#0d1f3c] dark:text-white">
            New raise
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="btn btn-ghost btn-sm min-h-[44px] min-w-[44px]"
          >
            ✕
          </button>
        </div>

        {candidates.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500 dark:text-white/50">
            Every deal already has an open raise. New deals appear here as they enter the
            pipeline.
          </p>
        ) : (
          <div className="mt-4 space-y-4">
            <div>
              <label className={labelCls} htmlFor="new-raise-deal">
                Deal
              </label>
              <select
                id="new-raise-deal"
                className={`${selectCls} min-h-[44px]`}
                value={dealId}
                onChange={(e) => setDealId(e.target.value)}
              >
                {candidates.map((d) => (
                  <option key={d.dealId} value={d.dealId}>
                    {d.dealName || d.companyName || "Deal"}
                    {d.stage ? ` — ${d.stage}` : ""}
                  </option>
                ))}
              </select>
              {selected && (
                <p className="mt-2 flex items-center gap-2 text-sm text-slate-500 dark:text-white/50">
                  <CompanyMark
                    companyId={selected.companyId}
                    name={selected.dealName || selected.companyName}
                    logoVersion={selected.logoVersion ?? 0}
                    size={22}
                  />
                  {selected.companyName || selected.dealName}
                  {selected.investmentType ? ` · ${selected.investmentType.label}` : ""}
                </p>
              )}
            </div>
            <div>
              <label className={labelCls} htmlFor="new-raise-target">
                Target raise (optional)
              </label>
              <input
                id="new-raise-target"
                inputMode="numeric"
                className={`${inputCls} min-h-[44px]`}
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                placeholder="5,000,000"
              />
            </div>
            {error && (
              <p role="alert" className="text-sm text-red-600 dark:text-red-300">
                {error}
              </p>
            )}
            <div className="flex flex-wrap gap-2 pt-1">
              <button
                type="button"
                disabled={!dealId || creating}
                onClick={() => void create()}
                className="btn btn-primary btn-sm min-h-[44px]"
              >
                {creating ? "Creating…" : "Create raise"}
              </button>
              <button
                type="button"
                onClick={onClose}
                className="btn btn-secondary btn-sm min-h-[44px]"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

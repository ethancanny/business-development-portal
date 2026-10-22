"use client";

/**
 * Exit readiness — the five EXIT_AREAS scored 1–5 with notes, an
 * overall score (/100) shown as a big serif number, and the hints
 * panel from the readiness GET (posted-periods count + flags
 * computed server-side from the company's records).
 */

import { useCallback, useEffect, useState } from "react";
import { Button, ErrorState, SkeletonRows } from "@/components/ui";
import {
  API,
  EXIT_AREAS,
  api,
  cardCls,
  inputCls,
  type ExitAreaScore,
  type ExitHints,
  type ExitReadiness,
  type VcTabProps,
} from "@/components/valuecreation/types";

export default function ExitTab({ planId, reload }: VcTabProps) {
  const [areas, setAreas] = useState<Record<string, ExitAreaScore>>({});
  const [overall, setOverall] = useState<number | null>(null);
  const [hints, setHints] = useState<ExitHints | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setLoadFailed(false);
    try {
      const d = await api<{ readiness?: ExitReadiness; hints?: ExitHints }>(
        `${API}/plans/${encodeURIComponent(planId)}/exit-readiness`
      );
      const readiness = d.readiness ?? null;
      setAreas(readiness?.scores ?? readiness?.areas ?? {});
      setOverall(readiness?.overall ?? null);
      setHints(readiness?.hints ?? d.hints ?? null);
    } catch {
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, [planId]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    setSaving(true);
    setError("");
    setSavedMsg("");
    try {
      const full: Record<string, ExitAreaScore> = {};
      for (const a of EXIT_AREAS) {
        full[a.key] = areas[a.key] ?? { score: null, notes: "" };
      }
      const d = await api<{ readiness?: ExitReadiness }>(
        `${API}/plans/${encodeURIComponent(planId)}/exit-readiness`,
        { method: "PATCH", body: JSON.stringify({ scores: full }) }
      );
      if (d.readiness) {
        setAreas(d.readiness.scores ?? full);
        setOverall(d.readiness.overall ?? null);
        if (d.readiness.hints) setHints(d.readiness.hints);
      }
      setSavedMsg("Exit readiness saved.");
      await reload();
    } catch {
      setError("Could not save exit readiness. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <SkeletonRows rows={5} />;
  if (loadFailed) return <ErrorState onRetry={() => void load()} />;

  const scored = EXIT_AREAS.map((a) => areas[a.key]?.score ?? null).filter(
    (s): s is number => typeof s === "number"
  );
  const localOverall =
    scored.length > 0
      ? Math.round((scored.reduce((sum, s) => sum + s, 0) / scored.length / 5) * 100)
      : null;
  const displayOverall = overall ?? localOverall;
  const finHints = hints?.financial_readiness ?? null;
  const flags = finHints?.flags ?? (Array.isArray(hints?.flags) ? hints.flags : []);
  const postedPeriods = finHints?.postedPeriods ?? hints?.postedPeriods;

  return (
    <div className="space-y-5">
      {error && (
        <p role="alert" className="rounded-xl bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-300">{error}</p>
      )}

      <div className={cardCls}>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h3 className="font-display text-lg font-semibold text-[#0d1f3c] dark:text-white">
              Exit readiness
            </h3>
            <p className="mt-0.5 max-w-lg text-sm text-slate-500 dark:text-white/50">
              Score each area 1 (not ready) to 5 (buyer-ready). The overall is the mean score out of 5, expressed out of 100.
            </p>
          </div>
          <div className="text-right">
            <p className="micro-label">Overall</p>
            <p className="tnum font-display text-5xl font-semibold text-[#0d1f3c] dark:text-white">
              {displayOverall === null ? "—" : displayOverall}
              <span className="text-xl text-slate-400 dark:text-white/40"> /100</span>
            </p>
            <p className="text-xs text-slate-500 dark:text-white/50">
              {scored.length} of {EXIT_AREAS.length} areas scored
              {scored.length > 0 && ` · mean ${(scored.reduce((a, b) => a + b, 0) / scored.length).toFixed(1)} / 5`}
            </p>
          </div>
        </div>

        <div className="mt-5 space-y-5">
          {EXIT_AREAS.map((area) => {
            const current = areas[area.key] ?? { score: null, notes: "" };
            return (
              <div key={area.key} className="border-t border-slate-100 pt-4 first:border-t-0 first:pt-0 dark:border-white/5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-[#0d1f3c] dark:text-white">{area.label}</p>
                    <p className="text-xs text-slate-500 dark:text-white/50">{area.hint}</p>
                  </div>
                  <div className="flex items-center gap-1.5" role="radiogroup" aria-label={`Score for ${area.label}`}>
                    {[1, 2, 3, 4, 5].map((n) => {
                      const active = current.score === n;
                      return (
                        <button
                          key={n}
                          type="button"
                          role="radio"
                          aria-checked={active}
                          onClick={() =>
                            setAreas((s) => ({
                              ...s,
                              [area.key]: {
                                score: active ? null : n,
                                notes: s[area.key]?.notes ?? "",
                              },
                            }))
                          }
                          className={`flex h-11 w-11 items-center justify-center rounded-full text-sm font-semibold transition ${
                            active
                              ? "bg-[#0d1f3c] text-white dark:bg-[#b8975a] dark:text-[#0d1f3c]"
                              : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-white/10 dark:text-white/70 dark:hover:bg-white/20"
                          }`}
                        >
                          {n}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <input
                  className={`${inputCls} mt-2.5 min-h-[44px]`}
                  placeholder={`Notes on ${area.label.toLowerCase()}`}
                  value={current.notes}
                  onChange={(e) =>
                    setAreas((s) => ({
                      ...s,
                      [area.key]: {
                        score: s[area.key]?.score ?? null,
                        notes: e.target.value,
                      },
                    }))
                  }
                  aria-label={`Notes for ${area.label}`}
                />
              </div>
            );
          })}
        </div>

        <div className="mt-5 flex items-center gap-3">
          <Button onClick={() => void save()} loading={saving}>
            Save exit readiness
          </Button>
          {savedMsg && <span className="text-sm text-emerald-700 dark:text-emerald-300">{savedMsg}</span>}
        </div>
      </div>

      {hints && (
        <div className={cardCls}>
          <h3 className="font-display text-lg font-semibold text-[#0d1f3c] dark:text-white">
            Readiness hints
          </h3>
          <p className="mt-2 text-sm text-slate-600 dark:text-white/70">
            Posted financial periods on record:{" "}
            <span className="tnum font-semibold text-[#0d1f3c] dark:text-white">
              {typeof postedPeriods === "number" ? postedPeriods : "—"}
            </span>
          </p>
          {finHints?.suggestion && (
            <p className="mt-1 text-sm text-slate-600 dark:text-white/70">
              <span className="font-semibold text-[#0d1f3c] dark:text-white">Financial readiness suggestion: </span>
              {finHints.suggestion}
            </p>
          )}
          {flags.length === 0 ? (
            <p className="mt-1 text-sm text-slate-500 dark:text-white/50">
              No automated flags right now — nothing in the posted records contradicts a buyer-ready posture.
            </p>
          ) : (
            <ul className="mt-2 space-y-1.5">
              {flags.map((f, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-slate-600 dark:text-white/70">
                  <span className="badge badge-warn mt-0.5 shrink-0">Flag</span>
                  <span>{f}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

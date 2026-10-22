"use client";

/**
 * Controls & systems scorecard — five areas scored 1–5 with notes,
 * plus an overall average of the scored areas.
 */

import { useCallback, useEffect, useState } from "react";
import { Button, ErrorState, SkeletonRows } from "@/components/ui";
import {
  api,
  cardCls,
  inputCls,
  labelCls,
  type TabProps,
} from "@/components/diligence/types";

const AREAS: Array<{ key: string; label: string; hint: string }> = [
  {
    key: "accounting_system",
    label: "Accounting system",
    hint: "Platform, version, integrations, chart of accounts quality",
  },
  {
    key: "close_process",
    label: "Close process",
    hint: "Days to close, checklist discipline, review evidence",
  },
  {
    key: "segregation_of_duties",
    label: "Segregation of duties",
    hint: "Who can initiate, approve and record the same transaction",
  },
  {
    key: "soc_reports",
    label: "SOC reports",
    hint: "SOC 1 / SOC 2 availability and exceptions, if applicable",
  },
  {
    key: "it_security",
    label: "IT security basics",
    hint: "MFA, access reviews, backups, endpoint protection",
  },
];

interface Scorecard {
  areas: Record<string, { score: number | null; notes: string }>;
  notes: string;
}

export default function ScorecardTab({ workspaceId }: TabProps) {
  const [areas, setAreas] = useState<Record<string, { score: number | null; notes: string }>>({});
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setLoadFailed(false);
    try {
      const d = await api<{ scorecard: Scorecard }>(
        `/api/platform/diligence/workspaces/${encodeURIComponent(workspaceId)}/scorecard`
      );
      setAreas(d.scorecard.areas ?? {});
      setNotes(d.scorecard.notes ?? "");
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
      const full: Record<string, { score: number | null; notes: string }> = {};
      for (const a of AREAS) {
        full[a.key] = areas[a.key] ?? { score: null, notes: "" };
      }
      await api(`/api/platform/diligence/workspaces/${encodeURIComponent(workspaceId)}/scorecard`, {
        method: "PUT",
        body: JSON.stringify({ areas: full, notes }),
      });
      setSavedMsg("Scorecard saved.");
    } catch {
      setError("Could not save the scorecard. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <SkeletonRows rows={5} />;
  if (loadFailed) return <ErrorState onRetry={() => void load()} />;

  const scored = AREAS.map((a) => areas[a.key]?.score ?? null).filter(
    (s): s is number => typeof s === "number"
  );
  const average =
    scored.length > 0
      ? scored.reduce((sum, s) => sum + s, 0) / scored.length
      : null;

  return (
    <div className="space-y-5">
      {error && (
        <p className="rounded-xl bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-300">
          {error}
        </p>
      )}

      <div className={cardCls}>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h3 className="font-display text-lg font-semibold text-[#0d1f3c] dark:text-white">
              Controls & systems scorecard
            </h3>
            <p className="mt-0.5 text-sm text-slate-500 dark:text-white/50">
              Score each area 1 (weak) to 5 (strong). Leave unscored areas
              blank until they have actually been assessed.
            </p>
          </div>
          <div className="text-right">
            <p className="micro-label">Overall average</p>
            <p className="tnum font-display text-4xl font-semibold text-[#0d1f3c] dark:text-white">
              {average === null ? "—" : average.toFixed(1)}
            </p>
            <p className="text-xs text-slate-500 dark:text-white/50">
              {scored.length} of {AREAS.length} areas scored
            </p>
          </div>
        </div>

        <div className="mt-5 space-y-5">
          {AREAS.map((area) => {
            const current = areas[area.key] ?? { score: null, notes: "" };
            return (
              <div
                key={area.key}
                className="border-t border-slate-100 pt-4 first:border-t-0 first:pt-0 dark:border-white/5"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-[#0d1f3c] dark:text-white">
                      {area.label}
                    </p>
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
                          className={`flex h-9 w-9 items-center justify-center rounded-full text-sm font-semibold transition ${
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
                  className={`${inputCls} mt-2.5`}
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

        <div className="mt-5">
          <label className={labelCls}>Overall notes</label>
          <textarea
            className={`${inputCls} min-h-[70px]`}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Cross-cutting observations, remediation priorities…"
          />
        </div>

        <div className="mt-4 flex items-center gap-3">
          <Button onClick={() => void save()} loading={saving}>
            Save scorecard
          </Button>
          {savedMsg && (
            <span className="text-sm text-emerald-700 dark:text-emerald-300">{savedMsg}</span>
          )}
        </div>
      </div>
    </div>
  );
}

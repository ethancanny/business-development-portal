"use client";

/**
 * Matching weights settings (Investors & Capital Redesign Step 1) —
 * the six point weights behind investor↔raise match scores. Type is
 * the heavyweight: a type mismatch also caps an investor's total
 * score at 49 no matter how the weights are set. Styled after the
 * neighboring ValuationParamsSettings card.
 */

import { useCallback, useEffect, useState } from "react";
import { Button, SkeletonRows } from "@/components/ui";
import {
  API,
  api,
  inputCls,
  labelCls,
  parseNum,
  type MatchingWeights,
} from "@/components/capital/types";

const FIELDS: Array<{
  key: keyof MatchingWeights;
  label: string;
  hint: string;
}> = [
  {
    key: "type",
    label: "Investment type",
    hint: "Invests-in types vs the raise's type. A mismatch caps the score at 49.",
  },
  {
    key: "checkSize",
    label: "Check size",
    hint: "The investor's check range vs a typical check for the raise.",
  },
  {
    key: "sector",
    label: "Sector",
    hint: "Thesis sectors vs the deal's industry (A&D synonyms count).",
  },
  {
    key: "structure",
    label: "Structure",
    hint: "Structure preferences that fit this type of raise.",
  },
  {
    key: "geography",
    label: "Geography",
    hint: "Arizona / Southwest / national scope.",
  },
  {
    key: "activity",
    label: "Activity",
    hint: "Prior commitments with Canny, then recent touches.",
  },
];

export default function MatchingWeightsCard() {
  const [weights, setWeights] = useState<MatchingWeights | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  const apply = useCallback((w: MatchingWeights) => {
    setWeights(w);
    const next: Record<string, string> = {};
    for (const f of FIELDS) next[f.key] = String(w[f.key] ?? "");
    setForm(next);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadFailed(false);
    try {
      const d = await api<{ weights: MatchingWeights }>(
        `${API}/matching-weights`
      );
      apply(d.weights);
    } catch {
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, [apply]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    if (saving) return;
    setSaving(true);
    setError("");
    setSaved(false);
    try {
      const payload: Record<string, number> = {};
      for (const f of FIELDS) {
        const v = parseNum((form[f.key] ?? "").trim());
        if (v !== null) payload[f.key] = v;
      }
      const d = await api<{ weights: MatchingWeights }>(
        `${API}/matching-weights`,
        { method: "PUT", body: JSON.stringify({ weights: payload }) }
      );
      apply(d.weights);
      setSaved(true);
    } catch {
      setError("Could not save the matching weights. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <SkeletonRows rows={3} />;
  if (loadFailed || !weights) {
    return (
      <div>
        <p className="text-sm text-slate-500 dark:text-white/50">
          The matching weights could not be loaded.
        </p>
        <Button
          variant="secondary"
          size="sm"
          className="mt-3 min-h-[44px]"
          onClick={() => void load()}
        >
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div>
      {error && (
        <p
          role="alert"
          className="mb-3 rounded-xl bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-300"
        >
          {error}
        </p>
      )}
      {saved && (
        <p className="mb-3 rounded-xl bg-emerald-500/10 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-300">
          Matching weights saved. New scores use them right away.
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {FIELDS.map((f) => (
          <div key={f.key}>
            <label className={labelCls}>{f.label} (points)</label>
            <input
              inputMode="decimal"
              className={`${inputCls} min-h-[44px]`}
              value={form[f.key] ?? ""}
              onChange={(e) => {
                setSaved(false);
                setForm((st) => ({ ...st, [f.key]: e.target.value }));
              }}
            />
            <p className="mt-1 text-xs text-slate-400 dark:text-white/40">
              {f.hint}
            </p>
          </div>
        ))}
      </div>
      <div className="mt-5">
        <Button
          onClick={() => void save()}
          loading={saving}
          className="min-h-[44px]"
        >
          {saving ? "Saving…" : "Save matching weights"}
        </Button>
      </div>
    </div>
  );
}

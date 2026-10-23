"use client";

/**
 * Stage gates card (Settings; Phase 10): the workflow.gate_rules table
 * grouped by target stage, with an enable/disable toggle per rule.
 * Data from the admin-aware GET /api/platform/settings/gates; toggles
 * write through PUT to the same route ({ rules: [{ id, enabled }] }).
 * A disabled rule no longer blocks stage moves into its target stage;
 * the condition catalog labels/descriptions explain what each rule
 * checks. The coordinator mounts this card on the Settings page.
 */

import { useCallback, useEffect, useMemo, useState } from "react";

interface GateRule {
  id: string;
  targetStage: string;
  conditionKey: string;
  label: string;
  enabled: boolean;
  sort: number;
}

interface GateCondition {
  key: string;
  defaultLabel: string;
  description: string;
}

const STAGE_ORDER = [
  "Sourcing",
  "Initial Contact",
  "Diligence",
  "Negotiation",
  "Closing",
  "Closed Won",
  "Passed",
];

export default function StageGatesCard() {
  const [rules, setRules] = useState<GateRule[]>([]);
  const [conditions, setConditions] = useState<GateCondition[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [savingId, setSavingId] = useState("");
  const [note, setNote] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/platform/settings/gates");
      if (res.status === 401) {
        setError("Sign in required to view stage gates.");
        setRules([]);
        return;
      }
      if (!res.ok) {
        setError("Could not load stage gates.");
        return;
      }
      const data = (await res.json()) as {
        rules?: GateRule[];
        conditions?: GateCondition[];
      };
      setRules(Array.isArray(data.rules) ? data.rules : []);
      setConditions(Array.isArray(data.conditions) ? data.conditions : []);
    } catch {
      setError("Could not load stage gates.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const conditionByKey = useMemo(() => {
    const map = new Map<string, GateCondition>();
    for (const c of conditions) map.set(c.key, c);
    return map;
  }, [conditions]);

  const groups = useMemo(() => {
    const byStage = new Map<string, GateRule[]>();
    for (const rule of rules) {
      const list = byStage.get(rule.targetStage) ?? [];
      list.push(rule);
      byStage.set(rule.targetStage, list);
    }
    return Array.from(byStage.entries()).sort((a, b) => {
      const ia = STAGE_ORDER.indexOf(a[0]);
      const ib = STAGE_ORDER.indexOf(b[0]);
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    });
  }, [rules]);

  const toggle = async (rule: GateRule) => {
    const next = !rule.enabled;
    setSavingId(rule.id);
    setError("");
    setNote("");
    // Optimistic — reverted by the reload on failure.
    setRules((prev) =>
      prev.map((r) => (r.id === rule.id ? { ...r, enabled: next } : r))
    );
    try {
      const res = await fetch("/api/platform/settings/gates", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rules: [{ id: rule.id, enabled: next }] }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        rules?: GateRule[];
        conditions?: GateCondition[];
        error?: string;
      };
      if (res.status === 403) {
        setError("Admins only — your role cannot change stage gates.");
        void load();
        return;
      }
      if (!res.ok) {
        setError(data.error || "Could not save the gate change.");
        void load();
        return;
      }
      if (Array.isArray(data.rules)) setRules(data.rules);
      if (Array.isArray(data.conditions)) setConditions(data.conditions);
      setNote(
        next
          ? `Gate enabled: ${rule.label}`
          : `Gate disabled: ${rule.label} — moves into ${rule.targetStage} no longer check it.`
      );
    } catch {
      setError("Could not save the gate change.");
      void load();
    } finally {
      setSavingId("");
    }
  };

  if (loading) {
    return (
      <div className="space-y-3" aria-busy="true">
        <div className="skel h-10" />
        <div className="skel h-10" />
        <span className="sr-only">Loading stage gates…</span>
      </div>
    );
  }

  return (
    <div>
      <p className="mb-4 text-sm text-slate-500 dark:text-white/50">
        A deal can only move into a stage when every enabled gate for that
        stage is satisfied. A partner can still move it with an override
        reason — the bypass is recorded on the deal. Disabling a gate
        turns its check off without deleting the rule.
      </p>
      {error && (
        <p className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-500/15 dark:text-red-300">
          {error}
        </p>
      )}
      {note && !error && (
        <p className="mb-4 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
          {note}
        </p>
      )}
      {groups.length === 0 && !error ? (
        <p className="text-sm text-slate-500 dark:text-white/50">
          No gate rules configured yet.
        </p>
      ) : (
        <div className="space-y-6">
          {groups.map(([stage, stageRules]) => (
            <div key={stage}>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-white/40">
                Moving into · {stage}
              </h3>
              <ul className="divide-y divide-slate-200 rounded-xl border border-slate-200 dark:divide-white/10 dark:border-white/10">
                {stageRules.map((rule: GateRule) => {
                  const condition = conditionByKey.get(rule.conditionKey);
                  return (
                    <li
                      key={rule.id}
                      className="flex items-start justify-between gap-4 px-4 py-3"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-[#0d1f3c] dark:text-white">
                          {rule.label}
                        </p>
                        <p className="mt-0.5 text-xs text-slate-500 dark:text-white/50">
                          {condition?.description ?? rule.conditionKey}
                        </p>
                        <p className="mt-0.5 font-mono text-[11px] text-slate-400 dark:text-white/35">
                          {rule.conditionKey}
                        </p>
                      </div>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={rule.enabled}
                        aria-label={`${rule.enabled ? "Disable" : "Enable"} gate: ${rule.label}`}
                        disabled={savingId === rule.id}
                        onClick={() => void toggle(rule)}
                        className={`relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50 ${
                          rule.enabled
                            ? "bg-[#0d1f3c] dark:bg-[#b8975a]"
                            : "bg-slate-300 dark:bg-white/20"
                        }`}
                      >
                        <span
                          className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${
                            rule.enabled ? "left-[22px]" : "left-0.5"
                          }`}
                        />
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      )}
      <p className="mt-4 text-xs text-slate-400 dark:text-white/35">
        Stages with no rules (Sourcing, Passed) are never gated.
      </p>
    </div>
  );
}

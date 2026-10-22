"use client";

/**
 * Record checks — external records (litigation, UCC, licenses,
 * sanctions and the like) tracked as dated snapshots per check
 * type. Automated types can refresh on demand; every type also
 * accepts a manual snapshot. A snapshot that differs from the
 * prior one is flagged “Changed” with its change summary.
 */

import { useCallback, useEffect, useState } from "react";
import { Button, EmptyState, ErrorState, SkeletonRows } from "@/components/ui";
import {
  api,
  cardCls,
  inputCls,
  labelCls,
  selectCls,
  fmtDateShort,
  type RecordCheckType,
  type RecordSnapshot,
  type TabProps,
} from "@/components/diligence/types";

interface ManualForm {
  sourceName: string;
  sourceUrl: string;
  resultStatus: string;
  summary: string;
}

const RESULT_STATUSES = ["clear", "finding", "unknown"] as const;

function resultPill(resultStatus: string) {
  const s = (resultStatus || "").toLowerCase();
  if (s === "clear") {
    return (
      <span className="badge bg-emerald-500/15 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300">
        clear
      </span>
    );
  }
  if (s === "finding") {
    return <span className="badge badge-danger">finding</span>;
  }
  return <span className="badge badge-neutral">{resultStatus || "unknown"}</span>;
}

function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return fmtDateShort(iso);
  return d.toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function SnapshotLine({ snap }: { snap: RecordSnapshot }) {
  return (
    <div className="text-sm">
      <div className="flex flex-wrap items-center gap-2">
        {resultPill(snap.resultStatus)}
        <span className="font-medium text-[#0d1f3c] dark:text-white">
          {snap.sourceName || "—"}
        </span>
        {snap.sourceUrl && (
          <a
            href={snap.sourceUrl}
            target="_blank"
            rel="noreferrer"
            className="text-xs font-semibold text-[#b8975a] hover:underline"
          >
            Open source ↗
          </a>
        )}
        <span className="text-xs text-slate-400 dark:text-white/40">
          {fmtDateTime(snap.checkedAt)}
          {snap.enteredBy ? ` · by ${snap.enteredBy}` : ""}
          {snap.route ? ` · ${snap.route}` : ""}
        </span>
      </div>
      {snap.summary && (
        <p className="mt-1 whitespace-pre-wrap text-slate-600 dark:text-white/70">
          {snap.summary}
        </p>
      )}
      {snap.changed && (
        <p className="mt-2 rounded-xl bg-amber-500/10 px-4 py-2.5 text-sm text-amber-800 dark:text-amber-200">
          <strong>Changed since prior snapshot.</strong>
          {snap.changeSummary ? ` ${snap.changeSummary}` : ""}
        </p>
      )}
    </div>
  );
}

export default function RecordsTab({ workspaceId, bundle }: TabProps) {
  const companyId = bundle.deal?.companyId ?? bundle.workspace.companyId;
  const dealId = bundle.deal?.dealId ?? bundle.workspace.dealId;

  const [types, setTypes] = useState<RecordCheckType[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [error, setError] = useState("");

  const [forms, setForms] = useState<Record<string, ManualForm>>({});
  const [savingKey, setSavingKey] = useState("");
  const [historyOpen, setHistoryOpen] = useState<Record<string, boolean>>({});
  const [history, setHistory] = useState<Record<string, RecordSnapshot[]>>({});
  const [historyLoadingKey, setHistoryLoadingKey] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [refreshNote, setRefreshNote] = useState("");

  const load = useCallback(async () => {
    if (!companyId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadFailed(false);
    try {
      const data = await api<{ types: RecordCheckType[] }>(
        `/api/platform/diligence/records?companyId=${encodeURIComponent(companyId)}`
      );
      const list = Array.isArray(data.types) ? data.types : [];
      setTypes(list);
      setForms((prev) => {
        const next = { ...prev };
        for (const t of list) {
          if (!next[t.key]) {
            next[t.key] = {
              sourceName: t.defaultSource ?? "",
              sourceUrl: "",
              resultStatus: "clear",
              summary: "",
            };
          }
        }
        return next;
      });
    } catch {
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => {
    void load();
  }, [load]);

  const setForm = (key: string, patch: Partial<ManualForm>) =>
    setForms((s) => {
      const base: ManualForm = s[key] ?? {
        sourceName: "",
        sourceUrl: "",
        resultStatus: "clear",
        summary: "",
      };
      return { ...s, [key]: { ...base, ...patch } };
    });

  const submitManual = async (t: RecordCheckType) => {
    if (!companyId) return;
    const form = forms[t.key];
    if (!form || savingKey) return;
    setSavingKey(t.key);
    setError("");
    try {
      await api("/api/platform/diligence/records", {
        method: "POST",
        body: JSON.stringify({
          companyId,
          dealId,
          workspaceId,
          checkType: t.key,
          sourceName: form.sourceName.trim(),
          sourceUrl: form.sourceUrl.trim() || undefined,
          resultStatus: form.resultStatus,
          summary: form.summary.trim(),
          route: "manual",
        }),
      });
      setForm(t.key, { sourceUrl: "", summary: "", resultStatus: "clear" });
      await load();
      if (historyOpen[t.key]) void loadHistory(t.key);
    } catch {
      setError(`Could not save the ${t.label} snapshot. Please try again.`);
    } finally {
      setSavingKey("");
    }
  };

  const loadHistory = async (checkType: string) => {
    if (!companyId) return;
    setHistoryLoadingKey(checkType);
    try {
      const data = await api<{ snapshots: RecordSnapshot[] }>(
        `/api/platform/diligence/records/history?companyId=${encodeURIComponent(companyId)}&checkType=${encodeURIComponent(checkType)}`
      );
      setHistory((s) => ({
        ...s,
        [checkType]: Array.isArray(data.snapshots) ? data.snapshots : [],
      }));
    } catch {
      setHistory((s) => ({ ...s, [checkType]: [] }));
    } finally {
      setHistoryLoadingKey("");
    }
  };

  const toggleHistory = (checkType: string) => {
    const next = !historyOpen[checkType];
    setHistoryOpen((s) => ({ ...s, [checkType]: next }));
    if (next && !history[checkType]) void loadHistory(checkType);
  };

  const runRefresh = async () => {
    if (!companyId || refreshing) return;
    setRefreshing(true);
    setRefreshNote("");
    setError("");
    try {
      const data = await api<{
        ran: boolean;
        snapshots?: RecordSnapshot[];
        snapshot?: RecordSnapshot;
        reason?: string;
      }>("/api/platform/diligence/records/refresh", {
        method: "POST",
        body: JSON.stringify({ companyId }),
      });
      const newCount =
        data.snapshots?.length ?? (data.snapshot ? 1 : 0);
      setRefreshNote(
        data.ran
          ? `Automated checks ran — ${newCount} new snapshot(s) recorded.`
          : (data.reason ?? "No automated checks ran for this company.")
      );
      await load();
    } catch {
      setError("Automated checks failed. Please try again.");
    } finally {
      setRefreshing(false);
    }
  };

  if (loading) return <SkeletonRows rows={5} />;
  if (loadFailed) return <ErrorState onRetry={() => void load()} />;

  if (!companyId) {
    return (
      <div className={cardCls}>
        <h3 className="font-display text-lg font-semibold text-[#0d1f3c] dark:text-white">
          Record checks
        </h3>
        <p className="mt-2 text-sm text-slate-500 dark:text-white/50">
          This deal is not linked to a company yet, so there is nothing to run
          record checks against. Link the deal to a company first.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {error && (
        <p className="rounded-xl bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-300">
          {error}
        </p>
      )}

      <div className={cardCls}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="font-display text-lg font-semibold text-[#0d1f3c] dark:text-white">
              Record checks
            </h3>
            <p className="mt-0.5 max-w-xl text-sm text-slate-500 dark:text-white/50">
              Each check is stored as a dated snapshot, so changes between
              checks surface explicitly instead of overwriting history.
            </p>
          </div>
          <Button
            onClick={() => void runRefresh()}
            loading={refreshing}
            className="min-h-[44px]"
          >
            Run automated checks
          </Button>
        </div>
        {refreshNote && (
          <p className="mt-3 rounded-xl bg-[#b8975a]/10 px-4 py-2.5 text-sm text-[#0d1f3c] dark:text-white/90">
            {refreshNote}
          </p>
        )}
      </div>

      {types.length === 0 ? (
        <EmptyState
          title="No record check types"
          message="No check types are configured for this company yet."
        />
      ) : (
        types.map((t) => {
          const form = forms[t.key] ?? {
            sourceName: t.defaultSource ?? "",
            sourceUrl: "",
            resultStatus: "clear",
            summary: "",
          };
          const isAutomated = (t.automation || "").toLowerCase() === "automated";
          const hist = history[t.key];
          return (
            <div key={t.key} className={cardCls}>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="min-w-[160px] flex-1 font-display text-lg font-semibold text-[#0d1f3c] dark:text-white">
                  {t.label}
                </h3>
                <span className={`badge ${isAutomated ? "badge-fit" : "badge-neutral"}`}>
                  {isAutomated ? "Automated" : "Manual"}
                </span>
                {t.refreshDue && <span className="badge badge-warn">Refresh due</span>}
              </div>
              {t.automationNote && (
                <p className="mt-1 text-xs text-slate-400 dark:text-white/40">
                  {t.automationNote}
                </p>
              )}

              <div className="mt-3 border-t border-slate-100 pt-3 dark:border-white/5">
                {t.latest ? (
                  <SnapshotLine snap={t.latest} />
                ) : (
                  <p className="text-sm text-slate-500 dark:text-white/50">
                    No snapshot recorded yet.
                  </p>
                )}
              </div>

              {/* Manual entry */}
              <div className="mt-4 border-t border-slate-100 pt-4 dark:border-white/5">
                <p className={labelCls}>Record a manual snapshot</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className={labelCls}>Source name</label>
                    <input
                      className={inputCls}
                      value={form.sourceName}
                      onChange={(e) => setForm(t.key, { sourceName: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className={labelCls}>Source URL</label>
                    <input
                      className={inputCls}
                      value={form.sourceUrl}
                      onChange={(e) => setForm(t.key, { sourceUrl: e.target.value })}
                      placeholder="https://…"
                    />
                  </div>
                  <div>
                    <label className={labelCls}>Result</label>
                    <select
                      className={selectCls}
                      value={form.resultStatus}
                      onChange={(e) => setForm(t.key, { resultStatus: e.target.value })}
                    >
                      {RESULT_STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="sm:col-span-2">
                    <label className={labelCls}>Summary</label>
                    <textarea
                      className={`${inputCls} min-h-[70px]`}
                      value={form.summary}
                      onChange={(e) => setForm(t.key, { summary: e.target.value })}
                      placeholder="What the source showed, in a sentence or two"
                    />
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    onClick={() => void submitManual(t)}
                    loading={savingKey === t.key}
                    className="min-h-[44px]"
                  >
                    Save snapshot
                  </Button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm min-h-[44px]"
                    onClick={() => toggleHistory(t.key)}
                  >
                    {historyOpen[t.key] ? "Hide history" : "History"}
                  </button>
                </div>
              </div>

              {historyOpen[t.key] && (
                <div className="mt-4 border-t border-slate-100 pt-3 dark:border-white/5">
                  <p className={labelCls}>History</p>
                  {historyLoadingKey === t.key ? (
                    <SkeletonRows rows={2} />
                  ) : !hist || hist.length === 0 ? (
                    <p className="text-sm text-slate-500 dark:text-white/50">
                      No snapshots in history.
                    </p>
                  ) : (
                    <ul className="divide-y divide-slate-100 dark:divide-white/5">
                      {hist.map((snap) => (
                        <li key={snap.id} className="py-3">
                          <SnapshotLine snap={snap} />
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}

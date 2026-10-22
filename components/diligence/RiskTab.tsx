"use client";

/**
 * Risk score — one composite score with a transparent component
 * breakdown: every component shows its weight, subscore, the key
 * inputs behind it and its source. History keeps each prior score
 * with what changed, so a move in the score is always explainable.
 */

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Button, ErrorState, SkeletonRows } from "@/components/ui";
import {
  api,
  cardCls,
  labelCls,
  tdCls,
  thCls,
  fmtDateShort,
  type RiskCurrent,
  type RiskHistoryItem,
  type RiskSource,
  type TabProps,
} from "@/components/diligence/types";

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

/** Subscores arrive on a 0–100 scale; tolerate a 0–1 scale too. */
function barPct(subscore: number | null | undefined): number {
  if (subscore === null || subscore === undefined || !Number.isFinite(subscore))
    return 0;
  const v = subscore > 1 ? subscore : subscore * 100;
  return Math.max(0, Math.min(100, v));
}

function fmtSubscore(subscore: number | null | undefined): string {
  if (subscore === null || subscore === undefined || !Number.isFinite(subscore))
    return "—";
  return Number.isInteger(subscore) ? String(subscore) : subscore.toFixed(1);
}

function fmtWeight(weight: number): string {
  if (!Number.isFinite(weight)) return "—";
  if (weight <= 1) return `${Math.round(weight * 100)}%`;
  return `${weight}%`;
}

function bandPill(band: string) {
  const b = (band || "").toLowerCase();
  if (b === "low") {
    return (
      <span className="badge bg-emerald-500/15 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300">
        {band}
      </span>
    );
  }
  if (b === "moderate") return <span className="badge badge-fit">{band}</span>;
  if (b === "elevated") return <span className="badge badge-warn">{band}</span>;
  if (b === "high") return <span className="badge badge-danger">{band}</span>;
  return <span className="badge badge-neutral">{band || "—"}</span>;
}

function renderSource(source: RiskSource | undefined): ReactNode {
  if (source === null || source === undefined) return "—";
  if (typeof source === "string") return source || "—";
  const href = source.href ?? source.url;
  const label = source.label ?? source.name ?? href ?? "Source";
  if (href) {
    return (
      <a
        href={href}
        target={href.startsWith("http") ? "_blank" : undefined}
        rel={href.startsWith("http") ? "noreferrer" : undefined}
        className="font-semibold text-[#b8975a] hover:underline"
      >
        {label} ↗
      </a>
    );
  }
  return label;
}

function SubscoreBar({ subscore }: { subscore: number | null | undefined }) {
  return (
    <span className="flex min-w-[120px] items-center gap-2">
      <span className="h-2 w-24 overflow-hidden rounded-full bg-slate-100 dark:bg-white/10">
        <span
          className="block h-full bg-[#b8975a]"
          style={{ width: `${barPct(subscore)}%` }}
        />
      </span>
      <span className="tnum text-sm font-semibold text-[#0d1f3c] dark:text-white">
        {fmtSubscore(subscore)}
      </span>
    </span>
  );
}

function renderChanges(changes: Record<string, unknown> | null): ReactNode {
  if (!changes || typeof changes !== "object") {
    return (
      <p className="text-sm text-slate-500 dark:text-white/50">
        No change detail recorded for this score.
      </p>
    );
  }
  const delta =
    typeof changes.scoreDelta === "number" ? changes.scoreDelta : null;
  const comps = Array.isArray(changes.components)
    ? (changes.components as Array<Record<string, unknown>>)
    : [];
  const notes = typeof changes.note === "string" ? changes.note : "";
  const summary =
    typeof changes.summary === "string" ? changes.summary : "";
  if (delta === null && comps.length === 0 && !notes && !summary) {
    return (
      <pre className="overflow-x-auto whitespace-pre-wrap rounded-xl bg-slate-50 px-4 py-3 text-xs text-slate-500 dark:bg-white/5 dark:text-white/50">
        {JSON.stringify(changes, null, 2)}
      </pre>
    );
  }
  return (
    <div className="space-y-2 text-sm text-slate-600 dark:text-white/70">
      {delta !== null && (
        <p>
          Score moved{" "}
          <strong className="text-[#0d1f3c] dark:text-white">
            {delta > 0 ? `+${delta}` : delta}
          </strong>{" "}
          versus the previous score.
        </p>
      )}
      {summary && <p>{summary}</p>}
      {notes && <p>{notes}</p>}
      {comps.length > 0 && (
        <ul className="space-y-1">
          {comps.map((c, i) => {
            const label =
              typeof c.label === "string"
                ? c.label
                : typeof c.key === "string"
                  ? c.key
                  : `Component ${i + 1}`;
            const d = typeof c.delta === "number" ? c.delta : null;
            const from = c.from ?? c.previous;
            const to = c.to ?? c.current;
            return (
              <li key={`${label}-${i}`} className="flex flex-wrap gap-x-2">
                <span className="font-medium text-[#0d1f3c] dark:text-white">
                  {label}
                </span>
                {d !== null && (
                  <span className="tnum">{d > 0 ? `+${d}` : d}</span>
                )}
                {(from !== undefined || to !== undefined) && (
                  <span className="text-slate-400 dark:text-white/40">
                    {String(from ?? "—")} → {String(to ?? "—")}
                  </span>
                )}
                {typeof c.detail === "string" && <span>{c.detail}</span>}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export default function RiskTab({ workspaceId, bundle }: TabProps) {
  const dealId = bundle.deal?.dealId ?? bundle.workspace.dealId;

  const [current, setCurrent] = useState<RiskCurrent | null>(null);
  const [history, setHistory] = useState<RiskHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [error, setError] = useState("");
  const [computing, setComputing] = useState(false);
  const [expandedId, setExpandedId] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setLoadFailed(false);
    try {
      const data = await api<{
        current: RiskCurrent | null;
        history: RiskHistoryItem[];
      }>(`/api/platform/diligence/risk?dealId=${encodeURIComponent(dealId)}`);
      setCurrent(data.current ?? null);
      setHistory(Array.isArray(data.history) ? data.history : []);
    } catch {
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, [dealId]);

  useEffect(() => {
    void load();
  }, [load]);

  const compute = async () => {
    setComputing(true);
    setError("");
    try {
      await api("/api/platform/diligence/risk", {
        method: "POST",
        body: JSON.stringify({ workspaceId }),
      });
      await load();
    } catch {
      setError("Could not compute the risk score. Please try again.");
    } finally {
      setComputing(false);
    }
  };

  if (loading) return <SkeletonRows rows={5} />;
  if (loadFailed) return <ErrorState onRetry={() => void load()} />;

  if (!current) {
    return (
      <div className="space-y-5">
        {error && (
          <p className="rounded-xl bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-300">
            {error}
          </p>
        )}
        <div className={cardCls}>
          <h3 className="font-display text-lg font-semibold text-[#0d1f3c] dark:text-white">
            Risk score
          </h3>
          <p className="mt-2 max-w-2xl text-sm text-slate-500 dark:text-white/50">
            No risk score has been computed for this deal yet. Computing one
            scores the deal across weighted components — financial integrity,
            concentration, contracts, record checks, red flags and more —
            with every component&apos;s inputs and source shown, so the score
            can always be traced back to evidence.
          </p>
          <div className="mt-4">
            <Button
              onClick={() => void compute()}
              loading={computing}
              className="min-h-[44px]"
            >
              Compute risk score
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const drivers = current.drivers ?? [];
  const components = current.components ?? [];

  return (
    <div className="space-y-5">
      {error && (
        <p className="rounded-xl bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-300">
          {error}
        </p>
      )}

      {/* Score header */}
      <div className={cardCls}>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className={labelCls}>Composite risk score</p>
            <div className="flex flex-wrap items-center gap-3">
              <span className="tnum font-display text-7xl font-semibold leading-none text-[#0d1f3c] dark:text-white">
                {Math.round(current.score)}
              </span>
              {bandPill(current.band)}
            </div>
            <p className="mt-2 text-xs text-slate-400 dark:text-white/40">
              Computed {fmtDateTime(current.createdAt)}
              {current.triggerSource ? ` · Trigger: ${current.triggerSource}` : ""}
            </p>
          </div>
          <Button
            variant="secondary"
            onClick={() => void compute()}
            loading={computing}
            className="min-h-[44px]"
          >
            Recompute
          </Button>
        </div>

        {drivers.length > 0 && (
          <div className="mt-5 border-t border-slate-100 pt-4 dark:border-white/5">
            <p className={labelCls}>Top drivers</p>
            <ul className="mt-2 divide-y divide-slate-100 dark:divide-white/5">
              {drivers.map((d, i) => {
                if (typeof d === "string") {
                  return (
                    <li key={i} className="py-2.5 text-sm text-slate-600 dark:text-white/80">
                      {d}
                    </li>
                  );
                }
                const label = d.label ?? d.title ?? d.key ?? `Driver ${i + 1}`;
                return (
                  <li key={d.key ?? i} className="py-2.5">
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="min-w-[160px] flex-1 text-sm font-semibold text-[#0d1f3c] dark:text-white">
                        {label}
                      </span>
                      <SubscoreBar subscore={d.subscore} />
                      {d.value !== null && d.value !== undefined && (
                        <span className="tnum text-sm text-slate-500 dark:text-white/60">
                          {String(d.value)}
                        </span>
                      )}
                      {d.source !== undefined && d.source !== null && (
                        <span className="text-sm">{renderSource(d.source)}</span>
                      )}
                      {(d.source === undefined || d.source === null) &&
                        d.href && (
                          <span className="text-sm">
                            {renderSource({ label: "Source", href: d.href })}
                          </span>
                        )}
                    </div>
                    {d.detail && (
                      <p className="mt-1 text-sm text-slate-500 dark:text-white/50">
                        {d.detail}
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>

      {/* Components */}
      <div className={cardCls}>
        <h3 className="font-display text-lg font-semibold text-[#0d1f3c] dark:text-white">
          Components
        </h3>
        {components.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500 dark:text-white/50">
            No component breakdown recorded for this score.
          </p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse">
              <thead>
                <tr className="border-b border-slate-200 dark:border-white/10">
                  <th className={thCls}>Component</th>
                  <th className={thCls}>Weight</th>
                  <th className={thCls}>Subscore</th>
                  <th className={thCls}>Key inputs</th>
                  <th className={thCls}>Source</th>
                </tr>
              </thead>
              <tbody>
                {components.map((c) => (
                  <tr
                    key={c.key}
                    className="border-b border-slate-100 align-top dark:border-white/5"
                  >
                    <td className={`${tdCls} font-medium`}>
                      {c.label}
                      {c.detail && (
                        <p className="mt-0.5 max-w-xs text-xs font-normal text-slate-500 dark:text-white/50">
                          {c.detail}
                        </p>
                      )}
                    </td>
                    <td className={`${tdCls} tnum`}>{fmtWeight(c.weight)}</td>
                    <td className={tdCls}>
                      <SubscoreBar subscore={c.subscore} />
                    </td>
                    <td className={`${tdCls} tnum`}>
                      {c.value === null || c.value === undefined
                        ? "—"
                        : String(c.value)}
                    </td>
                    <td className={tdCls}>{renderSource(c.source)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* History */}
      <div className={cardCls}>
        <h3 className="font-display text-lg font-semibold text-[#0d1f3c] dark:text-white">
          Score history
        </h3>
        {history.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500 dark:text-white/50">
            No prior scores — this is the first computation.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-slate-100 dark:divide-white/5">
            {history.map((h) => {
              const delta =
                h.changes && typeof h.changes.scoreDelta === "number"
                  ? h.changes.scoreDelta
                  : null;
              const expanded = expandedId === h.id;
              return (
                <li key={h.id} className="py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm text-slate-500 dark:text-white/50">
                      {fmtDateTime(h.createdAt)}
                    </span>
                    <span className="tnum font-display text-2xl font-semibold text-[#0d1f3c] dark:text-white">
                      {Math.round(h.score)}
                    </span>
                    {bandPill(h.band)}
                    {delta !== null && (
                      <span
                        className={`tnum text-sm font-semibold ${
                          delta > 0
                            ? "text-red-600 dark:text-red-300"
                            : delta < 0
                              ? "text-emerald-600 dark:text-emerald-300"
                              : "text-slate-400 dark:text-white/40"
                        }`}
                      >
                        {delta > 0 ? `+${delta}` : delta} vs previous
                      </span>
                    )}
                    {h.triggerSource && (
                      <span className="text-xs text-slate-400 dark:text-white/40">
                        {h.triggerSource}
                      </span>
                    )}
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm ml-auto min-h-[44px]"
                      onClick={() => setExpandedId(expanded ? "" : h.id)}
                    >
                      {expanded ? "Hide changes" : "What changed"}
                    </button>
                  </div>
                  {expanded && (
                    <div className="mt-3 rounded-xl bg-slate-50 px-4 py-3 dark:bg-white/5">
                      {renderChanges(h.changes)}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

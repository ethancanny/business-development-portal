"use client";

/**
 * Import from diligence (VCP redesign, §5/§6): one drawer listing both
 * conversion sources — open diligence FINDINGS (read through the
 * diligence module's service layer by the API) and low-scorecard-area
 * REMEDIATION candidates. Converting creates a plan initiative linked
 * back to its source (sourceKind finding / remediation + sourceRef).
 */

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui";
import Drawer from "@/components/valuecreation/Drawer";
import {
  API,
  api,
  inputCls,
  labelCls,
  type FindingCandidate,
  type RemediationCandidate,
} from "@/components/valuecreation/types";

const SEVERITY_BADGE: Record<string, string> = {
  critical: "badge-danger",
  high: "badge-danger",
  medium: "badge-warn",
  low: "badge-neutral",
};

export default function ImportPanel({
  planId,
  onClose,
  onConverted,
}: {
  planId: string;
  onClose: () => void;
  onConverted: () => Promise<void>;
}) {
  const [findings, setFindings] = useState<FindingCandidate[] | null>(null);
  const [remediation, setRemediation] = useState<RemediationCandidate[] | null>(null);
  const [ownerName, setOwnerName] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [busyKey, setBusyKey] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const d = await api<{ candidates: FindingCandidate[] }>(
        `${API}/plans/${encodeURIComponent(planId)}/finding-candidates`
      );
      setFindings((d.candidates ?? []).filter((c) => !c.alreadyConverted));
    } catch {
      setFindings([]);
    }
    try {
      const d = await api<{ candidates?: RemediationCandidate[]; items?: RemediationCandidate[] }>(
        `${API}/plans/${encodeURIComponent(planId)}/remediation`
      );
      setRemediation((d.candidates ?? d.items ?? []).filter((c) => !c.alreadyConverted));
    } catch {
      setRemediation([]);
    }
  }, [planId]);

  useEffect(() => { void load(); }, [load]);

  const convertFinding = async (c: FindingCandidate) => {
    setBusyKey(`f:${c.findingId}`);
    setError(""); setNotice("");
    try {
      await api(`${API}/plans/${encodeURIComponent(planId)}/convert-finding`, {
        method: "POST",
        body: JSON.stringify({
          findingId: c.findingId,
          ownerName: ownerName.trim() || undefined,
          dueDate: dueDate || undefined,
        }),
      });
      setNotice(`Converted finding “${c.title}” into an initiative.`);
      await load();
      await onConverted();
    } catch {
      setError("Could not convert that finding. It may already be converted.");
    } finally {
      setBusyKey("");
    }
  };

  const convertRemediation = async (c: RemediationCandidate) => {
    const key = `${c.workspaceId}:${c.areaKey}`;
    setBusyKey(`r:${key}`);
    setError(""); setNotice("");
    try {
      await api(`${API}/plans/${encodeURIComponent(planId)}/remediation`, {
        method: "POST",
        body: JSON.stringify({
          workspaceId: c.workspaceId,
          areaKey: c.areaKey,
          ownerName: ownerName.trim() || undefined,
          dueDate: dueDate || undefined,
        }),
      });
      setNotice(`Converted “${c.areaLabel ?? c.label ?? c.areaKey}” into an initiative.`);
      await load();
      await onConverted();
    } catch {
      setError("Could not convert that candidate. Please try again.");
    } finally {
      setBusyKey("");
    }
  };

  const loading = findings === null || remediation === null;
  const empty = !loading && (findings?.length ?? 0) === 0 && (remediation?.length ?? 0) === 0;

  return (
    <Drawer title="Import from diligence" subtitle="Findings and remediation candidates become initiatives, linked to their source." onClose={onClose}>
      <div className="space-y-5">
        {error && (
          <p role="alert" className="rounded-xl bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-300">{error}</p>
        )}
        {notice && (
          <p className="rounded-xl bg-emerald-500/10 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-300">{notice}</p>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className={labelCls}>Owner for converted initiatives</label>
            <input className={`${inputCls} min-h-[44px]`} value={ownerName} onChange={(e) => setOwnerName(e.target.value)} placeholder="Name (optional)" />
          </div>
          <div>
            <label className={labelCls}>Due date</label>
            <input type="date" className={`${inputCls} min-h-[44px]`} value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </div>
        </div>

        {loading ? (
          <div className="space-y-2" aria-busy="true">
            <div className="skel h-14" /><div className="skel h-14" /><div className="skel h-14" />
            <span className="sr-only">Loading diligence candidates…</span>
          </div>
        ) : empty ? (
          <p className="rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-600 dark:bg-white/5 dark:text-white/60">
            Nothing to import right now — no open diligence findings and no low scorecard
            areas for this company. Candidates appear here as diligence work produces them.
          </p>
        ) : (
          <>
            {(findings?.length ?? 0) > 0 && (
              <div>
                <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-white/45">
                  Diligence findings
                </h4>
                <ul className="mt-2 space-y-2">
                  {findings!.map((c) => (
                    <li key={c.findingId} className="rounded-xl border border-slate-100 px-3.5 py-3 dark:border-white/10">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`badge ${SEVERITY_BADGE[c.severity] ?? "badge-neutral"}`}>{c.severity}</span>
                        {c.category && <span className="text-xs text-slate-500 dark:text-white/50">{c.category}</span>}
                        <span className="ml-auto">
                          <Button size="sm" onClick={() => void convertFinding(c)} loading={busyKey === `f:${c.findingId}`}>
                            Convert
                          </Button>
                        </span>
                      </div>
                      <p className="mt-1.5 text-sm font-medium text-[#0d1f3c] dark:text-white">{c.title}</p>
                      {c.detail && (
                        <p className="mt-0.5 line-clamp-2 text-sm text-slate-500 dark:text-white/50">{c.detail}</p>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {(remediation?.length ?? 0) > 0 && (
              <div>
                <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-white/45">
                  Remediation candidates (low scorecard areas)
                </h4>
                <ul className="mt-2 space-y-2">
                  {remediation!.map((c) => {
                    const key = `${c.workspaceId}:${c.areaKey}`;
                    return (
                      <li key={key} className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-100 px-3.5 py-3 dark:border-white/10">
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-[#0d1f3c] dark:text-white">
                            {c.areaLabel ?? c.label ?? c.areaKey}
                          </span>
                          <span className="tnum block text-xs text-slate-500 dark:text-white/50">
                            Score {c.score === null || c.score === undefined ? "—" : `${c.score}/5`}{c.notes ? ` · ${c.notes}` : ""}
                          </span>
                        </span>
                        <Button size="sm" onClick={() => void convertRemediation(c)} loading={busyKey === `r:${key}`}>
                          Convert
                        </Button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </>
        )}
      </div>
    </Drawer>
  );
}

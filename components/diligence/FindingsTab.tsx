"use client";

/**
 * Findings & Terms — REDESIGNED Oct 2026 (spec §5). Summary header
 * (open counts by severity, cumulative dollar impact, by status),
 * then the standard table: severity, workstream (category),
 * description, dollar impact, outcome (proposed term), owner,
 * status. Every pre-redesign control is preserved: add finding,
 * accept/reject the proposed term, delete, and the red-flag link —
 * editing now happens in the shared right-side drawer (delete lives
 * only there). Existing term types keep their stored values; the
 * outcome list adds indemnity / closing condition / walk-away for
 * new findings (see checkpoint).
 *
 * Data: this tab fetches its own sections only (findings, red flags
 * for link titles, checklist for link options).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { EmptyState, ErrorState, SkeletonRows } from "@/components/ui";
import {
  SEVERITIES,
  TERM_TYPES,
  WORKSTREAMS,
  api,
  cardCls,
  fmtDateShort,
  fmtMoney,
  labelOf,
  type ChecklistItem,
  type Finding,
  type RedFlag,
  type TabProps,
} from "@/components/diligence/types";
import {
  CommentsPanel,
  DrawerShell,
  drawerInputCls,
  drawerLabelCls,
} from "@/components/diligence/ItemDrawer";

const SEV_PILL: Record<string, string> = {
  high: "bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300",
  medium: "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300",
  low: "bg-slate-100 text-slate-500 dark:bg-white/10 dark:text-white/50",
};
const STATUS_PILL: Record<string, string> = {
  proposed:
    "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300",
  accepted:
    "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300",
  rejected: "bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300",
};
const PARTNERS = ["Ethan Canny", "Ronan Canny", "Ian Canny"];

export default function FindingsTab(props: TabProps) {
  const { workspaceId } = props;
  const [findings, setFindings] = useState<Finding[]>([]);
  const [redFlags, setRedFlags] = useState<RedFlag[]>([]);
  const [checklist, setChecklist] = useState<ChecklistItem[]>([]);
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const [sevFilter, setSevFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [drawerId, setDrawerId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const [f, r, c] = await Promise.all([
        api<{ findings: Finding[] }>(
          `/api/platform/diligence/workspaces/${encodeURIComponent(workspaceId)}/findings`
        ),
        api<{ flags: RedFlag[] }>(
          `/api/platform/diligence/workspaces/${encodeURIComponent(workspaceId)}/red-flags`
        ).catch(() => ({ flags: [] as RedFlag[] })),
        api<{ items: ChecklistItem[] }>(
          `/api/platform/diligence/workspaces/${encodeURIComponent(workspaceId)}/checklist`
        ).catch(() => ({ items: [] as ChecklistItem[] })),
      ]);
      setFindings(f.findings ?? []);
      setRedFlags(r.flags ?? []);
      setChecklist(c.items ?? []);
      setPhase("ready");
    } catch {
      setPhase("error");
    }
  }, [workspaceId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (props.intent?.findingsSeverity)
      setSevFilter(props.intent.findingsSeverity);
  }, [props.intent]);

  const open = findings.filter((f) => f.status !== "rejected");
  const bySeverity = {
    high: open.filter((f) => f.severity === "high").length,
    medium: open.filter((f) => f.severity === "medium").length,
    low: open.filter((f) => f.severity === "low").length,
  };
  const impactTotal = open.reduce((s, f) => s + (f.impactAmount ?? 0), 0);
  const byStatus = {
    proposed: findings.filter((f) => f.status === "proposed").length,
    accepted: findings.filter((f) => f.status === "accepted").length,
    rejected: findings.filter((f) => f.status === "rejected").length,
  };
  const shown = findings.filter(
    (f) =>
      (!sevFilter || f.severity === sevFilter) &&
      (!statusFilter || f.status === statusFilter)
  );
  const owners = useMemo(() => {
    const set = new Set<string>(PARTNERS);
    for (const f of findings) if (f.owner) set.add(f.owner);
    return Array.from(set);
  }, [findings]);
  const drawerFinding = drawerId
    ? findings.find((f) => f.id === drawerId) ?? null
    : null;

  const refresh = async () => {
    await load();
    void props.reload();
  };

  if (phase === "loading") return <SkeletonRows rows={6} />;
  if (phase === "error") return <ErrorState onRetry={() => void load()} />;

  return (
    <div className="space-y-4">
      {error && (
        <p className="rounded-xl bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-300">
          {error}
        </p>
      )}

      {/* Summary header */}
      <div className={cardCls}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="font-display text-lg font-semibold text-[#0d1f3c] dark:text-white">
            Findings &amp; proposed terms
          </h3>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => setCreating(true)}
          >
            + New finding
          </button>
        </div>
        <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm text-slate-500 dark:text-white/60">
          <span>
            Open: <strong className="text-[#0d1f3c] dark:text-white">{open.length}</strong>{" "}
            ({bySeverity.high} high · {bySeverity.medium} med · {bySeverity.low} low)
          </span>
          <span>
            Cumulative impact:{" "}
            <strong className="text-[#0d1f3c] dark:text-white">
              {fmtMoney(impactTotal || null)}
            </strong>
          </span>
          <span>
            Proposed {byStatus.proposed} · Accepted {byStatus.accepted} ·
            Rejected {byStatus.rejected}
          </span>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <select
            className="rounded-xl border border-slate-200 bg-white px-2 py-1.5 text-sm dark:border-white/10 dark:bg-white/5 dark:text-white"
            value={sevFilter}
            onChange={(e) => setSevFilter(e.target.value)}
          >
            <option value="">All severities</option>
            {SEVERITIES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <select
            className="rounded-xl border border-slate-200 bg-white px-2 py-1.5 text-sm dark:border-white/10 dark:bg-white/5 dark:text-white"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="">All statuses</option>
            <option value="proposed">Proposed</option>
            <option value="accepted">Accepted</option>
            <option value="rejected">Rejected</option>
          </select>
        </div>
      </div>

      {findings.length === 0 ? (
        <EmptyState
          title="No findings yet"
          message="Findings translate diligence discoveries into proposed deal terms for negotiation. Add the first one with “New finding”."
        />
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white dark:border-white/10 dark:bg-[#132847]/60">
          <table className="w-full min-w-[820px] border-collapse">
            <thead>
              <tr className="bg-[#0d1f3c] text-[#f5efe0]">
                <th className="w-24 px-2 py-2 text-left text-[11px] font-semibold uppercase tracking-wider">Severity</th>
                <th className="w-28 px-2 py-2 text-left text-[11px] font-semibold uppercase tracking-wider">Workstream</th>
                <th className="px-2 py-2 text-left text-[11px] font-semibold uppercase tracking-wider">Description</th>
                <th className="w-28 px-2 py-2 text-right text-[11px] font-semibold uppercase tracking-wider">$ impact</th>
                <th className="w-36 px-2 py-2 text-left text-[11px] font-semibold uppercase tracking-wider">Outcome</th>
                <th className="w-28 px-2 py-2 text-left text-[11px] font-semibold uppercase tracking-wider">Owner</th>
                <th className="w-24 px-2 py-2 text-left text-[11px] font-semibold uppercase tracking-wider">Status</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((f) => (
                <tr
                  key={f.id}
                  className="cursor-pointer border-b border-slate-100 hover:bg-[#f0f4fa] dark:border-white/5 dark:hover:bg-white/5"
                  onClick={() => setDrawerId(f.id)}
                >
                  <td className="px-2 py-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize ${SEV_PILL[f.severity] ?? SEV_PILL.medium}`}
                    >
                      {f.severity}
                    </span>
                  </td>
                  <td className="px-2 py-2 text-[13px] text-slate-500 dark:text-white/60">
                    {f.category || "—"}
                  </td>
                  <td className="max-w-0 px-2 py-2">
                    <span className="block truncate text-[13px] font-medium text-[#0d1f3c] dark:text-white/90">
                      {f.title}
                    </span>
                    {f.detail && (
                      <span className="block truncate text-xs text-slate-400">
                        {f.detail}
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-2 text-right text-[13px] font-medium text-[#0d1f3c] dark:text-white/90">
                    {fmtMoney(f.impactAmount)}
                  </td>
                  <td className="px-2 py-2 text-[13px] text-slate-500 dark:text-white/60">
                    {labelOf(TERM_TYPES, f.proposedTermType)}
                  </td>
                  <td className="px-2 py-2 text-[13px] text-slate-500 dark:text-white/60">
                    {f.owner || "—"}
                  </td>
                  <td className="px-2 py-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize ${STATUS_PILL[f.status] ?? ""}`}
                    >
                      {f.status}
                    </span>
                  </td>
                </tr>
              ))}
              {shown.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-3 py-6 text-center text-sm text-slate-400">
                    No findings match these filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {(drawerFinding || creating) && (
        <FindingDrawer
          key={drawerFinding?.id ?? "new"}
          finding={drawerFinding}
          workspaceId={workspaceId}
          redFlags={redFlags}
          checklist={checklist}
          owners={owners}
          onClose={() => {
            setDrawerId(null);
            setCreating(false);
          }}
          onSaved={async () => {
            setDrawerId(null);
            setCreating(false);
            await refresh();
          }}
          onError={setError}
        />
      )}
    </div>
  );
}

function FindingDrawer({
  finding,
  workspaceId,
  redFlags,
  checklist,
  owners,
  onClose,
  onSaved,
  onError,
}: {
  finding: Finding | null;
  workspaceId: string;
  redFlags: RedFlag[];
  checklist: ChecklistItem[];
  owners: string[];
  onClose: () => void;
  onSaved: () => Promise<void>;
  onError: (msg: string) => void;
}) {
  const [form, setForm] = useState({
    title: finding?.title ?? "",
    detail: finding?.detail ?? "",
    category: finding?.category ?? "",
    severity: finding?.severity ?? "medium",
    proposedTermType: finding?.proposedTermType ?? "other",
    proposedTermDetail: finding?.proposedTermDetail ?? "",
    impactAmount:
      finding?.impactAmount !== null && finding?.impactAmount !== undefined
        ? String(finding.impactAmount)
        : "",
    owner: finding?.owner ?? "",
    redFlagId: finding?.redFlagId ?? "",
    checklistItemId: finding?.checklistItemId ?? "",
  });
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const payload = () => ({
    title: form.title.trim(),
    detail: form.detail.trim(),
    category: form.category.trim(),
    severity: form.severity,
    proposedTermType: form.proposedTermType,
    proposedTermDetail: form.proposedTermDetail.trim(),
    impactAmount: form.impactAmount.trim()
      ? Number(form.impactAmount)
      : null,
    owner: form.owner,
    redFlagId: form.redFlagId || null,
    checklistItemId: form.checklistItemId || null,
  });

  const save = async () => {
    if (!form.title.trim() || busy) return;
    setBusy(true);
    try {
      if (finding) {
        await api(
          `/api/platform/diligence/findings/${encodeURIComponent(finding.id)}`,
          { method: "PATCH", body: JSON.stringify(payload()) }
        );
      } else {
        await api(
          `/api/platform/diligence/workspaces/${encodeURIComponent(workspaceId)}/findings`,
          { method: "POST", body: JSON.stringify(payload()) }
        );
      }
      await onSaved();
    } catch {
      onError("Could not save that finding. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const decide = async (status: "accepted" | "rejected") => {
    if (!finding || busy) return;
    setBusy(true);
    try {
      await api(
        `/api/platform/diligence/findings/${encodeURIComponent(finding.id)}`,
        { method: "PATCH", body: JSON.stringify({ status }) }
      );
      await onSaved();
    } catch {
      onError("Could not update that finding. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <DrawerShell
      title={finding ? finding.title : "New finding"}
      subtitle={
        finding
          ? `${finding.status}${finding.decidedBy ? ` · decided by ${finding.decidedBy}${finding.decidedAt ? ` ${fmtDateShort(finding.decidedAt)}` : ""}` : ""} · Created ${fmtDateShort(finding.createdAt)}`
          : "Record a finding and its proposed deal-term outcome"
      }
      onClose={onClose}
      onDelete={
        finding
          ? async () => {
              await api(
                `/api/platform/diligence/findings/${encodeURIComponent(finding.id)}`,
                { method: "DELETE" }
              );
              await onSaved();
            }
          : undefined
      }
      deleteLabel="Delete finding"
    >
      <div className="space-y-4">
        <div>
          <label className={drawerLabelCls}>Title</label>
          <input className={drawerInputCls} value={form.title} onChange={set("title")} />
        </div>
        <div>
          <label className={drawerLabelCls}>Detail</label>
          <textarea
            className={drawerInputCls}
            rows={4}
            value={form.detail}
            onChange={set("detail")}
            placeholder="What was found, and the evidence behind it"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={drawerLabelCls}>Workstream / category</label>
            <input
              className={drawerInputCls}
              value={form.category}
              onChange={set("category")}
              list="dd-finding-categories"
              placeholder="e.g. Revenue quality"
            />
            <datalist id="dd-finding-categories">
              {WORKSTREAMS.map((w) => (
                <option key={w.key} value={w.label} />
              ))}
            </datalist>
          </div>
          <div>
            <label className={drawerLabelCls}>Severity</label>
            <select className={drawerInputCls} value={form.severity} onChange={set("severity")}>
              {SEVERITIES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={drawerLabelCls}>Dollar impact ($)</label>
            <input
              className={drawerInputCls}
              type="number"
              value={form.impactAmount}
              onChange={set("impactAmount")}
              placeholder="e.g. 250000"
            />
          </div>
          <div>
            <label className={drawerLabelCls}>Owner</label>
            <select className={drawerInputCls} value={form.owner} onChange={set("owner")}>
              <option value="">Unassigned</option>
              {owners.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={drawerLabelCls}>Outcome (proposed term)</label>
            <select
              className={drawerInputCls}
              value={form.proposedTermType}
              onChange={set("proposedTermType")}
            >
              {TERM_TYPES.map((t) => (
                <option key={t.key} value={t.key}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={drawerLabelCls}>Linked red flag</label>
            <select className={drawerInputCls} value={form.redFlagId} onChange={set("redFlagId")}>
              <option value="">None</option>
              {redFlags.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.title}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div>
          <label className={drawerLabelCls}>Proposed term detail</label>
          <textarea
            className={drawerInputCls}
            rows={3}
            value={form.proposedTermDetail}
            onChange={set("proposedTermDetail")}
            placeholder="e.g. $250K holdback for 12 months against the top-customer receivable"
          />
        </div>
        <div>
          <label className={drawerLabelCls}>Linked checklist item</label>
          <select
            className={drawerInputCls}
            value={form.checklistItemId}
            onChange={set("checklistItemId")}
          >
            <option value="">None</option>
            {checklist.map((c) => (
              <option key={c.id} value={c.id}>
                {labelOf(WORKSTREAMS, c.workstream)} — {c.title}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={busy || !form.title.trim()}
            onClick={() => void save()}
          >
            {busy ? "Saving…" : finding ? "Save changes" : "Add finding"}
          </button>
          {finding && finding.status === "proposed" && (
            <>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={busy}
                onClick={() => void decide("accepted")}
              >
                Accept term
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                disabled={busy}
                onClick={() => void decide("rejected")}
              >
                Reject term
              </button>
            </>
          )}
        </div>
        {finding && (
          <div>
            <span className={drawerLabelCls}>Comments</span>
            <CommentsPanel entityKind="diligence_finding" entityId={finding.id} />
          </div>
        )}
      </div>
    </DrawerShell>
  );
}

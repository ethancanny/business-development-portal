"use client";

/**
 * IC memo — a generated draft memo assembled from the workspace's
 * own diligence data, with citations back to the source records.
 * Drafts are clearly marked until a partner approves them; when
 * the underlying data changes after generation the draft is
 * flagged stale. The recommendation section is reserved — it is
 * never generated.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Button, ErrorState, SkeletonRows } from "@/components/ui";
import {
  api,
  cardCls,
  fmtDateShort,
  type MemoCitation,
  type MemoData,
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

function CitationChip({ citation }: { citation: MemoCitation }) {
  const cls =
    "inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600 dark:bg-white/10 dark:text-white/70";
  const content = (
    <>
      <span className="uppercase tracking-wide opacity-70">{citation.kind}</span>
      <span>{citation.label}</span>
    </>
  );
  if (citation.kind === "document" && citation.id) {
    return (
      <Link
        href={`/documents?doc=${encodeURIComponent(citation.id)}`}
        className={`${cls} hover:bg-[#b8975a]/20 hover:text-[#0d1f3c] dark:hover:text-white`}
      >
        {content}
      </Link>
    );
  }
  return <span className={cls}>{content}</span>;
}

export default function MemoTab({ workspaceId, bundle }: TabProps) {
  const dealId = bundle.deal?.dealId ?? bundle.workspace.dealId;

  const [memo, setMemo] = useState<MemoData | null>(null);
  const [stale, setStale] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [error, setError] = useState("");
  const [generating, setGenerating] = useState(false);
  const [approving, setApproving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadFailed(false);
    try {
      const data = await api<{ memo: MemoData | null; stale: boolean }>(
        `/api/platform/diligence/memo?dealId=${encodeURIComponent(dealId)}`
      );
      setMemo(data.memo ?? null);
      setStale(Boolean(data.stale));
    } catch {
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, [dealId]);

  useEffect(() => {
    void load();
  }, [load]);

  const generate = async () => {
    setGenerating(true);
    setError("");
    try {
      await api("/api/platform/diligence/memo", {
        method: "POST",
        body: JSON.stringify({ workspaceId }),
      });
      await load();
    } catch {
      setError("Could not generate the memo draft. Please try again.");
    } finally {
      setGenerating(false);
    }
  };

  const approve = async () => {
    if (!memo || approving) return;
    setApproving(true);
    setError("");
    try {
      await api("/api/platform/diligence/memo/approve", {
        method: "POST",
        body: JSON.stringify({ id: memo.id }),
      });
      await load();
    } catch {
      setError("Could not approve the memo. Please try again.");
    } finally {
      setApproving(false);
    }
  };

  if (loading) return <SkeletonRows rows={5} />;
  if (loadFailed) return <ErrorState onRetry={() => void load()} />;

  if (!memo) {
    return (
      <div className="space-y-5">
        {error && (
          <p className="rounded-xl bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-300">
            {error}
          </p>
        )}
        <div className={cardCls}>
          <h3 className="font-display text-lg font-semibold text-[#0d1f3c] dark:text-white">
            Investment committee memo
          </h3>
          <p className="mt-2 max-w-2xl text-sm text-slate-500 dark:text-white/50">
            No memo has been generated for this deal yet. Generating a draft
            assembles the workspace&apos;s findings, contracts, record checks,
            red flags and risk score into a cited memo. The draft is not
            approved — a partner reviews and approves it here, and the
            recommendation section stays reserved for the partners.
          </p>
          <div className="mt-4">
            <Button
              onClick={() => void generate()}
              loading={generating}
              className="min-h-[44px]"
            >
              Generate draft
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const isApproved = (memo.status || "").toLowerCase() === "approved";
  const sections = memo.payload?.sections ?? [];

  return (
    <div className="space-y-5">
      {error && (
        <p className="rounded-xl bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-300">
          {error}
        </p>
      )}

      {/* Status banner */}
      {isApproved ? (
        <div className="rounded-2xl border border-emerald-300 bg-emerald-50 px-5 py-4 dark:border-emerald-500/40 dark:bg-emerald-500/10">
          <p className="font-display text-lg font-semibold text-emerald-800 dark:text-emerald-200">
            Approved
            {memo.approvedBy ? ` by ${memo.approvedBy}` : ""}
            {memo.approvedAt ? ` on ${fmtDateShort(memo.approvedAt)}` : ""}
          </p>
          <p className="mt-1 text-xs text-emerald-700/80 dark:text-emerald-300/70">
            Version {memo.version} · Generated
            {memo.generatedBy ? ` by ${memo.generatedBy}` : ""} ·{" "}
            {fmtDateTime(memo.generatedAt)}
          </p>
        </div>
      ) : (
        <div className="rounded-2xl border border-amber-300 bg-amber-50 px-5 py-4 dark:border-amber-500/40 dark:bg-amber-500/10">
          <p className="font-display text-lg font-semibold text-amber-800 dark:text-amber-200">
            DRAFT — not approved
          </p>
          <p className="mt-1 text-xs text-amber-700/80 dark:text-amber-300/70">
            Version {memo.version} · Generated
            {memo.generatedBy ? ` by ${memo.generatedBy}` : ""} ·{" "}
            {fmtDateTime(memo.generatedAt)}
          </p>
        </div>
      )}

      {stale && (
        <p className="rounded-xl bg-amber-500/10 px-4 py-3 text-sm font-medium text-amber-800 dark:text-amber-200">
          Source data changed since this draft — regenerate to refresh the
          memo before relying on it.
        </p>
      )}

      {/* Sections */}
      {sections.length === 0 ? (
        <div className={cardCls}>
          <p className="text-sm text-slate-500 dark:text-white/50">
            This memo has no sections yet. Regenerate to rebuild it from the
            current workspace data.
          </p>
        </div>
      ) : (
        sections.map((section) => {
          if (section.key === "recommendation") {
            return (
              <div
                key={section.key}
                className="rounded-2xl border-2 border-dashed border-[#b8975a]/60 bg-[#b8975a]/5 p-5 sm:p-6"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-display text-lg font-semibold text-[#0d1f3c] dark:text-white">
                    {section.title || "Recommendation"}
                  </h3>
                  <span className="badge badge-fit">Reserved</span>
                </div>
                {section.body?.trim() ? (
                  <p className="mt-3 whitespace-pre-wrap text-sm text-slate-600 dark:text-white/80">
                    {section.body}
                  </p>
                ) : (
                  <p className="mt-3 text-sm text-slate-500 dark:text-white/50">
                    Reserved for the partners&apos; recommendation — this
                    section is never generated. Record the recommendation
                    outside the draft and approve the memo when it is final.
                  </p>
                )}
                {section.citations && section.citations.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {section.citations.map((c, i) => (
                      <CitationChip key={`${c.kind}-${c.id}-${i}`} citation={c} />
                    ))}
                  </div>
                )}
              </div>
            );
          }
          return (
            <div key={section.key} className={cardCls}>
              <h3 className="font-display text-lg font-semibold text-[#0d1f3c] dark:text-white">
                {section.title}
              </h3>
              <div className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-slate-600 dark:text-white/80">
                {section.body}
              </div>
              {section.citations && section.citations.length > 0 && (
                <div className="mt-4 flex flex-wrap gap-1.5 border-t border-slate-100 pt-3 dark:border-white/5">
                  {section.citations.map((c, i) => (
                    <CitationChip key={`${c.kind}-${c.id}-${i}`} citation={c} />
                  ))}
                </div>
              )}
            </div>
          );
        })
      )}

      {/* Actions */}
      <div className={cardCls}>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            onClick={() => void generate()}
            loading={generating}
            className="min-h-[44px]"
          >
            Regenerate
          </Button>
          {!isApproved && (
            <Button
              onClick={() => void approve()}
              loading={approving}
              className="min-h-[44px]"
            >
              Approve memo
            </Button>
          )}
        </div>
        <p className="mt-2 text-xs text-slate-400 dark:text-white/40">
          Regenerating creates a new draft version from the current workspace
          data. Approving records who approved this version and when.
        </p>
      </div>
    </div>
  );
}

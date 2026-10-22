"use client";

/**
 * IC tab (Phase 7) — investment committee for one deal:
 * - Scorecard: five areas scored 1–5 with notes (PUT …/ic/scorecard).
 * - Memo: the auto-draft assembled in the Due Diligence workspace
 *   (Phase 5B), shown read-only here with its citations; staleness
 *   is flagged, never hidden. No memo → an honest pointer back to
 *   the Due Diligence workspace, where drafts are generated.
 * - Decisions: the recorded committee decisions with per-partner
 *   votes and conditions.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Button, ErrorState, SkeletonRows } from "@/components/ui";
import {
  API,
  IC_AREAS,
  IC_DECISIONS,
  api,
  cardCls,
  decisionBadge,
  fmtDateShort,
  fmtUpdated,
  inputCls,
  labelCls,
  labelOf,
  selectCls,
  type CapitalTabProps,
  type IcData,
  type MemoCitation,
} from "@/components/capital/types";

const PARTNERS = ["Ethan Canny", "Ronan Canny", "Ian Canny"];
const VOTE_OPTIONS = [
  { key: "approve", label: "Approve" },
  { key: "decline", label: "Decline" },
  { key: "abstain", label: "Abstain" },
];

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

export default function IcTab({ dealId }: CapitalTabProps) {
  const url = `${API}/deals/${encodeURIComponent(dealId)}/ic`;
  const [data, setData] = useState<IcData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [error, setError] = useState("");

  const [scores, setScores] = useState<Record<string, number | null>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [savingCard, setSavingCard] = useState(false);
  const [cardNote, setCardNote] = useState("");

  const [decisionForm, setDecisionForm] = useState({
    decision: "approved",
    conditions: "",
    notes: "",
    votes: PARTNERS.map((voter) => ({ voter, vote: "approve" })),
  });
  const [recording, setRecording] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadFailed(false);
    try {
      const d = await api<IcData>(url);
      setData(d);
      setScores(d.scorecard?.scores ?? {});
      setNotes(d.scorecard?.notes ?? {});
    } catch {
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, [url]);

  useEffect(() => {
    void load();
  }, [load]);

  const saveScorecard = async () => {
    if (savingCard) return;
    setSavingCard(true);
    setError("");
    setCardNote("");
    try {
      await api(`${url}/scorecard`, {
        method: "PUT",
        body: JSON.stringify({ scores, notes }),
      });
      setCardNote("Scorecard saved.");
      await load();
    } catch {
      setError("Could not save the scorecard. Please try again.");
    } finally {
      setSavingCard(false);
    }
  };

  const recordDecision = async () => {
    if (recording) return;
    setRecording(true);
    setError("");
    try {
      await api(`${url}/decisions`, {
        method: "POST",
        body: JSON.stringify({
          decision: decisionForm.decision,
          conditions: decisionForm.conditions.trim(),
          votes: decisionForm.votes,
          notes: decisionForm.notes.trim(),
        }),
      });
      setDecisionForm((f) => ({ ...f, conditions: "", notes: "" }));
      await load();
    } catch {
      setError("Could not record the decision. Please try again.");
    } finally {
      setRecording(false);
    }
  };

  if (loading) return <SkeletonRows rows={5} />;
  if (loadFailed || !data) return <ErrorState onRetry={() => void load()} />;

  const memo = data.memo?.memo ?? null;
  const memoStale = Boolean(data.memo?.stale);
  const scoredCount = IC_AREAS.filter((a) => typeof scores[a.key] === "number").length;
  const avg =
    scoredCount > 0
      ? IC_AREAS.reduce((sum, a) => sum + (scores[a.key] ?? 0), 0) / scoredCount
      : null;

  return (
    <div className="space-y-5">
      {error && (
        <p role="alert" className="rounded-xl bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-300">{error}</p>
      )}

      {/* Scorecard */}
      <div className={cardCls}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="font-display text-lg font-semibold text-[#0d1f3c] dark:text-white">
              IC scorecard
            </h3>
            <p className="mt-0.5 text-xs text-slate-400 dark:text-white/40">
              Scored 1 (weak) – 5 (strong)
              {data.scorecard?.updatedAt
                ? ` · last saved ${fmtUpdated(data.scorecard.updatedAt)}${data.scorecard.updatedBy ? ` by ${data.scorecard.updatedBy}` : ""}`
                : " · not scored yet"}
            </p>
          </div>
          {avg !== null && (
            <p className="tnum font-display text-3xl font-semibold text-[#0d1f3c] dark:text-white">
              {avg.toFixed(1)}<span className="text-base text-slate-400 dark:text-white/40"> / 5</span>
            </p>
          )}
        </div>
        <div className="mt-4 space-y-4">
          {IC_AREAS.map((area) => (
            <div key={area.key} className="grid gap-2 lg:grid-cols-[180px_auto_1fr] lg:items-center">
              <p className="text-sm font-semibold text-[#0d1f3c] dark:text-white">{area.label}</p>
              <div className="flex gap-1.5" role="radiogroup" aria-label={`${area.label} score`}>
                {[1, 2, 3, 4, 5].map((n) => {
                  const active = scores[area.key] === n;
                  return (
                    <button
                      key={n}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      onClick={() =>
                        setScores((s) => ({ ...s, [area.key]: active ? null : n }))
                      }
                      className={`flex h-11 w-11 items-center justify-center rounded-xl border text-sm font-bold transition ${
                        active
                          ? "border-[#b8975a] bg-[#0d1f3c] text-white dark:bg-[#b8975a] dark:text-[#0d1f3c]"
                          : "border-slate-200 text-slate-500 hover:border-[#b8975a] dark:border-white/15 dark:text-white/60"
                      }`}
                    >
                      {n}
                    </button>
                  );
                })}
              </div>
              <input
                className={`${inputCls} min-h-[44px]`}
                value={notes[area.key] ?? ""}
                onChange={(e) => setNotes((s) => ({ ...s, [area.key]: e.target.value }))}
                placeholder={`${area.label} notes…`}
                aria-label={`${area.label} notes`}
              />
            </div>
          ))}
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button onClick={() => void saveScorecard()} loading={savingCard} className="min-h-[44px]">
            Save scorecard
          </Button>
          {cardNote && <span className="text-sm text-emerald-700 dark:text-emerald-300">{cardNote}</span>}
        </div>
      </div>

      {/* Memo */}
      {!memo ? (
        <div className={cardCls}>
          <h3 className="font-display text-lg font-semibold text-[#0d1f3c] dark:text-white">
            IC memo
          </h3>
          <p className="mt-2 max-w-2xl text-sm text-slate-500 dark:text-white/50">
            No IC memo drafted yet — generate one from the Due Diligence
            workspace, where the draft is assembled from this deal&apos;s
            findings, contracts, record checks and analysis with citations.
          </p>
          <div className="mt-4">
            <Link
              href={`/due-diligence/${encodeURIComponent(dealId)}`}
              className="btn btn-secondary btn-sm min-h-[44px]"
            >
              Open Due Diligence workspace
            </Link>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div
            className={`rounded-2xl border px-5 py-4 ${
              (memo.status || "").toLowerCase() === "approved"
                ? "border-emerald-300 bg-emerald-50 dark:border-emerald-500/40 dark:bg-emerald-500/10"
                : "border-amber-300 bg-amber-50 dark:border-amber-500/40 dark:bg-amber-500/10"
            }`}
          >
            <p className="font-display text-lg font-semibold text-[#0d1f3c] dark:text-white">
              IC memo — {(memo.status || "draft").toUpperCase()}
              {memoStale ? " · STALE" : ""}
            </p>
            <p className="mt-1 text-xs text-slate-500 dark:text-white/50">
              Version {memo.version} · generated {fmtDateShort(memo.generatedAt)}
              {memoStale
                ? " · source data changed since this draft — regenerate it in the Due Diligence workspace before relying on it"
                : ""}
            </p>
          </div>
          {(memo.payload?.sections ?? []).map((section) =>
            section.key === "recommendation" ? (
              <div key={section.key} className="rounded-2xl border-2 border-dashed border-[#b8975a]/60 bg-[#b8975a]/5 p-5 sm:p-6">
                <div className="flex flex-wrap items-center gap-2">
                  <h4 className="font-display text-lg font-semibold text-[#0d1f3c] dark:text-white">
                    {section.title || "Recommendation"}
                  </h4>
                  <span className="badge badge-fit">Reserved</span>
                </div>
                <p className="mt-3 whitespace-pre-wrap text-sm text-slate-600 dark:text-white/80">
                  {section.body?.trim() || "Reserved for the partners' recommendation — this section is never generated."}
                </p>
              </div>
            ) : (
              <div key={section.key} className={cardCls}>
                <h4 className="font-display text-lg font-semibold text-[#0d1f3c] dark:text-white">
                  {section.title}
                </h4>
                <div className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-slate-600 dark:text-white/80">
                  {section.body}
                </div>
                {(section.citations ?? []).length > 0 && (
                  <div className="mt-4 flex flex-wrap gap-1.5 border-t border-slate-100 pt-3 dark:border-white/5">
                    {section.citations.map((c, i) => (
                      <CitationChip key={`${c.kind}-${c.id}-${i}`} citation={c} />
                    ))}
                  </div>
                )}
              </div>
            )
          )}
        </div>
      )}

      {/* Decisions */}
      <div className={cardCls}>
        <h3 className="font-display text-lg font-semibold text-[#0d1f3c] dark:text-white">
          Decisions
        </h3>
        {(data.decisions ?? []).length === 0 ? (
          <p className="mt-2 text-sm text-slate-500 dark:text-white/50">
            No committee decision recorded for this deal yet.
          </p>
        ) : (
          <ul className="mt-3 space-y-3">
            {data.decisions.map((d) => (
              <li key={d.id} className="rounded-2xl border border-slate-200 p-4 dark:border-white/10">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`badge ${decisionBadge(d.decision)}`}>
                    {labelOf(IC_DECISIONS, d.decision)}
                  </span>
                  <span className="text-xs text-slate-400 dark:text-white/40">
                    {fmtDateShort(d.decidedAt)}
                    {d.decidedBy ? ` · recorded by ${d.decidedBy}` : ""}
                  </span>
                </div>
                {d.conditions && (
                  <p className="mt-2 text-sm text-slate-600 dark:text-white/80">
                    <span className="font-semibold">Conditions: </span>
                    {d.conditions}
                  </p>
                )}
                {(d.votes ?? []).length > 0 && (
                  <p className="mt-2 flex flex-wrap gap-1.5">
                    {d.votes.map((v) => (
                      <span key={v.voter} className="badge badge-neutral">
                        {v.voter}: {v.vote}
                      </span>
                    ))}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}

        <div className="mt-5 border-t border-slate-100 pt-4 dark:border-white/5">
          <h4 className="text-sm font-semibold text-[#0d1f3c] dark:text-white">Record a decision</h4>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div>
              <label className={labelCls}>Decision</label>
              <select className={`${selectCls} min-h-[44px]`} value={decisionForm.decision} onChange={(e) => setDecisionForm((f) => ({ ...f, decision: e.target.value }))}>
                {IC_DECISIONS.map((d) => (
                  <option key={d.key} value={d.key}>{d.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls}>Conditions</label>
              <input className={`${inputCls} min-h-[44px]`} value={decisionForm.conditions} onChange={(e) => setDecisionForm((f) => ({ ...f, conditions: e.target.value }))} placeholder="Required when approving with conditions" />
            </div>
            {decisionForm.votes.map((v, i) => (
              <div key={v.voter}>
                <label className={labelCls}>{v.voter}</label>
                <select
                  className={`${selectCls} min-h-[44px]`}
                  value={v.vote}
                  onChange={(e) =>
                    setDecisionForm((f) => ({
                      ...f,
                      votes: f.votes.map((x, xi) => (xi === i ? { ...x, vote: e.target.value } : x)),
                    }))
                  }
                >
                  {VOTE_OPTIONS.map((o) => (
                    <option key={o.key} value={o.key}>{o.label}</option>
                  ))}
                </select>
              </div>
            ))}
            <div className="sm:col-span-2">
              <label className={labelCls}>Notes</label>
              <textarea className={`${inputCls} min-h-[64px]`} value={decisionForm.notes} onChange={(e) => setDecisionForm((f) => ({ ...f, notes: e.target.value }))} />
            </div>
          </div>
          <div className="mt-4">
            <Button onClick={() => void recordDecision()} loading={recording} className="min-h-[44px]">
              {recording ? "Recording…" : "Record decision"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

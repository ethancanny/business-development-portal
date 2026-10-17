"use client";

import { useMemo, useState, type ReactNode } from "react";
import PersonAvatar from "@/components/PersonAvatar";
import SectorChip from "@/components/SectorChip";
import { AGING_COLORS } from "@/lib/sector-colors";
import type { OperatorCandidate } from "@/lib/candidates-db";

/**
 * Operator Candidates UI (Operator Discovery spec, Build 4 — Oct 16,
 * 2026): the Directory → Operators → Candidates sub-tab. List sorted
 * by score (unscored last), sector + location-verified + no-touch
 * filters, a profile pane with score factors / matches / conflicts,
 * review actions (Mark verified, Add to Directory, Pass with reason),
 * and the §6 outreach kit: prep note, touch logging, and a
 * draft-first-message composer. MANUAL SEND ONLY: the composer
 * produces text Ethan copies and sends himself — nothing here
 * transmits a message anywhere.
 */

export type CandidateWithSector = OperatorCandidate & { sector: string };

export const PASS_REASONS = [
  "Not a fit — sector",
  "Not a fit — company size",
  "Not a fit — experience",
  "Timing — not available",
  "Not interested",
  "Unresponsive",
  "Location",
  "Duplicate record",
  "Other",
] as const;

const ACTIVE_STATUSES = ["Candidate", "Verified", "Contacted", "Interviewing"];

export function fmtDate(iso: string): string {
  if (!iso) return "—";
  const d = new Date(`${iso.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/** Days since the last touch (or since found, when never touched) for
 * active candidates; null when the 30-day flag does not apply. */
export function noTouchDays(c: OperatorCandidate): number | null {
  if (!ACTIVE_STATUSES.includes(c.status)) return null;
  const ref = c.lastTouch || c.dateFound;
  if (!ref) return null;
  const refMs = new Date(`${ref.slice(0, 10)}T12:00:00`).getTime();
  if (Number.isNaN(refMs)) return null;
  const days = Math.floor((Date.now() - refMs) / 86400000);
  return days >= 30 ? days : null;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-white/40">
        {label}
      </p>
      <div className="mt-0.5 text-sm font-medium text-[#0d1f3c] dark:text-white">
        {children}
      </div>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const styles: Record<string, string> = {
    Candidate: "bg-slate-100 text-slate-600 dark:bg-white/10 dark:text-white/60",
    Verified:
      "bg-[#b8975a]/15 text-[#8a6f3e] dark:bg-[#b8975a]/20 dark:text-[#d4b37a]",
    Contacted: "bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-300",
    Interviewing:
      "bg-violet-100 text-violet-800 dark:bg-violet-500/15 dark:text-violet-300",
    Paired:
      "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300",
    Passed: "bg-slate-200 text-slate-500 dark:bg-white/10 dark:text-white/40",
  };
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${styles[status] ?? styles.Candidate}`}
    >
      {status}
    </span>
  );
}

function ScoreBadge({ score }: { score: number | null }) {
  if (score === null) {
    return (
      <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-400 dark:bg-white/10 dark:text-white/40">
        Unscored
      </span>
    );
  }
  return (
    <span
      className={`tnum shrink-0 rounded-full px-2 py-0.5 text-xs font-bold ${
        score >= 80
          ? "bg-[#b8975a] text-white dark:text-[#0d1f3c]"
          : score >= 65
            ? "bg-[#0d1f3c] text-white dark:bg-white/15 dark:text-white"
            : "bg-slate-100 text-slate-600 dark:bg-white/10 dark:text-white/60"
      }`}
      title="Fit score (0–100)"
    >
      {score}
    </span>
  );
}

/* ============================== List ============================== */

interface ListProps {
  candidates: CandidateWithSector[];
  q: string;
  selectedId: string | null;
  busyId: string | null;
  onSelect: (c: CandidateWithSector) => void;
  onVerify: (c: CandidateWithSector) => void;
  onAdd: (c: CandidateWithSector) => void;
  onPass: (c: CandidateWithSector) => void;
}

export function CandidateList({
  candidates,
  q,
  selectedId,
  busyId,
  onSelect,
  onVerify,
  onAdd,
  onPass,
}: ListProps) {
  const [sectorFilter, setSectorFilter] = useState<"all" | "focus" | "other">(
    "all"
  );
  const [unverifiedOnly, setUnverifiedOnly] = useState(false);
  const [noTouchOnly, setNoTouchOnly] = useState(false);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const sorted = [...candidates].sort((a, b) => {
      if (a.score === null && b.score === null)
        return a.name.localeCompare(b.name);
      if (a.score === null) return 1;
      if (b.score === null) return -1;
      if (b.score !== a.score) return b.score - a.score;
      return a.name.localeCompare(b.name);
    });
    return sorted.filter((c) => {
      if (sectorFilter === "focus" && !c.focusSector) return false;
      if (sectorFilter === "other" && c.focusSector) return false;
      if (unverifiedOnly && c.locationVerified) return false;
      if (noTouchOnly && noTouchDays(c) === null) return false;
      if (needle) {
        const hay =
          `${c.name} ${c.currentTitle} ${c.company} ${c.city} ${c.industry} ${c.sourceType}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [candidates, q, sectorFilter, unverifiedOnly, noTouchOnly]);

  const segBtn = (active: boolean) =>
    `px-3 py-1.5 text-xs font-semibold transition ${
      active
        ? "bg-[#0d1f3c] text-white dark:bg-[#b8975a] dark:text-[#0d1f3c]"
        : "bg-white text-slate-500 hover:bg-slate-100 dark:bg-transparent dark:text-white/60"
    }`;
  const togglePill = (active: boolean) =>
    `rounded-full border px-2.5 py-1 text-[11px] font-semibold transition ${
      active
        ? "border-[#b8975a] bg-[#b8975a]/15 text-[#8a6f3e] dark:text-[#d4b37a]"
        : "border-slate-200 text-slate-500 hover:border-[#b8975a]/60 dark:border-white/10 dark:text-white/60"
    }`;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex shrink-0 overflow-hidden rounded-lg border border-slate-200 dark:border-white/15">
          {(
            [
              ["all", "All"],
              ["focus", "Focus sectors"],
              ["other", "Other"],
            ] as const
          ).map(([v, label]) => (
            <button
              key={v}
              onClick={() => setSectorFilter(v)}
              className={segBtn(sectorFilter === v)}
            >
              {label}
            </button>
          ))}
        </div>
        <button
          onClick={() => setUnverifiedOnly((v) => !v)}
          className={togglePill(unverifiedOnly)}
          aria-pressed={unverifiedOnly}
        >
          Location unverified
        </button>
        <button
          onClick={() => setNoTouchOnly((v) => !v)}
          className={togglePill(noTouchOnly)}
          aria-pressed={noTouchOnly}
        >
          No touch 30d+
        </button>
      </div>
      <p className="mb-2 text-xs text-slate-400 dark:text-white/40">
        Showing {rows.length} of {candidates.length} candidates · sorted by
        score
      </p>
      {rows.length === 0 ? (
        <p className="text-sm text-slate-400 dark:text-white/40">
          No candidates match those filters.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {rows.map((c) => {
            const active = selectedId === c.id;
            const stale = noTouchDays(c);
            const busy = busyId === c.id;
            return (
              <li key={c.id}>
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => onSelect(c)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") onSelect(c);
                  }}
                  className={`w-full cursor-pointer rounded-xl border px-3 py-2.5 text-left transition ${
                    active
                      ? "border-[#b8975a] bg-[#b8975a]/10 ring-1 ring-[#b8975a]"
                      : "border-slate-200 bg-white hover:border-[#b8975a]/60 dark:border-white/10 dark:bg-[#132847]/60"
                  }`}
                >
                  <span className="flex items-start gap-2.5">
                    <PersonAvatar name={c.name} size={28} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline justify-between gap-2">
                        <span className="truncate text-sm font-semibold text-[#0d1f3c] dark:text-white">
                          {c.name}
                        </span>
                        <ScoreBadge score={c.score} />
                      </span>
                      <span className="mt-0.5 block truncate text-xs text-slate-400 dark:text-white/40">
                        {[c.currentTitle, c.company]
                          .filter((s) => s && s.trim())
                          .join(" · ") || "Operator"}
                        {c.city ? ` · ${c.city}` : ""}
                      </span>
                      <span className="mt-1.5 flex flex-wrap items-center gap-1">
                        <SectorChip sector={c.sector} />
                        {c.status !== "Candidate" && (
                          <StatusPill status={c.status} />
                        )}
                        {!c.locationVerified && (
                          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-500 dark:bg-white/10 dark:text-white/50">
                            Location unverified
                          </span>
                        )}
                        {c.conflicts.length > 0 && (
                          <span
                            className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-600 dark:bg-white/10 dark:text-white/60"
                            title={c.conflicts
                              .map((x) => x.detail)
                              .join("; ")}
                          >
                            ⚠ Conflict
                          </span>
                        )}
                        {stale !== null && (
                          <span
                            className="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide"
                            style={{
                              backgroundColor: `${AGING_COLORS.warn}26`,
                              color: AGING_COLORS.warn,
                            }}
                          >
                            No touch · {stale}d
                          </span>
                        )}
                        {c.directoryExecId && (
                          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300">
                            In Directory ✓
                          </span>
                        )}
                      </span>
                      <span className="mt-1 block text-[11px] text-slate-400 dark:text-white/40">
                        {c.sourceType || "Source"} · found {fmtDate(c.dateFound)}
                      </span>
                      <span className="mt-1.5 flex flex-wrap gap-1.5">
                        {c.status === "Candidate" && (
                          <button
                            disabled={busy}
                            onClick={(e) => {
                              e.stopPropagation();
                              onVerify(c);
                            }}
                            className="rounded-md border border-[#b8975a]/60 px-2 py-0.5 text-[11px] font-semibold text-[#8a6f3e] transition hover:bg-[#b8975a]/15 disabled:opacity-50 dark:text-[#d4b37a]"
                          >
                            ✓ Mark verified
                          </button>
                        )}
                        {!c.directoryExecId && c.status !== "Passed" && (
                          <button
                            disabled={busy}
                            onClick={(e) => {
                              e.stopPropagation();
                              onAdd(c);
                            }}
                            className="rounded-md border border-slate-300 px-2 py-0.5 text-[11px] font-semibold text-slate-600 transition hover:bg-slate-50 disabled:opacity-50 dark:border-white/15 dark:text-white/70 dark:hover:bg-white/5"
                          >
                            + Add to Directory
                          </button>
                        )}
                        {c.status !== "Passed" && (
                          <button
                            disabled={busy}
                            onClick={(e) => {
                              e.stopPropagation();
                              onPass(c);
                            }}
                            className="rounded-md border border-slate-300 px-2 py-0.5 text-[11px] font-semibold text-slate-500 transition hover:bg-slate-50 disabled:opacity-50 dark:border-white/15 dark:text-white/60 dark:hover:bg-white/5"
                          >
                            Pass
                          </button>
                        )}
                      </span>
                    </span>
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/* ============================= Profile ============================= */

interface ProfileProps {
  candidate: CandidateWithSector;
  busy: boolean;
  passOpen: boolean;
  onVerify: (c: CandidateWithSector) => void;
  onAdd: (c: CandidateWithSector) => void;
  onPassToggle: (c: CandidateWithSector | null) => void;
  onPassSubmit: (c: CandidateWithSector, reason: string) => void;
  onRestore: (c: CandidateWithSector) => void;
  onPatch: (c: CandidateWithSector, patch: Record<string, unknown>) => void;
  onViewExec: (execId: string) => void;
}

function draftMessage(c: OperatorCandidate & { sector: string }): string {
  const first = (c.name || "").trim().split(/\s+/)[0] || "there";
  const role = [c.currentTitle, c.company].filter((s) => s && s.trim()).join(" at ");
  const sectorText = c.focusSector
    ? c.sector !== "Other"
      ? c.sector
      : c.industry
    : c.industry || "your industry";
  const referrerBit = c.referrer
    ? ` ${c.referrer} mentioned your name in connection with this.`
    : "";
  return [
    `Hi ${first} —`,
    ``,
    `I'm Ethan Canny, a partner at Canny Capital Partners here in Arizona. We acquire and operate lower-middle-market Arizona businesses, and we partner with experienced operators to run them.`,
    ``,
    `Your background${role ? ` as ${role}` : ""} stood out.${referrerBit} I'd like to introduce myself and compare notes on the ${sectorText || "Arizona"} market — no agenda beyond a conversation about what you're seeing, and what might come next for you.`,
    ``,
    `Open to a brief call next week?`,
    ``,
    `Best,`,
    `Ethan Canny`,
    `Canny Capital Partners`,
  ].join("\n");
}

export function CandidateProfile({
  candidate: c,
  busy,
  passOpen,
  onVerify,
  onAdd,
  onPassToggle,
  onPassSubmit,
  onRestore,
  onPatch,
  onViewExec,
}: ProfileProps) {
  const [passReason, setPassReason] = useState<string>(PASS_REASONS[0]);
  const [prep, setPrep] = useState<string | null>(null);
  const [touchDate, setTouchDate] = useState("");
  const [nextStep, setNextStep] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [copied, setCopied] = useState(false);
  const stale = noTouchDays(c);

  const smallBtn =
    "rounded-lg px-3 py-1.5 text-xs font-semibold transition disabled:opacity-50";
  const primaryBtn = `${smallBtn} bg-[#0d1f3c] text-white hover:bg-[#1a3455] dark:bg-[#b8975a] dark:text-[#0d1f3c] dark:hover:bg-[#d4b37a]`;
  const ghostBtn = `${smallBtn} border border-slate-300 text-slate-600 hover:bg-slate-50 dark:border-white/15 dark:text-white/70 dark:hover:bg-white/5`;
  const inputCls =
    "w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-[#0d1f3c] outline-none focus:border-[#b8975a] dark:border-white/15 dark:bg-white/5 dark:text-white";

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-violet-100 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-violet-800 dark:bg-violet-500/15 dark:text-violet-300">
          Candidate
        </span>
        <StatusPill status={c.status} />
        <SectorChip sector={c.sector} />
        {!c.locationVerified && (
          <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-500 dark:bg-white/10 dark:text-white/50">
            Location unverified
          </span>
        )}
        {stale !== null && (
          <span
            className="rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide"
            style={{
              backgroundColor: `${AGING_COLORS.warn}26`,
              color: AGING_COLORS.warn,
            }}
          >
            No touch in {stale} days
          </span>
        )}
      </div>
      <h3 className="mt-3 flex items-center gap-3 text-2xl font-bold text-[#0d1f3c] dark:text-white">
        <PersonAvatar name={c.name} size={36} />
        {c.name}
      </h3>
      <p className="mt-0.5 text-sm text-slate-500 dark:text-white/60">
        {[c.currentTitle, c.company].filter((s) => s && s.trim()).join(" · ") ||
          "Operator candidate"}
        {c.city ? ` — ${c.city}` : ""}
      </p>

      {/* Review actions */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {c.status === "Candidate" && (
          <button disabled={busy} onClick={() => onVerify(c)} className={primaryBtn}>
            ✓ Mark verified
          </button>
        )}
        {c.directoryExecId ? (
          <button onClick={() => onViewExec(c.directoryExecId)} className={primaryBtn}>
            In Directory ✓ — view record
          </button>
        ) : (
          c.status !== "Passed" && (
            <button disabled={busy} onClick={() => onAdd(c)} className={primaryBtn}>
              + Add to Directory
            </button>
          )
        )}
        {c.status !== "Passed" ? (
          <button
            disabled={busy}
            onClick={() => onPassToggle(passOpen ? null : c)}
            className={ghostBtn}
          >
            Pass…
          </button>
        ) : (
          <button disabled={busy} onClick={() => onRestore(c)} className={ghostBtn}>
            Restore to Candidate
          </button>
        )}
        {c.score !== null && (
          <span className="ml-auto text-sm text-slate-500 dark:text-white/50">
            Fit score{" "}
            <span className="tnum font-display text-2xl font-semibold text-[#0d1f3c] dark:text-white">
              {c.score}
            </span>
            /100
          </span>
        )}
        {c.score === null && (
          <span className="ml-auto text-xs text-slate-400 dark:text-white/40">
            Unscored{c.locationVerified ? "" : " — location unverified"}
          </span>
        )}
      </div>
      {passOpen && c.status !== "Passed" && (
        <div className="mt-3 flex flex-wrap items-end gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-white/10 dark:bg-white/[0.04]">
          <label className="block min-w-[200px] flex-1">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-white/40">
              Pass reason
            </span>
            <select
              className={`${inputCls} mt-1`}
              value={passReason}
              onChange={(e) => setPassReason(e.target.value)}
            >
              {PASS_REASONS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </label>
          <button
            disabled={busy}
            onClick={() => onPassSubmit(c, passReason)}
            className={primaryBtn}
          >
            Pass candidate
          </button>
          <button onClick={() => onPassToggle(null)} className={ghostBtn}>
            Cancel
          </button>
        </div>
      )}
      {c.status === "Passed" && c.passReason && (
        <p className="mt-3 rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-600 dark:bg-white/[0.06] dark:text-white/70">
          Passed — {c.passReason}
        </p>
      )}

      {/* Score factors */}
      {c.scoreFactors && c.scoreFactors.components.length > 0 && (
        <div className="mt-5">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-white/40">
            Why this score
          </p>
          <ul className="mt-2 space-y-2.5">
            {c.scoreFactors.components.map((comp) => (
              <li key={comp.key}>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-sm font-medium text-[#0d1f3c] dark:text-white">
                    {comp.label}
                  </span>
                  <span className="tnum text-xs font-semibold text-slate-500 dark:text-white/50">
                    {comp.points}/{comp.max}
                  </span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-white/10">
                  <div
                    className="h-full rounded-full bg-[#b8975a]"
                    style={{
                      width: `${comp.max > 0 ? Math.min(100, Math.round((comp.points / comp.max) * 100)) : 0}%`,
                    }}
                  />
                </div>
                {comp.evidence.length > 0 && (
                  <p className="mt-0.5 text-xs text-slate-400 dark:text-white/40">
                    {comp.evidence.join(" · ")}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-3">
        <Field label="Industry">{c.industry || "—"}</Field>
        <Field label="City">{c.city || "—"}</Field>
        <Field label="Target role">{c.targetRole || "—"}</Field>
        <Field label="Source">
          {c.sourceUrl ? (
            <a
              href={c.sourceUrl}
              target="_blank"
              rel="noreferrer"
              className="underline decoration-[#b8975a] decoration-2 underline-offset-2"
            >
              {c.sourceType || "Source"}
            </a>
          ) : (
            c.sourceType || "—"
          )}
        </Field>
        <Field label="Date found">{fmtDate(c.dateFound)}</Field>
        <Field label="Last seen">{fmtDate(c.lastSeen)}</Field>
        {c.referrer && <Field label="Referrer">{c.referrer}</Field>}
        <Field label="Sightings">{c.sightings.length || 1}</Field>
        <Field label="Last touch">
          {c.lastTouch ? fmtDate(c.lastTouch) : "Never"}
        </Field>
      </div>

      {c.fitNotes && (
        <div className="mt-5">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-white/40">
            Fit notes
          </p>
          <div className="mt-1 max-h-56 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-sm leading-relaxed text-slate-600 dark:bg-white/[0.04] dark:text-white/75">
            {c.fitNotes}
          </div>
        </div>
      )}

      {c.matchedTargets.length > 0 && (
        <div className="mt-5">
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-white/40">
            Top matches
          </p>
          <ul className="space-y-1.5">
            {c.matchedTargets.map((m) => (
              <li
                key={`${m.type}-${m.id}`}
                className="rounded-lg border border-slate-100 px-3 py-2 dark:border-white/10"
              >
                <span className="flex items-baseline justify-between gap-2">
                  <span className="text-sm font-semibold text-[#0d1f3c] dark:text-white">
                    {m.name}
                  </span>
                  <span className="tnum shrink-0 text-xs font-bold text-[#8a6f3e] dark:text-[#d4b37a]">
                    match {m.matchScore}
                  </span>
                </span>
                <span className="mt-0.5 block text-xs text-slate-400 dark:text-white/40">
                  {m.type === "deal" ? "Pipeline deal" : "Fit target"} · {m.sector}
                  {m.city ? ` · ${m.city}` : ""} · {m.relation}
                </span>
                {m.basis && (
                  <span className="mt-0.5 block text-xs text-slate-500 dark:text-white/50">
                    {m.basis}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {c.conflicts.length > 0 && (
        <div className="mt-5">
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-white/40">
            Conflict flags — review before outreach
          </p>
          <ul className="space-y-1">
            {c.conflicts.map((x, i) => (
              <li
                key={i}
                className="rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-600 dark:bg-white/[0.06] dark:text-white/70"
              >
                ⚠ {x.detail || x.name}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Outreach — manual send only */}
      <div className="mt-6 border-t border-slate-100 pt-4 dark:border-white/10">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-white/40">
          Outreach prep
        </p>
        <label className="mt-2 block">
          <span className="text-xs font-medium text-slate-500 dark:text-white/50">
            Prep note (talking points, context, cautions — only you see this)
          </span>
          <textarea
            className={`${inputCls} mt-1 min-h-[72px]`}
            value={prep ?? c.prepNotes}
            onChange={(e) => setPrep(e.target.value)}
            placeholder="e.g. Met at AZMFG summit; exiting current role in Q1; wants Phoenix only…"
          />
        </label>
        <div className="mt-2 flex justify-end">
          <button
            disabled={busy || prep === null || prep === c.prepNotes}
            onClick={() => {
              onPatch(c, { prepNotes: prep ?? "" });
              setPrep(null);
            }}
            className={primaryBtn}
          >
            Save prep note
          </button>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-[170px_1fr_auto] sm:items-end">
          <label className="block">
            <span className="text-xs font-medium text-slate-500 dark:text-white/50">
              Log a touch — date
            </span>
            <input
              type="date"
              className={`${inputCls} mt-1`}
              value={touchDate}
              onChange={(e) => setTouchDate(e.target.value)}
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-slate-500 dark:text-white/50">
              Next step
            </span>
            <input
              className={`${inputCls} mt-1`}
              value={nextStep ?? c.nextStep}
              onChange={(e) => setNextStep(e.target.value)}
              placeholder="e.g. Send intro email Thursday"
            />
          </label>
          <button
            disabled={busy}
            onClick={() => {
              const todayStr = new Date().toLocaleDateString("en-CA");
              onPatch(c, {
                lastTouch: touchDate || todayStr,
                nextStep: nextStep ?? c.nextStep,
              });
              setTouchDate("");
              setNextStep(null);
            }}
            className={primaryBtn}
          >
            Log touch
          </button>
        </div>
        {c.nextStep && (
          <p className="mt-1.5 text-xs text-slate-400 dark:text-white/40">
            Next step on file: {c.nextStep}
          </p>
        )}

        <div className="mt-4">
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => {
                setDraft(draftMessage(c));
                setCopied(false);
              }}
              className={ghostBtn}
            >
              ✎ Draft first message
            </button>
            <span className="text-[11px] text-slate-400 dark:text-white/40">
              Draft only — copy it and send it yourself. The portal never
              sends outreach.
            </span>
          </div>
          {draft && (
            <div className="mt-2">
              <textarea
                className={`${inputCls} min-h-[220px] font-normal leading-relaxed`}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
              />
              <div className="mt-2 flex justify-end">
                <button
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(draft);
                      setCopied(true);
                      setTimeout(() => setCopied(false), 2000);
                    } catch {
                      /* clipboard unavailable — the text is selectable */
                    }
                  }}
                  className={primaryBtn}
                >
                  {copied ? "Copied ✓" : "Copy draft"}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ============================ Analytics ============================ */

export function CandidateAnalytics({
  candidates,
}: {
  candidates: CandidateWithSector[];
}) {
  const stats = useMemo(() => {
    const bySource = new Map<string, OperatorCandidate[]>();
    for (const c of candidates) {
      const key = c.sourceType || "Unknown";
      const arr = bySource.get(key) ?? [];
      arr.push(c);
      bySource.set(key, arr);
    }
    const sourceRows = Array.from(bySource.entries())
      .map(([source, arr]) => {
        const verifiedPlus = arr.filter((c) =>
          ["Verified", "Contacted", "Interviewing", "Paired"].includes(c.status)
        ).length;
        return {
          source,
          total: arr.length,
          verifiedPlus,
          rate: arr.length ? verifiedPlus / arr.length : 0,
        };
      })
      .sort((a, b) => b.total - a.total);
    const bestSources = [...sourceRows]
      .filter((r) => r.total >= 3)
      .sort((a, b) => b.rate - a.rate || b.total - a.total)
      .slice(0, 3);
    const funnel = (
      ["Candidate", "Verified", "Contacted", "Interviewing", "Paired", "Passed"] as const
    ).map((s) => ({
      status: s,
      count: candidates.filter((c) => c.status === s).length,
    }));
    const focus = candidates.filter((c) => c.focusSector).length;
    return {
      sourceRows: sourceRows.slice(0, 8),
      bestSources,
      funnel,
      focus,
      other: candidates.length - focus,
    };
  }, [candidates]);

  const panel =
    "rounded-xl border border-slate-100 p-4 dark:border-white/10";
  const panelTitle =
    "text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-white/40";

  return (
    <section className="card-surface mt-6 p-5">
      <h2 className="font-display text-2xl font-semibold text-[#0d1f3c] dark:text-white">
        Sourcing analytics
      </h2>
      <p className="mt-1 text-xs text-slate-400 dark:text-white/40">
        Computed live from the {candidates.length} candidate records.
      </p>
      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className={panel}>
          <p className={panelTitle}>Funnel</p>
          <ul className="mt-2 space-y-1">
            {stats.funnel.map((f) => (
              <li
                key={f.status}
                className="flex items-baseline justify-between text-sm"
              >
                <span className="text-slate-600 dark:text-white/70">{f.status}</span>
                <span className="tnum font-semibold text-[#0d1f3c] dark:text-white">
                  {f.count}
                </span>
              </li>
            ))}
          </ul>
        </div>
        <div className={panel}>
          <p className={panelTitle}>By source type</p>
          <ul className="mt-2 space-y-1">
            {stats.sourceRows.map((r) => (
              <li
                key={r.source}
                className="flex items-baseline justify-between gap-2 text-sm"
              >
                <span className="truncate text-slate-600 dark:text-white/70">
                  {r.source}
                </span>
                <span className="tnum shrink-0 font-semibold text-[#0d1f3c] dark:text-white">
                  {r.total}
                </span>
              </li>
            ))}
          </ul>
        </div>
        <div className={panel}>
          <p className={panelTitle}>Focus vs other sectors</p>
          <div className="mt-2 space-y-1 text-sm">
            <p className="flex items-baseline justify-between">
              <span className="text-slate-600 dark:text-white/70">Focus sectors</span>
              <span className="tnum font-semibold text-[#0d1f3c] dark:text-white">
                {stats.focus}
                {candidates.length
                  ? ` (${Math.round((stats.focus / candidates.length) * 100)}%)`
                  : ""}
              </span>
            </p>
            <p className="flex items-baseline justify-between">
              <span className="text-slate-600 dark:text-white/70">Other sectors</span>
              <span className="tnum font-semibold text-[#0d1f3c] dark:text-white">
                {stats.other}
                {candidates.length
                  ? ` (${Math.round((stats.other / candidates.length) * 100)}%)`
                  : ""}
              </span>
            </p>
          </div>
        </div>
        <div className={panel}>
          <p className={panelTitle}>Best sources (Verified+ rate)</p>
          {stats.bestSources.length === 0 ? (
            <p className="mt-2 text-sm text-slate-400 dark:text-white/40">
              No source has 3+ candidates yet.
            </p>
          ) : (
            <ul className="mt-2 space-y-1">
              {stats.bestSources.map((r) => (
                <li key={r.source} className="text-sm">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-slate-600 dark:text-white/70">
                      {r.source}
                    </span>
                    <span className="tnum shrink-0 font-semibold text-[#0d1f3c] dark:text-white">
                      {Math.round(r.rate * 100)}%
                    </span>
                  </span>
                  <span className="text-xs text-slate-400 dark:text-white/40">
                    {r.verifiedPlus} of {r.total} reached Verified+
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}

"use client";

import type { FocusImpact, FocusMode } from "@/lib/platform/focus-shared";

/**
 * Focus-change confirmation (spec §1): before a workspace Focus
 * change applies, list exactly what will be hidden or paused (→
 * Aerospace & Defense) and what will be restored (→ All sectors).
 * The impact payload comes from GET /api/platform/settings/focus
 * (live counts), so the dialog never guesses. Shared by the Settings
 * page and the user-menu quick switch.
 */
export default function FocusConfirmDialog({
  open,
  target,
  impact,
  busy,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  target: FocusMode;
  impact: FocusImpact | null;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (!open) return null;
  const toAd = target === "ad";
  return (
    <div
      className="fixed inset-0 z-[90] flex items-end justify-center bg-[#081426]/60 p-0 backdrop-blur-[2px] sm:items-center sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label={toAd ? "Switch focus to Aerospace & Defense" : "Switch focus to All sectors"}
      onClick={() => !busy && onCancel()}
    >
      <div
        className="card-surface max-h-[88dvh] w-full max-w-lg overflow-y-auto rounded-t-3xl p-6 sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="micro-label">Workspace focus</p>
        <h2 className="font-display mt-1 text-2xl text-[#0d1f3c] dark:text-white">
          {toAd ? "Focus on Aerospace & Defense?" : "Return to All sectors?"}
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-white/65">
          {toAd
            ? "Nothing is deleted. Out-of-focus records stay fully accessible behind the “Show out-of-focus” toggle on each list, and everything returns when you switch back."
            : "Every paused pull resumes on its normal schedule and all sectors, records, and copy return."}
        </p>

        {impact ? (
          <div className="mt-4 space-y-4 text-sm">
            {(toAd ? impact.willHide : impact.willRestore).length > 0 && (
              <div>
                <p className="micro-label mb-1.5">
                  {toAd ? "Will be flagged “Out of focus”" : "Will be restored"}
                </p>
                <ul className="space-y-1 text-slate-600 dark:text-white/70">
                  {(toAd ? impact.willHide : impact.willRestore).map((line) => (
                    <li key={line} className="flex gap-2">
                      <span aria-hidden className="text-[#b8975a]">•</span>
                      <span>{line}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {toAd && impact.willPause.length > 0 && (
              <div>
                <p className="micro-label mb-1.5">Pulls that will pause</p>
                <ul className="space-y-1 text-slate-600 dark:text-white/70">
                  {impact.willPause.map((line) => (
                    <li key={line} className="flex gap-2">
                      <span aria-hidden className="text-[#b8975a]">•</span>
                      <span>{line}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        ) : (
          <p className="mt-4 text-sm text-slate-500 dark:text-white/55">
            Loading the current counts…
          </p>
        )}

        <div className="mt-6 flex flex-wrap justify-end gap-2">
          <button type="button" className="btn btn-secondary btn-sm" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={onConfirm}
            disabled={busy || !impact}
            data-loading={busy ? "true" : undefined}
          >
            {busy
              ? "Applying…"
              : toAd
                ? "Switch to Aerospace & Defense"
                : "Switch to All sectors"}
          </button>
        </div>
      </div>
    </div>
  );
}

"use client";

import CompanyMark from "./CompanyMark";

/**
 * Wrong-deal protection (Deal Identity System, Oct 24, 2026): a
 * reusable confirmation dialog for consequential deal actions —
 * sending a report, sharing a data room, inviting a guest, signing
 * or sending a contract, deleting a record. It NAMES the deal with
 * its mark and codename so the human confirms the exact deal before
 * anything irreversible leaves the portal.
 *
 * Controlled component: the caller owns `open`, renders the action
 * behind onConfirm, and keeps its own busy/error states.
 */
export default function ConfirmDealDialog({
  open,
  actionLabel,
  companyId,
  companyName,
  codename,
  logoVersion = 0,
  detail,
  danger = false,
  busy = false,
  confirmLabel,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  /** Verb phrase for the action, e.g. "Send report" / "Share data room". */
  actionLabel: string;
  companyId?: string;
  companyName: string;
  codename?: string | null;
  logoVersion?: number;
  /** Optional one-line context (recipient, room name, …). */
  detail?: string;
  danger?: boolean;
  busy?: boolean;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center sm:p-6"
      role="alertdialog"
      aria-modal="true"
      aria-label={`${actionLabel} — confirm the deal`}
      onClick={onCancel}
    >
      <div
        className="w-full max-w-md rounded-t-2xl bg-white p-5 shadow-xl dark:bg-[#101b30] sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="micro-label">{actionLabel}</p>
        <div className="mt-2.5 flex items-center gap-3">
          <CompanyMark
            companyId={companyId}
            name={companyName}
            logoVersion={logoVersion}
            size={40}
            rounded="rounded-lg"
          />
          <div className="min-w-0">
            <p className="truncate font-display text-lg font-semibold text-slate-900 dark:text-white">
              {companyName}
            </p>
            {codename ? (
              <p className="text-xs text-caption">
                Codename:{" "}
                <span className="font-semibold uppercase tracking-wide text-gold-700 dark:text-gold-400">
                  {codename}
                </span>
              </p>
            ) : (
              <p className="text-xs text-caption">No codename set</p>
            )}
          </div>
        </div>
        <p className="mt-3 text-sm leading-relaxed text-slate-600 dark:text-white/75">
          You are about to {actionLabel.charAt(0).toLowerCase() + actionLabel.slice(1)}{" "}
          for <strong className="text-slate-900 dark:text-white">{companyName}</strong>.
          {detail ? <> {detail}</> : null} Double-check this is the right deal
          before continuing.
        </p>
        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            type="button"
            className="btn-secondary text-sm"
            onClick={onCancel}
            disabled={busy}
          >
            Cancel
          </button>
          <button
            type="button"
            className={`${danger ? "btn-danger" : "btn-primary"} text-sm`}
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? "Working…" : (confirmLabel ?? actionLabel)}
          </button>
        </div>
      </div>
    </div>
  );
}

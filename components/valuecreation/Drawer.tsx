"use client";

/**
 * Right-side detail drawer (VCP redesign, §5). Thin local wrapper with
 * the same shape as the Diligence Workspace redesign's detail drawer
 * (title, optional header menu, scrollable body, Escape/backdrop close,
 * full-screen on mobile) so the shared component can replace it without
 * touching call sites. The diligence shared drawer had not landed on
 * main when this shipped — substitution recorded in the build
 * checkpoint (vcp-redesign-2026-10-24.md).
 */

import { useEffect, type ReactNode } from "react";

export default function Drawer({
  title,
  subtitle,
  onClose,
  menu,
  children,
  wide = false,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  /** Optional header menu node (e.g. a "⋯" actions menu incl. Delete). */
  menu?: ReactNode;
  children: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label={title}>
      <button
        type="button"
        aria-label="Close"
        className="absolute inset-0 h-full w-full cursor-default bg-[#0d1f3c]/40 backdrop-blur-[1px]"
        onClick={onClose}
      />
      <div
        className={`absolute inset-y-0 right-0 flex w-full flex-col bg-white shadow-2xl dark:bg-[#0d1f3c] ${
          wide ? "sm:max-w-2xl" : "sm:max-w-xl"
        }`}
      >
        <div className="flex items-start gap-3 border-b border-slate-100 px-4 py-3.5 sm:px-5 dark:border-white/10">
          <div className="min-w-0 flex-1">
            <h3 className="truncate font-display text-xl font-semibold text-[#0d1f3c] dark:text-white">
              {title}
            </h3>
            {subtitle && (
              <p className="mt-0.5 truncate text-xs text-slate-500 dark:text-white/50">{subtitle}</p>
            )}
          </div>
          {menu}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close drawer"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-slate-500 transition hover:bg-[#f0f4fa] hover:text-[#0d1f3c] dark:text-white/60 dark:hover:bg-white/5 dark:hover:text-white"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5">{children}</div>
      </div>
    </div>
  );
}

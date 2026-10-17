"use client";

import { useEffect, useState } from "react";

/**
 * Toast host (visual polish, Oct 17, 2026 — spec §7). No global
 * toast system existed in the portal (feedback was inline "Saved ✓"
 * text and page-local notices, which are unchanged); this host
 * provides the token-styled, bottom-sliding surface for any code
 * that wants one:
 *
 *   import { showToast } from "@/components/Toast";
 *   showToast("Saved", { actionLabel: "Undo", onAction: () => … });
 *
 * Position: above the floating bottom nav on phones (100px + safe
 * area), bottom-right on desktop. Navy surface, gold action.
 * Mounted once in app/layout.tsx.
 */

interface ToastItem {
  id: number;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}

const callbacks = new Map<number, () => void>();
let nextId = 1;

export function showToast(
  message: string,
  opts?: { actionLabel?: string; onAction?: () => void }
) {
  if (typeof window === "undefined") return;
  const id = nextId++;
  if (opts?.onAction) callbacks.set(id, opts.onAction);
  window.dispatchEvent(
    new CustomEvent("ccp:toast", {
      detail: { id, message, actionLabel: opts?.actionLabel },
    })
  );
}

export default function Toast() {
  const [items, setItems] = useState<ToastItem[]>([]);

  useEffect(() => {
    const onToast = (e: Event) => {
      const d = (e as CustomEvent).detail as {
        id: number;
        message: string;
        actionLabel?: string;
      };
      const item: ToastItem = {
        id: d.id,
        message: d.message,
        actionLabel: d.actionLabel,
        onAction: callbacks.get(d.id),
      };
      callbacks.delete(d.id);
      setItems((prev) => [...prev.slice(-2), item]);
      window.setTimeout(() => {
        setItems((prev) => prev.filter((t) => t.id !== d.id));
      }, 4500);
    };
    window.addEventListener("ccp:toast", onToast);
    return () => window.removeEventListener("ccp:toast", onToast);
  }, []);

  if (items.length === 0) return null;

  return (
    <div
      className="pointer-events-none fixed inset-x-3 bottom-[calc(100px+env(safe-area-inset-bottom))] z-[70] flex flex-col items-center gap-2 md:inset-x-auto md:bottom-6 md:right-6 md:items-end"
      role="status"
      aria-live="polite"
    >
      {items.map((t) => (
        <div
          key={t.id}
          className="toast-in pointer-events-auto flex w-full max-w-md items-center gap-3 rounded-xl bg-navy-900 py-3 pl-4 pr-3 text-sm font-medium text-white shadow-pop ring-1 ring-white/10 md:w-auto md:min-w-72"
        >
          <span className="min-w-0 flex-1">{t.message}</span>
          {t.actionLabel && (
            <button
              onClick={() => {
                t.onAction?.();
                setItems((prev) => prev.filter((x) => x.id !== t.id));
              }}
              className="shrink-0 rounded-lg px-2.5 py-1.5 font-semibold text-gold-400 transition hover:bg-white/10 hover:text-gold-300"
            >
              {t.actionLabel}
            </button>
          )}
          <button
            aria-label="Dismiss"
            onClick={() =>
              setItems((prev) => prev.filter((x) => x.id !== t.id))
            }
            className="shrink-0 rounded-lg px-2 py-1.5 text-white/60 transition hover:bg-white/10 hover:text-white"
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}

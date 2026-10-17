"use client";

/**
 * Shared UI primitives (visual polish, Oct 17, 2026). All styling
 * flows from the design tokens in app/globals.css (.btn / .chip /
 * .badge classes + navy/gold utilities) — no magic values here.
 * These are presentation-only: no data fetching, no behavior beyond
 * local animation.
 */

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

/* ---------------- Button ---------------- */

export type ButtonVariant = "primary" | "accent" | "secondary" | "ghost" | "danger";

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  className = "",
  disabled,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: "md" | "sm";
  loading?: boolean;
}) {
  return (
    <button
      {...props}
      disabled={disabled || loading}
      data-loading={loading || undefined}
      className={`btn btn-${variant} ${size === "sm" ? "btn-sm" : ""} ${className}`}
    />
  );
}

/* ---------------- Count-up ---------------- */

/** Ease a number from 0 to `value` on first appearance (~650ms).
 * Reduced-motion (or a non-finite value) lands on the final number
 * immediately. Returns the current value; format at render. */
export function useCountUp(value: number, durationMs = 650): number {
  const [display, setDisplay] = useState(() =>
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
      ? value
      : 0
  );
  const ranRef = useRef(false);
  useEffect(() => {
    if (ranRef.current) {
      setDisplay(value);
      return;
    }
    ranRef.current = true;
    if (
      !Number.isFinite(value) ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      setDisplay(value);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(Math.round(value * eased));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, durationMs]);
  return display;
}

/* ---------------- Stat tile (§4) ---------------- */

export interface StatTrend {
  direction: "up" | "down";
  /** e.g. "+3 this week" — only ever pass real computed data. */
  label: string;
  /** Defaults: up = positive (gold/green-free palette: navy/gold).
   * Set when "up" is bad (e.g. overdue counts). */
  invert?: boolean;
}

/**
 * One Morning-Brief-style stat: micro label, big serif number
 * (count-up when `numericValue` is given), caption, optional trend
 * arrow, optional link to the underlying list. Drop-in replacement
 * for the hand-rolled stat blocks — the Overview grid patch staged
 * in the visual-polish checkpoint uses exactly this component.
 */
export function StatTile({
  label,
  display,
  numericValue,
  format,
  caption,
  href,
  title,
  trend,
  valueClassName = "",
}: {
  label: string;
  /** Preformatted value shown when numericValue is absent. */
  display: string;
  /** When set, the tile counts up to this and formats with `format`. */
  numericValue?: number;
  format?: (n: number) => string;
  caption?: string;
  href?: string;
  /** Full-precision value for tap/hover (title attribute). */
  title?: string;
  trend?: StatTrend;
  valueClassName?: string;
}) {
  const counted = useCountUp(numericValue ?? 0);
  const text =
    numericValue !== undefined && format ? format(counted) : display;
  const trendGood = trend
    ? trend.invert
      ? trend.direction === "down"
      : trend.direction === "up"
    : true;
  const inner = (
    <>
      <p className="micro-label">{label}</p>
      <p
        className={`tnum mt-1 font-display text-4xl font-semibold text-navy-900 transition group-hover:text-gold-700 dark:text-white dark:group-hover:text-gold-400 ${valueClassName}`}
        title={title}
      >
        {text}
      </p>
      {(caption || trend) && (
        <p className="mt-0.5 flex items-center gap-1.5 text-xs text-caption">
          {trend && (
            <span
              className={`inline-flex items-center gap-0.5 font-semibold ${
                trendGood
                  ? "text-gold-700 dark:text-gold-400"
                  : "text-red-700 dark:text-red-300"
              }`}
            >
              <span aria-hidden>{trend.direction === "up" ? "▲" : "▼"}</span>
              {trend.label}
            </span>
          )}
          {caption && <span>{caption}</span>}
        </p>
      )}
    </>
  );
  if (href) {
    return (
      <Link href={href} className="group block" title={title}>
        {inner}
      </Link>
    );
  }
  return <div className="group">{inner}</div>;
}

/* ---------------- Empty state (§6) ---------------- */

export function EmptyState({
  title,
  message,
  actionLabel,
  onAction,
  href,
}: {
  title: string;
  message?: string;
  actionLabel?: string;
  onAction?: () => void;
  href?: string;
}) {
  return (
    <div className="card-surface flex flex-col items-center px-6 py-10 text-center">
      <span
        aria-hidden
        className="flex h-12 w-12 items-center justify-center rounded-full bg-gold-500/10 text-gold-700 ring-1 ring-inset ring-gold-500/40 dark:text-gold-400"
      >
        <svg
          viewBox="0 0 24 24"
          className="h-6 w-6"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M22 12h-6l-2 3h-4l-2-3H2" />
          <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
        </svg>
      </span>
      <p className="mt-3 font-display text-xl font-semibold text-navy-900 dark:text-white">
        {title}
      </p>
      {message && <p className="caption mt-1 max-w-sm">{message}</p>}
      {actionLabel && href && (
        <Link href={href} className="btn btn-primary btn-sm mt-4">
          {actionLabel}
        </Link>
      )}
      {actionLabel && onAction && !href && (
        <button onClick={onAction} className="btn btn-primary btn-sm mt-4">
          {actionLabel}
        </button>
      )}
    </div>
  );
}

/* ---------------- Skeleton rows (§6) ---------------- */

export function SkeletonRows({
  rows = 4,
  className = "",
}: {
  rows?: number;
  className?: string;
}) {
  const widths = ["92%", "78%", "85%", "64%", "88%", "71%"];
  return (
    <div className={`space-y-3 ${className}`} aria-busy="true">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="skel h-14" style={{ width: widths[i % widths.length] }} />
      ))}
      <span className="sr-only">Loading…</span>
    </div>
  );
}

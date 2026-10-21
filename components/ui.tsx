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

/* ==================================================================
 * Phase 1 platform additions (appended Oct 21, 2026) — everything
 * below is additive; the exports above are unchanged.
 * ================================================================== */

/* ---------------- Skeleton block ---------------- */

export function Skeleton({ className = "" }: { className?: string }) {
  return <div aria-hidden className={`skel ${className}`} />;
}

export function CardSkeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div className="card-surface p-5" aria-busy="true">
      <div className="skel h-5 w-2/5" />
      <div className="mt-4 space-y-2.5">
        {Array.from({ length: lines }).map((_, i) => (
          <div
            key={i}
            className="skel h-3.5"
            style={{ width: `${88 - i * 13}%` }}
          />
        ))}
      </div>
      <span className="sr-only">Loading…</span>
    </div>
  );
}

/* ---------------- Error state ---------------- */

export function ErrorState({
  title = "Something went wrong",
  message,
  onRetry,
}: {
  title?: string;
  message?: string;
  onRetry?: () => void;
}) {
  return (
    <div className="card-surface flex flex-col items-center px-6 py-10 text-center">
      <span
        aria-hidden
        className="flex h-12 w-12 items-center justify-center rounded-full bg-red-500/10 text-red-600 ring-1 ring-inset ring-red-500/40 dark:text-red-300"
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
          <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
          <path d="M12 9v4" />
          <path d="M12 17h.01" />
        </svg>
      </span>
      <p className="mt-3 font-display text-xl font-semibold text-navy-900 dark:text-white">
        {title}
      </p>
      {message && <p className="caption mt-1 max-w-sm">{message}</p>}
      {onRetry && (
        <button onClick={onRetry} className="btn btn-primary btn-sm mt-4">
          Retry
        </button>
      )}
    </div>
  );
}

/* ---------------- Sortable data table ---------------- */

export interface DataTableColumn<Row> {
  key: string;
  label: string;
  sortable?: boolean;
  align?: "left" | "right" | "center";
  render?: (row: Row) => React.ReactNode;
}

/**
 * SortableTable / DataTable: config-driven table on the shared
 * .tbl-grad styling. Sort state is internal (click a sortable
 * header to toggle); `onSort` is notified when provided. Rows are
 * sorted client-side by the column's raw value unless a column
 * render is present, in which case sorting falls back to the raw
 * value too — callers needing server sorts can pre-sort `rows`.
 *
 * Mobile approach (pragmatic Phase 1): the table keeps a min-width
 * inside an overflow-x-auto container, so at 375px it scrolls
 * horizontally instead of reflowing to cards; full card-collapse
 * can layer on per-screen later without changing this API.
 */
export function DataTable<Row extends Record<string, unknown>>({
  columns,
  rows,
  rowKey,
  onSort,
  emptyTitle = "Nothing here yet",
  emptyMessage,
  className = "",
}: {
  columns: DataTableColumn<Row>[];
  rows: Row[];
  rowKey?: (row: Row, index: number) => string;
  onSort?: (key: string, dir: "asc" | "desc") => void;
  emptyTitle?: string;
  emptyMessage?: string;
  className?: string;
}) {
  const [sort, setSort] = useState<{ key: string; dir: "asc" | "desc" } | null>(
    null
  );

  const sorted = (() => {
    if (!sort) return rows;
    const col = columns.find((c) => c.key === sort.key);
    if (!col) return rows;
    const copy = [...rows];
    copy.sort((a, b) => {
      const av = a[sort.key];
      const bv = b[sort.key];
      let cmp = 0;
      if (typeof av === "number" && typeof bv === "number") cmp = av - bv;
      else cmp = String(av ?? "").localeCompare(String(bv ?? ""));
      return sort.dir === "asc" ? cmp : -cmp;
    });
    return copy;
  })();

  const toggleSort = (col: DataTableColumn<Row>) => {
    if (!col.sortable) return;
    const next: { key: string; dir: "asc" | "desc" } =
      sort && sort.key === col.key
        ? { key: col.key, dir: sort.dir === "asc" ? "desc" : "asc" }
        : { key: col.key, dir: "asc" };
    setSort(next);
    if (onSort) onSort(next.key, next.dir);
  };

  if (rows.length === 0) {
    return <EmptyState title={emptyTitle} message={emptyMessage} />;
  }

  return (
    <div className={`overflow-x-auto ${className}`}>
      <table className="tbl-grad w-full min-w-[560px] text-sm">
        <thead>
          <tr>
            {columns.map((col) => {
              const activeSort = sort && sort.key === col.key;
              return (
                <th
                  key={col.key}
                  className={`px-3 py-2.5 text-xs font-semibold uppercase tracking-wide ${
                    col.align === "right"
                      ? "text-right"
                      : col.align === "center"
                        ? "text-center"
                        : "text-left"
                  }`}
                  aria-sort={
                    activeSort
                      ? sort.dir === "asc"
                        ? "ascending"
                        : "descending"
                      : undefined
                  }
                >
                  {col.sortable ? (
                    <button
                      type="button"
                      onClick={() => toggleSort(col)}
                      className="inline-flex items-center gap-1 uppercase tracking-wide hover:text-[#d4b37a]"
                    >
                      {col.label}
                      <span aria-hidden className="text-[10px]">
                        {activeSort ? (sort.dir === "asc" ? "▲" : "▼") : "↕"}
                      </span>
                    </button>
                  ) : (
                    col.label
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row, i) => (
            <tr
              key={rowKey ? rowKey(row, i) : i}
              className="border-t border-slate-100 transition hover:bg-[#f0f4fa] dark:border-white/5 dark:hover:bg-white/5"
            >
              {columns.map((col) => (
                <td
                  key={col.key}
                  className={`px-3 py-2.5 text-[#0d1f3c] dark:text-white ${
                    col.align === "right"
                      ? "text-right"
                      : col.align === "center"
                        ? "text-center"
                        : "text-left"
                  }`}
                >
                  {col.render
                    ? col.render(row)
                    : String(row[col.key] ?? "—")}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export const SortableTable = DataTable;

/* ---------------- Saved view chips ---------------- */

export function SavedViewChips({
  views,
  activeId,
  onSelect,
}: {
  views: { id: string; label: string }[];
  activeId?: string;
  onSelect: (id: string) => void;
}) {
  if (views.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Saved views">
      {views.map((v) => (
        <button
          key={v.id}
          type="button"
          role="tab"
          aria-selected={activeId === v.id}
          onClick={() => onSelect(v.id)}
          className={`chip ${activeId === v.id ? "chip-active" : ""}`}
        >
          {v.label}
        </button>
      ))}
    </div>
  );
}

/* ---------------- Bulk action bar ---------------- */

export function BulkActionBar({
  count,
  children,
}: {
  count: number;
  children?: React.ReactNode;
}) {
  if (count <= 0) return null;
  return (
    <div className="sticky bottom-4 z-30 mx-auto flex w-fit max-w-full flex-wrap items-center gap-3 rounded-2xl bg-navy-900 px-4 py-3 text-white shadow-pop dark:bg-navy-950 dark:ring-1 dark:ring-white/15">
      <span className="text-sm font-semibold">
        {count} selected
      </span>
      {children}
    </div>
  );
}

/* ---------------- Keyboard hint ---------------- */

export function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex items-center rounded border border-slate-300 bg-slate-50 px-1.5 py-0.5 font-sans text-[10px] font-semibold text-slate-500 dark:border-white/20 dark:bg-white/5 dark:text-white/50">
      {children}
    </kbd>
  );
}

/* ---------------- Widget card ---------------- */

export function WidgetCard({
  title,
  actions,
  children,
  className = "",
}: {
  title: string;
  actions?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`card-surface p-5 ${className}`}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="font-display text-xl font-semibold text-navy-900 dark:text-white">
          {title}
        </h3>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
      {children}
    </section>
  );
}

"use client";

/**
 * Small shared building blocks for the Portfolio Monitoring tabs —
 * section cards and a lean table that collapses into stacked cards
 * under the sm breakpoint (each cell carries its column label), so
 * every tab works at 375px without horizontal scrolling.
 */

import type { ReactNode } from "react";
import { cardCls, tdCls, thCls } from "@/components/monitoring/types";

export function Section({
  title,
  caption,
  actions,
  children,
}: {
  title: string;
  caption?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className={cardCls}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-display text-lg font-semibold text-[#0d1f3c] dark:text-white">
            {title}
          </h3>
          {caption && (
            <p className="mt-0.5 max-w-2xl text-sm text-slate-500 dark:text-white/50">
              {caption}
            </p>
          )}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

export interface SimpleColumn {
  key: string;
  label: string;
  align?: "left" | "right" | "center";
  render?: (row: Record<string, unknown>) => ReactNode;
  value?: (row: Record<string, unknown>) => ReactNode;
}

/**
 * Responsive table: a real table on ≥sm screens; on phones each row
 * becomes a card with label:value lines (no hover-only info, ≥44px
 * row targets where a row action exists is the caller's job).
 */
export function SimpleTable({
  columns,
  rows,
  rowKey,
  empty,
}: {
  columns: SimpleColumn[];
  rows: Array<Record<string, unknown>>;
  rowKey: (row: Record<string, unknown>, i: number) => string;
  empty?: ReactNode;
}) {
  if (!rows.length) return <>{empty ?? null}</>;
  const cell = (col: SimpleColumn, row: Record<string, unknown>) =>
    col.render ? col.render(row) : col.value ? col.value(row) : String(row[col.key] ?? "—");
  const alignCls = (a?: string) =>
    a === "right" ? "text-right" : a === "center" ? "text-center" : "text-left";
  return (
    <>
      {/* ≥sm: table */}
      <div className="hidden overflow-x-auto sm:block">
        <table className="w-full min-w-[520px]">
          <thead>
            <tr className="border-b border-slate-100 dark:border-white/5">
              {columns.map((c) => (
                <th key={c.key} className={`${thCls} ${alignCls(c.align)}`}>
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={rowKey(row, i)} className="border-t border-slate-100 dark:border-white/5">
                {columns.map((c) => (
                  <td key={c.key} className={`${tdCls} ${alignCls(c.align)}`}>
                    {cell(c, row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {/* <sm: stacked cards */}
      <div className="space-y-3 sm:hidden">
        {rows.map((row, i) => (
          <div
            key={rowKey(row, i)}
            className="rounded-xl border border-slate-100 p-3 dark:border-white/10"
          >
            <dl className="space-y-1.5">
              {columns.map((c) => (
                <div key={c.key} className="flex items-start justify-between gap-3">
                  <dt className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-white/40">
                    {c.label}
                  </dt>
                  <dd className="text-right text-sm text-[#0d1f3c] dark:text-white/90">
                    {cell(c, row)}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        ))}
      </div>
    </>
  );
}

/** Label/value definition grid for baseline-style records. */
export function KeyValues({
  rows,
}: {
  rows: Array<{ label: string; value: ReactNode }>;
}) {
  const shown = rows.filter(
    (r) => r.value !== null && r.value !== undefined && r.value !== ""
  );
  if (!shown.length)
    return (
      <p className="text-sm text-slate-500 dark:text-white/50">
        Nothing recorded yet.
      </p>
    );
  return (
    <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
      {shown.map((r) => (
        <div key={r.label}>
          <dt className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-white/40">
            {r.label}
          </dt>
          <dd className="mt-0.5 text-sm font-medium text-[#0d1f3c] dark:text-white/90">
            {r.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** Error banner shared by the tabs. */
export function ErrorBanner({ message }: { message: string }) {
  if (!message) return null;
  return (
    <p
      role="alert"
      className="rounded-xl bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-300"
    >
      {message}
    </p>
  );
}

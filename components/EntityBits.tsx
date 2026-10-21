"use client";

/**
 * Entity presentation bits (Phase 1 platform restructure): every
 * entity name is a link (PROJECT_RULES), with a hover/focus preview
 * card, plus the shared Breadcrumbs and LinkedRecords panels used
 * on record pages.
 *
 * EntityLink preview: for companies, the first hover/focus fetches
 * GET /api/platform/companies/{id} once and caches it in state;
 * failures fall back to the name-only card. People skip the fetch
 * (no person preview endpoint in the Phase 1 contract) and show the
 * name + a Person label. The preview card is pointer-events-none —
 * it never intercepts the click.
 */

import { useRef, useState } from "react";
import Link from "next/link";

interface CompanyPreview {
  name?: string;
  vertical?: string;
  stage?: string;
  dealStage?: string;
  city?: string;
  state?: string;
  lastActivityAt?: string;
}

function fmtDate(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "America/Phoenix",
  });
}

export function EntityLink({
  kind,
  id,
  name,
  href,
  className = "",
}: {
  kind: "company" | "person";
  id: string;
  name: string;
  href: string;
  className?: string;
}) {
  const [show, setShow] = useState(false);
  const [company, setCompany] = useState<CompanyPreview | null>(null);
  const [loaded, setLoaded] = useState(false);
  const fetchedRef = useRef(false);

  const maybeFetch = () => {
    setShow(true);
    if (kind !== "company" || fetchedRef.current) return;
    fetchedRef.current = true;
    fetch(`/api/platform/companies/${encodeURIComponent(id)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { company?: CompanyPreview } | null) => {
        if (d?.company) setCompany(d.company);
      })
      .catch(() => {
        /* preview falls back to the name-only card */
      })
      .finally(() => setLoaded(true));
  };

  const stage = company?.dealStage || company?.stage;
  const place = [company?.city, company?.state].filter(Boolean).join(", ");

  return (
    <span className="relative inline-block">
      <Link
        href={href}
        onMouseEnter={maybeFetch}
        onMouseLeave={() => setShow(false)}
        onFocus={maybeFetch}
        onBlur={() => setShow(false)}
        className={`font-medium text-[#0d1f3c] underline decoration-[#b8975a] decoration-2 underline-offset-2 transition hover:text-[#8a6f3e] dark:text-white dark:hover:text-[#d4b37a] ${className}`}
      >
        {name}
      </Link>
      {show && (
        <span className="pointer-events-none absolute left-0 top-full z-30 mt-1.5 block w-64 rounded-2xl border border-slate-200 bg-white p-3.5 text-left shadow-xl dark:border-white/10 dark:bg-[#12294d]">
          <span className="block truncate text-sm font-semibold text-[#0d1f3c] dark:text-white">
            {company?.name || name}
          </span>
          <span className="mt-1.5 flex flex-wrap gap-1">
            <span className="badge badge-neutral">
              {kind === "company" ? "Company" : "Person"}
            </span>
            {company?.vertical && (
              <span className="badge badge-neutral">{company.vertical}</span>
            )}
            {stage && <span className="badge badge-neutral">{stage}</span>}
          </span>
          {place && (
            <span className="mt-2 block text-xs text-slate-500 dark:text-white/60">
              {place}
            </span>
          )}
          {kind === "company" && company?.lastActivityAt && (
            <span className="mt-0.5 block text-xs text-slate-400 dark:text-white/40">
              Last activity {fmtDate(company.lastActivityAt)}
            </span>
          )}
          {kind === "company" && !loaded && (
            <span className="mt-2 block text-xs text-slate-400 dark:text-white/40">
              Loading preview…
            </span>
          )}
        </span>
      )}
    </span>
  );
}

/* ---------------- Breadcrumbs ---------------- */

export function Breadcrumbs({
  items,
  className = "",
}: {
  items: { label: string; href?: string }[];
  className?: string;
}) {
  if (items.length === 0) return null;
  return (
    <nav aria-label="Breadcrumb" className={className}>
      <ol className="flex flex-wrap items-center gap-1.5 text-sm">
        {items.map((item, i) => {
          const last = i === items.length - 1;
          return (
            <li key={`${item.label}-${i}`} className="flex items-center gap-1.5">
              {i > 0 && (
                <span aria-hidden className="text-slate-300 dark:text-white/25">
                  ›
                </span>
              )}
              {item.href && !last ? (
                <Link
                  href={item.href}
                  className="font-medium text-slate-500 transition hover:text-[#8a6f3e] dark:text-white/50 dark:hover:text-[#d4b37a]"
                >
                  {item.label}
                </Link>
              ) : (
                <span
                  aria-current={last ? "page" : undefined}
                  className={
                    last
                      ? "font-semibold text-[#0d1f3c] dark:text-white"
                      : "font-medium text-slate-500 dark:text-white/50"
                  }
                >
                  {item.label}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/* ---------------- Linked records ---------------- */

export function LinkedRecords({
  groups,
  className = "",
}: {
  groups: {
    title: string;
    items: { label: string; href: string; meta?: string }[];
  }[];
  className?: string;
}) {
  const nonEmpty = groups.filter((g) => g.items.length > 0);
  if (nonEmpty.length === 0) return null;
  return (
    <div className={`flex flex-col gap-5 ${className}`}>
      {nonEmpty.map((group) => (
        <div key={group.title}>
          <p className="micro-label mb-1.5">
            {group.title} · {group.items.length}
          </p>
          <ul className="divide-y divide-slate-100 dark:divide-white/5">
            {group.items.map((item, i) => (
              <li key={`${item.href}-${i}`}>
                <Link
                  href={item.href}
                  className="group flex min-h-[44px] items-center gap-2 py-1.5"
                >
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-[#0d1f3c] group-hover:underline group-hover:decoration-[#b8975a] group-hover:decoration-2 group-hover:underline-offset-2 dark:text-white">
                    {item.label}
                  </span>
                  {item.meta && (
                    <span className="shrink-0 text-xs text-slate-400 dark:text-white/40">
                      {item.meta}
                    </span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

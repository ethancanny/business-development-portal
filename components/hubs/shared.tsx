"use client";

/**
 * Shared bits for the Business Development hub sections: a one-shot
 * fetch hook (fetch on mount only — no polling, per PROJECT_RULES)
 * and the section shell with title, "Open full view" link, and
 * skeleton / error / empty states.
 */

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";

export function useHubFetch<T>(url: string): {
  data: T | null;
  failed: boolean;
} {
  const [data, setData] = useState<T | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error("HTTP " + res.status);
        const json = (await res.json()) as T;
        if (!cancelled) setData(json);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [url]);

  return { data, failed };
}

export function SectionShell({
  id,
  title,
  blurb,
  href,
  children,
}: {
  id: string;
  title: string;
  blurb?: string;
  href: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-[120px]">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="font-display text-2xl font-semibold text-navy-900 dark:text-white">
            {title}
          </h2>
          {blurb && (
            <p className="mt-0.5 text-sm text-slate-500 dark:text-white/60">
              {blurb}
            </p>
          )}
        </div>
        <Link
          href={href}
          className="inline-flex min-h-[44px] items-center text-sm font-semibold text-[#8a6f3e] hover:underline dark:text-[#d4b37a]"
        >
          Open full view →
        </Link>
      </div>
      <div className="card-surface p-4 sm:p-5">{children}</div>
    </section>
  );
}

export function SectionSkeleton() {
  return (
    <div className="space-y-3" aria-busy="true">
      <div className="skel h-16" />
      <div className="skel h-16" />
      <div className="skel h-16" />
      <span className="sr-only">Loading…</span>
    </div>
  );
}

export function SectionError({ label }: { label: string }) {
  return (
    <p className="text-sm text-caption">
      {label} could not be loaded. Open the full view to try again.
    </p>
  );
}

export function SectionEmpty({ children }: { children: ReactNode }) {
  return <p className="text-sm text-caption">{children}</p>;
}

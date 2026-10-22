"use client";

/**
 * BD hub — Activity section. Unread-new counts per kind and the
 * latest triage items from GET /api/platform/hubs/bd-activity.
 * Triage itself happens at /activity.
 */

import { fmtDate } from "@/lib/format";
import type { DealFlowKind } from "@/lib/types";
import {
  SectionEmpty,
  SectionError,
  SectionShell,
  SectionSkeleton,
  useHubFetch,
} from "./shared";

interface ActivityData {
  counts: {
    businessesForSale: number;
    operatorsAvailable: number;
    marketNotes: number;
  };
  items: {
    id: string;
    kind: DealFlowKind;
    title: string;
    createdAt: string;
    isNew: boolean;
  }[];
}

const KIND_META: Record<DealFlowKind, { label: string; cls: string }> = {
  business_for_sale: {
    label: "Business for sale",
    cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
  },
  operator_available: {
    label: "Operator available",
    cls: "bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300",
  },
  market_note: {
    label: "Market note",
    cls: "bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300",
  },
};

export default function BdActivitySection() {
  const { data, failed } = useHubFetch<ActivityData>(
    "/api/platform/hubs/bd-activity"
  );

  return (
    <SectionShell
      id="bd-activity"
      title="Activity"
      blurb="Fresh businesses for sale, available operators, and market notes to triage."
      href="/activity"
    >
      {failed && <SectionError label="Activity summary" />}
      {!failed && !data && <SectionSkeleton />}
      {!failed && data && (
        <div>
          <div className="flex flex-wrap gap-2">
            <CountChip label="Businesses for sale" count={data.counts.businessesForSale} />
            <CountChip label="Operators available" count={data.counts.operatorsAvailable} />
            <CountChip label="Market notes" count={data.counts.marketNotes} />
          </div>
          {data.items.length === 0 ? (
            <div className="mt-4">
              <SectionEmpty>Nothing new in the feed right now.</SectionEmpty>
            </div>
          ) : (
            <ul className="mt-3 divide-y divide-slate-100 dark:divide-white/5">
              {data.items.map((it) => {
                const meta = KIND_META[it.kind] ?? KIND_META.market_note;
                return (
                  <li
                    key={it.id}
                    className="flex flex-wrap items-center gap-x-3 gap-y-1.5 py-2.5 first:pt-1 last:pb-0"
                  >
                    {it.isNew ? (
                      <span
                        aria-label="New"
                        className="h-2 w-2 shrink-0 rounded-full bg-[#b8975a]"
                      />
                    ) : (
                      <span aria-hidden className="h-2 w-2 shrink-0" />
                    )}
                    <span className="min-w-0 flex-1 basis-48 truncate text-sm font-medium text-slate-800 dark:text-white/90">
                      {it.title}
                    </span>
                    <span
                      className={
                        "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold " +
                        meta.cls
                      }
                    >
                      {meta.label}
                    </span>
                    <span className="text-xs text-slate-400 dark:text-white/40">
                      {it.createdAt ? fmtDate(it.createdAt) : ""}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </SectionShell>
  );
}

function CountChip({ label, count }: { label: string; count: number }) {
  return (
    <span className="inline-flex min-h-[36px] items-center gap-2 rounded-full bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-600 dark:bg-white/10 dark:text-white/70">
      {label}
      <span className="tnum font-display text-base font-semibold text-navy-900 dark:text-white">
        {count}
      </span>
      <span className="text-[11px] text-slate-400 dark:text-white/40">new</span>
    </span>
  );
}

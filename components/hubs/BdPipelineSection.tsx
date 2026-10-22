"use client";

/**
 * BD hub — Pipeline section. Compact stage strip (count + resolved
 * value per stage, funnel-style bars) and the stale-deals list from
 * GET /api/platform/hubs/bd-pipeline. Not the full board — the full
 * board lives at /pipeline.
 */

import Link from "next/link";
import { fmtMoneyCompact } from "@/lib/format";
import { stageColor } from "@/lib/sector-colors";
import {
  SectionEmpty,
  SectionError,
  SectionShell,
  SectionSkeleton,
  useHubFetch,
} from "./shared";

interface PipelineData {
  stages: { stage: string; count: number; value: number }[];
  staleDeals: { id: string; name: string; stage: string; daysStale: number }[];
  totals: { openDeals: number; staleCount: number };
}

export default function BdPipelineSection() {
  const { data, failed } = useHubFetch<PipelineData>(
    "/api/platform/hubs/bd-pipeline"
  );

  return (
    <SectionShell
      id="bd-pipeline"
      title="Pipeline"
      blurb="Deals by stage, valued the same way the Pipeline and Overview show them."
      href="/pipeline"
    >
      {failed && <SectionError label="Pipeline summary" />}
      {!failed && !data && <SectionSkeleton />}
      {!failed && data && data.totals.openDeals === 0 && data.stages.every((s) => s.count === 0) && (
        <SectionEmpty>No deals in the pipeline yet.</SectionEmpty>
      )}
      {!failed && data && data.stages.some((s) => s.count > 0) && (
        <PipelineBody data={data} />
      )}
    </SectionShell>
  );
}

function PipelineBody({ data }: { data: PipelineData }) {
  const maxCount = Math.max(1, ...data.stages.map((s) => s.count));
  return (
    <div>
      <p className="text-sm text-slate-500 dark:text-white/60">
        <span className="tnum font-display text-xl font-semibold text-navy-900 dark:text-white">
          {data.totals.openDeals}
        </span>{" "}
        open deals
        {data.totals.staleCount > 0 && (
          <>
            {" · "}
            <span className="font-semibold text-amber-700 dark:text-amber-300">
              {data.totals.staleCount} stale
            </span>
          </>
        )}
      </p>

      <div className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
        {data.stages.map((s) => (
          <div
            key={s.stage}
            className="rounded-lg border border-slate-200 p-3 dark:border-white/10"
          >
            <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-white/50">
              <span
                aria-hidden
                className="inline-block h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: stageColor(s.stage) }}
              />
              {s.stage}
            </p>
            <p className="tnum mt-1 font-display text-2xl font-semibold text-navy-900 dark:text-white">
              {s.count}
            </p>
            <p className="text-xs text-slate-500 dark:text-white/60">
              {s.value > 0 ? fmtMoneyCompact(s.value) : "—"}
            </p>
            <div
              className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-white/10"
              aria-hidden
            >
              <div
                className="h-full rounded-full"
                style={{
                  width: String(Math.round((s.count / maxCount) * 100)) + "%",
                  backgroundColor: stageColor(s.stage),
                }}
              />
            </div>
          </div>
        ))}
      </div>

      {data.staleDeals.length > 0 && (
        <div className="mt-5">
          <h3 className="text-sm font-semibold text-navy-900 dark:text-white">
            Stale deals — no movement in 30+ days
          </h3>
          <ul className="mt-2 divide-y divide-slate-100 dark:divide-white/5">
            {data.staleDeals.map((d) => (
              <li
                key={d.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-1.5 py-2.5 first:pt-1 last:pb-0"
              >
                <Link
                  href="/pipeline"
                  className="min-w-0 flex-1 basis-40 truncate text-sm font-medium text-slate-800 hover:text-gold-700 dark:text-white/90 dark:hover:text-gold-400"
                >
                  {d.name || "Unnamed deal"}
                </Link>
                <span className="badge badge-neutral shrink-0">{d.stage}</span>
                <span className="badge badge-warn shrink-0">
                  Stale · {d.daysStale}d
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

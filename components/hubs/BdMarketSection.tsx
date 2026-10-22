"use client";

/**
 * BD hub — Market Intel section. Fit total + top fit targets,
 * compact per-sector EV/EBITDA snapshot, tailwind score chips, and
 * the latest market events from GET /api/platform/hubs/bd-market.
 * The full intelligence surface lives at /market-intel.
 */

import { fmtDate } from "@/lib/format";
import { sectorColor } from "@/lib/sector-colors";
import {
  SectionEmpty,
  SectionError,
  SectionShell,
  SectionSkeleton,
  useHubFetch,
} from "./shared";

interface MarketData {
  fitTotal: number;
  topFits: { id: string; name: string; sector: string; city: string }[];
  multiples: { sector: string; evEbitda: number | null; period: string }[];
  tailwind: { sector: string; score: number | null }[];
  upcomingEvents: { title: string; date: string }[];
}

export default function BdMarketSection() {
  const { data, failed } = useHubFetch<MarketData>(
    "/api/platform/hubs/bd-market"
  );

  return (
    <SectionShell
      id="bd-market"
      title="Market Intel"
      blurb="Arizona fit targets, multiples, tailwinds, and market events at a glance."
      href="/market-intel"
    >
      {failed && <SectionError label="Market summary" />}
      {!failed && !data && <SectionSkeleton />}
      {!failed && data && (
        <div>
          <p className="text-sm text-slate-500 dark:text-white/60">
            <span className="tnum font-display text-xl font-semibold text-navy-900 dark:text-white">
              {data.fitTotal.toLocaleString()}
            </span>{" "}
            fit targets across the five focus sectors
          </p>

          <div className="mt-4 grid gap-6 lg:grid-cols-2">
            <div>
              <h3 className="text-sm font-semibold text-navy-900 dark:text-white">
                Newest fit targets
              </h3>
              {data.topFits.length === 0 ? (
                <SectionEmpty>No fit targets yet.</SectionEmpty>
              ) : (
                <ul className="mt-2 divide-y divide-slate-100 dark:divide-white/5">
                  {data.topFits.map((f) => (
                    <li
                      key={f.id}
                      className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 first:pt-1 last:pb-0"
                    >
                      <span
                        aria-hidden
                        className="h-2 w-2 shrink-0 rounded-full"
                        style={{ backgroundColor: sectorColor(f.sector) }}
                      />
                      <span className="min-w-0 flex-1 basis-40 truncate text-sm font-medium text-slate-800 dark:text-white/90">
                        {f.name}
                      </span>
                      <span className="text-xs text-slate-500 dark:text-white/60">
                        {f.sector}
                        {f.city ? " · " + f.city : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              )}

              {data.upcomingEvents.length > 0 && (
                <>
                  <h3 className="mt-5 text-sm font-semibold text-navy-900 dark:text-white">
                    Latest market events
                  </h3>
                  <ul className="mt-2 space-y-1.5">
                    {data.upcomingEvents.map((e, i) => (
                      <li
                        key={String(i)}
                        className="flex flex-wrap items-baseline gap-x-2 text-sm text-slate-700 dark:text-white/80"
                      >
                        <span className="min-w-0 flex-1 basis-48">{e.title}</span>
                        <span className="text-xs text-slate-400 dark:text-white/40">
                          {e.date ? fmtDate(e.date) : ""}
                        </span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>

            <div>
              <h3 className="text-sm font-semibold text-navy-900 dark:text-white">
                EV/EBITDA by sector
              </h3>
              {data.multiples.length === 0 ? (
                <SectionEmpty>No multiples on file yet.</SectionEmpty>
              ) : (
                <ul className="mt-2 divide-y divide-slate-100 dark:divide-white/5">
                  {data.multiples.map((m) => (
                    <li
                      key={m.sector}
                      className="flex items-center gap-x-3 py-2 first:pt-1 last:pb-0"
                    >
                      <span
                        aria-hidden
                        className="h-2 w-2 shrink-0 rounded-full"
                        style={{ backgroundColor: sectorColor(m.sector) }}
                      />
                      <span className="min-w-0 flex-1 truncate text-sm text-slate-700 dark:text-white/80">
                        {m.sector}
                      </span>
                      <span className="tnum text-sm font-semibold text-navy-900 dark:text-white">
                        {m.evEbitda !== null ? String(m.evEbitda) + "×" : "—"}
                      </span>
                    </li>
                  ))}
                </ul>
              )}

              <h3 className="mt-5 text-sm font-semibold text-navy-900 dark:text-white">
                Tailwind scores
              </h3>
              <div className="mt-2 flex flex-wrap gap-2">
                {data.tailwind.map((t) => {
                  const color = sectorColor(t.sector);
                  return (
                    <span
                      key={t.sector}
                      className="inline-flex min-h-[36px] items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium text-slate-700 ring-1 ring-inset ring-slate-200 dark:text-white/80 dark:ring-white/15"
                    >
                      <span
                        aria-hidden
                        className="h-2 w-2 rounded-full"
                        style={{ backgroundColor: color }}
                      />
                      {t.sector}
                      <span className="tnum font-display text-base font-semibold text-navy-900 dark:text-white">
                        {t.score !== null ? t.score : "—"}
                      </span>
                    </span>
                  );
                })}
              </div>
              <p className="mt-2 text-xs text-slate-400 dark:text-white/40">
                0–100 per sector; 50 is flat. A dash means fewer than two
                live components — no score is shown rather than a stale one.
              </p>
            </div>
          </div>
        </div>
      )}
    </SectionShell>
  );
}

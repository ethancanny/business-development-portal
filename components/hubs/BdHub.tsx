"use client";

/**
 * Business Development hub. Ethan, Oct 23, 2026 (supersedes the
 * Oct 22 hub spec and the summary-section design):
 * - The tab bar is exactly three tabs, in this order: Pipeline,
 *   Activity, Market Intel. There is NO Tasks & Follow-ups tab —
 *   open tasks and follow-ups are referenced on the Pipeline page
 *   itself (a Tasks & Follow-ups section under the pipeline).
 * - Each tab renders the FULL page for that area — the actual
 *   /pipeline, /activity, and /market-intel page components with
 *   their heroes suppressed (embedded) — never a summary overview
 *   with an "Open full view" link.
 * - Only the selected tab renders, so an unselected page never
 *   fetches. The tab restores from the URL hash (#bd-pipeline /
 *   #bd-activity / #bd-market) so deep links keep working.
 * - The Capture button that used to sit at the right of the banner
 *   was removed; the /capture page itself is unchanged.
 * No Directory or Audit Trail tiles — those live in the main nav.
 */

import { useEffect, useState } from "react";
import { BANNER_DARK, BANNER_LIGHT } from "@/lib/sector-colors";
import PipelineView from "@/components/PipelineView";
import ActivityView from "@/components/ActivityView";
import MarketIntelView from "@/components/MarketIntelView";

const NAV: { id: string; label: string }[] = [
  { id: "bd-pipeline", label: "Pipeline" },
  { id: "bd-activity", label: "Activity" },
  { id: "bd-market", label: "Market Intel" },
];

export default function BdHub() {
  const [active, setActive] = useState<string>(NAV[0].id);

  // Restore the tab from the URL hash on first mount (deep links).
  useEffect(() => {
    const h = window.location.hash.replace("#", "");
    if (NAV.some((n) => n.id === h)) setActive(h);
  }, []);

  const select = (id: string) => (e: React.MouseEvent) => {
    e.preventDefault();
    setActive(id);
    try {
      window.history.replaceState(null, "", "#" + id);
    } catch {
      /* hash sync is an enhancement — the tab still switches */
    }
  };

  return (
    <div>
      {/* PageHero-style header (no action button — Capture removed). */}
      <div className="relative overflow-hidden">
        <div className="relative h-36 sm:h-44">
          <img
            src={BANNER_LIGHT}
            alt=""
            loading="lazy"
            className="absolute inset-0 h-full w-full object-cover dark:hidden"
          />
          <img
            src={BANNER_DARK}
            alt=""
            loading="lazy"
            className="absolute inset-0 hidden h-full w-full object-cover dark:block"
          />
          <div className="absolute inset-0 bg-gradient-to-r from-[#0d1f3c] via-[#0d1f3c]/55 to-[#0d1f3c]/10" />
          <div className="absolute inset-0 bg-gradient-to-t from-[#0d1f3c]/60 via-transparent to-transparent" />
          <div className="absolute inset-0 hidden bg-gradient-to-r from-[#040b1a]/60 via-[#040b1a]/25 to-transparent dark:block" />
          <div className="absolute inset-0 hidden bg-gradient-to-t from-[#040b1a]/50 via-transparent to-transparent dark:block" />
          <div className="relative mx-auto flex h-full max-w-[1400px] items-center justify-between gap-4 px-4 sm:px-6">
            <div className="min-w-0">
              <p className="hidden text-[11px] font-semibold uppercase tracking-label text-[#d4b37a] sm:block">
                Canny Capital Partners
              </p>
              <h1 className="mt-1 font-sans text-2xl font-bold text-white sm:text-3xl">
                Business Development
              </h1>
              <p className="mt-1 hidden text-sm text-[#e8dfc8] sm:block">
                Sourcing, market intelligence, and the deal pipeline
              </p>
            </div>
          </div>
          <div className="absolute inset-x-0 bottom-0 h-0.5 bg-[#b8975a]" />
        </div>
      </div>

      {/* Sticky in-page tab bar (below the 56px shell TopBar). */}
      <div className="sticky top-14 z-20 border-b border-slate-200 bg-white/85 backdrop-blur dark:border-white/10 dark:bg-[#0d1f3c]/85">
        <nav
          aria-label="Business Development sections"
          role="tablist"
          className="mx-auto flex max-w-[1400px] gap-2 overflow-x-auto whitespace-nowrap px-4 py-2 sm:px-6"
        >
          {NAV.map((n) => (
            <a
              key={n.id}
              href={"#" + n.id}
              onClick={select(n.id)}
              role="tab"
              aria-selected={active === n.id}
              aria-current={active === n.id ? "true" : undefined}
              className={
                (active === n.id ? "chip chip-active" : "chip") +
                " min-h-[44px] px-4"
              }
            >
              {n.label}
            </a>
          ))}
        </nav>
      </div>

      {/* The full pages, embedded (their own heroes suppressed; each
          page supplies its own content container). */}
      {active === "bd-pipeline" && <PipelineView embedded />}
      {active === "bd-activity" && <ActivityView embedded />}
      {active === "bd-market" && <MarketIntelView embedded />}

      <div className="mx-auto max-w-[1400px] px-4 pb-6 sm:px-6">
        <p className="text-sm text-slate-400 dark:text-white/40">
          The existing CRM, now under Business Development — every record
          here links to the central company record, so deals, people, and
          documents stay connected across modules.
        </p>
      </div>
    </div>
  );
}

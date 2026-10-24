"use client";

/**
 * Business Development hub (navigation restructure): live summary
 * sections — Pipeline, Market Intel, Activity, Tasks & Follow-ups —
 * under a sticky in-page tab bar. Ethan, Oct 23, 2026: these are
 * TABS, not a scroll page — only the selected tab's section renders
 * (which also means an unselected section never fetches). The tab
 * restores from the URL hash (#bd-pipeline / #bd-market /
 * #bd-activity / #bd-tasks) so deep links keep working. No Directory
 * or Audit Trail tiles — those live in the main nav. The header
 * replicates PageHero's markup; the Capture button that used to sit
 * at its right was removed at Ethan's direction (Oct 23, 2026) — the
 * /capture page itself is unchanged.
 */

import { useEffect, useState } from "react";
import { BANNER_DARK, BANNER_LIGHT } from "@/lib/sector-colors";
import BdPipelineSection from "./BdPipelineSection";
import BdMarketSection from "./BdMarketSection";
import BdActivitySection from "./BdActivitySection";
import BdTasksSection from "./BdTasksSection";

const NAV: { id: string; label: string }[] = [
  { id: "bd-pipeline", label: "Pipeline" },
  { id: "bd-market", label: "Market Intel" },
  { id: "bd-activity", label: "Activity" },
  { id: "bd-tasks", label: "Tasks & Follow-ups" },
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

      <div className="mx-auto max-w-[1400px] space-y-10 px-4 py-6 sm:px-6">
        {active === "bd-pipeline" && <BdPipelineSection />}
        {active === "bd-market" && <BdMarketSection />}
        {active === "bd-activity" && <BdActivitySection />}
        {active === "bd-tasks" && <BdTasksSection />}
        <p className="text-sm text-slate-400 dark:text-white/40">
          The existing CRM, now under Business Development — every record
          here links to the central company record, so deals, people, and
          documents stay connected across modules.
        </p>
      </div>
    </div>
  );
}

"use client";

/**
 * Business Development hub (navigation restructure): replaces the
 * old card grid with live summary sections — Pipeline, Market
 * Intel, Activity, Tasks & Follow-ups — under a sticky in-page
 * section bar. Each section fetches only its own compact summary
 * endpoint; sections below the fold lazy-mount near the viewport.
 * No Directory or Audit Trail tiles — those live in the main nav.
 *
 * The header replicates PageHero's markup (PageHero has no action
 * slot) so the Capture button can sit at the right of the banner.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { BANNER_DARK, BANNER_LIGHT } from "@/lib/sector-colors";
import LazyMount from "./LazyMount";
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

  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) setActive(e.target.id);
        }
      },
      { rootMargin: "-30% 0px -60% 0px" }
    );
    // Sections below the fold lazy-mount (their element replaces the
    // LazyMount placeholder carrying the same id), so re-scan for
    // unobserved section elements whenever the DOM changes.
    const seen = new Set<Element>();
    const scan = () => {
      for (const n of NAV) {
        const el = document.getElementById(n.id);
        if (el && !seen.has(el)) {
          seen.add(el);
          obs.observe(el);
        }
      }
    };
    scan();
    const mo =
      typeof MutationObserver !== "undefined"
        ? new MutationObserver(scan)
        : null;
    if (mo) mo.observe(document.body, { childList: true, subtree: true });
    return () => {
      if (mo) mo.disconnect();
      obs.disconnect();
    };
  }, []);

  const jump = (id: string) => (e: React.MouseEvent) => {
    e.preventDefault();
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    setActive(id);
  };

  return (
    <div>
      {/* PageHero-style header with the Capture action at the right. */}
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
              <h1 className="mt-1 font-display text-3xl font-semibold text-white sm:text-4xl">
                Business Development
              </h1>
              <p className="mt-1 hidden text-sm text-[#e8dfc8] sm:block">
                Sourcing, market intelligence, and the deal pipeline
              </p>
            </div>
            <Link href="/capture" className="btn btn-accent shrink-0">
              + Capture
            </Link>
          </div>
          <div className="absolute inset-x-0 bottom-0 h-0.5 bg-[#b8975a]" />
        </div>
      </div>

      {/* Sticky in-page section bar (below the ~52px shell TopBar). */}
      <div className="sticky top-[52px] z-20 border-b border-slate-200 bg-white/85 backdrop-blur dark:border-white/10 dark:bg-[#0d1f3c]/85">
        <nav
          aria-label="Business Development sections"
          className="mx-auto flex max-w-[1400px] gap-2 overflow-x-auto whitespace-nowrap px-4 py-2 sm:px-6"
        >
          {NAV.map((n) => (
            <a
              key={n.id}
              href={"#" + n.id}
              onClick={jump(n.id)}
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
        <BdPipelineSection />
        <LazyMount id="bd-market">
          <BdMarketSection />
        </LazyMount>
        <LazyMount id="bd-activity">
          <BdActivitySection />
        </LazyMount>
        <LazyMount id="bd-tasks">
          <BdTasksSection />
        </LazyMount>
        <p className="text-sm text-slate-400 dark:text-white/40">
          The existing CRM, now under Business Development — every record
          here links to the central company record, so deals, people, and
          documents stay connected across modules.
        </p>
      </div>
    </div>
  );
}

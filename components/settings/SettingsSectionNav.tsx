"use client";

/**
 * Settings — General: section navigation (Ethan, Oct 24, 2026).
 * Replaces the chip index row (added earlier the same day, rejected
 * on sight — three stacked chip rows cluttering the tab). Desktop:
 * a sticky left rail grouped by the page's own group headings, each
 * group a chevron disclosure over its sections; section links
 * anchor-scroll to the cards (ids + scroll-margins live on the
 * sections in app/settings/page.tsx). Mobile: the rail collapses to
 * one "Jump to a section…" select with the same groups as
 * <optgroup>s — a native select closes itself on selection. A light
 * IntersectionObserver scrollspy highlights the section in view and
 * opens its group when it has been collapsed.
 */

import { useEffect, useState } from "react";

interface SectionLink {
  id: string;
  label: string;
}
interface SectionGroup {
  label: string;
  sections: SectionLink[];
}

const SECTION_GROUPS: SectionGroup[] = [
  {
    label: "Workspace",
    sections: [{ id: "settings-focus-theme", label: "Focus & Theme" }],
  },
  {
    label: "Account & security",
    sections: [
      { id: "settings-notifications", label: "Notifications" },
      { id: "settings-security", label: "Security & devices" },
    ],
  },
  {
    label: "Sourcing & fit rules",
    sections: [
      { id: "settings-hospitality", label: "Hospitality fit rules" },
      { id: "settings-chain-filter", label: "Chain & franchise filter" },
      { id: "settings-manual-sources", label: "Manual sources" },
    ],
  },
  {
    label: "Deal workflow",
    sections: [
      { id: "settings-valuation", label: "Valuation parameters" },
      { id: "settings-stage-gates", label: "Stage gates" },
      { id: "settings-esignature", label: "E-signature" },
      { id: "settings-investment-types", label: "Investment types" },
    ],
  },
  {
    label: "System",
    sections: [{ id: "settings-background-jobs", label: "Background jobs" }],
  },
];

function allOpen(): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  SECTION_GROUPS.forEach((g) => {
    out[g.label] = true;
  });
  return out;
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={`h-4 w-4 shrink-0 text-slate-400 transition-transform duration-200 dark:text-white/40 ${
        open ? "" : "-rotate-90"
      }`}
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

export default function SettingsSectionNav() {
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(allOpen);
  const [activeId, setActiveId] = useState<string>("");

  // Scrollspy: the section crossing the band just under the sticky
  // bars is "in view". Sections carry scroll-mt-[104px], so the band
  // starts below that.
  useEffect(() => {
    const ids: string[] = [];
    SECTION_GROUPS.forEach((g) =>
      g.sections.forEach((s) => ids.push(s.id))
    );
    if (window.location.hash) {
      const fromHash = window.location.hash.slice(1);
      if (ids.indexOf(fromHash) >= 0) setActiveId(fromHash);
    }
    if (typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) setActiveId(entry.target.id);
        });
      },
      { rootMargin: "-110px 0px -55% 0px", threshold: 0 }
    );
    ids.forEach((id) => {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    });
    return () => observer.disconnect();
  }, []);

  // Keep the in-view section's group open so the highlight is visible.
  useEffect(() => {
    if (!activeId) return;
    SECTION_GROUPS.forEach((g) => {
      const contains = g.sections.some((s) => s.id === activeId);
      if (contains) {
        setOpenGroups((prev) =>
          prev[g.label] ? prev : { ...prev, [g.label]: true }
        );
      }
    });
  }, [activeId]);

  const jumpTo = (id: string) => {
    setActiveId(id);
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="lg:sticky lg:top-[72px] lg:w-[232px] lg:shrink-0">
      {/* Mobile / tablet: one jump-to select, same groups. */}
      <div className="lg:hidden">
        <label className="sr-only" htmlFor="settings-section-jump">
          Jump to a section
        </label>
        <select
          id="settings-section-jump"
          className="min-h-[44px] w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-[#0d1f3c] outline-none focus:border-[#b8975a] focus:ring-2 focus:ring-[#b8975a]/40 dark:border-white/10 dark:bg-white/5 dark:text-white"
          value={activeId}
          onChange={(e) => {
            if (e.target.value) jumpTo(e.target.value);
          }}
        >
          <option value="" disabled>
            Jump to a section…
          </option>
          {SECTION_GROUPS.map((g) => (
            <optgroup key={g.label} label={g.label}>
              {g.sections.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>

      {/* Desktop: sticky left rail, groups as chevron disclosures. */}
      <nav
        aria-label="Settings sections"
        className="hidden rounded-2xl border border-slate-200 bg-white p-3 shadow-sm lg:block dark:border-white/10 dark:bg-[#132847]/60"
      >
        {SECTION_GROUPS.map((g, gi) => {
          const open = !!openGroups[g.label];
          return (
            <div key={g.label} className={gi > 0 ? "mt-2" : ""}>
              <button
                type="button"
                aria-expanded={open}
                onClick={() =>
                  setOpenGroups((prev) => ({ ...prev, [g.label]: !open }))
                }
                className="flex min-h-[36px] w-full items-center justify-between rounded-lg px-2 py-1.5 text-left transition hover:bg-[#f0f4fa] dark:hover:bg-white/5"
              >
                <span className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-white/40">
                  {g.label}
                </span>
                <Chevron open={open} />
              </button>
              {open && (
                <ul className="mt-0.5 space-y-0.5">
                  {g.sections.map((s) => {
                    const isActive = s.id === activeId;
                    return (
                      <li key={s.id}>
                        <a
                          href={`#${s.id}`}
                          aria-current={isActive ? "true" : undefined}
                          onClick={() => setActiveId(s.id)}
                          className={`flex min-h-[40px] items-center rounded-lg px-3 py-2 text-sm font-medium transition ${
                            isActive
                              ? "bg-[#0d1f3c] text-white shadow-sm dark:bg-[#b8975a] dark:text-[#0d1f3c]"
                              : "text-slate-600 hover:bg-[#f0f4fa] hover:text-[#0d1f3c] dark:text-white/60 dark:hover:bg-white/10 dark:hover:text-white"
                          }`}
                        >
                          {s.label}
                        </a>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          );
        })}
      </nav>
    </div>
  );
}

"use client";

/**
 * Today header (Overview redesign §2, Oct 25, 2026).
 *
 * The hero IS the Today header: greeting by Phoenix time of day,
 * the full date, and the one-line data brief merged into the banner
 * (imagery lives only here per §11). The brief is built by the
 * caller from REAL counts only (meetings today, follow-ups due
 * today, overdue) — any piece that can't be derived is omitted.
 *
 * Photography (Ethan, Oct 26, 2026): the day/night theme transition
 * stays, but both variants are now the realistic photographs the
 * public website runs — the Luke AFB four-ship formation in day
 * (light) mode, the Falcon 9 night-launch still in night (dark)
 * mode — and the decorative lines/motif overlay is gone. The navy
 * gradient is deepened a step (via /75, to /40) so the greeting
 * text holds WCAG AA over the brightest region of either photo,
 * desktop and mobile crops (worst measured: 4.59:1, the gold
 * eyebrow over the day formation at phone width).
 */

import { OVERVIEW_HERO_DAY, OVERVIEW_HERO_NIGHT } from "@/lib/sector-colors";
import { useFocus } from "@/components/focus/FocusProvider";

export function phoenixHour(now = new Date()): number {
  const h = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Phoenix",
    hour: "numeric",
    hour12: false,
  }).format(now);
  const n = Number(h);
  return Number.isFinite(n) ? n % 24 : 12;
}

export function greetingFor(hour: number): string {
  if (hour < 5) return "Working late";
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

export default function TodayHero({
  firstName,
  briefParts,
}: {
  firstName: string;
  briefParts: string[];
}) {
  const { focus } = useFocus();
  const now = new Date();
  const greeting = greetingFor(phoenixHour(now));
  const fullDate = now.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "America/Phoenix",
  });
  return (
    <section className="relative mb-6 overflow-hidden rounded-2xl">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={OVERVIEW_HERO_DAY}
        alt=""
        loading="lazy"
        className="absolute inset-0 h-full w-full object-cover dark:hidden"
      />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={OVERVIEW_HERO_NIGHT}
        alt=""
        loading="lazy"
        className="absolute inset-0 hidden h-full w-full object-cover dark:block"
      />
      <div className="absolute inset-0 bg-gradient-to-r from-[#0d1f3c] via-[#0d1f3c]/75 to-[#0d1f3c]/40" />
      <div className="absolute inset-0 bg-gradient-to-t from-[#0d1f3c]/60 via-transparent to-transparent" />
      <div className="relative px-5 py-6 sm:px-6 sm:py-7">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#d4b37a]">
          {focus === "ad"
            ? "Canny Capital Partners · Arizona aerospace and defense"
            : "Canny Capital Partners · Overview"}
        </p>
        <h1 className="mt-1.5 font-display text-3xl font-semibold text-white sm:text-4xl">
          {greeting}
          {firstName ? `, ${firstName}` : ""}
        </h1>
        <p className="mt-1 text-sm font-medium text-[#e8dfc8]">{fullDate}</p>
        {briefParts.length > 0 && (
          <p className="mt-2 max-w-xl text-sm text-white/75">
            {briefParts.join(" · ")}
          </p>
        )}
      </div>
      <div className="absolute inset-x-0 bottom-0 h-0.5 bg-[#b8975a]" />
    </section>
  );
}

"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import PageHero from "@/components/PageHero";
import type { CalendarEvent } from "@/lib/calendar-db";

/**
 * Calendar (Ethan, Oct 9, 2026): Ethan's Outlook calendar mirrored into the
 * portal. Events sync every ~15 minutes (portal-calendar-sync). Titles open
 * the real Outlook event; locations open Maps (meeting URLs render as short
 * Zoom/Teams/Online labels). Events dismissed from the Weekly summary show
 * muted here with a Restore button — dismissal only affects the summary.
 */

const locText = (loc: string): string => {
  if (!loc) return "";
  if (/^https?:\/\//i.test(loc)) {
    const l = loc.toLowerCase();
    return l.includes("zoom") ? "Zoom" : l.includes("teams") ? "Microsoft Teams" : "Online";
  }
  return loc;
};

const dayKey = (iso: string): string =>
  new Date(iso).toLocaleDateString("en-US", { timeZone: "America/Phoenix" });

const dayLabel = (iso: string): string => {
  const today = new Date().toLocaleDateString("en-US", { timeZone: "America/Phoenix" });
  const tomorrow = new Date(Date.now() + 86400000).toLocaleDateString("en-US", {
    timeZone: "America/Phoenix",
  });
  const k = dayKey(iso);
  if (k === today) return "Today";
  if (k === tomorrow) return "Tomorrow";
  return new Date(iso).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: "America/Phoenix",
  });
};

const timeLabel = (e: CalendarEvent): string => {
  if (e.allDay) return "All day";
  const fmt = (iso: string) =>
    new Date(iso).toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      timeZone: "America/Phoenix",
    });
  return e.endsAt ? `${fmt(e.startsAt)} – ${fmt(e.endsAt)}` : fmt(e.startsAt);
};

export default function CalendarPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [events, setEvents] = useState<CalendarEvent[]>([]);

  useEffect(() => {
    (async () => {
      try {
        const from = new Date(Date.now() - 16 * 86400000).toISOString();
        const to = new Date(Date.now() + 28 * 86400000).toISOString();
        const r = await fetch(
          `/api/calendar?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
        );
        if (r.status === 401) {
          router.replace("/login");
          return;
        }
        if (r.ok) {
          const d = await r.json();
          if (Array.isArray(d.events)) setEvents(d.events);
        }
      } finally {
        setLoading(false);
      }
    })();
  }, [router]);

  const setDismissed = async (eventId: string, dismissed: boolean) => {
    setEvents((prev) =>
      prev.map((e) => (e.eventId === eventId ? { ...e, dismissed } : e))
    );
    try {
      await fetch("/api/calendar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "dismiss", eventId, dismissed }),
      });
    } catch {
      /* optimistic state stands for this session */
    }
  };

  const { upcoming, past } = useMemo(() => {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const todayMs = startOfToday.getTime();
    const weekAgoMs = todayMs - 7 * 86400000;
    const up: CalendarEvent[] = [];
    const pa: CalendarEvent[] = [];
    events.forEach((e) => {
      const t = new Date(e.startsAt).getTime();
      if (t >= todayMs) up.push(e);
      else if (t >= weekAgoMs) pa.push(e);
    });
    pa.reverse();
    return { upcoming: up, past: pa };
  }, [events]);

  const groups = (list: CalendarEvent[]) => {
    const keys: string[] = [];
    const map = new Map<string, CalendarEvent[]>();
    list.forEach((e) => {
      const k = dayKey(e.startsAt);
      if (!map.has(k)) {
        keys.push(k);
        map.set(k, []);
      }
      (map.get(k) as CalendarEvent[]).push(e);
    });
    return keys.map((k) => ({ key: k, label: dayLabel((map.get(k) as CalendarEvent[])[0].startsAt), rows: map.get(k) as CalendarEvent[] }));
  };

  const row = (e: CalendarEvent) => {
    const d = new Date(e.startsAt);
    return (
      <li
        key={e.eventId}
        className={`group flex items-center gap-3 rounded-lg border px-2.5 py-2 ${
          e.dismissed
            ? "border-slate-100 bg-slate-50/40 opacity-60 dark:border-white/5 dark:bg-white/[0.02]"
            : "border-slate-100 bg-slate-50/60 dark:border-white/5 dark:bg-white/[0.03]"
        }`}
      >
        <div className="flex h-10 w-11 shrink-0 flex-col items-center justify-center rounded-md bg-[#0d1f3c] text-white dark:bg-[#b8975a] dark:text-[#0d1f3c]">
          <span className="text-[9px] font-bold uppercase leading-none tracking-wider">
            {d.toLocaleDateString("en-US", { month: "short", timeZone: "America/Phoenix" })}
          </span>
          <span className="text-base font-bold leading-tight">
            {d.toLocaleDateString("en-US", { day: "numeric", timeZone: "America/Phoenix" })}
          </span>
        </div>
        <div className="min-w-0 flex-1">
          {e.webUrl ? (
            <a
              href={e.webUrl}
              target="_blank"
              rel="noreferrer"
              className="block truncate text-sm font-semibold text-[#0d1f3c] hover:underline dark:text-white"
            >
              {e.title}
            </a>
          ) : (
            <p className="truncate text-sm font-semibold text-[#0d1f3c] dark:text-white">
              {e.title}
            </p>
          )}
          <p className="truncate text-xs text-slate-400 dark:text-white/40">
            {timeLabel(e)}
            {e.location ? (
              <>
                {" · "}
                {/^https?:\/\//i.test(e.location) ? (
                  <a
                    href={e.location}
                    target="_blank"
                    rel="noreferrer"
                    className="underline decoration-dotted underline-offset-2 hover:text-[#8a6f3e]"
                  >
                    {locText(e.location)}
                  </a>
                ) : /teams|zoom|online|phone|call/i.test(e.location) ? (
                  <span>{e.location}</span>
                ) : (
                  <a
                    href={`https://www.google.com/maps/search/${encodeURIComponent(e.location)}`}
                    target="_blank"
                    rel="noreferrer"
                    className="hover:underline"
                  >
                    {e.location}
                  </a>
                )}
              </>
            ) : null}
            {e.attendees.length > 0
              ? ` · ${e.attendees.slice(0, 2).join(", ")}${e.attendees.length > 2 ? ` +${e.attendees.length - 2}` : ""}`
              : ""}
          </p>
        </div>
        {e.dismissed ? (
          <span className="flex shrink-0 items-center gap-2">
            <span className="hidden text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-white/30 sm:block">
              Hidden from summary
            </span>
            <button
              onClick={() => setDismissed(e.eventId, false)}
              className="rounded-lg border border-[#b8975a]/60 px-2.5 py-1 text-xs font-semibold text-[#8a6f3e] transition hover:bg-[#b8975a]/15 dark:text-[#d4b37a]"
            >
              Restore
            </button>
          </span>
        ) : (
          <button
            onClick={() => setDismissed(e.eventId, true)}
            title="Hide from Weekly summary"
            aria-label="Hide from Weekly summary"
            className="shrink-0 rounded px-1.5 text-lg leading-none text-slate-300 opacity-0 transition hover:text-red-400 group-hover:opacity-100 dark:text-white/25"
          >
            ×
          </button>
        )}
      </li>
    );
  };

  const section = (title: string, list: CalendarEvent[]) => {
    if (list.length === 0) return null;
    return (
      <div className="mb-8">
        <h3 className="mb-3 text-sm font-bold uppercase tracking-wider text-[#0d1f3c] dark:text-white">
          {title}
        </h3>
        {groups(list).map((g) => (
          <div key={g.key} className="mb-4">
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-white/40">
              {g.label}
            </p>
            <ul className="space-y-1.5">{g.rows.map(row)}</ul>
          </div>
        ))}
      </div>
    );
  };

  return (
    <div>
      <PageHero
        eyebrow="Canny Capital Partners"
        title="Calendar"
        subtitle="Your Outlook calendar, mirrored into the portal — syncs every few minutes"
      />
      <div className="mx-auto max-w-[1100px] px-4 py-6 sm:px-6">
        {loading ? (
          <p className="text-sm text-slate-400 dark:text-white/40">Loading calendar…</p>
        ) : events.length === 0 ? (
          <p className="text-sm text-slate-400 dark:text-white/40">
            No events in the synced window yet — the next sync runs within ~15 minutes.
          </p>
        ) : (
          <>
            {section("Upcoming", upcoming)}
            {section("Earlier this week", past)}
          </>
        )}
      </div>
    </div>
  );
}

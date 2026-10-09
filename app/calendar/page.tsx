"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import PageHero from "@/components/PageHero";
import type { CalendarEvent } from "@/lib/calendar-db";

/**
 * Calendar (Ethan, Oct 9, 2026): Ethan's Outlook calendar mirrored into the
 * portal, editable in place. The portal holds no Microsoft credentials —
 * edits queue in the calendar outbox and the 15-minute sync applies them to
 * Outlook (and pulls Outlook's changes back). Titles open the real Outlook
 * event; locations open Maps (meeting URLs render as short Zoom/Teams/Online
 * labels). Dismiss (×) only hides an event from the Weekly summary; Delete
 * removes it from Outlook itself on the next sync.
 */

interface OutboxItem {
  id: string;
  action: string;
  eventId: string;
  payload: Record<string, unknown>;
  status: string;
}

interface MsStatus {
  configured: boolean;
  connected: boolean;
  accountEmail: string;
}

interface Draft {
  title: string;
  date: string;
  start: string;
  end: string;
  location: string;
}

const emptyDraft: Draft = { title: "", date: "", start: "09:00", end: "09:30", location: "" };

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

const draftOf = (e: CalendarEvent): Draft => ({
  title: e.title,
  date: e.startsAt.slice(0, 10),
  start: e.allDay ? "09:00" : e.startsAt.slice(11, 16) || "09:00",
  end: e.endsAt ? e.endsAt.slice(11, 16) || "09:30" : "09:30",
  location: /^https?:\/\//i.test(e.location) ? "" : e.location,
});

const payloadOf = (d: Draft) => ({
  title: d.title.trim(),
  startsAt: `${d.date}T${d.start}:00-07:00`,
  endsAt: `${d.date}T${d.end}:00-07:00`,
  location: d.location.trim(),
});

export default function CalendarPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [pending, setPending] = useState<OutboxItem[]>([]);
  const [showNew, setShowNew] = useState(false);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [editingId, setEditingId] = useState<string>("");
  const [editDraft, setEditDraft] = useState<Draft>(emptyDraft);
  const [notice, setNotice] = useState("");
  const [ms, setMs] = useState<MsStatus | null>(null);

  const loadPending = async () => {
    try {
      const r = await fetch("/api/calendar/outbox?status=pending");
      if (r.ok) {
        const d = await r.json();
        if (Array.isArray(d.items)) setPending(d.items);
      }
    } catch {
      /* pending strip just stays as-is */
    }
  };

  const loadEvents = async () => {
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
  };

  const loadMsStatus = async () => {
    try {
      const r = await fetch("/api/calendar/microsoft/status");
      if (r.ok) setMs(await r.json());
    } catch {
      /* banner just stays hidden */
    }
  };

  useEffect(() => {
    (async () => {
      try {
        await loadEvents();
        await loadPending();
        await loadMsStatus();
        const param = new URLSearchParams(window.location.search).get("ms");
        if (param === "connected") {
          setNotice("Outlook connected — real-time sync is on.");
        } else if (param && param.startsWith("error")) {
          setNotice("Microsoft connection didn't complete — try Connect again.");
        } else if (param === "not-configured") {
          setNotice("Real-time sync isn't configured yet (missing Microsoft app keys).");
        }
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  const queueIntent = async (
    action: "create" | "update" | "delete",
    eventId: string,
    payload: Record<string, unknown>
  ) => {
    // Real-time path: write straight to Outlook via Graph when connected.
    if (ms?.connected) {
      const url =
        action === "create"
          ? "/api/calendar/events"
          : action === "update"
            ? "/api/calendar/events/update"
            : "/api/calendar/events/delete";
      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventId, payload }),
      });
      if (r.ok) {
        setNotice("Saved to Outlook ✓");
        await loadEvents();
        return;
      }
      if (r.status !== 409) {
        setNotice("Something went wrong saving that — please try again.");
        return;
      }
      // 409 = connection dropped; fall through to the queued path.
    }
    const r = await fetch("/api/calendar/outbox", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, eventId, payload }),
    });
    if (r.ok) {
      setNotice("Saved — it will sync to Outlook within ~15 minutes.");
      await loadPending();
    } else {
      setNotice("Something went wrong saving that — please try again.");
    }
  };

  const disconnectMs = async () => {
    if (!window.confirm("Disconnect Outlook from the portal? Events stop syncing in real time.")) return;
    await fetch("/api/calendar/microsoft/disconnect", { method: "POST" });
    setMs((prev) => (prev ? { ...prev, connected: false, accountEmail: "" } : prev));
    setNotice("Outlook disconnected.");
  };

  const submitNew = async () => {
    if (!draft.title.trim() || !draft.date) {
      setNotice("Give the event a title and a date first.");
      return;
    }
    await queueIntent("create", "", payloadOf(draft));
    setShowNew(false);
    setDraft(emptyDraft);
  };

  const submitEdit = async (e: CalendarEvent) => {
    if (!editDraft.title.trim() || !editDraft.date) {
      setNotice("Give the event a title and a date first.");
      return;
    }
    await queueIntent("update", e.eventId, payloadOf(editDraft));
    setEditingId("");
  };

  const submitDelete = async (e: CalendarEvent) => {
    if (!window.confirm(`Delete "${e.title}" from Outlook on the next sync?`)) return;
    await queueIntent("delete", e.eventId, { title: e.title });
    setEditingId("");
  };

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
    return keys.map((k) => ({
      key: k,
      label: dayLabel((map.get(k) as CalendarEvent[])[0].startsAt),
      rows: map.get(k) as CalendarEvent[],
    }));
  };

  const formFields = (d: Draft, set: (x: Draft) => void) => (
    <div className="grid gap-2.5 sm:grid-cols-2">
      <input
        value={d.title}
        onChange={(e) => set({ ...d, title: e.target.value })}
        placeholder="Event title — e.g. Coffee with Jared Stein"
        className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-[#0d1f3c] outline-none placeholder:text-slate-300 focus:border-[#b8975a] dark:border-white/10 dark:bg-white/[0.04] dark:text-white dark:placeholder:text-white/30 sm:col-span-2"
      />
      <input
        type="date"
        value={d.date}
        onChange={(e) => set({ ...d, date: e.target.value })}
        className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-[#0d1f3c] outline-none focus:border-[#b8975a] dark:border-white/10 dark:bg-white/[0.04] dark:text-white"
      />
      <div className="flex items-center gap-2">
        <input
          type="time"
          value={d.start}
          onChange={(e) => set({ ...d, start: e.target.value })}
          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-[#0d1f3c] outline-none focus:border-[#b8975a] dark:border-white/10 dark:bg-white/[0.04] dark:text-white"
        />
        <span className="text-slate-400">–</span>
        <input
          type="time"
          value={d.end}
          onChange={(e) => set({ ...d, end: e.target.value })}
          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-[#0d1f3c] outline-none focus:border-[#b8975a] dark:border-white/10 dark:bg-white/[0.04] dark:text-white"
        />
      </div>
      <input
        value={d.location}
        onChange={(e) => set({ ...d, location: e.target.value })}
        placeholder="Location (optional)"
        className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-[#0d1f3c] outline-none placeholder:text-slate-300 focus:border-[#b8975a] dark:border-white/10 dark:bg-white/[0.04] dark:text-white dark:placeholder:text-white/30 sm:col-span-2"
      />
    </div>
  );

  const row = (e: CalendarEvent) => {
    const d = new Date(e.startsAt);
    const editing = editingId === e.eventId;
    return (
      <li
        key={e.eventId}
        className={`rounded-lg border px-2.5 py-2 ${
          e.dismissed
            ? "border-slate-100 bg-slate-50/40 opacity-60 dark:border-white/5 dark:bg-white/[0.02]"
            : "border-slate-100 bg-slate-50/60 dark:border-white/5 dark:bg-white/[0.03]"
        }`}
      >
        <div className="group flex items-center gap-3">
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
          <button
            onClick={() => {
              setEditingId(editing ? "" : e.eventId);
              setEditDraft(draftOf(e));
            }}
            className="shrink-0 rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-semibold text-slate-500 transition hover:border-[#b8975a]/60 hover:text-[#8a6f3e] dark:border-white/10 dark:text-white/60"
          >
            Edit
          </button>
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
        </div>
        {editing && (
          <div className="mt-3 border-t border-slate-200/70 pt-3 dark:border-white/10">
            {formFields(editDraft, setEditDraft)}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                onClick={() => submitEdit(e)}
                className="rounded-lg bg-[#0d1f3c] px-3.5 py-1.5 text-sm font-semibold text-white transition hover:bg-[#16294d] dark:bg-[#b8975a] dark:text-[#0d1f3c]"
              >
                Save changes
              </button>
              <button
                onClick={() => setEditingId("")}
                className="rounded-lg border border-slate-200 px-3.5 py-1.5 text-sm font-semibold text-slate-500 dark:border-white/10 dark:text-white/60"
              >
                Cancel
              </button>
              <button
                onClick={() => submitDelete(e)}
                className="ml-auto rounded-lg border border-red-200 px-3.5 py-1.5 text-sm font-semibold text-red-500 transition hover:bg-red-50 dark:border-red-500/30 dark:hover:bg-red-500/10"
              >
                Delete event
              </button>
            </div>
            <p className="mt-2 text-[11px] text-slate-400 dark:text-white/30">
              {ms?.connected
                ? "Changes save straight to Outlook. Attendees can't be changed here — edit those in Outlook."
                : "Changes apply to Outlook on the next sync (~15 min). Attendees can't be changed here — edit those in Outlook."}
            </p>
          </div>
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
        {ms && !ms.connected && ms.configured && (
          <div className="mb-5 flex flex-wrap items-center gap-3 rounded-xl border border-[#b8975a]/50 bg-[#b8975a]/10 px-4 py-3.5">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold text-[#0d1f3c] dark:text-white">
                Connect Outlook for real-time sync
              </p>
              <p className="text-xs text-slate-500 dark:text-white/60">
                One sign-in, and events you create or edit here land in Outlook instantly —
                and Outlook changes appear here in seconds. Calendar-only permission; no
                mail access.
              </p>
            </div>
            <a
              href="/api/calendar/microsoft/connect"
              className="rounded-lg bg-[#0d1f3c] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#16294d] dark:bg-[#b8975a] dark:text-[#0d1f3c]"
            >
              Connect Outlook
            </a>
          </div>
        )}
        {ms?.connected && (
          <div className="mb-5 flex flex-wrap items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 dark:border-emerald-500/25 dark:bg-emerald-500/10">
            <p className="flex-1 text-sm font-medium text-emerald-800 dark:text-emerald-200">
              ⚡ Real-time sync on{ms.accountEmail ? ` — ${ms.accountEmail}` : ""}
            </p>
            <button
              onClick={disconnectMs}
              className="rounded-lg border border-emerald-300 px-3 py-1 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-100 dark:border-emerald-500/30 dark:text-emerald-200 dark:hover:bg-emerald-500/10"
            >
              Disconnect
            </button>
          </div>
        )}
        {ms && !ms.configured && (
          <div className="mb-5 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 dark:border-white/10 dark:bg-white/[0.03]">
            <p className="text-xs text-slate-500 dark:text-white/50">
              Real-time sync isn&apos;t configured yet — events currently sync every ~15
              minutes. Ask Muse to finish the Microsoft connection setup.
            </p>
          </div>
        )}
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <button
            onClick={() => setShowNew((s) => !s)}
            className="rounded-lg bg-[#0d1f3c] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#16294d] dark:bg-[#b8975a] dark:text-[#0d1f3c]"
          >
            ＋ New event
          </button>
          {notice && (
            <p className="text-sm text-[#8a6f3e] dark:text-[#d4b37a]">{notice}</p>
          )}
        </div>

        {showNew && (
          <div className="mb-5 rounded-xl border border-slate-200 bg-white p-4 dark:border-white/10 dark:bg-[#132847]/60">
            {formFields(draft, setDraft)}
            <div className="mt-3 flex gap-2">
              <button
                onClick={submitNew}
                className="rounded-lg bg-[#0d1f3c] px-3.5 py-1.5 text-sm font-semibold text-white transition hover:bg-[#16294d] dark:bg-[#b8975a] dark:text-[#0d1f3c]"
              >
                Add event
              </button>
              <button
                onClick={() => setShowNew(false)}
                className="rounded-lg border border-slate-200 px-3.5 py-1.5 text-sm font-semibold text-slate-500 dark:border-white/10 dark:text-white/60"
              >
                Cancel
              </button>
            </div>
            <p className="mt-2 text-[11px] text-slate-400 dark:text-white/30">
              {ms?.connected
                ? "New events are created in Outlook instantly. If the title names an operator or business in the pipeline, a note is logged on their profile automatically."
                : "New events are created in Outlook on the next sync (~15 min). If the title names an operator or business in the pipeline, a note is logged on their profile automatically."}
            </p>
          </div>
        )}

        {pending.length > 0 && (
          <div className="mb-5 rounded-xl border border-[#b8975a]/40 bg-[#b8975a]/10 px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-[#8a6f3e] dark:text-[#d4b37a]">
              Waiting to sync to Outlook
            </p>
            <ul className="mt-1.5 space-y-0.5">
              {pending.map((p) => (
                <li key={p.id} className="text-sm text-slate-600 dark:text-white/75">
                  {p.action === "create" ? "＋ New: " : p.action === "update" ? "✎ Edit: " : "🗑 Delete: "}
                  {String(p.payload.title ?? "(untitled)")}
                </li>
              ))}
            </ul>
          </div>
        )}

        {loading ? (
          <p className="text-sm text-slate-400 dark:text-white/40">Loading calendar…</p>
        ) : events.length === 0 && pending.length === 0 ? (
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

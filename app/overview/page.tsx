"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import TaskList from "@/components/TaskList";
import PageHero from "@/components/PageHero";
import { DEAL_STAGES, type Deal, type DealFlowItem, type Executive, type Interaction, type Task } from "@/lib/types";
import type { CalendarEvent } from "@/lib/calendar-db";
import { fmtMoney } from "@/lib/format";

const TargetMap = dynamic(() => import("@/components/TargetMap"), {
  ssr: false,
  loading: () => (
    <div className="flex h-72 items-center justify-center rounded-xl border border-slate-200 bg-slate-50 sm:h-80 dark:border-white/10 dark:bg-[#0d1f3c]">
      <p className="text-sm text-slate-400 dark:text-white/40">Loading map…</p>
    </div>
  ),
});

const TERMINAL_STAGES = ["Closed Won", "Passed"];

const fmtWhen = (iso: string, allDay: boolean): string => {
  const d = new Date(iso);
  const day = d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "America/Phoenix",
  });
  if (allDay) return day;
  const time = d.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/Phoenix",
  });
  return `${day} · ${time}`;
};

// A location that is a raw meeting URL renders as a short label, never the
// full link (Ethan, Oct 9, 2026 — a Zoom URL ran the full width of the card).
const locText = (loc: string): string => {
  if (!loc) return "";
  if (/^https?:\/\//i.test(loc)) {
    const l = loc.toLowerCase();
    return l.includes("zoom") ? "Zoom" : l.includes("teams") ? "Microsoft Teams" : "Online";
  }
  return loc;
};

export default function Overview() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [userName, setUserName] = useState("");
  const [deals, setDeals] = useState<Deal[]>([]);
  const [execs, setExecs] = useState<Executive[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [interactions, setInteractions] = useState<Interaction[]>([]);
  const [flow, setFlow] = useState<DealFlowItem[]>([]);
  const [calEvents, setCalEvents] = useState<CalendarEvent[]>([]);
  const [weekTab, setWeekTab] = useState<"this" | "last">("this");

  const load = async () => {
    try {
      const calFrom = new Date(Date.now() - 16 * 86400000).toISOString();
      const calTo = new Date(Date.now() + 28 * 86400000).toISOString();
      const [meRes, dealsRes, execsRes, tasksRes, ixRes, flowRes, calRes] = await Promise.all([
        fetch("/api/auth/me"),
        fetch("/api/deals"),
        fetch("/api/executives"),
        fetch("/api/tasks"),
        fetch("/api/interactions"),
        fetch("/api/deal-flow"),
        fetch(`/api/calendar?from=${encodeURIComponent(calFrom)}&to=${encodeURIComponent(calTo)}`),
      ]);
      if (
        meRes.status === 401 ||
        dealsRes.status === 401 ||
        tasksRes.status === 401
      ) {
        router.replace("/login");
        return;
      }
      const me = await meRes.json();
      setUserName(me.user?.name ?? "");
      if (dealsRes.ok) setDeals(await dealsRes.json());
      if (execsRes.ok) setExecs(await execsRes.json());
      if (tasksRes.ok) setTasks(await tasksRes.json());
      if (ixRes.ok) setInteractions(await ixRes.json());
      if (flowRes.ok) setFlow(await flowRes.json());
      if (calRes.ok) {
        const cal = await calRes.json();
        if (Array.isArray(cal.events)) {
          setCalEvents(cal.events.filter((e: CalendarEvent) => !e.dismissed));
        }
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const activeDeals = useMemo(
    () => deals.filter((d) => !TERMINAL_STAGES.includes(d.stage)),
    [deals]
  );
  const pipelineValue = useMemo(
    () => activeDeals.reduce((s, d) => s + (d.dealValue || 0), 0),
    [activeDeals]
  );
  const myClaims = useMemo(
    () =>
      deals.filter((d) => d.owner === userName).length +
      execs.filter((e) => e.owner === userName).length,
    [deals, execs, userName]
  );
  const openTasks = useMemo(() => tasks.filter((t) => !t.done), [tasks]);
  const overdueTasks = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    return openTasks.filter((t) => t.dueDate && t.dueDate < today);
  }, [openTasks]);

  const valueByStage = useMemo(
    () =>
      DEAL_STAGES.filter((s) => !TERMINAL_STAGES.includes(s)).map((stage) => ({
        stage,
        value: deals
          .filter((d) => d.stage === stage)
          .reduce((s, d) => s + (d.dealValue || 0), 0),
        count: deals.filter((d) => d.stage === stage).length,
      })),
    [deals]
  );
  const maxStageValue = Math.max(1, ...valueByStage.map((s) => s.value));

  const unclaimed = useMemo(
    () => activeDeals.filter((d) => !d.owner),
    [activeDeals]
  );

  // Deals with no logged touch in 30+ days (interactions fall back to last update).
  // Weekly summary windows (local time): this week = Monday 00:00 → now,
  // last week = the Monday–Sunday before it.
  const weekWindow = useMemo(() => {
    const now = new Date();
    const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
    if (weekTab === "this") return { start: monday, end: now };
    const prevMonday = new Date(monday);
    prevMonday.setDate(prevMonday.getDate() - 7);
    return { start: prevMonday, end: monday };
  }, [weekTab]);

  const weekly = useMemo(() => {
    const { start, end } = weekWindow;
    const inWin = (iso: string) => {
      const t = new Date(iso).getTime();
      return t >= start.getTime() && t < end.getTime();
    };
    const newDeals = deals
      .filter((d) => inWin(d.createdAt))
      .sort((a, b) => (b.dealValue || 0) - (a.dealValue || 0));
    const newExecs = execs.filter((e) => inWin(e.createdAt));
    const flowNew = flow.filter((f) => inWin(f.createdAt));
    return {
      newDeals,
      newDealsValue: newDeals.reduce((s, d) => s + (d.dealValue || 0), 0),
      newExecs,
      flowForSale: flowNew.filter((f) => f.kind === "business_for_sale").length,
      flowOperators: flowNew.filter((f) => f.kind === "operator_available").length,
      flowNotes: flowNew.filter((f) => f.kind === "market_note").length,
      flowAdded: flow.filter((f) => f.status === "added" && inWin(f.updatedAt)).length,
      touches: interactions.filter((i) => inWin(i.occurredAt)).length,
      tasksDone: tasks.filter((t) => t.done && inWin(t.updatedAt)).length,
      closedWon: deals.filter((d) => d.stage === "Closed Won" && inWin(d.updatedAt)).length,
      passed: deals.filter((d) => d.stage === "Passed" && inWin(d.updatedAt)).length,
    };
  }, [weekWindow, deals, execs, flow, interactions, tasks]);

  // Calendar-driven activity highlights + upcoming important dates for the
  // weekly summary (Ethan, Oct 9, 2026): Outlook events matched to pipeline
  // operators by name in the event title.
  const calSummary = useMemo(() => {
    const { start, end } = weekWindow;
    const startMs = start.getTime();
    const endMs = end.getTime();
    const personOf = (title: string): string => {
      const t = title.toLowerCase();
      for (let i = 0; i < execs.length; i++) {
        const nm = execs[i].name;
        const parts = nm.toLowerCase().split(" ");
        const first = parts[0];
        const last = parts[parts.length - 1];
        if (
          t.indexOf(nm.toLowerCase()) >= 0 ||
          (last.length > 2 && t.indexOf(last) >= 0) ||
          (first.length > 2 && t.indexOf(first) >= 0)
        ) {
          return nm;
        }
      }
      return "";
    };
    const held: CalendarEvent[] = [];
    const after: CalendarEvent[] = [];
    calEvents.forEach((e) => {
      const t = new Date(e.startsAt).getTime();
      if (t >= startMs && t < endMs) held.push(e);
      else if (t >= endMs && t < endMs + 21 * 86400000) after.push(e);
    });
    const lines: { id: string; text: string; person: string }[] = [];
    const usedNext: string[] = [];
    held.forEach((e) => {
      const person = personOf(e.title);
      if (!person) return;
      let next: CalendarEvent | null = null;
      for (let i = 0; i < after.length; i++) {
        if (personOf(after[i].title) === person && usedNext.indexOf(after[i].eventId) < 0) {
          next = after[i];
          break;
        }
      }
      if (next) {
        usedNext.push(next.eventId);
        const a = e.title.charAt(0).toLowerCase() + e.title.slice(1);
        const b = next.title.charAt(0).toLowerCase() + next.title.slice(1);
        lines.push({
          id: e.eventId,
          person,
          text: `Moved from ${a} to ${b} — ${fmtWhen(next.startsAt, next.allDay)}${next.location ? ` · ${locText(next.location)}` : ""}`,
        });
      } else {
        lines.push({ id: e.eventId, person, text: `${e.title} — ${fmtWhen(e.startsAt, e.allDay)}` });
      }
    });
    const nowMs = Date.now();
    const upcoming = calEvents
      .filter((e) => {
        const t = new Date(e.startsAt).getTime();
        return t >= nowMs - 3600000 && t < nowMs + 14 * 86400000;
      })
      .slice(0, 6);
    return { lines: lines.slice(0, 5), upcoming };
  }, [calEvents, execs, weekWindow]);

  const dismissEvent = async (eventId: string) => {
    setCalEvents((prev) => prev.filter((e) => e.eventId !== eventId));
    try {
      await fetch("/api/calendar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "dismiss", eventId, dismissed: true }),
      });
    } catch {
      /* optimistic removal stands for this session */
    }
  };

  const renderLoc = (loc: string) => {
    if (!loc) return null;
    if (/^https?:\/\//i.test(loc)) {
      return (
        <a href={loc} target="_blank" rel="noreferrer" className="underline decoration-dotted underline-offset-2 hover:text-[#8a6f3e]">
          {locText(loc)}
        </a>
      );
    }
    if (/teams|zoom|online|phone|call/i.test(loc)) return <span>{loc}</span>;
    return (
      <a
        href={`https://www.google.com/maps/search/${encodeURIComponent(loc)}`}
        target="_blank"
        rel="noreferrer"
        className="hover:underline"
      >
        {loc}
      </a>
    );
  };

  const renderLine = (line: { text: string; person: string }) => {
    if (!line.person) return line.text;
    let idx = line.text.indexOf(line.person);
    let matched = line.person;
    if (idx < 0) {
      const first = line.person.split(" ")[0];
      idx = line.text.indexOf(first);
      matched = first;
    }
    if (idx < 0) return line.text;
    return (
      <>
        {line.text.slice(0, idx)}
        <Link
          href={`/directory?q=${encodeURIComponent(line.person)}`}
          className="font-semibold text-[#0d1f3c] underline decoration-[#b8975a] decoration-2 underline-offset-2 dark:text-white"
        >
          {matched}
        </Link>
        {line.text.slice(idx + matched.length)}
      </>
    );
  };

  const staleDeals = useMemo(() => {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 30);
    const lastTouch = new Map<string, string>();
    interactions.forEach((ix) => {
      if (!ix.dealId) return;
      const cur = lastTouch.get(ix.dealId);
      if (!cur || ix.occurredAt > cur) lastTouch.set(ix.dealId, ix.occurredAt);
    });
    return activeDeals.filter((d) => {
      const touch = lastTouch.get(d.id) ?? d.updatedAt.slice(0, 10);
      return touch < cutoff.toISOString().slice(0, 10);
    });
  }, [activeDeals, interactions]);

  const analytics = useMemo(() => {
    const thirty = new Date();
    thirty.setDate(thirty.getDate() - 30);
    const cutoff = thirty.toISOString();
    const added30 = deals.filter((d) => d.createdAt >= cutoff).length;
    const ebitdaSum = activeDeals.reduce((s, d) => s + (d.ebitda || 0), 0);
    const avgValue =
      activeDeals.length > 0 ? pipelineValue / activeDeals.length : 0;
    const closed = deals.filter((d) => TERMINAL_STAGES.includes(d.stage));
    const won = closed.filter((d) => d.stage === "Closed Won").length;
    return {
      added30,
      ebitdaSum,
      avgValue,
      winRate: closed.length > 0 ? Math.round((won / closed.length) * 100) : null,
    };
  }, [deals, activeDeals, pipelineValue]);

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <p className="text-sm text-slate-500 dark:text-white/50">Loading overview…</p>
      </div>
    );
  }

  const stats = [
    { label: "Active pipeline value", value: fmtMoney(pipelineValue) },
    { label: "Active targets", value: String(activeDeals.length) },
    { label: "My claims", value: String(myClaims) },
    {
      label: "Open follow-ups",
      value: String(openTasks.length),
      alert: overdueTasks.length > 0,
      sub:
        overdueTasks.length > 0
          ? `${overdueTasks.length} overdue`
          : undefined,
    },
  ];

  return (
    <>
      <PageHero
        eyebrow="Canny Capital Partners"
        title="Overview"
        subtitle="The state of the firm's pipeline at a glance."
      />
      <main className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6">

      {/* Stat cards */}
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {stats.map((s) => (
          <div
            key={s.label}
            className="rounded-xl border border-slate-200 bg-white p-4 dark:border-white/10 dark:bg-[#132847]"
          >
            <p className="text-xs font-medium uppercase tracking-wide text-slate-400 dark:text-white/50">
              {s.label}
            </p>
            <p
              className={`mt-1 text-2xl font-bold ${
                s.alert ? "text-red-600 dark:text-red-400" : "text-[#0d1f3c] dark:text-white"
              }`}
            >
              {s.value}
            </p>
            {s.sub && <p className="mt-0.5 text-xs text-red-500">{s.sub}</p>}
          </div>
        ))}
      </div>

      {/* Weekly summary */}
      <div className="mb-6 rounded-xl border border-slate-200 bg-white p-4 sm:p-5 dark:border-white/10 dark:bg-[#132847]">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-bold text-[#0d1f3c] dark:text-white">
            📅 Weekly summary
          </h2>
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-400 dark:text-white/40">
              {weekWindow.start.toLocaleDateString("en-US", { month: "short", day: "numeric" })}
              {" – "}
              {weekTab === "this"
                ? "today"
                : new Date(weekWindow.end.getTime() - 86400000).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                  })}
            </span>
            {(["this", "last"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setWeekTab(t)}
                className={`rounded-lg px-2.5 py-1 text-xs font-medium ${
                  weekTab === t
                    ? "bg-[#0d1f3c] text-white dark:bg-[#b8975a] dark:text-[#0d1f3c]"
                    : "text-slate-500 hover:bg-slate-100 dark:text-white/60 dark:hover:bg-white/5"
                }`}
              >
                {t === "this" ? "This week" : "Last week"}
              </button>
            ))}
          </div>
        </div>
        <div className="mb-4 flex flex-wrap gap-2">
          {[
            `${weekly.newDeals.length} new target${weekly.newDeals.length === 1 ? "" : "s"}${
              weekly.newDealsValue > 0 ? ` · ${fmtMoney(weekly.newDealsValue)}` : ""
            }`,
            `${weekly.newExecs.length} new operator${weekly.newExecs.length === 1 ? "" : "s"}`,
            `${weekly.flowForSale + weekly.flowOperators + weekly.flowNotes} new in Activity (${weekly.flowForSale} for sale · ${weekly.flowOperators} operators · ${weekly.flowNotes} notes)`,
            `${weekly.flowAdded} moved to pipeline`,
            `${weekly.touches} touches logged`,
            `${weekly.tasksDone} follow-ups completed`,
            ...(weekly.closedWon > 0 ? [`${weekly.closedWon} closed won 🎉`] : []),
            ...(weekly.passed > 0 ? [`${weekly.passed} passed`] : []),
          ].map((chip) => (
            <span
              key={chip}
              className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600 dark:bg-white/10 dark:text-white/70"
            >
              {chip}
            </span>
          ))}
        </div>
        {calSummary.lines.length > 0 && (
          <div className="mt-4">
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-white/50">
              Activity highlights
            </p>
            <ul className="divide-y divide-slate-100 dark:divide-white/5">
              {calSummary.lines.map((line) => (
                <li
                  key={line.id}
                  className="group flex items-baseline gap-2 py-1.5 text-sm text-slate-600 dark:text-white/75"
                >
                  <span className="shrink-0 text-[#b8975a]">▸</span>
                  <span className="flex-1">{renderLine(line)}</span>
                  <button
                    onClick={() => dismissEvent(line.id)}
                    title="Dismiss"
                    aria-label="Dismiss highlight"
                    className="shrink-0 rounded px-1 text-base leading-none text-slate-300 opacity-0 transition hover:text-red-400 group-hover:opacity-100 dark:text-white/25"
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {weekTab === "this" && calSummary.upcoming.length > 0 && (
          <div className="mt-4">
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-white/50">
              Important dates
            </p>
            <ul className="space-y-1.5">
              {calSummary.upcoming.map((e) => {
                const d = new Date(e.startsAt);
                return (
                  <li
                    key={e.eventId}
                    className="group flex items-center gap-3 rounded-lg border border-slate-100 bg-slate-50/60 px-2.5 py-2 dark:border-white/5 dark:bg-white/[0.03]"
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
                        <p className="truncate text-sm font-semibold text-[#0d1f3c] dark:text-white">{e.title}</p>
                      )}
                      <p className="truncate text-xs text-slate-400 dark:text-white/40">
                        {fmtWhen(e.startsAt, e.allDay)}
                        {e.location ? <> · {renderLoc(e.location)}</> : null}
                      </p>
                    </div>
                    <button
                      onClick={() => dismissEvent(e.eventId)}
                      title="Dismiss"
                      aria-label="Dismiss event"
                      className="shrink-0 rounded px-1.5 text-lg leading-none text-slate-300 opacity-0 transition hover:text-red-400 group-hover:opacity-100 dark:text-white/25"
                    >
                      ×
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>

      {staleDeals.length > 0 && (
        <div className="mb-6 rounded-xl border border-amber-300 bg-amber-50 p-4 dark:border-amber-500/30 dark:bg-amber-500/10">
          <p className="text-sm font-bold text-amber-800 dark:text-amber-200">
            ⚠ {staleDeals.length} {staleDeals.length === 1 ? "deal is" : "deals are"} going stale
            <span className="font-normal"> — no touch in 30+ days: </span>
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {staleDeals.slice(0, 6).map((d) => (
              <Link
                key={d.id}
                href={`/deals/${d.id}`}
                className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-amber-800 shadow-sm hover:underline dark:bg-white/10 dark:text-amber-200"
              >
                {d.companyName}
              </Link>
            ))}
            {staleDeals.length > 6 && (
              <span className="px-2 py-1 text-xs text-amber-700 dark:text-amber-300">
                +{staleDeals.length - 6} more
              </span>
            )}
          </div>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Pipeline by stage */}
        <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-white/10 dark:bg-[#132847]">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-base font-bold text-[#0d1f3c] dark:text-white">
              Pipeline by stage
            </h2>
            <Link
              href="/pipeline"
              className="text-xs font-semibold text-[#8a6f3c] hover:underline dark:text-[#d4b37a]"
            >
              Open pipeline →
            </Link>
          </div>
          <div className="flex flex-col gap-2.5">
            {valueByStage.map(({ stage, value, count }) => (
              <div key={stage}>
                <div className="mb-1 flex items-baseline justify-between text-xs">
                  <span className="font-medium text-slate-700 dark:text-[#e8dfc8]">{stage}</span>
                  <span className="text-slate-500 dark:text-white/50">
                    {count} · {fmtMoney(value)}
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-white/10">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-[#0d1f3c] to-[#b8975a]"
                    style={{ width: `${(value / maxStageValue) * 100}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
          {unclaimed.length > 0 && (
            <div className="mt-4 rounded-lg bg-[#b8975a]/10 px-3 py-2.5 dark:bg-[#b8975a]/15">
              <p className="text-xs font-semibold text-[#8a6f3c] dark:text-[#d4b37a]">
                {unclaimed.length} unclaimed{" "}
                {unclaimed.length === 1 ? "target" : "targets"}:{" "}
                <span className="font-normal">
                  {unclaimed
                    .slice(0, 3)
                    .map((d) => d.companyName)
                    .join(", ")}
                  {unclaimed.length > 3 &&
                    ` +${unclaimed.length - 3} more`}
                </span>
              </p>
            </div>
          )}
        </section>

        {/* Target map */}
        <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-white/10 dark:bg-[#132847]">
          <h2 className="mb-4 text-base font-bold text-[#0d1f3c] dark:text-white">
            Where we&apos;re looking
          </h2>
          <TargetMap deals={deals} />
        </section>
      </div>

      {/* Tasks & follow-ups */}
      <section className="mt-6 rounded-xl border border-slate-200 bg-white p-5 dark:border-white/10 dark:bg-[#132847]">
        <h2 className="mb-4 text-base font-bold text-[#0d1f3c] dark:text-white">
          Tasks &amp; follow-ups
        </h2>
        <TaskList
          tasks={tasks}
          deals={deals}
          execs={execs}
          onChanged={load}
        />
      </section>

      {/* Pipeline analytics */}
      <section className="mt-6 rounded-xl border border-slate-200 bg-white p-5 dark:border-white/10 dark:bg-[#132847]">
        <h2 className="mb-4 text-base font-bold text-[#0d1f3c] dark:text-white">
          Pipeline analytics
        </h2>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div>
            <p className="text-2xl font-bold text-[#0d1f3c] dark:text-white">
              {analytics.added30}
            </p>
            <p className="text-xs uppercase tracking-wide text-slate-400 dark:text-white/50">
              Added (30 days)
            </p>
          </div>
          <div>
            <p className="text-2xl font-bold text-[#0d1f3c] dark:text-white">
              {fmtMoney(analytics.avgValue)}
            </p>
            <p className="text-xs uppercase tracking-wide text-slate-400 dark:text-white/50">
              Avg deal value
            </p>
          </div>
          <div>
            <p className="text-2xl font-bold text-[#0d1f3c] dark:text-white">
              {fmtMoney(analytics.ebitdaSum)}
            </p>
            <p className="text-xs uppercase tracking-wide text-slate-400 dark:text-white/50">
              Pipeline EBITDA
            </p>
          </div>
          <div>
            <p className="text-2xl font-bold text-[#0d1f3c] dark:text-white">
              {analytics.winRate === null ? "—" : `${analytics.winRate}%`}
            </p>
            <p className="text-xs uppercase tracking-wide text-slate-400 dark:text-white/50">
              Close rate
            </p>
          </div>
        </div>
      </section>


      </main>
    </>
  );
}

"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import TaskList from "@/components/TaskList";
import PageHero from "@/components/PageHero";
import { usePullToRefresh, pullPillLabel } from "@/components/usePullToRefresh";
import { DEAL_STAGES, EXEC_STAGES, type Deal, type DealFlowItem, type Executive, type Interaction, type MiMultiple, type Task } from "@/lib/types";
import type { CalendarEvent } from "@/lib/calendar-db";
import type { Investor } from "@/lib/investors-db";
import { fmtMoney } from "@/lib/format";
import { resolveDealValue, type MarketRates } from "@/lib/valuation";
import { AGING_COLORS, FOCUS_SECTOR_NAMES, barGradient, sectorColor, stageColor } from "@/lib/sector-colors";
import { SectorLegend } from "@/components/SectorChip";

/** Fit-target sectors — all five focus sectors (Oct 14, 2026: the
 * density view includes Hospitality even at 0; there is no
 * hospitality spine yet, and 0 is the honest count). */
const FIT_SECTORS: readonly string[] = FOCUS_SECTOR_NAMES;

const TERMINAL_STAGES = ["Closed Won", "Passed"];

const daysSince = (iso: string): number =>
  Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86400000));

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
  const [investors, setInvestors] = useState<Investor[]>([]);
  const [multiples, setMultiples] = useState<MiMultiple[]>([]);
  const [rates, setRates] = useState<MarketRates>({});
  const [fitCounts, setFitCounts] = useState<Record<string, number | null>>({});
  const [weekTab, setWeekTab] = useState<"this" | "last">("this");
  const [showOtherCal, setShowOtherCal] = useState(false);
  const [analyticsTab, setAnalyticsTab] = useState<"pipeline" | "sourcing" | "relationships">("pipeline");
  const [winDays, setWinDays] = useState<30 | 90 | 365>(30);

  const load = async () => {
    try {
      const calFrom = new Date(Date.now() - 16 * 86400000).toISOString();
      const calTo = new Date(Date.now() + 28 * 86400000).toISOString();
      const [meRes, dealsRes, execsRes, tasksRes, ixRes, flowRes, calRes, invRes, multRes, ratesRes] = await Promise.all([
        fetch("/api/auth/me"),
        fetch("/api/deals"),
        fetch("/api/executives"),
        fetch("/api/tasks"),
        fetch("/api/interactions"),
        fetch("/api/deal-flow"),
        fetch(`/api/calendar?from=${encodeURIComponent(calFrom)}&to=${encodeURIComponent(calTo)}`),
        fetch("/api/investors"),
        fetch("/api/market/multiples"),
        fetch("/api/market/rates"),
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
      if (invRes.ok) {
        const inv = await invRes.json();
        if (Array.isArray(inv)) setInvestors(inv);
      }
      if (multRes.ok) {
        const mult = await multRes.json();
        if (Array.isArray(mult)) setMultiples(mult);
      }
      if (ratesRes.ok) {
        const rd = await ratesRes.json().catch(() => null);
        setRates({ prime: rd?.prime?.value ?? null, sba: rd?.sba?.value ?? null });
      }
    } finally {
      setLoading(false);
    }
  };

  // Fit-target counts per sector for the density view.
  useEffect(() => {
    let live = true;
    for (const s of FIT_SECTORS) {
      fetch(`/api/market/companies?sector=${encodeURIComponent(s)}&limit=1`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d: { fitTotal?: number } | null) => {
          if (live) setFitCounts((c) => ({ ...c, [s]: d?.fitTotal ?? 0 }));
        })
        .catch(() => {
          if (live) setFitCounts((c) => ({ ...c, [s]: 0 }));
        });
    }
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Pull-to-refresh (mobile PWA).
  const { pull, refreshing } = usePullToRefresh(load);

  // The FAB's "Add follow-up" lands here with ?newtask=1: scroll to the
  // task form and focus its input.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("newtask") !== "1") return;
    const t = setTimeout(() => {
      const el = document.getElementById("overview-tasks");
      if (!el) return;
      el.scrollIntoView({ behavior: "smooth", block: "start" });
      const input = el.querySelector<HTMLInputElement>("input");
      if (input) input.focus({ preventScroll: true });
    }, 400);
    return () => clearTimeout(t);
  }, []);

  const activeDeals = useMemo(
    () => deals.filter((d) => !TERMINAL_STAGES.includes(d.stage)),
    [deals]
  );
  // Scope rule (Ethan, Oct 14, 2026 — supersedes the same-day toggle):
  // EVERY deal counts everywhere — stat cards, analytics, charts,
  // averages. The "Non-focus" tag remains a label on out-of-sector
  // deals only; it changes no total. (Name kept: ~15 consumers below.)
  const scopedDeals = deals;
  // Active pipeline value: sum of resolved values — stated price,
  // else the market-multiple estimate — over ACTIVE deals in scope
  // (Passed / Closed Won excluded). 0 of 0 qualifying deals → "—".
  const scopedActiveDeals = useMemo(
    () => scopedDeals.filter((d) => !TERMINAL_STAGES.includes(d.stage)),
    [scopedDeals]
  );
  const pipelineValued = useMemo(
    () =>
      scopedActiveDeals
        .map((d) => resolveDealValue(d, multiples, rates).value)
        .filter((v): v is number => v !== null),
    [scopedActiveDeals, multiples, rates]
  );
  const pipelineValue = useMemo(
    () => pipelineValued.reduce((s, v) => s + v, 0),
    [pipelineValued]
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
          .reduce((s, d) => s + (resolveDealValue(d, multiples, rates).value ?? 0), 0),
        count: deals.filter((d) => d.stage === stage).length,
      })),
    [deals, multiples, rates]
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
      .sort(
        (a, b) =>
          (resolveDealValue(b, multiples, rates).value ?? 0) -
          (resolveDealValue(a, multiples, rates).value ?? 0)
      );
    const newExecs = execs.filter((e) => inWin(e.createdAt));
    const flowNew = flow.filter((f) => inWin(f.createdAt));
    return {
      newDeals,
      newDealsValue: newDeals.reduce(
        (s, d) => s + (resolveDealValue(d, multiples, rates).value ?? 0),
        0
      ),
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
  }, [weekWindow, deals, execs, flow, interactions, tasks, multiples, rates]);

  // Upcoming important dates for the weekly summary (Ethan, Oct 9, 2026):
  // the next 14 days of Outlook events mirrored into the portal. (The
  // earlier "Activity highlights" lines were removed at Ethan's request —
  // the summary is counts + important dates, with Tasks & follow-ups
  // directly below.)
  // Oct 14, 2026: Important Dates shows only meetings linked to a
  // Directory contact or a deal — an attendee matching a deal contact
  // or an operator/investor, or the event title naming the company or
  // person — and each links to that profile. Everything else drops
  // into a collapsed "Other calendar items" list.
  const eventLink = (e: CalendarEvent): { href: string; label: string } | null => {
    const title = (e.title || "").toLowerCase();
    const attendees = (e.attendees ?? []).map((a) => a.toLowerCase());
    const attendeeHas = (needle: string) =>
      !!needle && attendees.some((a) => a.includes(needle.toLowerCase()));
    for (const d of deals) {
      if (attendeeHas(d.contactEmail) || attendeeHas(d.contactName))
        return { href: `/deals/${d.id}`, label: d.companyName };
      if (d.companyName && d.companyName.length >= 4 && title.includes(d.companyName.toLowerCase()))
        return { href: `/deals/${d.id}`, label: d.companyName };
    }
    for (const x of execs) {
      if (x.name && (attendeeHas(x.name) || (x.name.length >= 4 && title.includes(x.name.toLowerCase()))))
        return { href: `/directory?q=${encodeURIComponent(x.name)}`, label: x.name };
    }
    for (const inv of investors) {
      if (inv.name && (attendeeHas(inv.name) || attendeeHas(inv.email) || (inv.name.length >= 4 && title.includes(inv.name.toLowerCase()))))
        return { href: `/directory?q=${encodeURIComponent(inv.name)}`, label: inv.name };
    }
    return null;
  };

  const calSummary = useMemo(() => {
    const nowMs = Date.now();
    const upcomingAll = calEvents.filter((e) => {
      const t = new Date(e.startsAt).getTime();
      return t >= nowMs - 3600000 && t < nowMs + 14 * 86400000;
    });
    const linked: { e: CalendarEvent; href: string; label: string }[] = [];
    const other: CalendarEvent[] = [];
    for (const e of upcomingAll) {
      const link = eventLink(e);
      if (link) linked.push({ e, href: link.href, label: link.label });
      else other.push(e);
    }
    return { linked: linked.slice(0, 6), other };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calEvents, deals, execs, investors]);

  // Operators tile: interviewing now, paired to a deal, and new
  // candidates this week (Monday → now).
  const operatorStats = useMemo(() => {
    const pairedIds = new Set<string>();
    deals.forEach((d) => (d.operatorIds ?? []).forEach((id) => pairedIds.add(id)));
    const now = new Date();
    const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
    return {
      interviewing: execs.filter((e) => e.stage === "Interview").length,
      paired: execs.filter((e) => pairedIds.has(e.id)).length,
      newThisWeek: execs.filter((e) => new Date(e.createdAt) >= monday).length,
    };
  }, [execs, deals]);

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

  // Pipeline analytics (reworked Oct 14, 2026; tabbed Oct 14 visual
  // refresh). Scope comes from scopedDeals above — the one toggle
  // rule. Avg deal value averages only deals that HAVE a value;
  // pipeline EBITDA reports its coverage; the close rate stays "—"
  // until at least 5 deals have closed or been passed.

  const winCutoff = useMemo(
    () => new Date(Date.now() - winDays * 86400000).toISOString(),
    [winDays]
  );

  const analytics = useMemo(() => {
    const addedWin = scopedDeals.filter((d) => d.createdAt >= winCutoff).length;
    const scopedActive = scopedDeals.filter((d) => !TERMINAL_STAGES.includes(d.stage));
    const valued = scopedActive
      .map((d) => resolveDealValue(d, multiples, rates).value)
      .filter((v): v is number => v !== null);
    const avgValue =
      valued.length > 0 ? valued.reduce((s, v) => s + v, 0) / valued.length : null;
    const ebitdaDeals = scopedActive.filter((d) => d.ebitda != null);
    const ebitdaSum = ebitdaDeals.reduce((s, d) => s + (d.ebitda || 0), 0);
    const closedPassed = scopedDeals.filter((d) => TERMINAL_STAGES.includes(d.stage));
    const won = closedPassed.filter((d) => d.stage === "Closed Won").length;
    const winRate =
      closedPassed.length >= 5 ? Math.round((won / closedPassed.length) * 100) : null;

    // Stage-to-stage conversion, funnel-style from current stages
    // (no stage history is kept): a deal counts as having reached
    // every stage up to its own; Closed Won counts as reaching all.
    // Passed deals sit outside the funnel.
    const ACTIVE_STAGES = DEAL_STAGES.filter((s) => !TERMINAL_STAGES.includes(s));
    const reached = ACTIVE_STAGES.map((_, i) =>
      scopedDeals.filter((d) => {
        if (d.stage === "Closed Won") return true;
        const idx = (ACTIVE_STAGES as readonly string[]).indexOf(d.stage);
        return idx >= i;
      }).length
    );
    const conversions = ACTIVE_STAGES.slice(0, -1).map((s, i) => ({
      from: s,
      to: ACTIVE_STAGES[i + 1],
      of: reached[i],
      n: reached[i + 1],
      pct: reached[i] > 0 ? Math.round((reached[i + 1] / reached[i]) * 100) : null,
    }));

    // Days in stage: no stage history is stored, so this is the age
    // of each deal in its CURRENT stage (days since its last update) —
    // labeled as such in the UI.
    const daysInStage = ACTIVE_STAGES.map((stage) => {
      const inStage = scopedDeals.filter((d) => d.stage === stage);
      const ages = inStage.map((d) => daysSince(d.updatedAt));
      return {
        stage,
        n: inStage.length,
        avgDays: ages.length
          ? Math.round(ages.reduce((a, b) => a + b, 0) / ages.length)
          : null,
      };
    }).filter((r) => r.n > 0);

    // Pass reasons: the structured passReason field when set on the
    // deal, else categorized from the deal's notes. Windowed by the
    // pass (last update) date.
    const PASS_REASONS: { label: string; re: RegExp }[] = [
      { label: "Valuation / price", re: /price|pricing|valuation|expensive|asking|multiple/i },
      { label: "Margins / fit", re: /margin|fit|profile|thesis/i },
      { label: "Size / scale", re: /too small|too large|size|scale/i },
      { label: "Timing / readiness", re: /timing|not ready|too early|later/i },
      { label: "Financials / diligence", re: /financial|records|diligence|quality of earnings|qoe/i },
    ];
    const passedDeals = scopedDeals.filter(
      (d) => d.stage === "Passed" && d.updatedAt >= winCutoff
    );
    const reasonCounts = new Map<string, number>();
    for (const d of passedDeals) {
      const structured = (d.passReason || "").trim();
      const hit = PASS_REASONS.find((r) => r.re.test(d.notes || ""));
      const label = structured || (hit ? hit.label : "Not specified in notes");
      reasonCounts.set(label, (reasonCounts.get(label) ?? 0) + 1);
    }
    const passReasons = Array.from(reasonCounts.entries())
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count);

    return {
      addedWin,
      avgValue,
      valuedCount: valued.length,
      activeCount: scopedActive.length,
      ebitdaSum,
      ebitdaCount: ebitdaDeals.length,
      winRate,
      closedPassedCount: closedPassed.length,
      conversions,
      daysInStage,
      passReasons,
      passedCount: passedDeals.length,
      scopedCount: scopedDeals.length,
    };
  }, [scopedDeals, multiples, rates, winCutoff]);

  // Sourcing tab: fit targets (fitCounts), Activity listings funnel,
  // and source quality — deal_flow grouped by source, deals by broker.
  const sourcing = useMemo(() => {
    const listings = flow.filter(
      (f) => f.kind === "business_for_sale" && f.createdAt >= winCutoff
    );
    const bySource = new Map<string, { sent: number; added: number; dismissed: number }>();
    for (const f of flow) {
      if (f.createdAt < winCutoff) continue;
      const key = (f.source || "").trim() || "Unknown source";
      const cur = bySource.get(key) ?? { sent: 0, added: 0, dismissed: 0 };
      cur.sent++;
      if (f.status === "added") cur.added++;
      if (f.status === "dismissed") cur.dismissed++;
      bySource.set(key, cur);
    }
    const sourceRows = Array.from(bySource.entries())
      .map(([source, v]) => ({
        source,
        ...v,
        fitRate: v.sent > 0 ? Math.round((v.added / v.sent) * 100) : null,
      }))
      .sort((a, b) => b.sent - a.sent);
    const byBroker = new Map<string, { deals: number; advanced: number }>();
    for (const d of deals) {
      const key = (d.broker || "").trim();
      if (!key) continue;
      const cur = byBroker.get(key) ?? { deals: 0, advanced: 0 };
      cur.deals++;
      const idx = (DEAL_STAGES as readonly string[]).indexOf(d.stage);
      if (idx > 0 && d.stage !== "Passed") cur.advanced++;
      byBroker.set(key, cur);
    }
    const brokerRows = Array.from(byBroker.entries())
      .map(([broker, v]) => ({
        broker,
        ...v,
        advRate: v.deals > 0 ? Math.round((v.advanced / v.deals) * 100) : null,
      }))
      .sort((a, b) => b.deals - a.deals);
    return {
      reviewed: listings.length,
      added: listings.filter((f) => f.status === "added").length,
      dismissed: listings.filter((f) => f.status === "dismissed").length,
      pending: listings.filter((f) => f.status === "new").length,
      sourceRows,
      brokerRows,
    };
  }, [flow, deals, winCutoff]);

  // Relationships tab: operators by stage, intermediary activity,
  // investors by last touch, and contacts going quiet. Decay uses
  // AGING thresholds for no-touch: amber at 60 days, red at 90.
  const relationships = useMemo(() => {
    const opsByStage = EXEC_STAGES.map((stage) => ({
      stage,
      n: execs.filter((e) => e.stage === stage).length,
    })).filter((r) => r.n > 0);
    const act = new Map<string, number>();
    for (const f of flow) {
      const key = (f.source || "").trim() || "Unknown source";
      act.set(key, (act.get(key) ?? 0) + 1);
    }
    for (const d of deals) {
      const b = (d.broker || "").trim();
      if (b) act.set(b, (act.get(b) ?? 0) + 1);
    }
    const intermediaryRows = Array.from(act.entries())
      .map(([name, n]) => ({ name, n }))
      .sort((a, b) => b.n - a.n)
      .slice(0, 8);
    const invBuckets = [
      { label: "Touched ≤ 30 days ago", n: 0 },
      { label: "31–60 days", n: 0 },
      { label: "61–90 days", n: 0 },
      { label: "Over 90 days", n: 0 },
    ];
    for (const inv of investors) {
      const days = daysSince(inv.updatedAt);
      if (days <= 30) invBuckets[0].n++;
      else if (days <= 60) invBuckets[1].n++;
      else if (days <= 90) invBuckets[2].n++;
      else invBuckets[3].n++;
    }
    const lastExecTouch = new Map<string, string>();
    interactions.forEach((ix) => {
      if (!ix.execId) return;
      const cur = lastExecTouch.get(ix.execId);
      if (!cur || ix.occurredAt > cur) lastExecTouch.set(ix.execId, ix.occurredAt);
    });
    const quiet = [
      ...execs.map((e) => ({
        name: e.name,
        kind: "Operator",
        days: daysSince(lastExecTouch.get(e.id) ?? e.updatedAt),
      })),
      ...investors.map((i) => ({
        name: i.name,
        kind: "Investor",
        days: daysSince(i.updatedAt),
      })),
    ]
      .filter((x) => x.days >= 45)
      .sort((a, b) => b.days - a.days);
    return {
      opsByStage,
      intermediaryRows,
      invBuckets,
      quiet: quiet.slice(0, 10),
      quietTotal: quiet.length,
      quiet60: quiet.filter((x) => x.days >= 60 && x.days < 90).length,
      quiet90: quiet.filter((x) => x.days >= 90).length,
    };
  }, [execs, flow, deals, investors, interactions]);

  // "View full analytics" unlocks at 10+ pipeline deals and 5+
  // logged comps (Ethan, Oct 14, 2026).
  const compLogCount = useMemo(
    () => multiples.filter((m) => m.sourceReport === "Canny Comp Log").length,
    [multiples]
  );
  const showFullAnalytics = deals.length >= 10 && compLogCount >= 5;

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <p className="text-sm text-slate-500 dark:text-white/50">Loading overview…</p>
      </div>
    );
  }

  const dataDate = new Date().toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  const stats: {
    label: string;
    value: string;
    alert?: boolean;
    sub?: string;
    note?: string;
    accent: string;
    href?: string;
  }[] = [
    {
      label: "Active pipeline value",
      value: pipelineValued.length === 0 ? "—" : fmtMoney(pipelineValue),
      accent: "#b8975a",
      href: "/pipeline",
      note: "All sectors",
    },
    { label: "Active targets", value: String(activeDeals.length), accent: "#3B5B84", href: "/pipeline" },
    {
      label: "Deals & operators I've claimed",
      value: String(myClaims),
      accent: "#7D90B0",
      href: "/pipeline",
    },
    {
      label: "Open follow-ups",
      value: String(openTasks.length),
      accent: "#2F7F79",
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
      {(pull > 8 || refreshing) && (
        <div className="pointer-events-none fixed inset-x-0 top-3 z-50 flex justify-center">
          <span className="rounded-full bg-[#0d1f3c] px-3.5 py-1.5 text-xs font-semibold text-white shadow-lg">
            {pullPillLabel(pull, refreshing)}
          </span>
        </div>
      )}

      {/* Stat cards — thin accent top border per card (navy/gold/
          sector tones; aging hues stay reserved for staleness). */}
      <div className="mb-3 grid grid-cols-2 items-start gap-3 lg:grid-cols-4">
        {stats.map((s) => {
          const card = (
            <>
              <p className="text-xs font-medium uppercase tracking-wide text-slate-400 dark:text-white/50">
                {s.label}
              </p>
              <p
                className="mt-1 text-2xl font-bold text-[#0d1f3c] dark:text-white"
                style={s.alert ? { color: AGING_COLORS.bad } : undefined}
              >
                {s.value}
              </p>
              {s.sub && (
                <p className="mt-0.5 text-xs" style={{ color: AGING_COLORS.bad }}>
                  {s.sub}
                </p>
              )}
              {s.note && (
                <p className="mt-0.5 text-xs text-slate-400 dark:text-white/40">{s.note}</p>
              )}
            </>
          );
          const cls =
            "rounded-xl border border-slate-200 bg-white p-3.5 dark:border-white/10 dark:bg-[#132847]";
          const style = { borderTop: `3px solid ${s.accent}` };
          return s.href ? (
            <Link key={s.label} href={s.href} style={style} className={`${cls} block transition hover:border-[#b8975a]/60`}>
              {card}
            </Link>
          ) : (
            <div key={s.label} style={style} className={cls}>
              {card}
            </div>
          );
        })}
      </div>

      {/* Operators tile */}
      <div className="mb-6 rounded-xl border border-slate-200 bg-white p-4 dark:border-white/10 dark:bg-[#132847]">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-400 dark:text-white/50">
            Operators
          </p>
          <Link
            href="/directory"
            className="text-xs font-semibold text-[#8a6f3c] hover:underline dark:text-[#d4b37a]"
          >
            Open Directory →
          </Link>
        </div>
        <div className="mt-2 grid grid-cols-3 gap-3">
          <div>
            <p className="text-2xl font-bold text-[#0d1f3c] dark:text-white">{operatorStats.interviewing}</p>
            <p className="text-xs text-slate-500 dark:text-white/50">Interviewing</p>
          </div>
          <div>
            <p className="text-2xl font-bold text-[#0d1f3c] dark:text-white">{operatorStats.paired}</p>
            <p className="text-xs text-slate-500 dark:text-white/50">Paired to a deal</p>
          </div>
          <div>
            <p className="text-2xl font-bold text-[#0d1f3c] dark:text-white">{operatorStats.newThisWeek}</p>
            <p className="text-xs text-slate-500 dark:text-white/50">New candidates this week</p>
          </div>
        </div>
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
        {weekTab === "this" && (calSummary.linked.length > 0 || calSummary.other.length > 0) && (
          <div className="mt-4">
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-white/50">
              Important dates
            </p>
            {calSummary.linked.length > 0 ? (
              <ul className="space-y-1.5">
                {calSummary.linked.map(({ e, href, label }) => {
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
                        <Link
                          href={href}
                          className="block truncate text-sm font-semibold text-[#0d1f3c] hover:underline dark:text-white"
                        >
                          {e.title}
                        </Link>
                        <p className="truncate text-xs text-slate-400 dark:text-white/40">
                          {fmtWhen(e.startsAt, e.allDay)}
                          {e.location ? <> · {renderLoc(e.location)}</> : null}
                          {" · "}
                          <Link href={href} className="font-medium text-[#8a6f3c] hover:underline dark:text-[#d4b37a]">
                            {label} ↗
                          </Link>
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
            ) : (
              <p className="text-xs text-slate-400 dark:text-white/40">
                No upcoming meetings linked to a Directory contact or deal.
              </p>
            )}
            {calSummary.other.length > 0 && (
              <div className="mt-2">
                <button
                  onClick={() => setShowOtherCal((v) => !v)}
                  className="text-xs font-semibold text-slate-500 hover:underline dark:text-white/50"
                  aria-expanded={showOtherCal}
                >
                  {showOtherCal ? "▾" : "▸"} Other calendar items ({calSummary.other.length})
                </button>
                {showOtherCal && (
                  <ul className="mt-1.5 space-y-1">
                    {calSummary.other.map((e) => (
                      <li
                        key={e.eventId}
                        className="flex items-baseline justify-between gap-3 px-1 py-0.5 text-xs text-slate-500 dark:text-white/50"
                      >
                        <span className="min-w-0 truncate">{e.title}</span>
                        <span className="shrink-0">{fmtWhen(e.startsAt, e.allDay)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Tasks & follow-ups — directly below the Weekly summary's
          Important dates (Ethan, Oct 9, 2026) */}
      <section id="overview-tasks" className="mb-6 scroll-mt-4 rounded-xl border border-slate-200 bg-white p-5 dark:border-white/10 dark:bg-[#132847]">
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
                    className="h-full rounded-full"
                    style={{
                      width: `${(value / maxStageValue) * 100}%`,
                      background: barGradient(stageColor(stage)),
                    }}
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

        {/* Fit-target density by sector (replaces the "Where we're
            looking" map, Oct 14, 2026) */}
        <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-white/10 dark:bg-[#132847]">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-base font-bold text-[#0d1f3c] dark:text-white">
              Fit targets by sector
            </h2>
            <Link
              href="/market-intel#fit-targets"
              className="text-xs font-semibold text-[#8a6f3c] hover:underline dark:text-[#d4b37a]"
            >
              Open Market Intel →
            </Link>
          </div>
          <div className="mb-3">
            <SectorLegend sectors={[...FIT_SECTORS]} />
          </div>
          <div className="flex flex-col gap-2.5">
            {FIT_SECTORS.map((sector) => {
              const count = fitCounts[sector];
              const maxFit = Math.max(
                1,
                ...FIT_SECTORS.map((s) => fitCounts[s] ?? 0)
              );
              return (
                <div key={sector}>
                  <div className="mb-1 flex items-baseline justify-between text-xs">
                    <span className="font-medium text-slate-700 dark:text-[#e8dfc8]">{sector}</span>
                    <span className="text-slate-500 dark:text-white/50">
                      {count === null || count === undefined ? "…" : count.toLocaleString()}
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-white/10">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${(((count ?? 0) / maxFit) * 100).toFixed(1)}%`,
                        background: barGradient(sectorColor(sector)),
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
          <p className="mt-3 text-xs text-slate-400 dark:text-white/40">
            {FIT_SECTORS.reduce((s, x) => s + (fitCounts[x] ?? 0), 0).toLocaleString()} fit
            targets across the five focus sectors — live from Market Intel
            (Hospitality has no company spine yet, so its count is honestly 0).{" "}
            Data as of {new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })} · n ={" "}
            {FIT_SECTORS.reduce((s, x) => s + (fitCounts[x] ?? 0), 0).toLocaleString()}
          </p>
        </section>
      </div>

      {/* Analytics — tabbed (Oct 14, 2026 visual refresh): Pipeline |
          Sourcing | Relationships, one window selector, every chart
          footed with its data date and sample size. Scope: ALL deals
          (the non-focus toggle was removed later on Oct 14). */}
      <section className="mt-6 rounded-xl border border-slate-200 bg-white p-5 dark:border-white/10 dark:bg-[#132847]">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-bold text-[#0d1f3c] dark:text-white">
            Analytics
          </h2>
          <div className="flex items-center gap-2">
            {showFullAnalytics && (
              <Link
                href="/analytics"
                className="mr-1 text-xs font-semibold text-[#8a6f3c] hover:underline dark:text-[#d4b37a]"
              >
                View full analytics →
              </Link>
            )}
            <div className="flex overflow-hidden rounded-lg border border-slate-200 dark:border-white/15">
              {(
                [
                  ["pipeline", "Pipeline"],
                  ["sourcing", "Sourcing"],
                  ["relationships", "Relationships"],
                ] as const
              ).map(([t, label]) => (
                <button
                  key={t}
                  onClick={() => setAnalyticsTab(t)}
                  className={`px-3 py-1.5 text-xs font-semibold transition ${
                    analyticsTab === t
                      ? "bg-[#0d1f3c] text-white dark:bg-[#b8975a] dark:text-[#0d1f3c]"
                      : "text-slate-500 hover:bg-slate-100 dark:text-white/60 dark:hover:bg-white/5"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="flex overflow-hidden rounded-lg border border-slate-200 dark:border-white/15">
              {([30, 90, 365] as const).map((d) => (
                <button
                  key={d}
                  onClick={() => setWinDays(d)}
                  className={`px-2.5 py-1.5 text-xs font-semibold transition ${
                    winDays === d
                      ? "bg-[#0d1f3c] text-white dark:bg-[#b8975a] dark:text-[#0d1f3c]"
                      : "text-slate-500 hover:bg-slate-100 dark:text-white/60 dark:hover:bg-white/5"
                  }`}
                >
                  {d}d
                </button>
              ))}
            </div>
          </div>
        </div>

        {analyticsTab === "pipeline" && (
          <div>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <div>
                <p className="text-2xl font-bold text-[#0d1f3c] dark:text-white">
                  {analytics.addedWin}
                </p>
                <p className="text-xs uppercase tracking-wide text-slate-400 dark:text-white/50">
                  Added ({winDays} days)
                </p>
              </div>
              <div>
                <p className="text-2xl font-bold text-[#0d1f3c] dark:text-white">
                  {analytics.avgValue === null ? "—" : fmtMoney(analytics.avgValue)}
                </p>
                <p className="text-xs uppercase tracking-wide text-slate-400 dark:text-white/50">
                  Avg deal value
                </p>
                <p className="mt-0.5 text-[11px] text-slate-400 dark:text-white/40">
                  {analytics.valuedCount} of {analytics.activeCount} active deals have a value
                </p>
              </div>
              <div>
                <p className="text-2xl font-bold text-[#0d1f3c] dark:text-white">
                  {analytics.ebitdaCount === 0 ? "—" : fmtMoney(analytics.ebitdaSum)}
                </p>
                <p className="text-xs uppercase tracking-wide text-slate-400 dark:text-white/50">
                  Pipeline EBITDA
                </p>
                <p className="mt-0.5 text-[11px] text-slate-400 dark:text-white/40">
                  {analytics.ebitdaCount} of {analytics.activeCount} deals
                </p>
              </div>
              <div>
                <p className="text-2xl font-bold text-[#0d1f3c] dark:text-white">
                  {analytics.winRate === null ? "—" : `${analytics.winRate}%`}
                </p>
                <p className="text-xs uppercase tracking-wide text-slate-400 dark:text-white/50">
                  Close rate
                </p>
                {analytics.winRate === null && (
                  <p className="mt-0.5 text-[11px] text-slate-400 dark:text-white/40">
                    Needs 5+ closed or passed deals ({analytics.closedPassedCount} so far)
                  </p>
                )}
              </div>
            </div>
            <p className="mt-2 text-[11px] text-slate-400 dark:text-white/40">
              Data as of {dataDate} · n = {analytics.scopedCount} deals · All sectors.
            </p>

            {analytics.closedPassedCount >= 5 ? (
              <>
                <div className="mt-5 border-t border-slate-100 pt-4 dark:border-white/10">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-white/50">
                    Stage-to-stage conversion
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {analytics.conversions.map((c) => (
                      <span
                        key={c.from}
                        className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600 dark:bg-white/10 dark:text-white/70"
                      >
                        <span
                          className="mr-1 inline-block h-1.5 w-1.5 rounded-full align-middle"
                          style={{ backgroundColor: stageColor(c.to) }}
                        />
                        {c.from} → {c.to}:{" "}
                        <strong>{c.pct === null ? "—" : `${c.pct}%`}</strong>
                        <span className="text-slate-400 dark:text-white/40">
                          {" "}({c.n} of {c.of})
                        </span>
                      </span>
                    ))}
                  </div>
                  <p className="mt-1.5 text-[11px] text-slate-400 dark:text-white/40">
                    Funnel from current stages — a deal counts at every stage up to its own;
                    Closed Won counts at all stages, Passed sits outside the funnel. n = {analytics.scopedCount}
                  </p>
                </div>

                {analytics.passedCount > 0 && (
                  <div className="mt-4 border-t border-slate-100 pt-4 dark:border-white/10">
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-white/50">
                      Pass reasons ({analytics.passedCount} passed in {winDays} days)
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {analytics.passReasons.map((r) => (
                        <span
                          key={r.label}
                          className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600 dark:bg-white/10 dark:text-white/70"
                        >
                          {r.label} · {r.count}
                        </span>
                      ))}
                    </div>
                    <p className="mt-1.5 text-[11px] text-slate-400 dark:text-white/40">
                      Categorized from deal notes — no structured pass-reason field yet.
                    </p>
                  </div>
                )}
              </>
            ) : (
              <div className="mt-5 rounded-lg border border-dashed border-slate-200 px-4 py-3 dark:border-white/15">
                <p className="text-sm font-medium text-slate-500 dark:text-white/60">
                  Not enough data yet — {analytics.closedPassedCount} of 5 closed/passed deals.
                </p>
                <p className="mt-0.5 text-xs text-slate-400 dark:text-white/40">
                  Stage conversion and pass-reason breakdowns appear once at least 5 deals
                  have closed or been passed.
                </p>
              </div>
            )}

            {analytics.daysInStage.length > 0 && (
              <div className="mt-4 border-t border-slate-100 pt-4 dark:border-white/10">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-white/50">
                  Days in stage (average)
                </p>
                <div className="flex flex-col gap-2">
                  {analytics.daysInStage.map((r) => {
                    const maxD = Math.max(1, ...analytics.daysInStage.map((x) => x.avgDays ?? 0));
                    return (
                      <div key={r.stage}>
                        <div className="mb-0.5 flex items-baseline justify-between text-xs">
                          <span className="font-medium text-slate-700 dark:text-[#e8dfc8]">{r.stage}</span>
                          <span className="text-slate-500 dark:text-white/50">
                            {r.avgDays === null ? "—" : `${r.avgDays}d`} · n = {r.n}
                          </span>
                        </div>
                        <div className="h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-white/10">
                          <div
                            className="h-full rounded-full"
                            style={{
                              width: `${(((r.avgDays ?? 0) / maxD) * 100).toFixed(1)}%`,
                              background: barGradient(stageColor(r.stage)),
                            }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
                <p className="mt-1.5 text-[11px] text-slate-400 dark:text-white/40">
                  Age in current stage — no stage history is stored, so this is days since
                  each deal's last update. Data as of {dataDate}.
                </p>
              </div>
            )}
          </div>
        )}

        {analyticsTab === "sourcing" && (
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-white/50">
              Fit targets by sector
            </p>
            <div className="mb-1.5">
              <SectorLegend sectors={[...FIT_SECTORS]} />
            </div>
            <div className="flex flex-col gap-2">
              {FIT_SECTORS.map((sector) => {
                const count = fitCounts[sector] ?? 0;
                const maxFit = Math.max(1, ...FIT_SECTORS.map((s) => fitCounts[s] ?? 0));
                return (
                  <div key={sector}>
                    <div className="mb-0.5 flex items-baseline justify-between text-xs">
                      <span className="font-medium text-slate-700 dark:text-[#e8dfc8]">{sector}</span>
                      <span className="text-slate-500 dark:text-white/50">{count.toLocaleString()}</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-white/10">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${((count / maxFit) * 100).toFixed(1)}%`,
                          background: barGradient(sectorColor(sector)),
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
            <p className="mt-1.5 text-[11px] text-slate-400 dark:text-white/40">
              Live fit-target counts from Market Intel. Data as of {dataDate} · n ={" "}
              {FIT_SECTORS.reduce((s, x) => s + (fitCounts[x] ?? 0), 0).toLocaleString()}
            </p>

            <div className="mt-5 grid grid-cols-2 gap-4 border-t border-slate-100 pt-4 sm:grid-cols-4 dark:border-white/10">
              <div>
                <p className="text-2xl font-bold text-[#0d1f3c] dark:text-white">{sourcing.reviewed}</p>
                <p className="text-xs uppercase tracking-wide text-slate-400 dark:text-white/50">Listings reviewed ({winDays}d)</p>
              </div>
              <div>
                <p className="text-2xl font-bold text-[#0d1f3c] dark:text-white">{sourcing.added}</p>
                <p className="text-xs uppercase tracking-wide text-slate-400 dark:text-white/50">Added to pipeline</p>
              </div>
              <div>
                <p className="text-2xl font-bold text-[#0d1f3c] dark:text-white">{sourcing.dismissed}</p>
                <p className="text-xs uppercase tracking-wide text-slate-400 dark:text-white/50">Dismissed</p>
              </div>
              <div>
                <p className="text-2xl font-bold text-[#0d1f3c] dark:text-white">{sourcing.pending}</p>
                <p className="text-xs uppercase tracking-wide text-slate-400 dark:text-white/50">Still new</p>
              </div>
            </div>
            <p className="mt-1.5 text-[11px] text-slate-400 dark:text-white/40">
              Businesses-for-sale items in the Activity feed, by current status. Data as of {dataDate} · n = {sourcing.reviewed}
            </p>

            {sourcing.sourceRows.length > 0 && (
              <div className="mt-4 border-t border-slate-100 pt-4 dark:border-white/10">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-white/50">
                  Source quality — Activity feed
                </p>
                <div className="overflow-x-auto">
                  <table className="tbl-grad w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs uppercase tracking-wide text-slate-400 dark:text-white/40">
                        <th className="py-1 pr-3 font-semibold">Source</th>
                        <th className="py-1 pr-3 font-semibold">Sent</th>
                        <th className="py-1 pr-3 font-semibold">Added</th>
                        <th className="py-1 pr-3 font-semibold">Dismissed</th>
                        <th className="py-1 font-semibold">Fit rate</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sourcing.sourceRows.map((r) => (
                        <tr key={r.source} className="border-t border-slate-100 dark:border-white/5">
                          <td className="py-1.5 pr-3 font-medium text-slate-700 dark:text-[#e8dfc8]">{r.source}</td>
                          <td className="py-1.5 pr-3 text-slate-600 dark:text-white/70">{r.sent}</td>
                          <td className="py-1.5 pr-3 text-slate-600 dark:text-white/70">{r.added}</td>
                          <td className="py-1.5 pr-3 text-slate-600 dark:text-white/70">{r.dismissed}</td>
                          <td className="py-1.5 text-slate-600 dark:text-white/70">{r.fitRate === null ? "—" : `${r.fitRate}%`}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="mt-1.5 text-[11px] text-slate-400 dark:text-white/40">
                  Fit rate = added ÷ sent, over the last {winDays} days, all Activity kinds.
                </p>
              </div>
            )}

            {sourcing.brokerRows.length > 0 && (
              <div className="mt-4 border-t border-slate-100 pt-4 dark:border-white/10">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-white/50">
                  Source quality — brokers on pipeline deals
                </p>
                <div className="overflow-x-auto">
                  <table className="tbl-grad w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs uppercase tracking-wide text-slate-400 dark:text-white/40">
                        <th className="py-1 pr-3 font-semibold">Broker</th>
                        <th className="py-1 pr-3 font-semibold">Deals</th>
                        <th className="py-1 pr-3 font-semibold">Past Sourcing</th>
                        <th className="py-1 font-semibold">Advanced rate</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sourcing.brokerRows.map((r) => (
                        <tr key={r.broker} className="border-t border-slate-100 dark:border-white/5">
                          <td className="py-1.5 pr-3 font-medium text-slate-700 dark:text-[#e8dfc8]">{r.broker}</td>
                          <td className="py-1.5 pr-3 text-slate-600 dark:text-white/70">{r.deals}</td>
                          <td className="py-1.5 pr-3 text-slate-600 dark:text-white/70">{r.advanced}</td>
                          <td className="py-1.5 text-slate-600 dark:text-white/70">{r.advRate === null ? "—" : `${r.advRate}%`}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="mt-1.5 text-[11px] text-slate-400 dark:text-white/40">
                  Advanced rate = the broker's deals that moved past Sourcing (and weren't
                  passed) ÷ all their deals in the pipeline. All-time. n ={" "}
                  {sourcing.brokerRows.reduce((s, r) => s + r.deals, 0)}
                </p>
              </div>
            )}
          </div>
        )}

        {analyticsTab === "relationships" && (
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-white/50">
              Operators by stage
            </p>
            <div className="flex flex-col gap-2">
              {relationships.opsByStage.map((r) => {
                const maxN = Math.max(1, ...relationships.opsByStage.map((x) => x.n));
                return (
                  <div key={r.stage}>
                    <div className="mb-0.5 flex items-baseline justify-between text-xs">
                      <span className="font-medium text-slate-700 dark:text-[#e8dfc8]">{r.stage}</span>
                      <span className="text-slate-500 dark:text-white/50">{r.n}</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-white/10">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${((r.n / maxN) * 100).toFixed(1)}%`,
                          background: barGradient(stageColor(r.stage)),
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
            <p className="mt-1.5 text-[11px] text-slate-400 dark:text-white/40">
              Data as of {dataDate} · n = {execs.length} operators
            </p>

            <div className="mt-5 border-t border-slate-100 pt-4 dark:border-white/10">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-white/50">
                Intermediaries by activity
              </p>
              {relationships.intermediaryRows.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {relationships.intermediaryRows.map((r) => (
                    <span
                      key={r.name}
                      className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600 dark:bg-white/10 dark:text-white/70"
                    >
                      {r.name} · {r.n}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-slate-400 dark:text-white/40">No intermediary activity recorded yet.</p>
              )}
              <p className="mt-1.5 text-[11px] text-slate-400 dark:text-white/40">
                Activity-feed items plus the broker field on pipeline deals. A dedicated
                Intermediaries directory arrives in a later phase.
              </p>
            </div>

            <div className="mt-4 border-t border-slate-100 pt-4 dark:border-white/10">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-white/50">
                Investors by last touch
              </p>
              <div className="flex flex-wrap gap-2">
                {relationships.invBuckets.map((b) => (
                  <span
                    key={b.label}
                    className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600 dark:bg-white/10 dark:text-white/70"
                  >
                    {b.label}: <strong>{b.n}</strong>
                  </span>
                ))}
              </div>
              <p className="mt-1.5 text-[11px] text-slate-400 dark:text-white/40">
                Investors have no touch log — recency uses each record's last update.
                Data as of {dataDate} · n = {investors.length}
              </p>
            </div>

            <div className="mt-4 border-t border-slate-100 pt-4 dark:border-white/10">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-white/50">
                Going quiet — no touch in 45+ days
              </p>
              {relationships.quiet.length > 0 ? (
                <ul className="space-y-1">
                  {relationships.quiet.map((x) => (
                    <li
                      key={`${x.kind}-${x.name}`}
                      className="flex items-center gap-2 text-sm text-slate-700 dark:text-[#e8dfc8]"
                    >
                      <span
                        className="h-2 w-2 shrink-0 rounded-full"
                        style={{
                          backgroundColor:
                            x.days >= 90
                              ? AGING_COLORS.bad
                              : x.days >= 60
                                ? AGING_COLORS.warn
                                : AGING_COLORS.ok,
                        }}
                      />
                      <span className="font-medium">{x.name}</span>
                      <span className="text-xs text-slate-400 dark:text-white/40">
                        {x.kind} · {x.days} days
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-slate-400 dark:text-white/40">
                  Nobody is past 45 days without a touch.
                </p>
              )}
              <p className="mt-1.5 text-[11px] text-slate-400 dark:text-white/40">
                Amber at 60 days without a touch, red at 90. {relationships.quiet60} contacts
                are at 60–89 days, {relationships.quiet90} at 90+. Operators use their last
                logged interaction; investors use last record update. n = {relationships.quietTotal}
              </p>
            </div>
          </div>
        )}
      </section>


      </main>
    </>
  );
}

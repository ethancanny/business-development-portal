"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import PageHero from "@/components/PageHero";
import { SectorLegend } from "@/components/SectorChip";
import {
  DEAL_STAGES,
  EXEC_STAGES,
  type Deal,
  type DealFlowItem,
  type Executive,
  type Interaction,
  type MiMultiple,
} from "@/lib/types";
import type { Investor } from "@/lib/investors-db";
import { fmtMoney } from "@/lib/format";
import { resolveDealValue, type MarketRates } from "@/lib/valuation";
import { AGING_COLORS, FOCUS_SECTOR_NAMES, barGradient, sectorColor, stageColor } from "@/lib/sector-colors";

/**
 * Full analytics (Ethan, Oct 14, 2026): linked from Overview only once
 * the book is deep enough — 10+ pipeline deals and 5+ logged comps.
 * The page is never in the nav; when the gate isn't met it says so
 * and shows the counts. Same Pipeline / Sourcing / Relationships
 * tabs as Overview, plus a Market tab (fit density today, competing
 * buyers, and the comps log with running medians).
 */

const TERMINAL_STAGES = ["Closed Won", "Passed"];
const FIT_SECTORS: readonly string[] = FOCUS_SECTOR_NAMES;

const daysSince = (iso: string): number =>
  Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86400000));

function median(nums: number[]): number | null {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

interface Buyer {
  acquirer: string;
  dealCount: number;
  totalValue: number | null;
  deals: { target: string; headline: string; industry: string; dealValue: number | null; announcedDate: string }[];
}

export default function AnalyticsPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [execs, setExecs] = useState<Executive[]>([]);
  const [flow, setFlow] = useState<DealFlowItem[]>([]);
  const [interactions, setInteractions] = useState<Interaction[]>([]);
  const [investors, setInvestors] = useState<Investor[]>([]);
  const [multiples, setMultiples] = useState<MiMultiple[]>([]);
  const [rates, setRates] = useState<MarketRates>({});
  const [fitCounts, setFitCounts] = useState<Record<string, number>>({});
  const [buyers, setBuyers] = useState<Buyer[]>([]);
  const [tab, setTab] = useState<"pipeline" | "sourcing" | "relationships" | "market">("pipeline");
  const [winDays, setWinDays] = useState<30 | 90 | 365>(30);

  useEffect(() => {
    (async () => {
      try {
        const [dealsRes, execsRes, flowRes, ixRes, invRes, multRes, ratesRes, buyRes] =
          await Promise.all([
            fetch("/api/deals"),
            fetch("/api/executives"),
            fetch("/api/deal-flow"),
            fetch("/api/interactions"),
            fetch("/api/investors"),
            fetch("/api/market/multiples"),
            fetch("/api/market/rates"),
            fetch("/api/market/competing-buyers"),
          ]);
        if (dealsRes.status === 401) {
          router.replace("/login");
          return;
        }
        if (dealsRes.ok) setDeals(await dealsRes.json());
        if (execsRes.ok) setExecs(await execsRes.json());
        if (flowRes.ok) setFlow(await flowRes.json());
        if (ixRes.ok) setInteractions(await ixRes.json());
        if (invRes.ok) {
          const d = await invRes.json();
          if (Array.isArray(d)) setInvestors(d);
          else if (Array.isArray(d?.investors)) setInvestors(d.investors);
        }
        if (multRes.ok) {
          const m = await multRes.json();
          if (Array.isArray(m)) setMultiples(m);
        }
        if (ratesRes.ok) {
          const rd = await ratesRes.json().catch(() => null);
          setRates({ prime: rd?.prime?.value ?? null, sba: rd?.sba?.value ?? null });
        }
        if (buyRes.ok) {
          const b = await buyRes.json().catch(() => null);
          if (Array.isArray(b)) setBuyers(b);
        }
        for (const s of FIT_SECTORS) {
          fetch(`/api/market/companies?sector=${encodeURIComponent(s)}&limit=1`)
            .then((r) => (r.ok ? r.json() : null))
            .then((d: { fitTotal?: number } | null) =>
              setFitCounts((c) => ({ ...c, [s]: d?.fitTotal ?? 0 }))
            )
            .catch(() => setFitCounts((c) => ({ ...c, [s]: 0 })));
        }
      } finally {
        setLoading(false);
      }
    })();
  }, [router]);

  const dataDate = new Date().toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  const winCutoff = useMemo(
    () => new Date(Date.now() - winDays * 86400000).toISOString(),
    [winDays]
  );
  // All deals count (Ethan, Oct 14, 2026 — the non-focus toggle is
  // gone; the "Non-focus" tag is a label only and changes no total).
  const scopedDeals = deals;
  const compLog = useMemo(
    () =>
      multiples
        .filter((m) => m.sourceReport === "Canny Comp Log")
        .slice()
        .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1)),
    [multiples]
  );
  const gateMet = deals.length >= 10 && compLog.length >= 5;

  const pipeline = useMemo(() => {
    const scopedActive = scopedDeals.filter((d) => !TERMINAL_STAGES.includes(d.stage));
    const valued = scopedActive
      .map((d) => resolveDealValue(d, multiples, rates).value)
      .filter((v): v is number => v !== null);
    const closedPassed = scopedDeals.filter((d) => TERMINAL_STAGES.includes(d.stage));
    const won = closedPassed.filter((d) => d.stage === "Closed Won").length;
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
    const daysInStage = ACTIVE_STAGES.map((stage) => {
      const inStage = scopedDeals.filter((d) => d.stage === stage);
      const ages = inStage.map((d) => daysSince(d.updatedAt));
      return {
        stage,
        n: inStage.length,
        avgDays: ages.length ? Math.round(ages.reduce((a, b) => a + b, 0) / ages.length) : null,
      };
    }).filter((r) => r.n > 0);
    return {
      addedWin: scopedDeals.filter((d) => d.createdAt >= winCutoff).length,
      avgValue: valued.length ? valued.reduce((s, v) => s + v, 0) / valued.length : null,
      valuedCount: valued.length,
      activeCount: scopedActive.length,
      winRate: closedPassed.length >= 5 ? Math.round((won / closedPassed.length) * 100) : null,
      closedPassedCount: closedPassed.length,
      conversions,
      daysInStage,
    };
  }, [scopedDeals, multiples, rates, winCutoff]);

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
      sourceRows,
      brokerRows,
    };
  }, [flow, deals, winCutoff]);

  const relationships = useMemo(() => {
    const opsByStage = EXEC_STAGES.map((stage) => ({
      stage,
      n: execs.filter((e) => e.stage === stage).length,
    })).filter((r) => r.n > 0);
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
      .sort((a, b) => b.days - a.days)
      .slice(0, 15);
    return { opsByStage, quiet };
  }, [execs, investors, interactions]);

  // Comps log: running median by industry group + size band.
  const compGroups = useMemo(() => {
    const groups = new Map<string, MiMultiple[]>();
    for (const c of compLog) {
      const key = `${c.industry}|||${c.sizeBand}`;
      const arr = groups.get(key) ?? [];
      arr.push(c);
      groups.set(key, arr);
    }
    return Array.from(groups.entries())
      .map(([key, rows]) => {
        const [industry, sizeBand] = key.split("|||");
        return {
          industry,
          sizeBand,
          n: rows.length,
          medEbitda: median(rows.map((r) => r.evEbitdaMedian).filter((v): v is number => v != null)),
          medRevenue: median(rows.map((r) => r.evRevenueMedian).filter((v): v is number => v != null)),
          blended: rows.length >= 5,
        };
      })
      .sort((a, b) => b.n - a.n);
  }, [compLog]);

  const barRow = (
    label: string,
    n: number,
    max: number,
    color: string,
    right: string
  ) => (
    <div key={label}>
      <div className="mb-0.5 flex items-baseline justify-between text-xs">
        <span className="font-medium text-slate-700 dark:text-[#e8dfc8]">{label}</span>
        <span className="text-slate-500 dark:text-white/50">{right}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-white/10">
        <div
          className="h-full rounded-full"
          style={{ width: `${((n / Math.max(1, max)) * 100).toFixed(1)}%`, background: barGradient(color) }}
        />
      </div>
    </div>
  );

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <p className="text-sm text-slate-500 dark:text-white/50">Loading analytics…</p>
      </div>
    );
  }

  return (
    <>
      <PageHero
        eyebrow="Canny Capital Partners"
        title="Analytics"
        subtitle="Pipeline, sourcing, relationships, and market — the full book."
      />
      <main className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6">
        <Link
          href="/overview"
          className="text-sm font-semibold text-[#8a6f3c] hover:underline dark:text-[#d4b37a]"
        >
          ← Back to Overview
        </Link>

        {!gateMet && (
          <div className="mt-4 rounded-xl border border-dashed border-slate-300 bg-white px-4 py-3 dark:border-white/20 dark:bg-[#132847]">
            <p className="text-sm font-medium text-slate-600 dark:text-white/70">
              Full analytics unlocks at 10 pipeline deals and 5 logged comps — currently{" "}
              {deals.length} of 10 deals and {compLog.length} of 5 comps.
            </p>
            <p className="mt-0.5 text-xs text-slate-400 dark:text-white/40">
              The tabs below still render with whatever data exists today.
            </p>
          </div>
        )}

        <section className="mt-4 rounded-xl border border-slate-200 bg-white p-5 dark:border-white/10 dark:bg-[#132847]">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <div className="flex overflow-hidden rounded-lg border border-slate-200 dark:border-white/15">
              {(
                [
                  ["pipeline", "Pipeline"],
                  ["sourcing", "Sourcing"],
                  ["relationships", "Relationships"],
                  ["market", "Market"],
                ] as const
              ).map(([t, label]) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={`px-3 py-1.5 text-xs font-semibold transition ${
                    tab === t
                      ? "bg-[#0d1f3c] text-white dark:bg-[#b8975a] dark:text-[#0d1f3c]"
                      : "text-slate-500 hover:bg-slate-100 dark:text-white/60 dark:hover:bg-white/5"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-3">
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

          {tab === "pipeline" && (
            <div>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <div>
                  <p className="text-2xl font-bold text-[#0d1f3c] dark:text-white">{pipeline.addedWin}</p>
                  <p className="text-xs uppercase tracking-wide text-slate-400 dark:text-white/50">Added ({winDays} days)</p>
                </div>
                <div>
                  <p className="text-2xl font-bold text-[#0d1f3c] dark:text-white">
                    {pipeline.avgValue === null ? "—" : fmtMoney(pipeline.avgValue)}
                  </p>
                  <p className="text-xs uppercase tracking-wide text-slate-400 dark:text-white/50">Avg deal value</p>
                  <p className="mt-0.5 text-[11px] text-slate-400 dark:text-white/40">
                    {pipeline.valuedCount} of {pipeline.activeCount} active deals have a value
                  </p>
                </div>
                <div>
                  <p className="text-2xl font-bold text-[#0d1f3c] dark:text-white">
                    {pipeline.winRate === null ? "—" : `${pipeline.winRate}%`}
                  </p>
                  <p className="text-xs uppercase tracking-wide text-slate-400 dark:text-white/50">Close rate</p>
                </div>
                <div>
                  <p className="text-2xl font-bold text-[#0d1f3c] dark:text-white">{scopedDeals.length}</p>
                  <p className="text-xs uppercase tracking-wide text-slate-400 dark:text-white/50">Deals</p>
                </div>
              </div>
              <p className="mt-2 text-[11px] text-slate-400 dark:text-white/40">
                Data as of {dataDate} · n = {scopedDeals.length} · All sectors.
              </p>
              {pipeline.closedPassedCount >= 5 ? (
                <div className="mt-5 border-t border-slate-100 pt-4 dark:border-white/10">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-white/50">
                    Stage-to-stage conversion
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {pipeline.conversions.map((c) => (
                      <span
                        key={c.from}
                        className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600 dark:bg-white/10 dark:text-white/70"
                      >
                        <span
                          className="mr-1 inline-block h-1.5 w-1.5 rounded-full align-middle"
                          style={{ backgroundColor: stageColor(c.to) }}
                        />
                        {c.from} → {c.to}: <strong>{c.pct === null ? "—" : `${c.pct}%`}</strong>
                        <span className="text-slate-400 dark:text-white/40"> ({c.n} of {c.of})</span>
                      </span>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="mt-5 rounded-lg border border-dashed border-slate-200 px-4 py-3 dark:border-white/15">
                  <p className="text-sm font-medium text-slate-500 dark:text-white/60">
                    Not enough data yet — {pipeline.closedPassedCount} of 5 closed/passed deals.
                  </p>
                </div>
              )}
              {pipeline.daysInStage.length > 0 && (
                <div className="mt-4 border-t border-slate-100 pt-4 dark:border-white/10">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-white/50">
                    Days in stage (average)
                  </p>
                  <div className="flex flex-col gap-2">
                    {pipeline.daysInStage.map((r) =>
                      barRow(r.stage, r.avgDays ?? 0, Math.max(1, ...pipeline.daysInStage.map((x) => x.avgDays ?? 0)), stageColor(r.stage), `${r.avgDays ?? "—"}d · n = ${r.n}`)
                    )}
                  </div>
                  <p className="mt-1.5 text-[11px] text-slate-400 dark:text-white/40">
                    Age in current stage (days since last update) — no stage history is stored.
                  </p>
                </div>
              )}
            </div>
          )}

          {tab === "sourcing" && (
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-white/50">
                Fit targets by sector
              </p>
              <div className="mb-1.5">
                <SectorLegend sectors={[...FIT_SECTORS]} />
              </div>
              <div className="flex flex-col gap-2">
                {FIT_SECTORS.map((sector) =>
                  barRow(
                    sector,
                    fitCounts[sector] ?? 0,
                    Math.max(1, ...FIT_SECTORS.map((s) => fitCounts[s] ?? 0)),
                    sectorColor(sector),
                    (fitCounts[sector] ?? 0).toLocaleString()
                  )
                )}
              </div>
              <p className="mt-1.5 text-[11px] text-slate-400 dark:text-white/40">
                Data as of {dataDate} · n = {FIT_SECTORS.reduce((s, x) => s + (fitCounts[x] ?? 0), 0).toLocaleString()}
              </p>
              <div className="mt-5 grid grid-cols-3 gap-4 border-t border-slate-100 pt-4 dark:border-white/10">
                <div>
                  <p className="text-2xl font-bold text-[#0d1f3c] dark:text-white">{sourcing.reviewed}</p>
                  <p className="text-xs uppercase tracking-wide text-slate-400 dark:text-white/50">Listings reviewed ({winDays}d)</p>
                </div>
                <div>
                  <p className="text-2xl font-bold text-[#0d1f3c] dark:text-white">{sourcing.added}</p>
                  <p className="text-xs uppercase tracking-wide text-slate-400 dark:text-white/50">Added</p>
                </div>
                <div>
                  <p className="text-2xl font-bold text-[#0d1f3c] dark:text-white">{sourcing.dismissed}</p>
                  <p className="text-xs uppercase tracking-wide text-slate-400 dark:text-white/50">Dismissed</p>
                </div>
              </div>
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
                    Fit rate = added ÷ sent in the last {winDays} days.
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
                </div>
              )}
            </div>
          )}

          {tab === "relationships" && (
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-white/50">
                Operators by stage
              </p>
              <div className="flex flex-col gap-2">
                {relationships.opsByStage.map((r) =>
                  barRow(r.stage, r.n, Math.max(1, ...relationships.opsByStage.map((x) => x.n)), stageColor(r.stage), String(r.n))
                )}
              </div>
              <p className="mt-1.5 text-[11px] text-slate-400 dark:text-white/40">
                Data as of {dataDate} · n = {execs.length} operators
              </p>
              <div className="mt-4 border-t border-slate-100 pt-4 dark:border-white/10">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-white/50">
                  Going quiet — no touch in 45+ days
                </p>
                {relationships.quiet.length > 0 ? (
                  <ul className="space-y-1">
                    {relationships.quiet.map((x) => (
                      <li key={`${x.kind}-${x.name}`} className="flex items-center gap-2 text-sm text-slate-700 dark:text-[#e8dfc8]">
                        <span
                          className="h-2 w-2 shrink-0 rounded-full"
                          style={{
                            backgroundColor:
                              x.days >= 90 ? AGING_COLORS.bad : x.days >= 60 ? AGING_COLORS.warn : AGING_COLORS.ok,
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
                  <p className="text-sm text-slate-400 dark:text-white/40">Nobody is past 45 days without a touch.</p>
                )}
                <p className="mt-1.5 text-[11px] text-slate-400 dark:text-white/40">
                  Amber at 60 days without a touch, red at 90.
                </p>
              </div>
            </div>
          )}

          {tab === "market" && (
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-white/50">
                Sector tailwind — fit-target density today
              </p>
              <div className="mb-1.5">
                <SectorLegend sectors={[...FIT_SECTORS]} />
              </div>
              <div className="flex flex-col gap-2">
                {FIT_SECTORS.map((sector) =>
                  barRow(
                    sector,
                    fitCounts[sector] ?? 0,
                    Math.max(1, ...FIT_SECTORS.map((s) => fitCounts[s] ?? 0)),
                    sectorColor(sector),
                    (fitCounts[sector] ?? 0).toLocaleString()
                  )
                )}
              </div>
              <p className="mt-1.5 text-[11px] text-slate-400 dark:text-white/40">
                Sector tailwind scoring (employment growth, federal awards, permits,
                establishment growth) is a later phase — this shows the live fit-target
                counts it will build on. Data as of {dataDate}.
              </p>

              <div className="mt-5 border-t border-slate-100 pt-4 dark:border-white/10">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-white/50">
                  Competing buyers
                </p>
                {buyers.length > 0 ? (
                  <div className="overflow-x-auto">
                    <table className="tbl-grad w-full text-sm">
                      <thead>
                        <tr className="text-left text-xs uppercase tracking-wide text-slate-400 dark:text-white/40">
                          <th className="py-1 pr-3 font-semibold">Acquirer / platform</th>
                          <th className="py-1 pr-3 font-semibold">Deals</th>
                          <th className="py-1 pr-3 font-semibold">Latest target</th>
                          <th className="py-1 font-semibold">Total size</th>
                        </tr>
                      </thead>
                      <tbody>
                        {buyers.map((b) => (
                          <tr key={b.acquirer} className="border-t border-slate-100 dark:border-white/5">
                            <td className="py-1.5 pr-3 font-medium text-slate-700 dark:text-[#e8dfc8]">{b.acquirer}</td>
                            <td className="py-1.5 pr-3 text-slate-600 dark:text-white/70">{b.dealCount}</td>
                            <td className="py-1.5 pr-3 text-slate-600 dark:text-white/70">
                              {b.deals[0]?.target || b.deals[0]?.headline || "—"}
                              {b.deals[0]?.announcedDate ? ` · ${b.deals[0].announcedDate}` : ""}
                            </td>
                            <td className="py-1.5 text-slate-600 dark:text-white/70">
                              {b.totalValue ? fmtMoney(b.totalValue) : "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="text-sm text-slate-400 dark:text-white/40">
                    No repeat acquirers yet — a buyer appears after its second Arizona deal in the feed.
                  </p>
                )}
                <p className="mt-1.5 text-[11px] text-slate-400 dark:text-white/40">
                  Acquirers with 2+ Arizona deals in the last 12 months, incl. M&A 8-K filers. Data as of {dataDate} · n = {buyers.length}
                </p>
              </div>

              <div className="mt-4 border-t border-slate-100 pt-4 dark:border-white/10">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-white/50">
                  Comps log — running medians by sector &amp; size band
                </p>
                {compGroups.length > 0 ? (
                  <div className="overflow-x-auto">
                    <table className="tbl-grad w-full text-sm">
                      <thead>
                        <tr className="text-left text-xs uppercase tracking-wide text-slate-400 dark:text-white/40">
                          <th className="py-1 pr-3 font-semibold">Sector / group</th>
                          <th className="py-1 pr-3 font-semibold">Size band</th>
                          <th className="py-1 pr-3 font-semibold">Comps</th>
                          <th className="py-1 pr-3 font-semibold">Median EV/EBITDA</th>
                          <th className="py-1 pr-3 font-semibold">Median EV/Revenue</th>
                          <th className="py-1 font-semibold">In base multiple</th>
                        </tr>
                      </thead>
                      <tbody>
                        {compGroups.map((g) => (
                          <tr key={`${g.industry}-${g.sizeBand}`} className="border-t border-slate-100 dark:border-white/5">
                            <td className="py-1.5 pr-3 font-medium text-slate-700 dark:text-[#e8dfc8]">
                              <span
                                className="mr-1.5 inline-block h-2 w-2 rounded-full align-middle"
                                style={{ backgroundColor: sectorColor(g.industry) }}
                              />
                              {g.industry}
                            </td>
                            <td className="py-1.5 pr-3 text-slate-600 dark:text-white/70">{g.sizeBand}</td>
                            <td className="py-1.5 pr-3 text-slate-600 dark:text-white/70">{g.n}</td>
                            <td className="py-1.5 pr-3 text-slate-600 dark:text-white/70">
                              {g.medEbitda === null ? "—" : `${g.medEbitda.toFixed(1)}×`}
                            </td>
                            <td className="py-1.5 pr-3 text-slate-600 dark:text-white/70">
                              {g.medRevenue === null ? "—" : `${g.medRevenue.toFixed(1)}×`}
                            </td>
                            <td className="py-1.5 text-slate-600 dark:text-white/70">
                              {g.blended ? "Yes — blended 50/50" : `At ${5 - g.n} more`}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="text-sm text-slate-400 dark:text-white/40">
                    No comps logged yet — pass or close a deal and log it from the deal panel.
                  </p>
                )}
                <p className="mt-1.5 text-[11px] text-slate-400 dark:text-white/40">
                  Medians run over all logged comps in the group; at 5+ entries the
                  valuation engine blends the group median into the base multiple.
                  Data as of {dataDate} · n = {compLog.length}
                </p>
                {compLog.length > 0 && (
                  <div className="mt-3 space-y-1">
                    {compLog
                      .slice()
                      .reverse()
                      .slice(0, 10)
                      .map((c) => (
                        <p key={c.id} className="text-xs text-slate-500 dark:text-white/50">
                          <span className="font-medium text-slate-700 dark:text-[#e8dfc8]">{c.industry}</span>
                          {" · "}
                          {c.sizeBand} · {c.period} ·{" "}
                          {c.evEbitdaMedian != null ? `${c.evEbitdaMedian.toFixed(1)}× EBITDA` : "—"}
                          {c.evRevenueMedian != null ? ` · ${c.evRevenueMedian.toFixed(1)}× rev` : ""}
                        </p>
                      ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </section>
      </main>
    </>
  );
}

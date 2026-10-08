"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import PageHero from "@/components/PageHero";
import ValleyDemographics from "@/components/ValleyDemographics";
import { useTheme } from "@/components/ThemeProvider";
import { fmtMoney, fmtDate } from "@/lib/format";
import type {
  MiAcquisition,
  MiFiling,
  MiIndicatorObs,
  MiMultiple,
  MiSyncLog,
  MiWarnNotice,
} from "@/lib/types";

/* ---------------- helpers ---------------- */

type LatestMap = Record<string, { title: string; units: string; obsDate: string; value: number | null }>;

async function getJSON<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json() as Promise<T>;
}

function seriesToRows(obs: MiIndicatorObs[], ids: string[]): { date: string; [k: string]: string | number | null }[] {
  const byDate = new Map<string, Record<string, number | null>>();
  for (const o of obs) {
    if (!ids.includes(o.seriesId) || o.value === null) continue;
    let row = byDate.get(o.obsDate);
    if (!row) { row = {}; byDate.set(o.obsDate, row); }
    row[o.seriesId] = o.value;
  }
  return Array.from(byDate.entries())
    .map(([date, vals]) => ({ date, ...vals }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));
}

/** Index each series to 100 at the first observation for comparability. */
function indexRows(rows: { date: string; [k: string]: string | number | null }[], ids: string[]) {
  const base: Record<string, number> = {};
  for (const id of ids) {
    const first = rows.find((r) => typeof r[id] === "number");
    if (first) base[id] = first[id] as number;
  }
  return rows.map((r) => {
    const out: Record<string, string | number | null> = { date: r.date };
    for (const id of ids) {
      const v = r[id];
      out[id] = typeof v === "number" && base[id] ? Math.round((v / base[id]) * 1000) / 10 : null;
    }
    return out;
  });
}

/** Keep only rows within the trailing 5-year window so every chart starts at the same date. */
function filterSince<T extends { date: string }>(rows: T[], cutoff: string): T[] {
  return rows.filter((r) => r.date >= cutoff);
}

function yoyChange(obs: MiIndicatorObs[], seriesId: string): number | null {
  const s = obs.filter((o) => o.seriesId === seriesId && o.value !== null).sort((a, b) => (a.obsDate < b.obsDate ? -1 : 1));
  if (s.length < 13) return null;
  const latest = s[s.length - 1].value!;
  const yearAgo = s[s.length - 13].value!;
  if (!yearAgo) return null;
  return ((latest - yearAgo) / Math.abs(yearAgo)) * 100;
}

const shortDate = (d: string) => (d?.length >= 7 ? d.slice(0, 7) : d);

/* ---------------- main page ---------------- */

const TABS = ["acquisitions", "filings"] as const;
type Tab = (typeof TABS)[number];

/** Collapsible section: charts summarize, source data lives inside. */
function Section({
  title,
  sub,
  defaultOpen = false,
  children,
}: {
  title: string;
  sub?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="mb-6">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 border-b-2 border-[#b8975a]/50 pb-2 text-left"
      >
        <span>
          <span className="block text-lg font-bold text-[#0d1f3c] dark:text-white">{title}</span>
          {sub && <span className="block text-xs text-slate-500 dark:text-white/40">{sub}</span>}
        </span>
        <span className="text-xl leading-none text-[#8a6f3c] dark:text-[#d4b37a]">{open ? "▾" : "▸"}</span>
      </button>
      {open && <div className="pt-4">{children}</div>}
    </section>
  );
}

/** Collapsible subsection, nested inside a Section. */
function SubSection({
  title,
  defaultOpen = false,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="mb-5">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 border-b border-slate-200 pb-1.5 text-left dark:border-white/10"
      >
        <span className="text-base font-bold text-[#0d1f3c] dark:text-white">{title}</span>
        <span className="text-lg leading-none text-[#8a6f3c] dark:text-[#d4b37a]">{open ? "▾" : "▸"}</span>
      </button>
      {open && <div className="pt-3">{children}</div>}
    </div>
  );
}

/** Compact highlight strip of major events relevant to a section. */
function EventStrip({
  items,
  onDismiss,
}: {
  items: MiAcquisition[];
  onDismiss: (a: MiAcquisition) => void;
}) {
  if (items.length === 0) return null;
  const typeLabel: Record<string, string> = {
    acquisition: "Acquisition",
    bankruptcy: "Bankruptcy",
    expansion: "Major Expansion",
    investment: "New Investment",
    contract: "Contract Award",
    relocation: "Relocation",
    ipo: "IPO",
    policy: "Market Policy",
  };
  return (
    <div className="mt-4">
      <p className="mb-2 text-xs font-bold uppercase tracking-wider text-[#8a6f3c] dark:text-[#d4b37a]">
        ★ Major events
      </p>
      <div className="grid gap-2 md:grid-cols-3">
        {items.map((a) => (
          <div
            key={a.id}
            className="relative rounded-lg border border-[#b8975a]/40 bg-[#b8975a]/5 p-3 dark:bg-[#b8975a]/10"
          >
            <a href={a.sourceUrl || undefined} target="_blank" rel="noreferrer" className="block">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-[#8a6f3c] dark:text-[#d4b37a]">
                {typeLabel[a.eventType] || a.eventType}
                {a.announcedDate ? ` · ${fmtDate(a.announcedDate)}` : ""}
              </p>
              <p className="mt-0.5 pr-4 text-sm font-semibold text-[#0d1f3c] dark:text-white">
                {a.target || a.acquirer || "Unnamed"}
              </p>
              <p className="text-xs text-slate-500 dark:text-white/50">{a.publisher || "News"}</p>
            </a>
            <button
              onClick={() => onDismiss(a)}
              aria-label="Dismiss event"
              title="Dismiss"
              className="absolute right-1.5 top-1.5 rounded-full px-1.5 py-0.5 text-xs leading-none text-slate-400 transition hover:bg-black/5 hover:text-slate-700 dark:text-white/40 dark:hover:bg-white/10 dark:hover:text-white"
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function MarketIntelPage() {
  const { theme } = useTheme();
  const dark = theme === "dark";
  const [latest, setLatest] = useState<LatestMap>({});
  const [obs, setObs] = useState<MiIndicatorObs[]>([]);
  const [tab, setTab] = useState<Tab>("acquisitions");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [acquisitions, setAcquisitions] = useState<MiAcquisition[]>([]);
  const [filings, setFilings] = useState<MiFiling[]>([]);
  const [filingCat, setFilingCat] = useState("all");
  const [multMetric, setMultMetric] = useState<"ebitda" | "revenue">("revenue");
  const [multBand, setMultBand] = useState("EV $5–25M");
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);
  const [warn, setWarn] = useState<MiWarnNotice[]>([]);
  const [multiples, setMultiples] = useState<MiMultiple[]>([]);
  const [syncLog, setSyncLog] = useState<MiSyncLog[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const [latestData, obsData, acq, fil, warnData, mult, log] = await Promise.all([
          getJSON<LatestMap>("/api/market/latest"),
          getJSON<MiIndicatorObs[]>(
            "/api/market/indicators?series=AZUR,UNRATE,AZMFG,MANEMP,AZCONS,USCONS,AZBPPRIV,PERMIT,AZSTHPI,USSTHPI,SMS04000006562000001,CEU6500000001,AZNA,PAYEMS,AZ_DOD_CONTRACTS,AZ_AEROSPACE_CONTRACTS,QTAXTOTALQTAXCAT3AZNO,AZ_STATE_REVENUE,AZ_STATE_EXPENDITURE,AZ_SPEND_WELFARE,AZ_SPEND_EDUCATION,AZ_SPEND_INSURANCE,AZ_SPEND_HIGHWAYS,AZ_SPEND_CORRECTIONS,AZ_SPEND_HEALTH"
          ),
          getJSON<MiAcquisition[]>("/api/market/acquisitions?status=all"),
          getJSON<MiFiling[]>("/api/market/filings"),
          getJSON<MiWarnNotice[]>("/api/market/warn?limit=500"),
          getJSON<MiMultiple[]>("/api/market/multiples"),
          getJSON<MiSyncLog[]>("/api/market/sync-log"),
        ]);
        const lm: LatestMap = {};
        for (const l of latestData as unknown as { seriesId: string; title: string; units: string; obsDate: string; value: number | null }[])
          lm[l.seriesId] = l;
        setLatest(lm);
        setObs(obsData);
        setAcquisitions(acq);
        setFilings(fil);
        setWarn(warnData);
        setMultiples(mult);
        setSyncLog(log);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, []);

  const grid = dark ? "rgba(255,255,255,0.08)" : "#e2e8f0";
  const tick = dark ? "rgba(255,255,255,0.55)" : "#64748b";
  const gold = "#b8975a";
  const blue = dark ? "#7aa2f7" : "#3b82f6";
  const green = "#6abf8b";
  const orange = "#e07856";

  const fiveYearCutoff = useMemo(() => {
    const d = new Date();
    d.setFullYear(d.getFullYear() - 5);
    return d.toISOString().slice(0, 10);
  }, []);

  const unempRows = useMemo(
    () => filterSince(seriesToRows(obs.filter((o) => ["AZUR", "UNRATE"].includes(o.seriesId)), ["AZUR", "UNRATE"]), fiveYearCutoff),
    [obs, fiveYearCutoff]
  );
  const empRows = useMemo(
    () =>
      indexRows(
        filterSince(
          seriesToRows(
            obs.filter((o) => ["AZMFG", "AZCONS", "SMS04000006562000001"].includes(o.seriesId)),
            ["AZMFG", "AZCONS", "SMS04000006562000001"]
          ),
          fiveYearCutoff
        ),
        ["AZMFG", "AZCONS", "SMS04000006562000001"]
      ),
    [obs, fiveYearCutoff]
  );
  const permitRows = useMemo(
    () => filterSince(seriesToRows(obs.filter((o) => o.seriesId === "AZBPPRIV"), ["AZBPPRIV"]), fiveYearCutoff),
    [obs, fiveYearCutoff]
  );
  const hpiRows = useMemo(
    () =>
      indexRows(
        filterSince(
          seriesToRows(
            obs.filter((o) => ["AZSTHPI", "USSTHPI"].includes(o.seriesId)),
            ["AZSTHPI", "USSTHPI"]
          ),
          fiveYearCutoff
        ),
        ["AZSTHPI", "USSTHPI"]
      ),
    [obs, fiveYearCutoff]
  );

  const defenseRows = useMemo(() => {
    const rows = filterSince(
      seriesToRows(
        obs.filter((o) => ["AZ_DOD_CONTRACTS", "AZ_AEROSPACE_CONTRACTS"].includes(o.seriesId)),
        ["AZ_DOD_CONTRACTS", "AZ_AEROSPACE_CONTRACTS"]
      ),
      fiveYearCutoff
    );
    // display in $M
    return rows.map((r) => ({
      date: r.date,
      AZ_DOD_CONTRACTS: typeof r.AZ_DOD_CONTRACTS === "number" ? Math.round(r.AZ_DOD_CONTRACTS / 1e6) : null,
      AZ_AEROSPACE_CONTRACTS: typeof r.AZ_AEROSPACE_CONTRACTS === "number" ? Math.round(r.AZ_AEROSPACE_CONTRACTS / 1e6) : null,
    }));
  }, [obs, fiveYearCutoff]);

  const warnMonthly = useMemo(() => {
    const byMonth = new Map<string, number>();
    for (const w of warn) {
      if (!w.noticeDate || !w.headcount || w.noticeDate < fiveYearCutoff) continue;
      const m = `${w.noticeDate.slice(0, 7)}-01`;
      byMonth.set(m, (byMonth.get(m) || 0) + w.headcount);
    }
    return Array.from(byMonth.entries())
      .map(([date, workers]) => ({ date, workers }))
      .sort((a, b) => (a.date < b.date ? -1 : 1));
  }, [warn, fiveYearCutoff]);

  const spendRows = useMemo(() => {
    const cats: { id: string; label: string }[] = [
      { id: "AZ_SPEND_WELFARE", label: "Public welfare" },
      { id: "AZ_SPEND_EDUCATION", label: "Education" },
      { id: "AZ_SPEND_INSURANCE", label: "Insurance trust" },
      { id: "AZ_SPEND_HIGHWAYS", label: "Highways" },
      { id: "AZ_SPEND_CORRECTIONS", label: "Corrections" },
      { id: "AZ_SPEND_HEALTH", label: "Health" },
    ];
    const ids = ["AZ_STATE_EXPENDITURE", ...cats.map((c) => c.id)];
    const rows = seriesToRows(
      obs.filter((o) => ids.includes(o.seriesId)),
      ids
    );
    const toB = (v: unknown) => (typeof v === "number" ? Math.round(v / 1e5) / 10 : null);
    return rows.map((r) => {
      const out: Record<string, string | number | null> = { date: r.date.slice(0, 4) };
      let sum = 0;
      for (const c of cats) {
        const v = toB(r[c.id]);
        out[c.label] = v;
        if (v !== null) sum += v;
      }
      const total = toB(r.AZ_STATE_EXPENDITURE);
      out["Other"] = total !== null ? Math.round((total - sum) * 10) / 10 : null;
      out["Total"] = total;
      return out;
    });
  }, [obs]);

  const budgetRows = useMemo(() => {
    // Annual Census data (2017+) — show the full range, not the 5-yr window.
    const rows = seriesToRows(
      obs.filter((o) => ["AZ_STATE_REVENUE", "AZ_STATE_EXPENDITURE"].includes(o.seriesId)),
      ["AZ_STATE_REVENUE", "AZ_STATE_EXPENDITURE"]
    );
    // series are in $000s; display in $B
    const toB = (v: unknown) => (typeof v === "number" ? Math.round(v / 1e5) / 10 : null);
    return rows.map((r) => {
      const revenue = toB(r.AZ_STATE_REVENUE);
      const spending = toB(r.AZ_STATE_EXPENDITURE);
      return {
        date: r.date.slice(0, 4),
        Revenue: revenue,
        Spending: spending,
        Balance:
          revenue !== null && spending !== null
            ? Math.round((revenue - spending) * 10) / 10
            : null,
      };
    });
  }, [obs]);

  const statCards = useMemo(() => {
    const card = (id: string, label: string, format: (v: number) => string) => {
      const l = latest[id];
      if (!l || l.value === null) return null;
      const chg = yoyChange(obs, id);
      return { label, value: format(l.value), date: l.obsDate, chg };
    };
    // Combined unemployment bubble: AZ and US side by side in one card.
    const azUr = latest["AZUR"];
    const usUr = latest["UNRATE"];
    const unempCard =
      azUr && azUr.value !== null
        ? {
            label: "Unemployment — AZ / US",
            value: `${azUr.value.toFixed(1)}% / ${usUr && usUr.value !== null ? `${usUr.value.toFixed(1)}%` : "—"}`,
            date: azUr.obsDate,
            chg: yoyChange(obs, "AZUR"),
          }
        : null;
    return [
      unempCard,
      card("AZMFG", "AZ Manufacturing Jobs", (v) => `${Math.round(v)}k`),
      card("AZ_DOD_CONTRACTS", "AZ Defense Contracts/mo", (v) => `$${Math.round(v / 1e6)}M`),
    ].filter(Boolean) as { label: string; value: string; date: string; chg: number | null }[];
  }, [latest, obs]);

  const setStatus = async (kind: "acquisitions" | "filings", id: string, status: string) => {
    await fetch(`/api/market/${kind}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status }),
    });
    if (kind === "acquisitions") setAcquisitions((a) => a.map((x) => (x.id === id ? { ...x, status: status as MiAcquisition["status"] } : x)));
    if (kind === "filings") setFilings((a) => a.map((x) => (x.id === id ? { ...x, status: status as MiFiling["status"] } : x)));
  };

  /** Dismiss a major-event headline (persists on the underlying record). */
  const dismissHeadline = async (h: { source: "acquisitions" | "filings" | "warn"; rawId: string }) => {
    if (h.source === "warn") {
      await fetch("/api/market/warn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: h.rawId, status: "dismissed" }),
      });
      setWarn((w) => w.map((x) => (x.id === h.rawId ? { ...x, status: "dismissed" } : x)));
    } else {
      await setStatus(h.source, h.rawId, "dismissed");
    }
  };

  /** Section event strips: recent major events relevant to each section. */
  const dismissEvent = (a: MiAcquisition) => setStatus("acquisitions", a.id, "dismissed");
  const stripCutoff = new Date(Date.now() - 1 * 864e5).toISOString().slice(0, 10);
  const recentEvents = (pred: (a: MiAcquisition) => boolean, n = 3) =>
    acquisitions
      .filter((a) => a.status !== "dismissed" && a.announcedDate && a.announcedDate >= stripCutoff && pred(a))
      .sort((x, y) => (y.announcedDate || "").localeCompare(x.announcedDate || ""))
      .slice(0, n);
  const policyEvents = recentEvents((a) => a.eventType === "policy");
  const expansionEvents = recentEvents((a) => a.eventType === "expansion" || a.eventType === "relocation");
  const industryEvents = (industry: string) => recentEvents((a) => a.industry === industry);

  const healthRows = useMemo(
    () =>
      indexRows(
        filterSince(
          seriesToRows(obs.filter((o) => o.seriesId === "SMS04000006562000001"), ["SMS04000006562000001"]),
          fiveYearCutoff
        ),
        ["SMS04000006562000001"]
      ),
    [obs, fiveYearCutoff]
  );
  const mfgRows = useMemo(
    () =>
      indexRows(
        filterSince(seriesToRows(obs.filter((o) => o.seriesId === "AZMFG"), ["AZMFG"]), fiveYearCutoff),
        ["AZMFG"]
      ),
    [obs, fiveYearCutoff]
  );
  const consRows = useMemo(
    () =>
      indexRows(
        filterSince(seriesToRows(obs.filter((o) => o.seriesId === "AZCONS"), ["AZCONS"]), fiveYearCutoff),
        ["AZCONS"]
      ),
    [obs, fiveYearCutoff]
  );

  const filteredFilings = filingCat === "all" ? filings : filings.filter((f) => f.category === filingCat);
  const visibleAcq = acquisitions.filter((a) => a.status !== "dismissed" && a.eventType !== "bankruptcy");

  const multBands = useMemo(() => {
    const order = ["EV < $5M", "EV $5–25M", "EV $25–100M", "EV $100–500M", "EV > $500M"];
    const present = new Set(multiples.map((m) => m.sizeBand));
    return order.filter((b) => present.has(b));
  }, [multiples]);

  const multChartData = useMemo(() => {
    const byInd = new Map<string, MiMultiple>();
    for (const m of multiples) {
      if (m.sizeBand !== multBand) continue;
      const existing = byInd.get(m.industry);
      if (!existing || (m.period || "") > (existing.period || "")) byInd.set(m.industry, m);
    }
    const prettify = (s: string) =>
      s.split(/[_\-]+/).map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w)).join(" ");
    return Array.from(byInd.values())
      .map((m) => {
        const [top, sub] = m.industry.split("—").map((s) => s.trim());
        const prettySub = sub ? prettify(sub) : m.industry;
        return {
          industry: sub ? `${top}: ${prettySub}` : m.industry,
          short: prettySub,
          full: m.industry,
          value: multMetric === "ebitda" ? m.evEbitdaMedian : m.evRevenueMedian,
          notes: m.notes,
        };
      })
      .filter((d) => d.value !== null && d.value !== undefined)
      .sort((a, b) => (b.value as number) - (a.value as number));
  }, [multiples, multBand, multMetric]);

  const headlines = useMemo(() => {
    // Recency window: Major Events shows only the current day and the day
    // before — a "what just happened" feed refreshed by the daily ingest,
    // never a historical archive. Dismissed items can't backfill with older
    // news because nothing older is eligible.
    const cutoff = new Date(Date.now() - 1 * 864e5).toISOString().slice(0, 10);
    // Display-side quality gates (mirror the ingest filters so already-stored
    // junk disappears too): no commentary/stock/drama noise, and policy items
    // must be market policy — budgets, taxes, spending, incentives, funding.
    const JUNK =
      /\b(how to|what to know|opinion|editorial|podcast|webinar|sponsored|price target|dividend|earnings call|top \d+|best stocks?|stocks? to (buy|watch)|shares? (rise|risen|fall|fell|jump|drop|surge|plunge|slide|soar|climb|dip)|lawsuit|indicted|arrested|coupon|giveaway|campaign|endorses?|endorsement|poll (shows|says|finds)|slams|blasts|feud|scandal)\b/i;
    const MARKET_POLICY =
      /\b(budget|spending|tax|funding|funds|bond|incentive|appropriation|infrastructure|water|housing|economic|business|jobs|tariff|zoning|permit|development|revenue|fiscal|subsid|grant|loan|credit|semiconductor|energy|broadband)\b/i;
    const items: { id: string; kind: string; title: string; key: string; detail: string; summary: string; date: string; url: string; source: "acquisitions" | "filings" | "warn"; rawId: string }[] = [];
    const fmtVal = (v: number | null) =>
      v === null ? "" : v >= 1e9 ? ` · $${(v / 1e9).toFixed(1)}B` : v >= 1e6 ? ` · $${Math.round(v / 1e6)}M` : "";
    for (const a of acquisitions) {
      if (a.eventType === "bankruptcy" && a.status !== "dismissed" && a.announcedDate && a.announcedDate >= cutoff) {
        if (JUNK.test(a.summary || a.target)) continue;
        items.push({
          id: `news-${a.id}`,
          kind: "Bankruptcy",
          title: a.summary || a.target || "Unnamed company",
          key: a.target || a.summary || "",
          detail: `${a.publisher || "News"}${a.industry ? ` · ${a.industry}` : ""}`,
          summary: a.summary || "",
          date: a.announcedDate,
          url: a.sourceUrl,
          source: "acquisitions",
          rawId: a.id,
        });
      }
    }
    for (const f of filings) {
      if (f.majorEvent && f.azCompany && f.status !== "dismissed" && f.filingDate && f.filingDate >= cutoff) {
        items.push({
          id: `edgar-${f.id}`,
          kind: "8-K Bankruptcy",
          title: f.company || "Unnamed company",
          key: f.company || "",
          detail: `${f.form} · AZ company`,
          summary: f.summary || "",
          date: f.filingDate,
          url: f.url,
          source: "filings",
          rawId: f.id,
        });
      }
    }
    const byType = (t: string, n: number) =>
      acquisitions
        .filter((a) => {
          if (a.eventType !== t || a.status === "dismissed" || !a.announcedDate || a.announcedDate < cutoff) return false;
          const text = `${a.summary || ""} ${a.target || ""} ${a.acquirer || ""}`;
          if (JUNK.test(text)) return false;
          if (t === "policy" && !MARKET_POLICY.test(text)) return false;
          return true;
        })
        .sort((x, y) => (y.announcedDate || "").localeCompare(x.announcedDate || ""))
        .slice(0, n);
    const kindLabel: Record<string, string> = {
      acquisition: "Acquisition",
      expansion: "Major Expansion",
      investment: "New Investment",
      contract: "Contract Award",
      relocation: "Relocation",
      ipo: "IPO",
      policy: "Market Policy",
    };
    for (const t of ["acquisition", "expansion", "investment", "contract", "relocation", "ipo", "policy"] as const) {
      for (const a of byType(t, 2)) {
        items.push({
          id: `${t}-${a.id}`,
          kind: kindLabel[t],
          title: a.summary || (t === "acquisition" ? a.target || a.acquirer || "Unnamed deal" : a.target || "Unnamed"),
          key: a.target || a.summary || "",
          detail: `${a.acquirer && a.target && t === "acquisition" ? `${a.acquirer} → ${a.target} · ` : ""}${a.publisher || "News"}${a.industry ? ` · ${a.industry}` : ""}${fmtVal(a.dealValue ?? null)}`,
          summary: a.summary || "",
          date: a.announcedDate,
          url: a.sourceUrl,
          source: "acquisitions",
          rawId: a.id,
        });
      }
    }
    // Large layoffs
    const bigWarn = warn
      .filter((w) => (w.headcount ?? 0) >= 300 && w.status !== "dismissed" && w.noticeDate && w.noticeDate >= cutoff)
      .sort((x, y) => (y.noticeDate || "").localeCompare(x.noticeDate || ""))
      .slice(0, 2);
    for (const w of bigWarn) {
      items.push({
        id: `warn-${w.id}`,
        kind: "Major layoffs",
        title: w.employer,
        key: w.employer,
        detail: `${w.headcount} affected · ${w.location}${w.industry ? ` · ${w.industry}` : ""}`,
        summary: `${w.employer} filed a WARN notice for layoffs affecting ${w.headcount} employees in ${w.location}, Arizona${w.industry ? ` (${w.industry})` : ""}. Notice date ${w.noticeDate}.`,
        date: w.noticeDate,
        url: "",
        source: "warn",
        rawId: w.id,
      });
    }
    // Dedupe: the same event is often ingested several times (multiple news
    // queries/publishers). Collapse by normalized company + event kind,
    // keeping the most recent instance.
    const norm = (s: string) =>
      s
        .toLowerCase()
        .replace(/[^a-z0-9 ]/g, " ")
        .replace(/\b(inc|llc|ltd|corp|corporation|co|company|the|group|holdings)\b/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    const seen = new Set<string>();
    const deduped = items
      .sort((x, y) => (y.date || "").localeCompare(x.date || ""))
      .filter((it) => {
        // Coarse category so the same bankruptcy via news + 8-K still collapses.
        const cat = it.kind.toLowerCase().replace("8-k ", "").trim();
        const key = `${cat}|${norm(it.key || it.title)}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    return deduped.slice(0, 9);
  }, [acquisitions, filings, warn]);

  const chartCard = "rounded-xl border border-slate-200 bg-white p-4 dark:border-white/10 dark:bg-[#132847]/60";
  const tableWrap = "overflow-x-auto rounded-xl border border-slate-200 dark:border-white/10";
  const th = "px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-white/50";
  const td = "px-3 py-2 text-sm text-slate-700 dark:text-white/80";
  const tabBtn = (active: boolean) =>
    `rounded-lg px-3 py-1.5 text-sm font-medium ${active ? "bg-[#0d1f3c] text-white dark:bg-[#b8975a] dark:text-[#0d1f3c]" : "text-slate-600 hover:bg-slate-100 dark:text-white/60 dark:hover:bg-white/5"}`;

  return (
    <div className="min-h-screen">
      <PageHero eyebrow="Canny Capital Partners" title="Market Intel" subtitle="Arizona-focused investing" />

      <main className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6">
        {error && (
          <div className="mb-4 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
            Couldn&apos;t load market data: {error}. {error.includes("DATABASE_URL") ? "Market Intel needs the Postgres database." : "Data loads after the first daily ingest runs."}
          </div>
        )}

        {/* Stat cards */}
        <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {statCards.map((c) => (
            <div key={c.label} className="rounded-xl border border-slate-200 bg-white p-4 dark:border-white/10 dark:bg-[#132847]/60">
              <p className="text-xs font-medium uppercase tracking-wider text-slate-500 dark:text-white/50">{c.label}</p>
              <p className="mt-1 text-2xl font-bold text-[#0d1f3c] dark:text-white">{c.value}</p>
              <p className="mt-1 text-xs text-slate-400 dark:text-white/40">
                {c.date}
                {c.chg !== null && (
                  <span className={c.chg >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-500"}>
                    {" "}{c.chg >= 0 ? "▲" : "▼"} {Math.abs(c.chg).toFixed(1)}pp YoY
                  </span>
                )}
              </p>
            </div>
          ))}
          {statCards.length === 0 && !error && (
            <div className="col-span-4 rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500 dark:border-white/15 dark:text-white/40">
              No indicator data yet — it loads on the first daily ingest run.
            </div>
          )}
        </div>

        {/* Major-event headlines */}
        {headlines.length > 0 && (
          <div className="mb-6">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-[#0d1f3c] dark:text-white">
              Major events <span className="ml-1 rounded-full bg-slate-500/15 px-2 py-0.5 text-xs normal-case text-slate-600 dark:text-white/60">AZ only · last 2 days</span>
            </h2>
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
              {headlines.map((h) => {
                const isBankruptcy = h.kind === "Bankruptcy" || h.kind === "8-K Bankruptcy";
                const isDeal = h.kind === "Acquisition" || h.kind === "IPO" || h.kind === "New Investment";
                const isGrowth = h.kind === "Major Expansion" || h.kind === "Contract Award" || h.kind === "Relocation";
                const style = isBankruptcy
                  ? "border-red-200 bg-red-50/60 dark:border-red-500/25 dark:bg-red-500/10"
                  : isDeal
                    ? "border-emerald-200 bg-emerald-50/60 dark:border-emerald-500/25 dark:bg-emerald-500/10"
                    : isGrowth
                      ? "border-blue-200 bg-blue-50/60 dark:border-blue-500/25 dark:bg-blue-500/10"
                      : "border-amber-200 bg-amber-50/60 dark:border-amber-500/25 dark:bg-amber-500/10";
                const label = isBankruptcy
                  ? "text-red-700 dark:text-red-400"
                  : isDeal
                    ? "text-emerald-700 dark:text-emerald-400"
                    : isGrowth
                      ? "text-blue-700 dark:text-blue-400"
                      : "text-amber-700 dark:text-amber-400";
                return (
                  <div
                    key={h.id}
                    className={`relative rounded-xl border p-4 transition hover:shadow-md ${style}`}
                  >
                    <a
                      href={h.url || undefined}
                      target={h.url ? "_blank" : undefined}
                      rel="noreferrer"
                      className="block"
                    >
                      <p className={`text-xs font-semibold uppercase tracking-wider ${label}`}>{h.kind}</p>
                      <p className="mt-1 pr-5 text-base font-bold text-[#0d1f3c] dark:text-white">{h.title}</p>
                      <p className="mt-1 text-xs text-slate-500 dark:text-white/50">
                        {h.detail}{h.date ? ` · ${fmtDate(h.date)}` : ""}
                      </p>
                    </a>
                    {h.summary && (
                      <>
                        <button
                          onClick={() => setExpandedId((cur) => (cur === h.id ? null : h.id))}
                          aria-expanded={expandedId === h.id}
                          className={`mt-2 text-xs font-semibold ${label} hover:underline`}
                        >
                          {expandedId === h.id ? "Hide summary ▴" : "Summary ▾"}
                        </button>
                        {expandedId === h.id && (
                          <p className="mt-1.5 border-t border-black/5 pt-2 text-sm leading-relaxed text-slate-700 dark:border-white/10 dark:text-white/80">
                            {h.summary}
                          </p>
                        )}
                      </>
                    )}
                    <button
                      onClick={() => dismissHeadline(h)}
                      aria-label={`Dismiss ${h.title}`}
                      title="Dismiss"
                      className="absolute right-2 top-2 rounded-full px-1.5 py-0.5 text-sm leading-none text-slate-400 transition hover:bg-black/5 hover:text-slate-700 dark:text-white/40 dark:hover:bg-white/10 dark:hover:text-white"
                    >
                      ✕
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Sections — organized by data type; charts summarize, tables hold source data */}
        <Section title="Market Multiples" sub="Median deal multiples by industry and deal size — the valuation yardstick">
<div className={`${chartCard} lg:col-span-2`}>
          <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-[#0d1f3c] dark:text-white">Market Multiples by Industry</h3>
            <div className="flex flex-wrap gap-2">
              {(["ebitda", "revenue"] as const).map((v) => (
                <button key={v} onClick={() => setMultMetric(v)} className={tabBtn(multMetric === v)}>
                  {v === "ebitda" ? "EV/EBITDA" : "EV/Revenue"}
                </button>
              ))}
              {multBands.map((b) => (
                <button key={b} onClick={() => setMultBand(b)} className={tabBtn(multBand === b)}>{b}</button>
              ))}
            </div>
          </div>
          <p className="mb-3 text-xs text-slate-500 dark:text-white/40">
            Median {multMetric === "ebitda" ? "EV/EBITDA" : "EV/Revenue"} multiples, {multBand} deal size. Sources: ExitValue.ai open data + manual entries.
            {multMetric === "ebitda" && <span className="ml-1 italic">EBITDA data is sparse for smaller deals — try EV/Revenue or a larger band.</span>}
          </p>
          <div className="h-96">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={multChartData} layout="vertical" margin={{ top: 5, right: 20, left: 10, bottom: 0 }}>
                <CartesianGrid stroke={grid} strokeDasharray="3 3" />
                <XAxis type="number" tick={{ fontSize: 11, fill: tick }} />
                <YAxis
                  type="category"
                  dataKey={isMobile ? "short" : "industry"}
                  width={isMobile ? 118 : 230}
                  tick={{ fontSize: isMobile ? 11 : 12, fill: tick }}
                />
                <Tooltip
                  contentStyle={{ background: dark ? "#0d1f3c" : "#fff", border: `1px solid ${grid}`, fontSize: 12 }}
                  formatter={(v, _name, props) => [`${v}x`, (props?.payload as { full?: string })?.full || ""]}
                />
                <Bar dataKey="value" fill={gold} radius={[0, 4, 4, 0]} barSize={16} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          {multChartData.length === 0 && (
            <p className="py-4 text-center text-sm text-slate-400">No {multMetric === "ebitda" ? "EV/EBITDA" : "EV/Revenue"} data for this size band yet.</p>
          )}
        </div>
          <div className="mt-4">
            <MultiplesPanel multiples={multiples} onAdded={async () => setMultiples(await getJSON("/api/market/multiples"))} />
          </div>
        </Section>

        <Section title="Arizona Economic Data" sub="State-level indicators, budget, demographics, and permitting">
          <SubSection title="Economic Indicators">
            <div className="grid gap-4 lg:grid-cols-2">
<div className={chartCard}>
            <h3 className="mb-1 text-sm font-semibold text-[#0d1f3c] dark:text-white">Unemployment — AZ vs US</h3>
            <p className="mb-3 text-xs text-slate-500 dark:text-white/40">Monthly, %, FRED · 5-yr</p>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={unempRows} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
                  <CartesianGrid stroke={grid} strokeDasharray="3 3" />
                  <XAxis dataKey="date" tick={{ fontSize: 11, fill: tick }} tickFormatter={shortDate} minTickGap={40} />
                  <YAxis tick={{ fontSize: 11, fill: tick }} domain={["auto", "auto"]} />
                  <Tooltip
                    contentStyle={{ background: dark ? "#0d1f3c" : "#fff", border: `1px solid ${grid}`, fontSize: 12 }}
                    labelFormatter={(l) => String(l)}
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Line type="monotone" dataKey="AZUR" name="Arizona" stroke={gold} strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="UNRATE" name="US" stroke={blue} strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
<div className={chartCard}>
            <h3 className="mb-1 text-sm font-semibold text-[#0d1f3c] dark:text-white">AZ Employment by Sector</h3>
            <p className="mb-3 text-xs text-slate-500 dark:text-white/40">Indexed to 100, monthly, FRED · 5-yr</p>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={empRows} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
                  <CartesianGrid stroke={grid} strokeDasharray="3 3" />
                  <XAxis dataKey="date" tick={{ fontSize: 11, fill: tick }} tickFormatter={shortDate} minTickGap={40} />
                  <YAxis tick={{ fontSize: 11, fill: tick }} domain={["auto", "auto"]} />
                  <Tooltip contentStyle={{ background: dark ? "#0d1f3c" : "#fff", border: `1px solid ${grid}`, fontSize: 12 }} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Line type="monotone" dataKey="AZMFG" name="Manufacturing" stroke={gold} strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="AZCONS" name="Construction" stroke={orange} strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="SMS04000006562000001" name="Healthcare" stroke={green} strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
<div className={chartCard}>
            <h3 className="mb-1 text-sm font-semibold text-[#0d1f3c] dark:text-white">House Prices — AZ vs US</h3>
            <p className="mb-3 text-xs text-slate-500 dark:text-white/40">FHFA index, indexed to 100, quarterly, FRED · 5-yr</p>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={hpiRows} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
                  <CartesianGrid stroke={grid} strokeDasharray="3 3" />
                  <XAxis dataKey="date" tick={{ fontSize: 11, fill: tick }} tickFormatter={shortDate} minTickGap={50} />
                  <YAxis tick={{ fontSize: 11, fill: tick }} domain={["auto", "auto"]} />
                  <Tooltip contentStyle={{ background: dark ? "#0d1f3c" : "#fff", border: `1px solid ${grid}`, fontSize: 12 }} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Line type="monotone" dataKey="AZSTHPI" name="Arizona" stroke={gold} strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="USSTHPI" name="US" stroke={blue} strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
<div className={chartCard}>
            <h3 className="mb-1 text-sm font-semibold text-[#0d1f3c] dark:text-white">Latest Indicator Values</h3>
            <p className="mb-3 text-xs text-slate-500 dark:text-white/40">Source data behind the charts · FRED</p>
            <div className={tableWrap}>
              <table className="w-full border-collapse bg-white dark:bg-[#132847]/40">
                <thead><tr className="border-b border-slate-200 dark:border-white/10">
                  <th className={th}>Indicator</th><th className={th}>Latest</th><th className={th}>As of</th>
                </tr></thead>
                <tbody>
                  {["AZUR", "UNRATE", "AZMFG", "AZCONS", "SMS04000006562000001", "AZSTHPI", "USSTHPI", "PAYEMS"].map((id) => {
                    const l = latest[id];
                    if (!l) return null;
                    return (
                      <tr key={id} className="border-b border-slate-100 dark:border-white/5">
                        <td className={td}>{l.title}</td>
                        <td className={`${td} font-medium`}>{l.value !== null ? l.value.toLocaleString() : "—"}{l.units ? <span className="text-slate-400"> {l.units}</span> : ""}</td>
                        <td className={td}>{l.obsDate ? fmtDate(l.obsDate) : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
            </div>
          </SubSection>

          <SubSection title="State Revenue & Spending">
<div className={chartCard}>
          <h3 className="mb-1 text-sm font-semibold text-[#0d1f3c] dark:text-white">Revenue vs Spending</h3>
          <p className="mb-3 text-xs text-slate-500 dark:text-white/40">
            Annual, $B, Census Annual Survey of State &amp; Local Government Finances (state government only). Census notes the gap isn&apos;t a formal surplus/deficit, but it shows the fiscal trend.
          </p>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={budgetRows} margin={{ top: 5, right: 10, left: -5, bottom: 0 }}>
                <CartesianGrid stroke={grid} strokeDasharray="3 3" />
                <XAxis dataKey="date" tick={{ fontSize: 11, fill: tick }} />
                <YAxis tick={{ fontSize: 11, fill: tick }} />
                <Tooltip
                  contentStyle={{ background: dark ? "#0d1f3c" : "#fff", border: `1px solid ${grid}`, fontSize: 12 }}
                  formatter={(v, name) => [`$${v}B`, name]}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="Revenue" fill={green} radius={[2, 2, 0, 0]} />
                <Bar dataKey="Spending" fill={gold} radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className={`${tableWrap} mt-4`}>
            <table className="w-full border-collapse bg-white dark:bg-[#132847]/40">
              <thead><tr className="border-b border-slate-200 dark:border-white/10">
                <th className={th}>Year</th><th className={th}>Revenue</th><th className={th}>Spending</th><th className={th}>Balance</th>
              </tr></thead>
              <tbody>
                {[...budgetRows].reverse().map((r) => (
                  <tr key={r.date} className="border-b border-slate-100 dark:border-white/5">
                    <td className={`${td} font-medium`}>{r.date}</td>
                    <td className={td}>{r.Revenue !== null ? `$${r.Revenue}B` : "—"}</td>
                    <td className={td}>{r.Spending !== null ? `$${r.Spending}B` : "—"}</td>
                    <td className={`${td} ${r.Balance !== null && r.Balance < 0 ? "text-red-500" : "text-emerald-600 dark:text-emerald-400"}`}>
                      {r.Balance !== null ? `${r.Balance > 0 ? "+" : ""}$${r.Balance}B` : "—"}
                    </td>
                  </tr>
                ))}
                {budgetRows.length === 0 && <tr><td className={td} colSpan={4}>Budget data appears after the next ingest with CENSUS_KEY set.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
<div className={`${chartCard} mt-4`}>
          <h3 className="mb-1 text-sm font-semibold text-[#0d1f3c] dark:text-white">Where the Spending Goes</h3>
          <p className="mb-3 text-xs text-slate-500 dark:text-white/40">
            State expenditure by function, $B · Census. Public welfare is mostly Medicaid (AHCCCS); insurance trust is mainly state employee retirement payouts. &quot;Other&quot; covers everything else — debt interest, administration, police, natural resources, and smaller functions.
          </p>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={spendRows} margin={{ top: 5, right: 10, left: -5, bottom: 0 }}>
                <CartesianGrid stroke={grid} strokeDasharray="3 3" />
                <XAxis dataKey="date" tick={{ fontSize: 11, fill: tick }} />
                <YAxis tick={{ fontSize: 11, fill: tick }} />
                <Tooltip
                  contentStyle={{ background: dark ? "#0d1f3c" : "#fff", border: `1px solid ${grid}`, fontSize: 12 }}
                  formatter={(v, name) => [`$${v}B`, name]}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="Public welfare" stackId="spend" fill={blue} />
                <Bar dataKey="Education" stackId="spend" fill={gold} />
                <Bar dataKey="Insurance trust" stackId="spend" fill={green} />
                <Bar dataKey="Highways" stackId="spend" fill={orange} />
                <Bar dataKey="Corrections" stackId="spend" fill="#a855f7" />
                <Bar dataKey="Health" stackId="spend" fill="#14b8a6" />
                <Bar dataKey="Other" stackId="spend" fill="#94a3b8" radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          {spendRows.length > 0 && (
            <div className={`${tableWrap} mt-4`}>
              <table className="w-full border-collapse bg-white dark:bg-[#132847]/40">
                <thead><tr className="border-b border-slate-200 dark:border-white/10">
                  <th className={th}>Category ({spendRows[spendRows.length - 1].date})</th><th className={th}>Amount</th><th className={th}>Share</th>
                </tr></thead>
                <tbody>
                  {["Public welfare", "Education", "Insurance trust", "Highways", "Corrections", "Health", "Other"].map((label) => {
                    const last = spendRows[spendRows.length - 1];
                    const v = last[label] as number | null;
                    const total = last["Total"] as number | null;
                    return (
                      <tr key={label} className="border-b border-slate-100 dark:border-white/5">
                        <td className={`${td} font-medium`}>{label}</td>
                        <td className={td}>{v !== null ? `$${v}B` : "—"}</td>
                        <td className={td}>{v !== null && total ? `${Math.round((v / total) * 1000) / 10}%` : "—"}</td>
                      </tr>
                    );
                  })}
                  <tr className="border-t-2 border-slate-200 dark:border-white/15">
                    <td className={`${td} font-bold`}>Total expenditure</td>
                    <td className={`${td} font-bold`}>{spendRows[spendRows.length - 1]["Total"] !== null ? `$${spendRows[spendRows.length - 1]["Total"]}B` : "—"}</td>
                    <td className={td}>100%</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </div>
            <EventStrip items={policyEvents} onDismiss={dismissEvent} />
          </SubSection>

          <SubSection title="Demographics">
<div className={`${chartCard} lg:col-span-2`}>
          <h3 className="mb-1 text-sm font-semibold text-[#0d1f3c] dark:text-white">Valley Demographics — Maricopa County</h3>
          <p className="mb-3 text-xs text-slate-500 dark:text-white/40">
            Census tract view of where age and wealth concentrate, plus population growth ’19–’23. Click any tract for details.
          </p>
          <ValleyDemographics />
        </div>
          </SubSection>

          <SubSection title="Permitting & Licensing">
            <div className="grid gap-4 lg:grid-cols-2">
<div className={chartCard}>
            <h3 className="mb-1 text-sm font-semibold text-[#0d1f3c] dark:text-white">AZ Housing Permits</h3>
            <p className="mb-3 text-xs text-slate-500 dark:text-white/40">New private units authorized, monthly, FRED · 5-yr</p>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={permitRows} margin={{ top: 5, right: 10, left: -5, bottom: 0 }}>
                  <CartesianGrid stroke={grid} strokeDasharray="3 3" />
                  <XAxis dataKey="date" tick={{ fontSize: 11, fill: tick }} tickFormatter={shortDate} minTickGap={50} />
                  <YAxis tick={{ fontSize: 11, fill: tick }} />
                  <Tooltip contentStyle={{ background: dark ? "#0d1f3c" : "#fff", border: `1px solid ${grid}`, fontSize: 12 }} />
                  <Line type="monotone" dataKey="AZBPPRIV" name="Permits" stroke={gold} strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
<div className={chartCard}>
            <h3 className="mb-1 text-sm font-semibold text-[#0d1f3c] dark:text-white">Permits — Recent Months</h3>
            <p className="mb-3 text-xs text-slate-500 dark:text-white/40">Source data · FRED AZBPPRIV</p>
            <div className={tableWrap}>
              <table className="w-full border-collapse bg-white dark:bg-[#132847]/40">
                <thead><tr className="border-b border-slate-200 dark:border-white/10">
                  <th className={th}>Month</th><th className={th}>Units authorized</th>
                </tr></thead>
                <tbody>
                  {[...permitRows].slice(-12).reverse().map((r) => (
                    <tr key={r.date} className="border-b border-slate-100 dark:border-white/5">
                      <td className={td}>{shortDate(r.date)}</td>
                      <td className={`${td} font-medium`}>{typeof r.AZBPPRIV === "number" ? r.AZBPPRIV.toLocaleString() : "—"}</td>
                    </tr>
                  ))}
                  {permitRows.length === 0 && <tr><td className={td} colSpan={2}>No permit data yet.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
            </div>
            <EventStrip items={expansionEvents} onDismiss={dismissEvent} />
          </SubSection>
        </Section>

        <Section title="Industry" sub="Focus sectors: aerospace & defense, healthcare, manufacturing, trades">
          <SubSection title="Aerospace & Defense">
            <div className="grid gap-4 lg:grid-cols-2">
<div className={chartCard}>
            <h3 className="mb-1 text-sm font-semibold text-[#0d1f3c] dark:text-white">Defense Contracts — Arizona</h3>
            <p className="mb-3 text-xs text-slate-500 dark:text-white/40">Monthly obligations, $M, USASpending.gov · 5-yr</p>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={defenseRows} margin={{ top: 5, right: 10, left: -5, bottom: 0 }}>
                  <CartesianGrid stroke={grid} strokeDasharray="3 3" />
                  <XAxis dataKey="date" tick={{ fontSize: 11, fill: tick }} tickFormatter={shortDate} minTickGap={50} />
                  <YAxis tick={{ fontSize: 11, fill: tick }} />
                  <Tooltip contentStyle={{ background: dark ? "#0d1f3c" : "#fff", border: `1px solid ${grid}`, fontSize: 12 }} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="AZ_DOD_CONTRACTS" name="All DoD ($M)" fill={blue} radius={[2, 2, 0, 0]} />
                  <Bar dataKey="AZ_AEROSPACE_CONTRACTS" name="Aerospace NAICS 3364 ($M)" fill={gold} radius={[2, 2, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
<div className={chartCard}>
            <h3 className="mb-1 text-sm font-semibold text-[#0d1f3c] dark:text-white">Contracts — Recent Months</h3>
            <p className="mb-3 text-xs text-slate-500 dark:text-white/40">Source data · USASpending.gov, $M</p>
            <div className={tableWrap}>
              <table className="w-full border-collapse bg-white dark:bg-[#132847]/40">
                <thead><tr className="border-b border-slate-200 dark:border-white/10">
                  <th className={th}>Month</th><th className={th}>All DoD</th><th className={th}>Aerospace</th>
                </tr></thead>
                <tbody>
                  {[...defenseRows].slice(-12).reverse().map((r) => (
                    <tr key={r.date} className="border-b border-slate-100 dark:border-white/5">
                      <td className={td}>{shortDate(r.date)}</td>
                      <td className={`${td} font-medium`}>{typeof r.AZ_DOD_CONTRACTS === "number" ? `$${r.AZ_DOD_CONTRACTS.toLocaleString()}M` : "—"}</td>
                      <td className={td}>{typeof r.AZ_AEROSPACE_CONTRACTS === "number" ? `$${r.AZ_AEROSPACE_CONTRACTS.toLocaleString()}M` : "—"}</td>
                    </tr>
                  ))}
                  {defenseRows.length === 0 && <tr><td className={td} colSpan={3}>No contract data yet.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
            </div>
            <EventStrip items={industryEvents("Aerospace & Defense")} onDismiss={dismissEvent} />
          </SubSection>

          <SubSection title="Healthcare">
            <div className="grid gap-4 lg:grid-cols-2">
          <div className={chartCard}>
            <h3 className="mb-1 text-sm font-semibold text-[#0d1f3c] dark:text-white">Healthcare Employment — AZ</h3>
            <p className="mb-3 text-xs text-slate-500 dark:text-white/40">Indexed to 100, monthly, FRED · 5-yr</p>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={healthRows} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
                  <CartesianGrid stroke={grid} strokeDasharray="3 3" />
                  <XAxis dataKey="date" tick={{ fontSize: 11, fill: tick }} tickFormatter={shortDate} minTickGap={40} />
                  <YAxis tick={{ fontSize: 11, fill: tick }} domain={["auto", "auto"]} />
                  <Tooltip contentStyle={{ background: dark ? "#0d1f3c" : "#fff", border: `1px solid ${grid}`, fontSize: 12 }} />
                  <Line type="monotone" dataKey="SMS04000006562000001" name="Healthcare" stroke={green} strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
            </div>
            <EventStrip items={industryEvents("Healthcare")} onDismiss={dismissEvent} />
          </SubSection>

          <SubSection title="Advanced Manufacturing">
            <div className="grid gap-4 lg:grid-cols-2">
          <div className={chartCard}>
            <h3 className="mb-1 text-sm font-semibold text-[#0d1f3c] dark:text-white">Manufacturing Employment — AZ</h3>
            <p className="mb-3 text-xs text-slate-500 dark:text-white/40">Indexed to 100, monthly, FRED · 5-yr</p>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={mfgRows} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
                  <CartesianGrid stroke={grid} strokeDasharray="3 3" />
                  <XAxis dataKey="date" tick={{ fontSize: 11, fill: tick }} tickFormatter={shortDate} minTickGap={40} />
                  <YAxis tick={{ fontSize: 11, fill: tick }} domain={["auto", "auto"]} />
                  <Tooltip contentStyle={{ background: dark ? "#0d1f3c" : "#fff", border: `1px solid ${grid}`, fontSize: 12 }} />
                  <Line type="monotone" dataKey="AZMFG" name="Manufacturing" stroke={gold} strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
            </div>
            <EventStrip items={industryEvents("Advanced Manufacturing")} onDismiss={dismissEvent} />
          </SubSection>

          <SubSection title="Specialty Trades & Construction">
            <div className="grid gap-4 lg:grid-cols-2">
          <div className={chartCard}>
            <h3 className="mb-1 text-sm font-semibold text-[#0d1f3c] dark:text-white">Construction Employment — AZ</h3>
            <p className="mb-3 text-xs text-slate-500 dark:text-white/40">Indexed to 100, monthly, FRED · 5-yr</p>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={consRows} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
                  <CartesianGrid stroke={grid} strokeDasharray="3 3" />
                  <XAxis dataKey="date" tick={{ fontSize: 11, fill: tick }} tickFormatter={shortDate} minTickGap={40} />
                  <YAxis tick={{ fontSize: 11, fill: tick }} domain={["auto", "auto"]} />
                  <Tooltip contentStyle={{ background: dark ? "#0d1f3c" : "#fff", border: `1px solid ${grid}`, fontSize: 12 }} />
                  <Line type="monotone" dataKey="AZCONS" name="Construction" stroke={orange} strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
            </div>
            <EventStrip items={industryEvents("Specialty Trades & Construction")} onDismiss={dismissEvent} />
          </SubSection>
        </Section>

        <Section title="Layoffs & WARN Notices" sub="Announced layoffs — often precede sales">
          <div className="mb-4 grid gap-4 lg:grid-cols-2">
<div className={chartCard}>
            <h3 className="mb-1 text-sm font-semibold text-[#0d1f3c] dark:text-white">AZ Layoff Notices (WARN)</h3>
            <p className="mb-3 text-xs text-slate-500 dark:text-white/40">Workers affected per month · 5-yr</p>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={warnMonthly} margin={{ top: 5, right: 10, left: -5, bottom: 0 }}>
                  <CartesianGrid stroke={grid} strokeDasharray="3 3" />
                  <XAxis dataKey="date" tick={{ fontSize: 11, fill: tick }} tickFormatter={shortDate} minTickGap={50} />
                  <YAxis tick={{ fontSize: 11, fill: tick }} />
                  <Tooltip contentStyle={{ background: dark ? "#0d1f3c" : "#fff", border: `1px solid ${grid}`, fontSize: 12 }} />
                  <Bar dataKey="workers" name="Workers affected" fill={orange} radius={[2, 2, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
          </div>
<div className={tableWrap}>
            <table className="w-full border-collapse bg-white dark:bg-[#132847]/40">
              <thead><tr className="border-b border-slate-200 dark:border-white/10">
                <th className={th}>Employer</th><th className={th}>Industry</th><th className={th}>Location</th><th className={th}>Affected</th><th className={th}>Notice date</th>
              </tr></thead>
              <tbody>
                {warn.map((w) => (
                  <tr key={w.id} className="border-b border-slate-100 dark:border-white/5">
                    <td className={`${td} font-medium`}>{w.employer}</td>
                    <td className={td}>{w.industry && <span className="rounded-full bg-[#b8975a]/15 px-2 py-0.5 text-xs text-[#8a6f3e] dark:text-[#d4b37a]">{w.industry}</span>}</td>
                    <td className={td}>{w.location}</td>
                    <td className={td}>{w.headcount ?? "—"}</td>
                    <td className={td}>{w.noticeDate ? fmtDate(w.noticeDate) : "—"}</td>
                  </tr>
                ))}
                {warn.length === 0 && <tr><td className={td} colSpan={5}>No WARN notices loaded yet.</td></tr>}
              </tbody>
            </table>
            <p className="px-3 py-2 text-xs text-slate-400 dark:text-white/30">Layoffs often precede sales — worth a look when a target-industry employer appears. Source: WARN Act notices dataset.</p>
          </div>
        </Section>

        <Section title="Deals & Filings" sub="AZ acquisitions and SEC filings">
          <div>
{/* Tabs */}
        <div className="mb-4 flex flex-wrap gap-2">
          {(TABS as readonly string[]).map((t) => (
            <button key={t} onClick={() => setTab(t as Tab)} className={tabBtn(tab === t)}>
              {t === "acquisitions" ? "Acquisitions" : t === "filings" ? "Filings" : t}
            </button>
          ))}
        </div>

        {tab === "acquisitions" && (
          <div className={tableWrap}>
            <table className="w-full border-collapse bg-white dark:bg-[#132847]/40">
              <thead><tr className="border-b border-slate-200 dark:border-white/10">
                <th className={th}>Acquirer → Target</th><th className={th}>Industry</th><th className={th}>Announced</th><th className={th}>Source</th><th className={th}></th>
              </tr></thead>
              <tbody>
                {visibleAcq.map((a) => (
                  <tr key={a.id} className="border-b border-slate-100 dark:border-white/5">
                    <td className={td}>
                      <span className="font-medium">{a.acquirer || "—"}</span>
                      <span className="text-slate-400"> → </span>
                      <span>{a.target}</span>
                      {a.targetLocation && <span className="text-slate-400 dark:text-white/40"> ({a.targetLocation})</span>}
                    </td>
                    <td className={td}>{a.industry && <span className="rounded-full bg-[#b8975a]/15 px-2 py-0.5 text-xs text-[#8a6f3e] dark:text-[#d4b37a]">{a.industry}</span>}</td>
                    <td className={td}>{a.announcedDate ? fmtDate(a.announcedDate) : "—"}</td>
                    <td className={td}>{a.sourceUrl ? <a href={a.sourceUrl} target="_blank" rel="noreferrer" className="text-[#8a6f3e] underline dark:text-[#d4b37a]">{a.publisher || "Link"}</a> : "—"}</td>
                    <td className={`${td} whitespace-nowrap`}>
                      <button onClick={() => setStatus("acquisitions", a.id, "keep")} className="mr-2 text-xs text-emerald-600 dark:text-emerald-400">Keep</button>
                      <button onClick={() => setStatus("acquisitions", a.id, "dismissed")} className="text-xs text-slate-400">Dismiss</button>
                    </td>
                  </tr>
                ))}
                {visibleAcq.length === 0 && <tr><td className={td} colSpan={5}>No acquisitions tracked yet — they appear after the first daily ingest.</td></tr>}
              </tbody>
            </table>
          </div>
        )}

        {tab === "filings" && (
          <div>
            <div className="mb-3 flex flex-wrap gap-2">
              {[["all", "All"], ["acquisition", "M&A 8-Ks"], ["form_d", "Form D"], ["expansion", "Expansion"], ["bankruptcy", "Bankruptcies"]].map(([v, l]) => (
                <button key={v} onClick={() => setFilingCat(v)} className={tabBtn(filingCat === v)}>{l}</button>
              ))}
            </div>
            <div className={tableWrap}>
              <table className="w-full border-collapse bg-white dark:bg-[#132847]/40">
                <thead><tr className="border-b border-slate-200 dark:border-white/10">
                  <th className={th}>Company</th><th className={th}>Form</th><th className={th}>Filed</th><th className={th}>Summary</th><th className={th}></th>
                </tr></thead>
                <tbody>
                  {filteredFilings.filter((f) => f.status !== "dismissed").map((f) => (
                    <tr key={f.id} className="border-b border-slate-100 dark:border-white/5">
                      <td className={td}>
                        {f.url ? <a href={f.url} target="_blank" rel="noreferrer" className="font-medium text-[#8a6f3e] underline dark:text-[#d4b37a]">{f.company}</a> : <span className="font-medium">{f.company}</span>}
                        <span className="block text-xs">
                          {f.azCompany && <span className="mr-1 rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-emerald-700 dark:text-emerald-400">AZ company</span>}
                          {f.majorEvent && <span className="rounded-full bg-red-500/15 px-1.5 py-0.5 text-red-700 dark:text-red-400">Major event</span>}
                        </span>
                      </td>
                      <td className={td}><span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs dark:bg-white/10">{f.form}</span></td>
                      <td className={td}>{f.filingDate ? fmtDate(f.filingDate) : "—"}</td>
                      <td className={`${td} max-w-md truncate`}>{f.summary || "—"}</td>
                      <td className={`${td} whitespace-nowrap`}>
                        <button onClick={() => setStatus("filings", f.id, "keep")} className="mr-2 text-xs text-emerald-600 dark:text-emerald-400">Keep</button>
                        <button onClick={() => setStatus("filings", f.id, "dismissed")} className="text-xs text-slate-400">Dismiss</button>
                      </td>
                    </tr>
                  ))}
                  {filteredFilings.length === 0 && <tr><td className={td} colSpan={5}>No filings yet — they appear after the first daily ingest.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        )}

          </div>
        </Section>

        {/* Sync status */}
        {syncLog.length > 0 && (
          <div className="mt-6 rounded-xl border border-slate-200 bg-white p-4 dark:border-white/10 dark:bg-[#132847]/40">
            <h3 className="mb-2 text-sm font-semibold text-[#0d1f3c] dark:text-white">Data freshness</h3>
            <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-slate-500 dark:text-white/50">
              {syncLog.slice(0, 8).map((s) => (
                <span key={s.id}>
                  <span className={s.status === "ok" ? "text-emerald-600 dark:text-emerald-400" : s.status === "skipped" ? "text-amber-500" : "text-red-500"}>●</span>{" "}
                  {s.job}: {fmtDate(s.ranAt.slice(0, 10))}{s.added ? ` (+${s.added})` : ""}{s.message ? ` — ${s.message}` : ""}
                </span>
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

/* ---------------- multiples panel ---------------- */

function MultiplesPanel({ multiples, onAdded }: { multiples: MiMultiple[]; onAdded: () => void }) {
  const [form, setForm] = useState({ sourceReport: "", period: "", industry: "", sizeBand: "", evEbitdaLow: "", evEbitdaHigh: "", evEbitdaMedian: "", evRevenueMedian: "", notes: "" });
  const [saving, setSaving] = useState(false);
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const input = "rounded-lg border border-slate-300 px-2 py-1.5 text-sm dark:border-white/15 dark:bg-white/5 dark:text-white";

  const save = async () => {
    if (!form.sourceReport || !form.period) return;
    setSaving(true);
    await fetch("/api/market/multiples", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...form,
        evEbitdaLow: form.evEbitdaLow ? Number(form.evEbitdaLow) : null,
        evEbitdaHigh: form.evEbitdaHigh ? Number(form.evEbitdaHigh) : null,
        evEbitdaMedian: form.evEbitdaMedian ? Number(form.evEbitdaMedian) : null,
        evRevenueMedian: form.evRevenueMedian ? Number(form.evRevenueMedian) : null,
      }),
    });
    setForm({ sourceReport: "", period: "", industry: "", sizeBand: "", evEbitdaLow: "", evEbitdaHigh: "", evEbitdaMedian: "", evRevenueMedian: "", notes: "" });
    setSaving(false);
    onAdded();
  };

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-white/10 dark:bg-[#132847]/40">
        <h3 className="mb-3 text-sm font-semibold text-[#0d1f3c] dark:text-white">Log multiples</h3>
        <p className="mb-3 text-xs text-slate-500 dark:text-white/40">From quarterly IB reports (PitchBook, BDO, Houlihan Lokey…). Enter once per report and it stays on the charts forever.</p>
        <div className="grid grid-cols-2 gap-2">
          <input className={input} placeholder="Report (e.g. PitchBook Q3)" value={form.sourceReport} onChange={set("sourceReport")} />
          <input className={input} placeholder="Period (e.g. 2026-Q3)" value={form.period} onChange={set("period")} />
          <input className={input} placeholder="Industry" value={form.industry} onChange={set("industry")} />
          <input className={input} placeholder="Size band" value={form.sizeBand} onChange={set("sizeBand")} />
          <input className={input} placeholder="EV/EBITDA low" value={form.evEbitdaLow} onChange={set("evEbitdaLow")} />
          <input className={input} placeholder="EV/EBITDA high" value={form.evEbitdaHigh} onChange={set("evEbitdaHigh")} />
          <input className={input} placeholder="EV/EBITDA median" value={form.evEbitdaMedian} onChange={set("evEbitdaMedian")} />
          <input className={input} placeholder="EV/Rev median" value={form.evRevenueMedian} onChange={set("evRevenueMedian")} />
          <input className={`${input} col-span-2`} placeholder="Notes" value={form.notes} onChange={set("notes")} />
        </div>
        <button onClick={save} disabled={saving || !form.sourceReport || !form.period} className="mt-3 rounded-lg bg-[#0d1f3c] px-4 py-1.5 text-sm font-medium text-white disabled:opacity-40 dark:bg-[#b8975a] dark:text-[#0d1f3c]">
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
      <div className="lg:col-span-2 overflow-x-auto rounded-xl border border-slate-200 dark:border-white/10">
        <table className="w-full border-collapse bg-white dark:bg-[#132847]/40">
          <thead><tr className="border-b border-slate-200 dark:border-white/10">
            <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-white/50">Report</th>
            <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-white/50">Period</th>
            <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-white/50">Industry</th>
            <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-white/50">EV/EBITDA</th>
            <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-white/50">EV/Rev</th>
          </tr></thead>
          <tbody>
            {multiples.map((m) => (
              <tr key={m.id} className="border-b border-slate-100 dark:border-white/5">
                <td className="px-3 py-2 text-sm font-medium text-slate-700 dark:text-white/80">{m.sourceReport}{m.sizeBand && <span className="block text-xs text-slate-400">{m.sizeBand}</span>}</td>
                <td className="px-3 py-2 text-sm text-slate-700 dark:text-white/80">{m.period}</td>
                <td className="px-3 py-2 text-sm text-slate-700 dark:text-white/80">{m.industry || "—"}</td>
                <td className="px-3 py-2 text-sm text-slate-700 dark:text-white/80">
                  {m.evEbitdaMedian ? `${m.evEbitdaMedian}x` : m.evEbitdaLow && m.evEbitdaHigh ? `${m.evEbitdaLow}–${m.evEbitdaHigh}x` : "—"}
                </td>
                <td className="px-3 py-2 text-sm text-slate-700 dark:text-white/80">{m.evRevenueMedian ? `${m.evRevenueMedian}x` : "—"}</td>
              </tr>
            ))}
            {multiples.length === 0 && <tr><td className="px-3 py-2 text-sm text-slate-500 dark:text-white/40" colSpan={5}>No multiples logged yet — add them from quarterly reports as they publish.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

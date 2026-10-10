"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import PageHero from "@/components/PageHero";
import SizeProfileRow, { hasSizeProfile, SUBSECTOR_IDS_CSV } from "@/components/SizeProfileRows";
import CompanyTargets from "@/components/CompanyTargets";
import IndustryExplorer from "@/components/IndustryExplorer";
import FitTargets from "@/components/FitTargets";
import { Section, SubSection, FullSection, EventStrip } from "@/components/market-sections";
import UpdatesStrip from "@/components/UpdatesStrip";
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

/** Stored rows ingested before RSS entity decoding may contain &amp; etc. */
function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/&nbsp;/g, " ");
}

/** Arizona's 15 counties; housing permits come from U of A EBRC county tables. */
const PERMIT_COUNTIES = [
  "Apache", "Cochise", "Coconino", "Gila", "Graham", "Greenlee", "La Paz",
  "Maricopa", "Mohave", "Navajo", "Pima", "Pinal", "Santa Cruz", "Yavapai", "Yuma",
] as const;
const countySlug = (name: string) => name.replace(/[^A-Za-z]/g, "").toUpperCase();
const SECTOR_SLUGS = ["11", "21", "22", "23", "3133", "3364", "42", "4445", "4849", "51", "52", "53", "54", "55", "56", "61", "62", "71", "72", "81"];
const SECTOR_SERIES = SECTOR_SLUGS.map((s) => `CBP_AZ_SEC_${s}_ESTAB,CBP_AZ_SEC_${s}_EMP`).join(",");
const SECTOR_SHORT: Record<string, string> = {
  "11": "Agriculture", "21": "Mining & Oil/Gas", "22": "Utilities", "23": "Construction",
  "3133": "Manufacturing", "3364": "Aerospace & Defense", "42": "Wholesale", "4445": "Retail",
  "4849": "Transport & Warehousing", "51": "Information", "52": "Finance & Insurance",
  "53": "Real Estate", "54": "Professional Services", "55": "Management",
  "56": "Admin & Waste", "61": "Education", "62": "Healthcare",
  "71": "Arts & Recreation", "72": "Hospitality & Food", "81": "Other Services",
};
const CHART_COLORS = ["#b8975a", "#0d1f3c", "#54708f", "#8a6f3c", "#7d94b5", "#d4b37a", "#33507c", "#a9b8cc"];
/** Commodity prices Arizona's economy depends on (FRED: IMF metals, EIA energy, PPI lumber). */
const COMMODITY_SERIES: { id: string; name: string; unit: string; digits: number }[] = [
  { id: "PCOPPUSDM", name: "Copper", unit: "$/metric ton", digits: 0 },
  { id: "MCOILWTICO", name: "WTI Crude Oil", unit: "$/barrel", digits: 2 },
  { id: "MHHNGSP", name: "Natural Gas", unit: "$/MMBtu", digits: 2 },
  { id: "WPU081", name: "Lumber & Wood Products", unit: "PPI index", digits: 1 },
  { id: "WPU01220101", name: "Cotton (raw)", unit: "PPI index", digits: 1 },
  { id: "WPU0121", name: "Hay & Forage (alfalfa)", unit: "PPI index", digits: 1 },
];
const COMMODITY_IDS = COMMODITY_SERIES.map((c) => c.id).join(",");
/** Exchange spot prices (Yahoo futures) paired with the FRED monthly
 * benchmarks above: chips show the spot price people actually quote; the
 * FRED series remain the long-history benchmarks, and the daily ingest
 * reconciles the two (commodity-xcheck in Data freshness). */
const SPOT_BY_FRED: Record<string, { id: string; venue: string; unit: string; digits: number }> = {
  PCOPPUSDM: { id: "SPOT_COPPER", venue: "COMEX", unit: "$/lb", digits: 2 },
  MCOILWTICO: { id: "SPOT_WTI", venue: "NYMEX", unit: "$/bbl", digits: 2 },
  MHHNGSP: { id: "SPOT_NATGAS", venue: "NYMEX", unit: "$/MMBtu", digits: 2 },
  WPU01220101: { id: "SPOT_COTTON", venue: "ICE", unit: "¢/lb", digits: 1 },
};
const SPOT_IDS = Object.values(SPOT_BY_FRED).map((s) => s.id).join(",");
/** SUSB business-size profiles (rendered by components/SizeProfileRows). */
const SUSB_SLUGS = ["TOTAL", "23", "3133", "62", "3364"];
const SUSB_IDS = SUSB_SLUGS.flatMap((s) => [
  `SUSB_AZ_${s}_FIRMS`,
  `SUSB_AZ_${s}_ESTAB`,
  `SUSB_AZ_${s}_EMP`,
  `SUSB_AZ_${s}_RCPT`,
  `QCEW_AZ_${s}_ESTAB`,
  `DAMO_EBITDA_MARGIN_${s}`,
  ...Array.from({ length: 17 }, (_, i) => `SUSB_AZ_${s}_CLS${String(i + 2).padStart(2, "0")}`),
]).join(",");

const COUNTY_PERMIT_SERIES = PERMIT_COUNTIES.flatMap((n) => [
  `AZPERMIT_${countySlug(n)}`,
  `AZPERMIT_SF_${countySlug(n)}`,
]).join(",");
const fmtMonth = (iso: string) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString("en-US", { month: "short", year: "numeric" });

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

/** Display-side quality gates for event headlines (mirror the ingest
 * filters): no commentary/stock/drama noise; policy items must be market
 * policy — budgets, taxes, spending, incentives, funding. */
const JUNK =
  /\b(how to|what to know|opinion|editorial|podcast|webinar|sponsored|price target|dividend|earnings call|top \d+|best stocks?|stocks? to (buy|watch)|shares? (rise|risen|fall|fell|jump|drop|surge|plunge|slide|soar|climb|dip)|stock is trending|trending stocks?|lawsuit|indicted|arrested|coupon|giveaway|campaign|endorses?|endorsement|poll (shows|says|finds)|slams|blasts|feud|scandal)\b/i;
const MARKET_POLICY =
  /\b(budget|spending|tax|funding|funds|bond|incentive|appropriation|infrastructure|water|housing|economic|business|jobs|tariff|zoning|permit|development|revenue|fiscal|subsid|grant|loan|credit|semiconductor|energy|broadband)\b/i;

/** Color the change figure inside an anomaly headline (▲ green, ▼ red). */
function renderAnomalyValue(value: string) {
  const m = value.match(/^(.*?)([▲▼][\d.]+(?:%|pp))(.*)$/);
  if (!m) return value;
  const up = m[2].startsWith("▲");
  return (
    <>
      {m[1]}
      <span className={up ? "text-emerald-600 dark:text-emerald-400" : "text-red-500"}>{m[2]}</span>
      {m[3]}
    </>
  );
}

export default function MarketIntelPage() {
  const { theme } = useTheme();
  const dark = theme === "dark";
  const [latest, setLatest] = useState<LatestMap>({});
  const [obs, setObs] = useState<MiIndicatorObs[]>([]);
  const [tab, setTab] = useState<Tab>("acquisitions");
  const [bottomTab, setBottomTab] = useState<"deals" | "econ">("deals");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [acquisitions, setAcquisitions] = useState<MiAcquisition[]>([]);
  const [filings, setFilings] = useState<MiFiling[]>([]);
  const [filingCat, setFilingCat] = useState("all");
  const [sectorView, setSectorView] = useState<"trend" | "share">("share");
  const [hoverSlug, setHoverSlug] = useState<string | null>(null);
  // Row hover highlighting for the data tables — hover only, painted from
  // React state with inline styles. (Click-to-select removed at Ethan's
  // request, Oct 9, 2026.)
  const [hovRow, setHovRow] = useState("");
  const rowStyle = (key: string) => ({
    backgroundColor:
      hovRow === key
        ? dark
          ? "rgba(255,255,255,0.08)"
          : "rgb(230,237,246)"
        : undefined,
    transition: "background-color 200ms ease",
  });
  const rowProps = (key: string) => ({
    onMouseEnter: () => setHovRow(key),
    onMouseLeave: () => setHovRow((h: string) => (h === key ? "" : h)),
    style: rowStyle(key),
    className: "border-b border-slate-100 dark:border-white/5",
  });
  const [hoverCommodity, setHoverCommodity] = useState<string | null>(null);
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);
  const [warn, setWarn] = useState<MiWarnNotice[]>([]);
  const [dealFlow, setDealFlow] = useState<{ id: string; kind: string; status: string; createdAt?: string }[]>([]);
  const [fitTotal, setFitTotal] = useState<number | null>(null);
  const [multiples, setMultiples] = useState<MiMultiple[]>([]);
  const [syncLog, setSyncLog] = useState<MiSyncLog[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const [latestData, obsData, acq, fil, warnData, mult, log, flow] = await Promise.all([
          getJSON<LatestMap>("/api/market/latest"),
          getJSON<MiIndicatorObs[]>(
            "/api/market/indicators?series=AZUR,UNRATE,AZMFG,MANEMP,AZCONS,USCONS,AZBPPRIV,PERMIT,AZSTHPI,USSTHPI,SMS04000006562000001,CEU6500000001,AZNA,PAYEMS,AZ_DOD_CONTRACTS,AZ_AEROSPACE_CONTRACTS,QTAXTOTALQTAXCAT3AZNO,AZ_STATE_REVENUE,AZ_STATE_EXPENDITURE,AZ_SPEND_WELFARE,AZ_SPEND_EDUCATION,AZ_SPEND_INSURANCE,AZ_SPEND_HIGHWAYS,AZ_SPEND_CORRECTIONS,AZ_SPEND_HEALTH," +
              COUNTY_PERMIT_SERIES +
              "," +
              SECTOR_SERIES +
              "," +
              COMMODITY_IDS +
              "," +
              SPOT_IDS +
              "," +
              SUSB_IDS +
              "," +
              SUBSECTOR_IDS_CSV
          ),
          getJSON<MiAcquisition[]>("/api/market/acquisitions?status=all"),
          getJSON<MiFiling[]>("/api/market/filings"),
          getJSON<MiWarnNotice[]>("/api/market/warn?limit=500"),
          getJSON<MiMultiple[]>("/api/market/multiples"),
          getJSON<MiSyncLog[]>("/api/market/sync-log"),
          getJSON<{ id: string; kind: string; status: string; createdAt?: string }[]>("/api/deal-flow"),
        ]);
        const lm: LatestMap = {};
        for (const l of latestData as unknown as { seriesId: string; title: string; units: string; obsDate: string; value: number | null }[])
          lm[l.seriesId] = l;
        setLatest(lm);
        setObs(obsData);
        setAcquisitions(acq);
        setFilings(fil);
        setWarn(warnData);
        setDealFlow(flow);
        setMultiples(mult);
        setSyncLog(log);
        try {
          const cf = await getJSON<{ fitTotal?: number }>("/api/market/companies?limit=1");
          setFitTotal(cf.fitTotal ?? null);
        } catch {
          /* fit card falls back to a dash */
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, []);

  const grid = dark ? "rgba(255,255,255,0.08)" : "#e2e8f0";
  const tick = dark ? "rgba(255,255,255,0.55)" : "#64748b";
  const gold = "#b8975a";
  const blue = dark ? "#7aa2f7" : "#54708f";
  const green = "#5e9c7f";
  const orange = "#c47b4a";

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

  // Arizona companies by sector (Census CBP): latest establishment and
  // employment counts per NAICS sector, with year-over-year change.
  const sectorRows = useMemo(() => {
    type Pt = { date: string; value: number; title: string };
    const est = new Map<string, Pt[]>();
    const emp = new Map<string, Pt[]>();
    for (const o of obs) {
      const m = o.seriesId.match(/^CBP_AZ_SEC_(.+)_(ESTAB|EMP)$/);
      if (!m || o.value === null) continue;
      const map = m[2] === "ESTAB" ? est : emp;
      if (!map.has(m[1])) map.set(m[1], []);
      map.get(m[1])!.push({ date: o.obsDate, value: o.value, title: o.title });
    }
    const rows = Array.from(est.entries()).map(([slug, vals]) => {
      vals.sort((a, b) => a.date.localeCompare(b.date));
      const last = vals[vals.length - 1];
      const prev = vals[vals.length - 2];
      const empVals = (emp.get(slug) || []).sort((a, b) => a.date.localeCompare(b.date));
      return {
        slug,
        name: last.title.replace(/ — AZ Establishments$/, ""),
        estab: last.value,
        emp: empVals.length ? empVals[empVals.length - 1].value : null,
        year: last.date.slice(0, 4),
        yoy: prev && prev.value ? ((last.value - prev.value) / prev.value) * 100 : null,
      };
    });
    return rows.sort((a, b) => b.estab - a.estab);
  }, [obs]);
  const sectorYear = sectorRows.length ? sectorRows[0].year : "";
  const sectorLine = (slug: string) => {
    const r = sectorRows.find((x) => x.slug === slug);
    if (!r) return null;
    return (
      <div className="mb-3 mt-2 flex flex-wrap items-center gap-2">
        <span className="rounded-lg border border-[#b8975a]/40 bg-[#b8975a]/10 px-3 py-1.5 text-sm text-[#0d1f3c] dark:text-white">
          🏢 <b>{r.estab.toLocaleString()}</b> Arizona companies
        </span>
        {r.emp ? (
          <span className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-600 dark:border-white/10 dark:bg-white/5 dark:text-white/70">
            👥 <b>{r.emp.toLocaleString()}</b> employees
          </span>
        ) : null}
        <span className="text-xs text-slate-400 dark:text-white/30">business establishments · Census CBP {r.year}</span>
      </div>
    );
  };
  const sectorTotal = sectorRows.reduce((s, r) => s + r.estab, 0);
  // Trend: establishments by year for the 8 largest sectors (CBP history).
  const sectorTrend = useMemo(() => {
    const bySlug = new Map<string, Map<string, number>>();
    for (const o of obs) {
      const m = o.seriesId.match(/^CBP_AZ_SEC_(.+)_ESTAB$/);
      if (!m || o.value === null) continue;
      if (!bySlug.has(m[1])) bySlug.set(m[1], new Map());
      bySlug.get(m[1])!.set(o.obsDate.slice(0, 4), o.value);
    }
    const slugs = sectorRows.filter((r) => r.slug !== "81").slice(0, 8).map((r) => r.slug);
    const yearSet = new Set<string>();
    for (const mp of Array.from(bySlug.values())) for (const y of Array.from(mp.keys())) yearSet.add(y);
    const rows = Array.from(yearSet)
      .sort()
      .map((y) => {
        const row: Record<string, number | string> = { year: y };
        for (const slug of slugs) {
          const v = bySlug.get(slug)?.get(y);
          if (v !== undefined) row[slug] = v;
        }
        return row;
      });
    return { rows, slugs };
  }, [obs, sectorRows]);
  // Share: current-year mix, top 7 named sectors + everything else.
  // "Other Services" (81) folds into All other sectors — both are
  // catch-alls (Ethan's call). Each slice carries its slugs so hovering a
  // table row can light up the matching slice.
  const sectorPieData = useMemo(() => {
    const named = sectorRows.filter((r) => r.slug !== "81").slice(0, 7);
    const namedSlugs = new Set(named.map((r) => r.slug));
    const data = named.map((r) => ({ name: SECTOR_SHORT[r.slug] ?? r.name, value: r.estab, slugs: [r.slug] }));
    const restRows = sectorRows.filter((r) => !namedSlugs.has(r.slug));
    const rest = restRows.reduce((s, r) => s + r.estab, 0);
    if (rest > 0) data.push({ name: "All other sectors", value: rest, slugs: restRows.map((r) => r.slug) });
    return data;
  }, [sectorRows]);
  // Commodity prices: latest values + a 5-year indexed series (base = 100)
  // so series with unlike units can share one chart.
  const commodityData = useMemo(() => {
    const series = COMMODITY_SERIES.map((c) => {
      const rows = obs
        .filter((o) => o.seriesId === c.id && o.value !== null)
        .sort((a, b) => a.obsDate.localeCompare(b.obsDate));
      const recent = rows.filter((o) => o.obsDate >= fiveYearCutoff);
      const spotDef = SPOT_BY_FRED[c.id] ?? null;
      let spot: MiIndicatorObs | null = null;
      let spotChg: number | null = null;
      if (spotDef) {
        const sr = obs
          .filter((o) => o.seriesId === spotDef.id && o.value !== null)
          .sort((a, b) => a.obsDate.localeCompare(b.obsDate));
        if (sr.length) {
          spot = sr[sr.length - 1];
          const cutoff = new Date(Date.parse(spot.obsDate) - 30 * 864e5).toISOString().slice(0, 10);
          const prev = sr.filter((o) => o.obsDate <= cutoff).pop();
          if (prev && prev.value && spot.value) spotChg = ((spot.value - prev.value) / prev.value) * 100;
        }
      }
      return {
        ...c,
        rows,
        recent,
        base: recent.length ? recent[0].value : null,
        latest: rows.length ? rows[rows.length - 1] : null,
        yearAgo: rows.length > 12 ? rows[rows.length - 13] : null,
        spotDef,
        spot,
        spotChg,
      };
    }).filter((s) => s.latest);
    const byMonth = new Map<string, Record<string, number | string>>();
    for (const s of series) {
      if (!s.base) continue;
      for (const o of s.recent) {
        const m = o.obsDate.slice(0, 7);
        if (!byMonth.has(m)) byMonth.set(m, { month: m });
        byMonth.get(m)![s.id] = Math.round(((o.value ?? 0) / s.base) * 1000) / 10;
      }
    }
    const chartRows = Array.from(byMonth.values()).sort((a, b) => String(a.month).localeCompare(String(b.month)));
    return { series, chartRows };
  }, [obs, fiveYearCutoff]);


  const statCards = useMemo(() => {
    // (Top-row cards are tailored to the acquisition search; the macro
    // series — unemployment, manufacturing, permits — live in the
    // Economic Indicators subsection below.)
    // Permits vs their trailing 12-month average (also feeds the anomaly scan).
    const permitObs = obs
      .filter((o) => o.seriesId === "AZBPPRIV" && o.value !== null)
      .sort((a, b) => a.obsDate.localeCompare(b.obsDate));
    const pLast = permitObs[permitObs.length - 1];
    const prior12 = permitObs.slice(-13, -1);
    const avg12 =
      prior12.length >= 6
        ? prior12.reduce((s, o) => s + (o.value || 0), 0) / prior12.length
        : null;
    const permitChg =
      pLast && avg12 ? (((pLast.value || 0) - avg12) / avg12) * 100 : null;
    // 🔎 Top Anomaly — scan every source for the reading that "usually
    // doesn't happen" and surface the single biggest deviation.
    type Cand = { score: number; headline: string; detail: string };
    const cands: Cand[] = [];
    const now = Date.now();
    const d90 = 90 * 864e5;
    const sumWin = (from: number, to: number) =>
      warn
        .filter((w) => {
          if (!w.noticeDate || !w.headcount) return false;
          const t = new Date(w.noticeDate).getTime();
          return t >= from && t < to;
        })
        .reduce((s, w) => s + (w.headcount || 0), 0);
    const layNow = sumWin(now - d90, now + 1);
    const layPrev = sumWin(now - 2 * d90, now - d90);
    // Layoffs only qualify as an anomaly on a MASSIVE increase (Ethan's
    // rule) — a drop in layoffs, or a small uptick, is not anomaly-worthy.
    if (layPrev > 0 && layNow >= 500) {
      const chg = ((layNow - layPrev) / layPrev) * 100;
      if (chg >= 50) {
        cands.push({
          score: Math.abs(chg),
          headline: `Layoffs ▲${Math.round(chg)}%`,
          detail: `${layNow.toLocaleString()} workers in 90 days vs ${layPrev.toLocaleString()} prior · WARN`,
        });
      }
    }
    if (permitChg !== null && pLast && avg12) {
      cands.push({
        score: Math.abs(permitChg),
        headline: `Permits ${permitChg >= 0 ? "▲" : "▼"}${Math.abs(Math.round(permitChg))}%`,
        detail: `${Math.round(pLast.value || 0).toLocaleString()} permits in ${pLast.obsDate.slice(0, 7)} vs ${Math.round(avg12).toLocaleString()} 1-yr avg · FRED`,
      });
    }
    // Defense candidate = trailing-12-month change. Monthly obligations are
    // far too lumpy for single-month or calendar-YTD readings (a few giant
    // awards land in single months — the old YTD framing showed +70% while
    // the TTM figure was +39%); trailing zero months are unposted
    // USASpending data, not real zeros.
    const dodObs = obs
      .filter((o) => o.seriesId === "AZ_DOD_CONTRACTS" && o.value !== null)
      .sort((a, b) => a.obsDate.localeCompare(b.obsDate));
    while (dodObs.length > 0 && dodObs[dodObs.length - 1].value === 0) dodObs.pop();
    if (dodObs.length >= 24) {
      const ttm = dodObs.slice(-12).reduce((s, o) => s + (o.value || 0), 0);
      const ttmPrev = dodObs.slice(-24, -12).reduce((s, o) => s + (o.value || 0), 0);
      if (ttmPrev > 0) {
        const chg = ((ttm - ttmPrev) / ttmPrev) * 100;
        const fmtB = (v: number) => (v >= 1e9 ? `$${(v / 1e9).toFixed(1)}B` : `$${Math.round(v / 1e6)}M`);
        cands.push({
          score: Math.abs(chg),
          headline: `Defense $ ${chg >= 0 ? "▲" : "▼"}${Math.abs(Math.round(chg))}% TTM`,
          detail: `${fmtB(ttm)} obligated in AZ, 12 mo thru ${dodObs[dodObs.length - 1].obsDate.slice(0, 7)} vs ${fmtB(ttmPrev)} prior 12 mo · USASpending`,
        });
      }
    }
    const urObs = obs
      .filter((o) => o.seriesId === "AZUR" && o.value !== null)
      .sort((a, b) => a.obsDate.localeCompare(b.obsDate));
    const urLast = urObs[urObs.length - 1];
    const urPrev = urObs[urObs.length - 4];
    if (urLast && urPrev) {
      const dpp = (urLast.value || 0) - (urPrev.value || 0);
      if (Math.abs(dpp) >= 0.2) {
        cands.push({
          score: Math.abs(dpp) * 30,
          headline: `Jobless ${dpp >= 0 ? "▲" : "▼"}${Math.abs(dpp).toFixed(1)}pp`,
          detail: `AZ unemployment ${urLast.value}% vs ${urPrev.value}% three months ago · BLS`,
        });
      }
    }
    const bkCutoff = new Date(now - 30 * 864e5).toISOString().slice(0, 10);
    const bk = acquisitions.filter(
      (a) => a.eventType === "bankruptcy" && a.status !== "dismissed" && a.announcedDate >= bkCutoff
    );
    if (bk.length >= 2) {
      cands.push({
        score: bk.length * 12,
        headline: `${bk.length} bankruptcies / 30 days`,
        detail: bk.slice(0, 3).map((a) => a.target).join(" · "),
      });
    }
    cands.sort((a, b) => b.score - a.score);
    const anomalyCard = cands[0]
      ? {
          label: "🔎 Top Anomaly",
          value: cands[0].headline,
          date: cands[0].detail,
          chg: null,
          chgLabel: undefined,
          invert: false,
        }
      : null;
    // Acquisition-search cards: live deal flow awaiting triage, the size
    // of the focus-sector target universe, and distress signals.
    const forSale = dealFlow.filter((i) => i.kind === "business_for_sale" && i.status === "new");
    const weekAgo = now - 7 * 864e5;
    const newThisWeek = forSale.filter(
      (i) => i.createdAt && new Date(i.createdAt).getTime() >= weekAgo
    ).length;
    const saleCard = {
      label: "🏷 Businesses For Sale",
      value: forSale.length.toLocaleString(),
      date: `awaiting triage in Activity${newThisWeek ? ` · ${newThisWeek} new this week` : ""}`,
      chg: null,
    };
    const focusSlugs = ["3364", "62", "3133", "23"];
    const focusRows = sectorRows.filter((r) => focusSlugs.includes(r.slug));
    const focusTotal = focusRows.reduce((s, r) => s + r.estab, 0);
    const focusCard =
      focusTotal > 0
        ? {
            label: "🎯 AZ Companies — Focus Sectors",
            value: focusTotal.toLocaleString(),
            date: `establishments · CBP ${focusRows[0]?.year ?? ""} · A&D, healthcare, manufacturing, construction`,
            chg: null,
          }
        : null;
    const fitCard = {
      label: "★ Fit Targets — All Industries",
      value: fitTotal !== null ? fitTotal.toLocaleString() : "—",
      date: "acquisition fits across A&D · healthcare · manufacturing · trades",
      chg: null,
    };
    return [saleCard, focusCard, fitCard, anomalyCard].filter(Boolean) as {
      label: string;
      value: string;
      date: string;
      chg: number | null;
      chgLabel?: string;
      invert?: boolean;
    }[];
  }, [obs, warn, acquisitions, dealFlow, sectorRows, fitTotal]);

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

  /** Section event strips — single allocation (Ethan: each event is used
   * exactly once on the page). Marquee stories are claimed for Major
   * Events first (big deals, big money, big scale — e.g. the Fairmont
   * Scottsdale Princess sale); specialty sections then claim what
   * remains in priority order, and Major Events fills from the rest
   * (plus filing bankruptcies and large WARN layoffs). */
  const dismissEvent = (a: MiAcquisition) => setStatus("acquisitions", a.id, "dismissed");
  const stripCutoff = new Date(Date.now() - 1 * 864e5).toISOString().slice(0, 10);
  const normCo = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  const seenCo = new Set<string>();
  const stripPool = acquisitions
    .filter(
      (a) =>
        a.status !== "dismissed" &&
        a.eventType !== "bankruptcy" &&
        a.announcedDate &&
        a.announcedDate >= stripCutoff &&
        !JUNK.test(a.headline || a.summary || a.target)
    )
    .sort((x, y) => (y.announcedDate || "").localeCompare(x.announcedDate || ""))
    .filter((a) => {
      const k = `${normCo(a.target || a.headline || "")}|${a.eventType}`;
      if (seenCo.has(k)) return false;
      seenCo.add(k);
      return true;
    });
  /** How "marquee" is a story? Big money dominates; scale and focus fit add. */
  const marqueeScore = (a: MiAcquisition): number => {
    let s = 0;
    const dv = a.dealValue ?? null;
    if (dv) s += dv >= 1e8 ? 100 : dv >= 2.5e7 ? 60 : dv >= 5e6 ? 30 : 15;
    const text = `${a.headline || ""} ${a.summary || ""}`;
    if (!dv && /\$\s?\d/.test(text)) s += 10;
    if (/\d[\d,]*\s*(jobs|employees|square|sq\.?\s?ft|acres)/i.test(text)) s += 15;
    if (a.eventType === "acquisition" || a.eventType === "ipo") s += 10;
    if (["Aerospace & Defense", "Healthcare", "Advanced Manufacturing", "Specialty Trades & Construction"].includes(a.industry)) s += 10;
    return s;
  };
  const marqueeEvents = stripPool
    .filter((a) => marqueeScore(a) >= 40)
    .sort((x, y) => marqueeScore(y) - marqueeScore(x) || (y.announcedDate || "").localeCompare(x.announcedDate || ""))
    .slice(0, 4);
  const marqueeIds = new Set(marqueeEvents.map((a) => a.id));
  const claimedIds = new Set<string>(marqueeIds);
  const claim = (pred: (a: MiAcquisition) => boolean, n = 3) => {
    const picked = stripPool.filter((a) => !claimedIds.has(a.id) && pred(a)).slice(0, n);
    for (const a of picked) claimedIds.add(a.id);
    return picked;
  };
  const industryClaims: Record<string, MiAcquisition[]> = {
    "Aerospace & Defense": claim((a) => a.industry === "Aerospace & Defense"),
    Healthcare: claim((a) => a.industry === "Healthcare"),
    "Advanced Manufacturing": claim((a) => a.industry === "Advanced Manufacturing"),
    "Specialty Trades & Construction": claim((a) => a.industry === "Specialty Trades & Construction"),
  };
  const policyEvents = claim(
    (a) => a.eventType === "policy" && MARKET_POLICY.test(`${a.headline || ""} ${a.summary || ""}`)
  );
  const expansionEvents = claim((a) => a.eventType === "expansion" || a.eventType === "relocation");
  const demoEvents = claim((a) => ["relocation", "expansion", "investment", "policy"].includes(a.eventType));
  const acqEvents = claim((a) => a.eventType === "acquisition");
  const allEvents = claim(() => true);
  const industryEvents = (industry: string) => industryClaims[industry] ?? [];
  /** Ids claimed by section strips (Major Events must skip these;
   * marquee ids are the opposite — they belong to Major Events). */
  const sectionIds = new Set(Array.from(claimedIds).filter((id) => !marqueeIds.has(id)));

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

  /** County housing permits (Census BPS, published by U of A EBRC): all
   * counties ranked within the single most recent month they share, so the
   * top-3 strip and share math never mix months. */
  const countyPermits = useMemo(() => {
    const per = PERMIT_COUNTIES.map((name) => {
      const id = `AZPERMIT_${countySlug(name)}`;
      const l = latest[id];
      if (!l || l.value === null) return null;
      const sf = latest[`AZPERMIT_SF_${countySlug(name)}`];
      return {
        name,
        value: l.value,
        date: l.obsDate,
        sf: sf && sf.value !== null ? sf.value : null,
        yoy: yoyChange(obs, id),
      };
    }).filter(Boolean) as { name: string; value: number; date: string; sf: number | null; yoy: number | null }[];
    if (!per.length) return per;
    const maxDate = per.map((c) => c.date).sort().slice(-1)[0];
    return per.filter((c) => c.date === maxDate).sort((a, b) => b.value - a.value);
  }, [latest, obs]);
  const permitMonth = countyPermits.length
    ? countyPermits.map((c) => c.date).sort().slice(-1)[0]
    : "";
  const countyPermitTotal = countyPermits.reduce((s, c) => s + c.value, 0);
  const countyChartRows = useMemo(() => {
    const top5 = countyPermits.slice(0, 5).map((c) => `AZPERMIT_${countySlug(c.name)}`);
    if (!top5.length) return [];
    return filterSince(
      seriesToRows(obs.filter((o) => top5.includes(o.seriesId)), top5),
      fiveYearCutoff
    );
  }, [obs, countyPermits, fiveYearCutoff]);

  const weekCutoff = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);
  const filteredFilings = (filingCat === "all" ? filings : filings.filter((f) => f.category === filingCat))
    .filter((f) => f.filingDate && f.filingDate >= weekCutoff)
    .slice()
    .sort((x, y) => (y.filingDate || "").localeCompare(x.filingDate || ""));
  // The Acquisitions tab is a ledger of actual Arizona deals (Ethan, Oct 8):
  // true acquisitions ONLY — expansions, contracts, IPOs, relocations,
  // investments and policy stories live in their own sections, not here.
  // Accuracy gates: no junk headlines, and the deal itself must be Arizona
  // (an AZ place named in the headline/target) — an AZ outlet covering a
  // national deal like Paramount–Warner Bros. doesn't count. Newest first.
  const AZ_DEAL_PLACE =
    /\b(arizona|phoenix|scottsdale|tempe|mesa|tucson|chandler|gilbert|glendale|peoria|surprise|flagstaff|yuma|prescott|avondale|goodyear|buckeye|queen creek|maricopa|pinal|sedona|lake havasu)\b/i;
  const visibleAcq = acquisitions
    .filter(
      (a) =>
        a.status !== "dismissed" &&
        a.eventType === "acquisition" &&
        a.announcedDate &&
        a.announcedDate >= weekCutoff &&
        !JUNK.test(a.headline || a.target || "")
    )
    .filter((a) => AZ_DEAL_PLACE.test(`${a.headline || ""} ${a.target || ""} ${a.targetLocation || ""}`))
    .slice()
    .sort(
      (x, y) =>
        (y.announcedDate || "").localeCompare(x.announcedDate || "") ||
        (y.createdAt || "").localeCompare(x.createdAt || "")
    );

  const headlines = useMemo(() => {
    // Recency window: Major Events shows only the current day and the day
    // before — a "what just happened" feed refreshed by the daily ingest,
    // never a historical archive. Dismissed items can't backfill with older
    // news because nothing older is eligible.
    const cutoff = new Date(Date.now() - 1 * 864e5).toISOString().slice(0, 10);
    // Display-side quality gates (mirror the ingest filters so already-stored
    // junk disappears too): JUNK and MARKET_POLICY are defined at module scope.
    const items: { id: string; kind: string; title: string; key: string; detail: string; summary: string; date: string; url: string; source: "acquisitions" | "filings" | "warn"; rawId: string }[] = [];
    const fmtVal = (v: number | null) =>
      v === null ? "" : v >= 1e9 ? ` · $${(v / 1e9).toFixed(1)}B` : v >= 1e6 ? ` · $${Math.round(v / 1e6)}M` : "";
    for (const a of acquisitions) {
      if (a.eventType === "bankruptcy" && a.status !== "dismissed" && !sectionIds.has(a.id) && a.announcedDate && a.announcedDate >= cutoff) {
        if (JUNK.test(a.headline || a.summary || a.target)) continue;
        items.push({
          id: `news-${a.id}`,
          kind: "Bankruptcy",
          title: a.headline || a.target || "Unnamed company",
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
          if (a.eventType !== t || a.status === "dismissed" || sectionIds.has(a.id) || marqueeIds.has(a.id) || !a.announcedDate || a.announcedDate < cutoff) return false;
          const text = `${a.headline || ""} ${a.summary || ""} ${a.target || ""} ${a.acquirer || ""}`;
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
    // Marquee stories (claimed ahead of the section strips): they lead
    // the main feed even when a section would also have fit them.
    for (const a of marqueeEvents) {
      items.push({
        id: `marquee-${a.id}`,
        kind: kindLabel[a.eventType] ?? a.eventType,
        title: a.headline || a.target || "Unnamed",
        key: a.target || a.summary || "",
        detail: `${a.acquirer && a.target && a.eventType === "acquisition" ? `${a.acquirer} → ${a.target} · ` : ""}${a.publisher || "News"}${a.industry ? ` · ${a.industry}` : ""}${fmtVal(a.dealValue ?? null)}`,
        summary: a.summary || "",
        date: a.announcedDate,
        url: a.sourceUrl,
        source: "acquisitions",
        rawId: a.id,
      });
    }
    for (const t of ["acquisition", "expansion", "investment", "contract", "relocation", "ipo", "policy"] as const) {
      for (const a of byType(t, 2)) {
        items.push({
          id: `${t}-${a.id}`,
          kind: kindLabel[t],
          title: a.headline || (t === "acquisition" ? a.target || a.acquirer || "Unnamed deal" : a.target || "Unnamed"),
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
  // Toggle/tab buttons: the selected state is a LIGHT tint, never a dark
  // fill. (Ethan, Oct 9, 2026: "make sure the row doesn't turn dark when selected")
  const tabBtn = (active: boolean) =>
    `rounded-lg px-3 py-1.5 text-sm font-medium ${active ? "bg-[#d7e1f0] font-semibold text-[#0d1f3c] dark:bg-[#b8975a]/30 dark:text-[#e8cf9a]" : "text-slate-600 hover:bg-[#f0f4fa] dark:text-white/60 dark:hover:bg-white/5"}`;

  const overviewNode = (
    <EventStrip items={acqEvents} onDismiss={dismissEvent} />
  );

  const sectorExtras: Record<string, ReactNode> = {
    "Aerospace & Defense": (
      <div className="mt-6">
            <EventStrip items={industryEvents("Aerospace & Defense")} onDismiss={dismissEvent} />
            {sectorLine("3364")}
            {hasSizeProfile(obs, "3364") && <SizeProfileRow obs={obs} slug="3364" />}
            <CompanyTargets sector="Aerospace & Defense" />
            <div className="grid gap-4 lg:grid-cols-2">
<div className={chartCard}>
            <h3 className="mb-1 text-sm font-semibold text-[#0d1f3c] dark:text-white">Defense Contracts — Arizona</h3>
            <p className="mb-3 text-xs text-slate-500 dark:text-white/40">Monthly DoD contract obligations performed in AZ, $M · USASpending.gov. Cross-check: DoD&apos;s Defense Spending by State report counts $14.5B (FY2023) / $14.7B (FY2024) in AZ contract spending — USASpending obligations run ~5–15% higher on a different methodology, and single awards (Raytheon missile lots, Boeing Apache, TriWest TRICARE) move individual months by billions, so judge the trend on 12-month windows, not single months.</p>
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
            {(() => {
              const fy25 = obs
                .filter((o) => o.seriesId === "AZ_DOD_CONTRACTS" && o.obsDate >= "2024-10-01" && o.obsDate <= "2025-09-01")
                .reduce((s, o) => s + (o.value || 0), 0);
              return fy25 > 0 ? (
                <p className="mt-2 text-xs text-slate-400 dark:text-white/30">
                  Cross-reference: this series computes to ${(fy25 / 1e9).toFixed(1)}B for federal FY2025 · DoD&apos;s published Defense Spending by State report: $14.5B (FY2023) / $14.7B (FY2024) AZ contract spending — different methodology, shown for comparison. The daily ingest re-verifies these monthly figures against USASpending&apos;s fiscal-year totals every run (see Data freshness below).
                </p>
              ) : null;
            })()}
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
                    <tr key={r.date} {...rowProps(`defense:${r.date}`)}>
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
          
      </div>
    ),
    "Healthcare": (
      <div className="mt-6">
            <EventStrip items={industryEvents("Healthcare")} onDismiss={dismissEvent} />
            {sectorLine("62")}
            {hasSizeProfile(obs, "62") && <SizeProfileRow obs={obs} slug="62" />}
            <CompanyTargets sector="Healthcare" />
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
          
      </div>
    ),
    "Advanced Manufacturing": (
      <div className="mt-6">
            <EventStrip items={industryEvents("Advanced Manufacturing")} onDismiss={dismissEvent} />
            {sectorLine("3133")}
            {hasSizeProfile(obs, "3133") && <SizeProfileRow obs={obs} slug="3133" />}
            <CompanyTargets sector="Advanced Manufacturing" />
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
          
      </div>
    ),
    "Specialty Trades & Construction": (
      <div className="mt-6">
            <EventStrip items={industryEvents("Specialty Trades & Construction")} onDismiss={dismissEvent} />
            {sectorLine("23")}
            {hasSizeProfile(obs, "23") && <SizeProfileRow obs={obs} slug="23" />}
            <CompanyTargets sector="Specialty Trades & Construction" />
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
          
      </div>
    ),
  };

  return (
    <div className="min-h-screen">
      <PageHero eyebrow="Canny Capital Partners" title="Market Intel" subtitle="Arizona private equity" />

      <main className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6">
        {error && (
          <div className="mb-4 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
            Couldn&apos;t load market data: {error}. {error.includes("DATABASE_URL") ? "Market Intel needs the Postgres database." : "Data loads after the first daily ingest runs."}
          </div>
        )}

        {/* Stat cards */}
        <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {statCards.map((c) => {
            const isAnomaly = c.label.includes("Top Anomaly");
            return (
              <div
                key={c.label}
                className={
                  isAnomaly
                    ? "rounded-xl border-2 border-[#b8975a] bg-gradient-to-br from-[#b8975a]/20 via-white to-white p-4 shadow-[0_0_28px_rgba(184,151,90,0.35)] dark:via-[#132847]/70 dark:to-[#132847]/70"
                    : "rounded-xl border border-slate-200 bg-white p-4 dark:border-white/10 dark:bg-[#132847]/60"
                }
              >
                <p
                  className={
                    isAnomaly
                      ? "flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-[#8a6d3b] dark:text-[#d9bc7a]"
                      : "text-xs font-medium uppercase tracking-wider text-slate-500 dark:text-white/50"
                  }
                >
                  {isAnomaly && (
                    <span className="relative flex h-2 w-2 shrink-0">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#b8975a] opacity-60" />
                      <span className="relative inline-flex h-2 w-2 rounded-full bg-[#b8975a]" />
                    </span>
                  )}
                  {c.label}
                </p>
                <p className="mt-1 text-2xl font-bold text-[#0d1f3c] dark:text-white">{isAnomaly ? renderAnomalyValue(c.value) : c.value}</p>
                <p className="mt-1 text-xs text-slate-400 dark:text-white/40">
                  {c.date}
                  {c.chg !== null && (
                    <span className={c.invert
                      ? Math.abs(c.chg) >= 25
                        ? "text-amber-600 dark:text-amber-400"
                        : "text-slate-400 dark:text-white/40"
                      : c.chg >= 0
                        ? "text-emerald-600 dark:text-emerald-400"
                        : "text-red-500"}>
                      {" "}{c.chg >= 0 ? "▲" : "▼"} {Math.abs(c.chg).toFixed(1)}{c.chgLabel ?? "pp YoY"}
                    </span>
                  )}
                </p>
              </div>
            );
          })}
          {statCards.length === 0 && !error && (
            <div className="col-span-4 rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500 dark:border-white/15 dark:text-white/40">
              No indicator data yet — it loads on the first daily ingest run.
            </div>
          )}
        </div>

        <UpdatesStrip />

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
                      <p className="mt-1 pr-5 text-base font-bold text-[#0d1f3c] dark:text-white">{decodeEntities(h.title)}</p>
                      <p className="mt-1 text-xs text-slate-500 dark:text-white/50">
                        {decodeEntities(h.detail)}{h.date ? ` · ${fmtDate(h.date)}` : ""}
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
                            {decodeEntities(h.summary)}
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

        {/* Combined Industries & Multiples (Oct 10, 2026 redo) + consolidated Fit Targets */}
        <FullSection kicker="Start here — the valuation yardstick" title="Industries & Multiples" sub="One home for industries and their multiples — switch industries at the top for multiples by subindustry and the typical deal structure in each; best guesses are flagged est where no multiple is published">
          <div className="rounded-2xl border border-[#b8975a]/40 bg-gradient-to-br from-[#e6edf6] via-white to-[#f7f1e3] p-3 shadow-sm dark:from-[#132847] dark:via-[#0d1f3c] dark:to-[#1a3358] sm:p-4">
            <IndustryExplorer
              multiples={multiples}
              dark={dark}
              onMultiplesAdded={async () => setMultiples(await getJSON("/api/market/multiples"))}
              overview={overviewNode}
              extras={sectorExtras}
            />
          </div>
        </FullSection>

        <FullSection kicker="Consolidated targets" title="★ Fit Targets" sub="Every company that passes Canny’s fit rules, across all focus industries — switch industries, expand a row, and convert a fit straight into the pipeline">
          <FitTargets />
        </FullSection>

        {/* Bottom reference block — tabbed: Acquisitions & Filings (default) | Arizona Economic Data */}
        <div className="mb-6 rounded-2xl border border-slate-200 bg-white/60 p-3 dark:border-white/10 dark:bg-[#132847]/30 sm:p-4">
          <div className="mb-2 flex flex-wrap items-center gap-2 border-b-2 border-[#b8975a]/50 pb-3">
            <button onClick={() => setBottomTab("deals")} className={tabBtn(bottomTab === "deals")}>Acquisitions &amp; Filings</button>
            <button onClick={() => setBottomTab("econ")} className={tabBtn(bottomTab === "econ")}>Arizona Economic Data</button>
            <span className="ml-auto hidden text-xs text-slate-400 dark:text-white/40 sm:block">
              {bottomTab === "deals" ? "AZ acquisitions and SEC filings · last 7 days only" : "State indicators, budget, demographics, permitting & WARN"}
            </span>
          </div>
          {bottomTab === "econ" && (
            <div>
          <SubSection alt title="Arizona Companies by Sector">
{sectorRows.length > 0 && (
            <div className={`${chartCard} mb-4`}>
              <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-[#0d1f3c] dark:text-white">Arizona Companies by Sector</h3>
                <div className="flex gap-1">
                  {(["trend", "share"] as const).map((v) => (
                    <button
                      key={v}
                      onClick={() => setSectorView(v)}
                      className={
                        sectorView === v
                          ? "rounded-full bg-[#b8975a] px-3 py-1 text-xs font-semibold text-white"
                          : "rounded-full border border-slate-300 px-3 py-1 text-xs text-slate-500 hover:border-[#b8975a] dark:border-white/15 dark:text-white/50"
                      }
                    >
                      {v === "trend" ? "Trend" : "Share"}
                    </button>
                  ))}
                </div>
              </div>
              <p className="mb-3 text-xs text-slate-500 dark:text-white/40">
                Employer establishments by NAICS sector · U.S. Census Bureau, County Business Patterns · refreshed daily (CBP publishes annually)
              </p>
              {sectorView === "trend" ? (
                <div className="h-[380px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={sectorTrend.rows} margin={{ top: 5, right: 20, left: 0, bottom: 0 }}>
                      <CartesianGrid stroke={grid} strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="year" tick={{ fontSize: 11, fill: tick }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fontSize: 11, fill: tick }} width={52} tickFormatter={(v: number) => v.toLocaleString()} axisLine={false} tickLine={false} domain={["auto", "auto"]} />
                      <Tooltip
                        contentStyle={{ background: dark ? "#0d1f3c" : "#fff", border: `1px solid ${grid}`, fontSize: 12, borderRadius: 8 }}
                        cursor={{ stroke: grid }}
                        formatter={(v, name) => [Number(v).toLocaleString(), name]}
                      />
                      <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} iconType="circle" iconSize={8} />
                      {sectorTrend.slugs.map((slug, i) => (
                        <Line
                          key={slug}
                          type="monotone"
                          dataKey={slug}
                          name={SECTOR_SHORT[slug] ?? slug}
                          stroke={CHART_COLORS[i % CHART_COLORS.length]}
                          strokeWidth={hoverSlug === slug ? 3.5 : 2}
                          strokeOpacity={hoverSlug && hoverSlug !== slug ? 0.12 : 1}
                          dot={false}
                          activeDot={{ r: 3.5 }}
                        />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="h-[380px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={sectorPieData} dataKey="value" nameKey="name" innerRadius={70} outerRadius={120} paddingAngle={1} stroke={dark ? "#132847" : "#ffffff"} strokeWidth={1}>
                        {sectorPieData.map((d, i) => (
                          <Cell
                            key={d.name}
                            fill={CHART_COLORS[i % CHART_COLORS.length]}
                            fillOpacity={hoverSlug ? (d.slugs.includes(hoverSlug) ? 1 : 0.22) : 1}
                          />
                        ))}
                      </Pie>
                      <Tooltip
                        contentStyle={{ background: dark ? "#0d1f3c" : "#fff", border: `1px solid ${grid}`, fontSize: 12 }}
                        formatter={(v, name) => [`${Number(v).toLocaleString()} (${sectorTotal ? ((Number(v) / sectorTotal) * 100).toFixed(1) : "0"}%)`, name]}
                      />
                      <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} iconType="circle" iconSize={8} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              )}
              <p className="mt-2 text-xs text-slate-400 dark:text-white/30">
                {sectorView === "trend" ? "Establishments per year — top 8 sectors" : `CBP ${sectorYear} mix`} · {sectorTotal.toLocaleString()} establishments statewide (CBP {sectorYear})
              </p>
              <div className={`${tableWrap} mt-3 max-h-[320px] overflow-y-auto`}>
                <table className="w-full border-collapse bg-white dark:bg-[#132847]/40">
                  <thead><tr className="border-b border-slate-200 dark:border-white/10">
                    <th className={th}>Sector</th><th className={th}>Companies</th><th className={th}>Employees</th><th className={th}>Share</th>
                  </tr></thead>
                  <tbody>
                    {sectorRows.map((r) => (
                      <tr
                        key={r.slug}
                        onMouseEnter={() => { setHoverSlug(r.slug); setHovRow(`sector:${r.slug}`); }}
                        onMouseLeave={() => { setHoverSlug(null); setHovRow(""); }}
                        style={{
                          backgroundColor:
                            hoverSlug === r.slug
                              ? dark
                                ? "rgba(255,255,255,0.10)"
                                : "rgb(215,225,240)"
                              : hovRow === `sector:${r.slug}`
                                ? dark
                                  ? "rgba(255,255,255,0.08)"
                                  : "rgb(230,237,246)"
                                : undefined,
                          transition: "background-color 200ms ease",
                        }}
                        className="border-b border-slate-100 dark:border-white/5"
                      >
                        <td className={td}>{r.name}</td>
                        <td className={`${td} font-medium`}>{r.estab.toLocaleString()}</td>
                        <td className={td}>{r.emp ? r.emp.toLocaleString() : "—"}</td>
                        <td className={td}>{sectorTotal ? `${((r.estab / sectorTotal) * 100).toFixed(1)}%` : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          </SubSection>
          <SubSection title="Economic Indicators">
            <EventStrip items={allEvents} onDismiss={dismissEvent} />
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
                      <tr key={id} {...rowProps(`ind:${id}`)}>
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

          <SubSection alt title="State Revenue & Spending">
            <EventStrip items={policyEvents} onDismiss={dismissEvent} />
<div className={chartCard}>
          <h3 className="mb-1 text-sm font-semibold text-[#0d1f3c] dark:text-white">Revenue vs Spending</h3>
          <p className="mb-3 text-xs text-slate-500 dark:text-white/40">
            Annual, $B, Census Annual Survey of State &amp; Local Government Finances (state government only). Chart shows the most recent 8 years; the table below has the full history. Census notes the gap isn&apos;t a formal surplus/deficit, but it shows the fiscal trend.
          </p>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={budgetRows.slice(-8)} margin={{ top: 5, right: 10, left: -5, bottom: 0 }}>
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
          <div className={`${tableWrap} mt-4 max-h-[300px] overflow-y-auto`}>
            <table className="w-full border-collapse bg-white dark:bg-[#132847]/40">
              <thead><tr className="border-b border-slate-200 dark:border-white/10">
                <th className={`${th} sticky top-0 bg-white dark:bg-[#132847]`}>Year</th><th className={`${th} sticky top-0 bg-white dark:bg-[#132847]`}>Revenue</th><th className={`${th} sticky top-0 bg-white dark:bg-[#132847]`}>Spending</th><th className={`${th} sticky top-0 bg-white dark:bg-[#132847]`}>Balance</th>
              </tr></thead>
              <tbody>
                {[...budgetRows].reverse().map((r) => (
                  <tr key={r.date} {...rowProps(`budget:${r.date}`)}>
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
            State expenditure by function, $B · Census (most recent 8 years). Public welfare is mostly Medicaid (AHCCCS); insurance trust is mainly state employee retirement payouts. &quot;Other&quot; covers everything else — debt interest, administration, police, natural resources, and smaller functions.
          </p>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={spendRows.slice(-8)} margin={{ top: 5, right: 10, left: -5, bottom: 0 }}>
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
                <Bar dataKey="Corrections" stackId="spend" fill="#7d94b5" />
                <Bar dataKey="Health" stackId="spend" fill="#33507c" />
                <Bar dataKey="Other" stackId="spend" fill="#94a3b8" radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          {spendRows.length > 0 && (
            <div className={`${tableWrap} mt-4 max-h-[320px] overflow-y-auto`}>
              <table className="w-full border-collapse bg-white dark:bg-[#132847]/40">
                <thead><tr className="border-b border-slate-200 dark:border-white/10">
                  <th className={`${th} sticky top-0 bg-white dark:bg-[#132847]`}>Category ({spendRows[spendRows.length - 1].date})</th><th className={`${th} sticky top-0 bg-white dark:bg-[#132847]`}>Amount</th><th className={`${th} sticky top-0 bg-white dark:bg-[#132847]`}>Share</th>
                </tr></thead>
                <tbody>
                  {["Public welfare", "Education", "Insurance trust", "Highways", "Corrections", "Health", "Other"].map((label) => {
                    const last = spendRows[spendRows.length - 1];
                    const v = last[label] as number | null;
                    const total = last["Total"] as number | null;
                    return (
                      <tr key={label} {...rowProps(`spend:${label}`)}>
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
          {(() => {
            const dod = obs
              .filter((o) => o.seriesId === "AZ_DOD_CONTRACTS" && o.value !== null)
              .sort((a, b) => a.obsDate.localeCompare(b.obsDate));
            // Trailing zero months are unposted USASpending data, not real
            // zeros — windows end at the last posted month. Trailing-12-month
            // framing: single awards move a month by billions, so YTD
            // comparisons mislead (cross-checked Oct 2026 vs DoD's Defense
            // Spending by State report — see A&D subsection note).
            while (dod.length > 0 && dod[dod.length - 1].value === 0) dod.pop();
            if (dod.length < 12) return null;
            const ttm = dod.slice(-12).reduce((s, o) => s + (o.value || 0), 0);
            const ttmPrev =
              dod.length >= 24 ? dod.slice(-24, -12).reduce((s, o) => s + (o.value || 0), 0) : 0;
            const chg = ttmPrev > 0 ? ((ttm - ttmPrev) / ttmPrev) * 100 : null;
            const fmt$ = (v: number) =>
              v >= 1e9 ? `$${(v / 1e9).toFixed(2)}B` : `$${Math.round(v / 1e6)}M`;
            const thru = dod[dod.length - 1].obsDate.slice(0, 7);
            return (
              <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-1 rounded-xl border border-slate-200 bg-white px-4 py-3 dark:border-white/10 dark:bg-[#132847]/60">
                <p className="text-sm font-bold text-[#0d1f3c] dark:text-white">🛡 AZ Defense Contracts</p>
                <p className="text-sm text-slate-600 dark:text-white/70">
                  <b>{fmt$(ttm)}</b> trailing 12 mo (thru {thru})
                  {chg !== null && (
                    <span className={chg >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-500"}>
                      {" "}{chg >= 0 ? "▲" : "▼"} {Math.abs(chg).toFixed(1)}% vs prior 12 mo ({fmt$(ttmPrev)})
                    </span>
                  )}
                </p>
                <p className="text-xs text-slate-400 dark:text-white/40">
                  DoD contract obligations performed in Arizona (USASpending) · DoD&apos;s official state report put AZ contract spending at $14.7B in FY2024 — obligations run higher and arrive in lumps · full chart under Industries → Aerospace &amp; Defense.
                </p>
              </div>
            );
          })()}
          </SubSection>

          <SubSection title="Demographics">
            <EventStrip items={demoEvents} onDismiss={dismissEvent} />
<div className={`${chartCard} lg:col-span-2`}>
          <h3 className="mb-1 text-sm font-semibold text-[#0d1f3c] dark:text-white">Valley Demographics — Maricopa County</h3>
          <p className="mb-3 text-xs text-slate-500 dark:text-white/40">
            Census tract view of where age and wealth concentrate, plus population growth ’19–’23. Click any tract for details.
          </p>
          <ValleyDemographics />
        </div>
          </SubSection>

          <SubSection alt title="Permitting & Licensing">
          {/* Top permit counties (U of A EBRC, latest month) */}
          {countyPermits.length >= 3 && (
            <div className="mb-6 flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl border border-[#b8975a]/40 bg-[#b8975a]/5 px-4 py-3 dark:bg-[#b8975a]/10">
              <p className="text-sm font-bold text-[#0d1f3c] dark:text-white">
                🏠 Top permit counties
                <span className="ml-2 text-xs font-medium text-slate-500 dark:text-white/50">
                  {fmtMonth(permitMonth)} · housing permits issued
                </span>
              </p>
              {countyPermits.slice(0, 3).map((c, i) => (
                <p key={c.name} className="text-sm text-slate-700 dark:text-white/80">
                  <span className="font-bold text-[#8a6f3c] dark:text-[#d4b37a]">{i + 1}. {c.name}</span>{" "}
                  <span className="font-semibold text-[#0d1f3c] dark:text-white">{c.value.toLocaleString()}</span>
                  {c.yoy !== null && (
                    <span className={c.yoy >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-500"}>
                      {" "}{c.yoy >= 0 ? "▲" : "▼"} {Math.abs(c.yoy).toFixed(0)}% YoY
                    </span>
                  )}
                </p>
              ))}
              <p className="text-xs text-slate-400 dark:text-white/40">Source: U.S. Census Bureau Building Permits Survey · published by U of A EBRC</p>
            </div>
          )}
            <EventStrip items={expansionEvents} onDismiss={dismissEvent} />
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
                    <tr key={r.date} {...rowProps(`permits:${r.date}`)}>
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
            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              <div className={chartCard}>
                <h3 className="mb-1 text-sm font-semibold text-[#0d1f3c] dark:text-white">Housing Permits by County — Top 5</h3>
                <p className="mb-3 text-xs text-slate-500 dark:text-white/40">Total units authorized, monthly · U.S. Census Bureau BPS · 5-yr</p>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={countyChartRows} margin={{ top: 5, right: 10, left: -5, bottom: 0 }}>
                      <CartesianGrid stroke={grid} strokeDasharray="3 3" />
                      <XAxis dataKey="date" tick={{ fontSize: 11, fill: tick }} tickFormatter={shortDate} minTickGap={50} />
                      <YAxis tick={{ fontSize: 11, fill: tick }} />
                      <Tooltip contentStyle={{ background: dark ? "#0d1f3c" : "#fff", border: `1px solid ${grid}`, fontSize: 12 }} />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      {countyPermits.slice(0, 5).map((c, i) => (
                        <Line
                          key={c.name}
                          type="monotone"
                          dataKey={`AZPERMIT_${countySlug(c.name)}`}
                          name={c.name}
                          stroke={["#b4713f", "#54708f", "#7d94b5", "#8a6f3c", "#b8c4d4"][i % 5]}
                          strokeWidth={2}
                          dot={false}
                        />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
              <div className={chartCard}>
                <h3 className="mb-1 text-sm font-semibold text-[#0d1f3c] dark:text-white">Permits by County — {permitMonth ? fmtMonth(permitMonth) : "Latest"}</h3>
                <p className="mb-3 text-xs text-slate-500 dark:text-white/40">All 15 counties · total units authorized · U.S. Census Bureau BPS — the county series published by U of A EBRC</p>
                <div className={tableWrap}>
                  <table className="w-full border-collapse bg-white dark:bg-[#132847]/40">
                    <thead><tr className="border-b border-slate-200 dark:border-white/10">
                      <th className={th}>County</th><th className={th}>Total</th><th className={th}>Single-Family</th><th className={th}>Share</th><th className={th}>YoY</th>
                    </tr></thead>
                    <tbody>
                      {countyPermits.map((c) => (
                        <tr key={c.name} {...rowProps(`county:${c.name}`)}>
                          <td className={`${td} font-medium`}>{c.name}</td>
                          <td className={td}>{c.value.toLocaleString()}</td>
                          <td className={td}>{c.sf !== null ? c.sf.toLocaleString() : "—"}</td>
                          <td className={td}>{countyPermitTotal ? `${((c.value / countyPermitTotal) * 100).toFixed(1)}%` : "—"}</td>
                          <td className={td}>
                            {c.yoy !== null ? (
                              <span className={c.yoy >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-500"}>
                                {c.yoy >= 0 ? "▲" : "▼"} {Math.abs(c.yoy).toFixed(0)}%
                              </span>
                            ) : "—"}
                          </td>
                        </tr>
                      ))}
                      {countyPermits.length === 0 && <tr><td className={td} colSpan={5}>No county permit data yet — it loads on the next daily ingest.</td></tr>}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </SubSection>
          {commodityData.series.length > 0 && (
            <SubSection title="Commodity Prices">
              <p className="mb-3 text-xs text-slate-500 dark:text-white/40">
                Arizona supplies roughly 70% of U.S. copper, and alfalfa and cotton are among its top cash crops — mining, construction, energy, and farm input costs drive operator margins across the focus sectors. The chips show current exchange futures prices (COMEX / NYMEX / ICE), reconciled against FRED monthly benchmarks on every daily run — the verdict is logged in Data freshness below (commodity-xcheck). Hay and lumber have no exchange-traded price, so they are tracked as BLS producer-price indexes. The chart indexes each monthly benchmark series to 100 five years ago so unlike units can be compared on one axis.
              </p>
              <div className="mb-3 grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
                {commodityData.series.map((s, i) => {
                  const yoy =
                    s.yearAgo?.value && s.latest?.value
                      ? ((s.latest.value - s.yearAgo.value) / s.yearAgo.value) * 100
                      : null;
                  return (
                    <div
                      key={s.id}
                      onMouseEnter={() => setHoverCommodity(s.id)}
                      onMouseLeave={() => setHoverCommodity(null)}
                      className={`rounded-lg border p-3 transition-colors ${hoverCommodity === s.id ? "border-[#b8975a] bg-[#b8975a]/[0.07] dark:border-[#b8975a]" : "border-slate-200 dark:border-white/10"}`}
                    >
                      <p className="flex items-center gap-1.5 text-xs font-medium text-slate-500 dark:text-white/50">
                        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: CHART_COLORS[i % CHART_COLORS.length] }} />
                        {s.name}
                      </p>
                      {s.spot && s.spotDef ? (
                        <>
                          <p className="mt-1 text-lg font-bold text-[#0d1f3c] dark:text-white">
                            {s.spot.value?.toLocaleString(undefined, { minimumFractionDigits: s.spotDef.digits, maximumFractionDigits: s.spotDef.digits })}
                            <span className="ml-1 text-[10px] font-normal text-slate-400 dark:text-white/40">{s.spotDef.unit}</span>
                          </p>
                          <p className="text-[11px] text-slate-400 dark:text-white/40">
                            {s.spotDef.venue} futures · {fmtDate(s.spot.obsDate)}
                            {s.spotChg !== null && (
                              <span className={s.spotChg >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-500"}>
                                {" "}· {s.spotChg >= 0 ? "▲" : "▼"} {Math.abs(s.spotChg).toFixed(1)}% 30d
                              </span>
                            )}
                          </p>
                        </>
                      ) : (
                        <>
                          <p className="mt-1 text-lg font-bold text-[#0d1f3c] dark:text-white">
                            {s.latest?.value?.toLocaleString(undefined, { maximumFractionDigits: s.digits })}
                            <span className="ml-1 text-[10px] font-normal text-slate-400 dark:text-white/40">{s.unit}</span>
                          </p>
                          <p className="text-[11px] text-slate-400 dark:text-white/40">
                            PPI index · {s.latest?.obsDate?.slice(0, 7)}
                            {yoy !== null && (
                              <span>
                                {" "}· {yoy >= 0 ? "▲" : "▼"} {Math.abs(yoy).toFixed(1)}% YoY
                              </span>
                            )}
                          </p>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
              <div className={chartCard}>
                <div className="h-[300px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={commodityData.chartRows} margin={{ top: 5, right: 20, left: 0, bottom: 0 }}>
                      <CartesianGrid stroke={grid} strokeDasharray="3 3" vertical={false} />
                      <XAxis
                        dataKey="month"
                        tick={{ fontSize: 11, fill: tick }}
                        minTickGap={40}
                        tickFormatter={(m: string) => {
                          const [y, mo] = m.split("-");
                          return `${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(mo) - 1]} ’${y.slice(2)}`;
                        }}
                      />
                      <YAxis tick={{ fontSize: 11, fill: tick }} width={40} domain={["auto", "auto"]} />
                      <Tooltip
                        contentStyle={{ background: dark ? "#0d1f3c" : "#fff", border: `1px solid ${grid}`, fontSize: 12 }}
                        formatter={(v, name) => [Number(v).toFixed(1), name]}
                      />
                      <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} iconType="circle" iconSize={8} />
                      {commodityData.series.map((s, i) => (
                        <Line key={s.id} type="monotone" dataKey={s.id} name={s.name} stroke={CHART_COLORS[i % CHART_COLORS.length]} strokeWidth={hoverCommodity === s.id ? 3.5 : 2} strokeOpacity={hoverCommodity && hoverCommodity !== s.id ? 0.12 : 1} dot={false} />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
                <p className="mt-2 text-xs text-slate-400 dark:text-white/30">Indexed: 100 = price five years ago · Monthly benchmarks: IMF, EIA, BLS PPI via FRED · Spot chips: exchange futures (Yahoo), cross-checked against these benchmarks every daily run</p>
              </div>
            </SubSection>
          )}
          <SubSection alt title="Layoffs & WARN Notices">
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
            <div className="max-h-[380px] overflow-y-auto">
            <table className="w-full border-collapse bg-white dark:bg-[#132847]/40">
              <thead className="sticky top-0 z-10 bg-white dark:bg-[#132847]"><tr className="border-b border-slate-200 dark:border-white/10">
                <th className="px-2.5 py-1.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-white/50">Employer</th><th className="px-2.5 py-1.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-white/50">Industry</th><th className="px-2.5 py-1.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-white/50">Location</th><th className="px-2.5 py-1.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-white/50">Affected</th><th className="px-2.5 py-1.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-white/50">Notice date</th>
              </tr></thead>
              <tbody>
                {[...warn]
                  .sort((a, b) => (b.noticeDate || "").localeCompare(a.noticeDate || ""))
                  .map((w) => (
                  <tr key={w.id} {...rowProps(`warn:${w.id}`)}>
                    <td className="px-2.5 py-1.5 text-xs font-medium text-slate-700 dark:text-white/80">{w.employer}</td>
                    <td className="px-2.5 py-1.5 text-xs text-slate-700 dark:text-white/80">{w.industry && <span className="rounded-full bg-[#b8975a]/15 px-2 py-0.5 text-[11px] text-[#8a6f3c] dark:text-[#d4b37a]">{w.industry}</span>}</td>
                    <td className="px-2.5 py-1.5 text-xs text-slate-700 dark:text-white/80">{w.location}</td>
                    <td className="px-2.5 py-1.5 text-xs text-slate-700 dark:text-white/80">{w.headcount ?? "—"}</td>
                    <td className="px-2.5 py-1.5 text-xs text-slate-700 dark:text-white/80">{w.noticeDate ? fmtDate(w.noticeDate) : "—"}</td>
                  </tr>
                ))}
                {warn.length === 0 && <tr><td className="px-2.5 py-1.5 text-xs text-slate-700 dark:text-white/80" colSpan={5}>No WARN notices loaded yet.</td></tr>}
              </tbody>
            </table>
            </div>
            <p className="px-3 py-2 text-xs text-slate-400 dark:text-white/30">Layoffs often precede sales — worth a look when a target-industry employer appears. Source: WARN Act notices dataset.</p>
          </div>
          </SubSection>
            </div>
          )}


          {bottomTab === "deals" && (
            <div>
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
                <th className={th}>Deal</th><th className={th}>Industry</th><th className={th}>Value</th><th className={th}>Announced</th><th className={th}>Source</th><th className={th}></th>
              </tr></thead>
              <tbody>
                {visibleAcq.map((a) => {
                  const title = decodeEntities(a.headline || a.target || "Deal");
                  // Show the parsed Acquirer → Target pair only when it reads
                  // like real company names (short), not a headline fragment.
                  const pairOk =
                    !!a.acquirer &&
                    !!a.target &&
                    a.target.split(/\s+/).length <= 5 &&
                    a.target !== (a.headline || "");
                  return (
                    <tr key={a.id} {...rowProps(`acq:${a.id}`)}>
                      <td className={`${td} max-w-md`}>
                        <span className="font-medium">{title}</span>
                        {pairOk && (
                          <span className="block text-xs text-slate-400 dark:text-white/40">
                            {decodeEntities(a.acquirer)} → {decodeEntities(a.target)}
                            {a.targetLocation ? ` (${decodeEntities(a.targetLocation)})` : ""}
                          </span>
                        )}
                      </td>
                      <td className={td}>{a.industry && <span className="rounded-full bg-[#b8975a]/15 px-2 py-0.5 text-xs text-[#8a6f3c] dark:text-[#d4b37a]">{a.industry}</span>}</td>
                      <td className={`${td} whitespace-nowrap`}>{a.dealValue ? fmtMoney(a.dealValue) : "—"}</td>
                      <td className={`${td} whitespace-nowrap`}>{a.announcedDate ? fmtDate(a.announcedDate) : "—"}</td>
                      <td className={td}>{a.sourceUrl ? <a href={a.sourceUrl} target="_blank" rel="noreferrer" className="text-[#8a6f3c] underline dark:text-[#d4b37a]">{a.publisher || "Link"}</a> : "—"}</td>
                      <td className={`${td} whitespace-nowrap`}>
                        <button onClick={() => setStatus("acquisitions", a.id, "keep")} className="mr-2 text-xs text-emerald-600 dark:text-emerald-400">Keep</button>
                        <button onClick={() => setStatus("acquisitions", a.id, "dismissed")} className="text-xs text-slate-400">Dismiss</button>
                      </td>
                    </tr>
                  );
                })}
                {visibleAcq.length === 0 && <tr><td className={td} colSpan={6}>No Arizona acquisitions in the last 7 days.</td></tr>}
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
                    <tr key={f.id} {...rowProps(`filing:${f.id}`)}>
                      <td className={td}>
                        {f.url ? <a href={f.url} target="_blank" rel="noreferrer" className="font-medium text-[#8a6f3c] underline dark:text-[#d4b37a]">{f.company}</a> : <span className="font-medium">{f.company}</span>}
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
                  {filteredFilings.length === 0 && <tr><td className={td} colSpan={5}>No filings in the last 7 days.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        )}

          </div>
            </div>
          )}
        </div>

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


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
import { usePullToRefresh, pullPillLabel } from "@/components/usePullToRefresh";
import SizeProfileRow, { hasSizeProfile, SUBSECTOR_IDS_CSV } from "@/components/SizeProfileRows";
import CompanyTargets from "@/components/CompanyTargets";
import IndustryExplorer from "@/components/IndustryExplorer";
import FitTargets from "@/components/FitTargets";
import NewsIntel from "@/components/NewsIntel";
import SectorChip from "@/components/SectorChip";
import { Section, SubSection, FullSection, EventStrip } from "@/components/market-sections";
import UpdatesStrip from "@/components/UpdatesStrip";
import ValleyDemographics from "@/components/ValleyDemographics";
import TailwindDetail from "@/components/TailwindDetail";
import { useTheme } from "@/components/ThemeProvider";
import { fmtMoney, fmtDate, uniqueStrings } from "@/lib/format";
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

function primeStats(
  obs: MiIndicatorObs[]
): { latest: number; date: string; m1: number | null; y1: number | null } | null {
  const rows = obs
    .filter((o) => o.seriesId === "DPRIME" && o.value !== null)
    .slice()
    .sort((a, b) => (a.obsDate < b.obsDate ? -1 : 1));
  if (!rows.length) return null;
  const last = rows[rows.length - 1];
  const at = (days: number) => {
    const t = new Date(new Date(last.obsDate).getTime() - days * 86400000).toISOString().slice(0, 10);
    let best: MiIndicatorObs | null = null;
    for (const r of rows) {
      if (r.obsDate <= t) best = r;
      else break;
    }
    return best;
  };
  const m = at(30);
  const y = at(365);
  return {
    latest: last.value!,
    date: last.obsDate,
    m1: m && m.value !== null && last.value !== null ? last.value - m.value : null,
    y1: y && y.value !== null && last.value !== null ? last.value - y.value : null,
  };
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

export default function MarketIntelView({
  embedded = false,
}: { embedded?: boolean }) {
  const { theme } = useTheme();
  const dark = theme === "dark";
  const [latest, setLatest] = useState<LatestMap>({});
  const [obs, setObs] = useState<MiIndicatorObs[]>([]);
  const [tab, setTab] = useState<Tab>("acquisitions");
  // Single tabbed panel (Oct 14, 2026 restructure): one panel under the
  // Updates tiles replaces the stacked sections. Tab restores from the
  // URL hash first, then the session's last choice; default Fit Targets.
  type MainTab = "fit" | "multiples" | "azdata" | "acq";
  const [mainTab, setMainTab] = useState<MainTab>("fit");
  const [buyers, setBuyers] = useState<{ acquirer: string; dealCount: number; totalValue: number | null; deals: { target: string; headline: string; industry: string; dealValue: number | null; announcedDate: string }[] }[]>([]);
  const [spineSeen, setSpineSeen] = useState<string>("");
  useEffect(() => {
    const map: Record<string, MainTab> = { "fit-targets": "fit", multiples: "multiples", "az-data": "azdata", acquisitions: "acq" };
    const fromHash = map[(window.location.hash || "").replace("#", "")];
    const saved = window.sessionStorage.getItem("ccp-mi-tab") || "";
    const valid: MainTab[] = ["fit", "multiples", "azdata", "acq"];
    const pick = fromHash ?? (valid.includes(saved as MainTab) ? (saved as MainTab) : null);
    if (pick) setMainTab(pick);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const selectMainTab = (t: MainTab) => {
    setMainTab(t);
    try {
      window.sessionStorage.setItem("ccp-mi-tab", t);
      window.history.replaceState(null, "", `#${t === "fit" ? "fit-targets" : t === "multiples" ? "multiples" : t === "azdata" ? "az-data" : "acquisitions"}`);
    } catch {
      /* storage unavailable — tab still switches */
    }
  };
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [acquisitions, setAcquisitions] = useState<MiAcquisition[]>([]);
  const [filings, setFilings] = useState<MiFiling[]>([]);
  const [filingCat, setFilingCat] = useState("all");
  const [filingWindow, setFilingWindow] = useState(7);
  const [showDismissed, setShowDismissed] = useState(false);
  const [showOtherD, setShowOtherD] = useState(false);
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

  const loadAll = async () => {
      try {
        const [latestData, obsData, acq, fil, warnData, mult, log, flow] = await Promise.all([
          getJSON<LatestMap>("/api/market/latest"),
          getJSON<MiIndicatorObs[]>(
            "/api/market/indicators?series=DPRIME,SOFR,DGS10,DGS2,DFF,AZUR,UNRATE,AZMFG,MANEMP,AZCONS,USCONS,AZBPPRIV,PERMIT,AZSTHPI,USSTHPI,SMS04000006562000001,CEU6500000001,AZNA,PAYEMS,AZ_DOD_CONTRACTS,AZ_AEROSPACE_CONTRACTS,QTAXTOTALQTAXCAT3AZNO,AZ_STATE_REVENUE,AZ_STATE_EXPENDITURE,AZ_SPEND_WELFARE,AZ_SPEND_EDUCATION,AZ_SPEND_INSURANCE,AZ_SPEND_HIGHWAYS,AZ_SPEND_CORRECTIONS,AZ_SPEND_HEALTH," +
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
          getJSON<MiSyncLog[]>("/api/market/sync-status"),
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
          const cf = await getJSON<{ fitTotal?: number; companies?: { lastSeen?: string }[] }>("/api/market/companies?limit=1");
          setFitTotal(cf.fitTotal ?? null);
          setSpineSeen(cf.companies?.[0]?.lastSeen ?? "");
        } catch {
          /* fit card falls back to a dash */
        }
        try {
          setBuyers(await getJSON("/api/market/competing-buyers"));
        } catch {
          /* competing buyers table shows its empty state */
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
  };

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Pull-to-refresh (mobile PWA).
  const { pull, refreshing } = usePullToRefresh(loadAll);

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
  const rateRows = useMemo(() => {
    const d = new Date();
    d.setFullYear(d.getFullYear() - 3);
    const rows = filterSince(
      seriesToRows(obs.filter((o) => ["DPRIME", "DGS10", "SOFR"].includes(o.seriesId)), ["DPRIME", "DGS10", "SOFR"]),
      d.toISOString().slice(0, 10)
    );
    // SBA 7(a) max for loans over $350K rides on prime (+3.00%).
    return rows.map((r) =>
      typeof r.DPRIME === "number" ? { ...r, SBA_MAX: Math.round((r.DPRIME + 3) * 100) / 100 } : r
    );
  }, [obs]);
  const sbaRows = useMemo(() => {
    const p = primeStats(obs);
    if (!p) return [];
    const bands = [
      { band: "over $350K", spread: 3 },
      { band: "$250–350K", spread: 4.5 },
      { band: "$50–250K", spread: 6 },
      { band: "$50K or less", spread: 6.5 },
    ];
    return bands.map((b) => ({
      ...b,
      value: Math.round((p.latest + b.spread) * 100) / 100,
      date: p.date,
      m1: p.m1,
      y1: p.y1,
    }));
  }, [obs]);
  const rateStats = useMemo(() => {
    const defs = [
      { id: "DPRIME", name: "Bank Prime Loan Rate" },
      { id: "SOFR", name: "SOFR (overnight)" },
      { id: "DGS10", name: "10-Year Treasury" },
      { id: "DGS2", name: "2-Year Treasury" },
      { id: "DFF", name: "Fed Funds Effective" },
    ];
    return defs.map((def) => {
      const rows = obs
        .filter((o) => o.seriesId === def.id && o.value !== null)
        .slice()
        .sort((a, b) => (a.obsDate < b.obsDate ? -1 : 1));
      if (!rows.length)
        return { ...def, latest: null as number | null, date: "", m1: null as number | null, y1: null as number | null };
      const last = rows[rows.length - 1];
      const at = (days: number) => {
        const t = new Date(new Date(last.obsDate).getTime() - days * 86400000).toISOString().slice(0, 10);
        let best: MiIndicatorObs | null = null;
        for (const r of rows) {
          if (r.obsDate <= t) best = r;
          else break;
        }
        return best;
      };
      const m = at(30);
      const y = at(365);
      return {
        ...def,
        latest: last.value,
        date: last.obsDate,
        m1: m && m.value !== null && last.value !== null ? last.value - m.value : null,
        y1: y && y.value !== null && last.value !== null ? last.value - y.value : null,
      };
    });
  }, [obs]);
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
    // ⭐ Top Market Event — the single biggest Arizona story of the
    // last 2 days, scored the way Major Events ranks marquee stories
    // (money first, then scale, acquisition/IPO, focus-industry fit;
    // bankruptcies count too — Ethan never wants to learn about one
    // late). Replaces the old Top Anomaly card (Oct 10, 2026).
    const now = Date.now();
    const evtCutoff = new Date(now - 1 * 864e5).toISOString().slice(0, 10);
    const evtScore = (a: MiAcquisition): number => {
      let s = 0;
      const dv = a.dealValue ?? null;
      if (dv) s += dv >= 1e8 ? 100 : dv >= 2.5e7 ? 60 : dv >= 5e6 ? 30 : 15;
      const text = `${a.headline || ""} ${a.summary || ""}`;
      if (!dv && /\$\s?\d/.test(text)) s += 10;
      if (/\d[\d,]*\s*(jobs|employees|square|sq\.?\s?ft|acres)/i.test(text)) s += 15;
      if (a.eventType === "acquisition" || a.eventType === "ipo") s += 10;
      if (["Aerospace & Defense", "Healthcare", "Advanced Manufacturing", "Specialty Trades & Construction"].includes(a.industry)) s += 10;
      if (a.eventType === "bankruptcy") s += 20;
      return s;
    };
    const evtPool = acquisitions.filter(
      (a) => a.status !== "dismissed" && a.announcedDate && a.announcedDate >= evtCutoff
    );
    const topEvt = evtPool
      .slice()
      .sort((x, y) => evtScore(y) - evtScore(x) || (y.announcedDate || "").localeCompare(x.announcedDate || ""))[0];
    const EVT_KIND: Record<string, string> = {
      acquisition: "Acquisition",
      bankruptcy: "Bankruptcy",
      expansion: "Expansion",
      contract: "Contract award",
      relocation: "Relocation",
      ipo: "IPO",
      investment: "New investment",
      layoffs: "Layoffs",
      policy: "Market policy",
    };
    const topEventCard = topEvt
      ? {
          label: "⭐ Top Market Event",
          value: topEvt.headline || topEvt.target || "—",
          date: `${EVT_KIND[topEvt.eventType] ?? topEvt.eventType} · ${topEvt.announcedDate ?? ""}${
            topEvt.dealValue
              ? ` · $${topEvt.dealValue >= 1e7 ? Math.round(topEvt.dealValue / 1e6) : (topEvt.dealValue / 1e6).toFixed(1)}M`
              : ""
          } · see Major Events below`,
          chg: null,
          chgLabel: undefined,
          invert: false,
        }
      : null;
    // 📈 Market Rates — latest FRED rate observations (daily ingest).
    // Replaces the Businesses For Sale card (Oct 10, 2026); listings
    // still surface in the Updates strip and Activity.
    const rateLatest = (id: string) => {
      const r = obs
        .filter((o) => o.seriesId === id && o.value !== null)
        .sort((x, y) => x.obsDate.localeCompare(y.obsDate));
      return r[r.length - 1];
    };
    const primeO = rateLatest("DPRIME");
    const sofrO = rateLatest("SOFR");
    const t10O = rateLatest("DGS10");
    const indOkMs = syncLog.filter((s) => s.job === "indicators" && s.status === "ok").reduce((m, s) => Math.max(m, +new Date(s.ranAt)), 0);
    const ratesStale = syncLog.length > 0 && (indOkMs === 0 || Date.now() - indOkMs > 48 * 3600_000);
    const ratesCard = primeO
      ? {
          label: "📈 Market Rates",
          value: `Prime ${primeO.value?.toFixed(2)}%`,
          date: `${sofrO ? `SOFR ${sofrO.value?.toFixed(2)}% · ` : ""}${t10O ? `10-Yr Treasury ${t10O.value?.toFixed(2)}% · ` : ""}FRED · as of ${fmtDate(primeO.obsDate)}${ratesStale ? " · ⚠ feed stale" : ""}`,
          chg: null,
        }
      : null;
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
    return [ratesCard, focusCard, fitCard, topEventCard].filter(Boolean) as {
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

  const filingCutoff = new Date(Date.now() - filingWindow * 864e5).toISOString().slice(0, 10);
  const acqWeekCutoff = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);
  const filteredFilings = (filingCat === "all" ? filings : filings.filter((f) => f.category === filingCat))
    .filter((f) => f.filingDate && f.filingDate >= filingCutoff)
    .filter((f) => showDismissed || f.status !== "dismissed")
    .filter((f) => showOtherD || f.category !== "form_d" || f.tag !== "Other")
    .slice()
    .sort((x, y) => (y.filingDate || "").localeCompare(x.filingDate || ""));
  const cleanCo = (n: string) => n.replace(/\s*\(CIK\s+\d+\)\s*$/i, "").replace(/\s*\([A-Z][A-Z0-9.\-]{0,5}\)\s*$/, "").trim();
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
        a.announcedDate >= acqWeekCutoff &&
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
    `rounded-lg px-3 py-1.5 text-sm font-medium ${active ? "font-semibold text-[#0d1f3c] ring-1 ring-inset ring-[#b8975a] dark:text-[#e8cf9a]" : "text-slate-600 hover:bg-[#f0f4fa] dark:text-white/60 dark:hover:bg-white/5"}`;

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
                  Cross-reference: this series computes to ${(fy25 / 1e9).toFixed(1)}B for federal FY2025 · DoD&apos;s published Defense Spending by State report: $14.5B (FY2023) / $14.7B (FY2024) AZ contract spending — different methodology, shown for comparison. The daily ingest re-verifies these monthly figures against USASpending&apos;s fiscal-year totals every run (defense-xcheck in the sync log).
                </p>
              ) : null;
            })()}
          </div>
<div className={chartCard}>
            <h3 className="mb-1 text-sm font-semibold text-[#0d1f3c] dark:text-white">Contracts — Recent Months</h3>
            <p className="mb-3 text-xs text-slate-500 dark:text-white/40">Source data · USASpending.gov, $M</p>
            <div className={tableWrap}>
              <table className="tbl-grad w-full border-collapse bg-white dark:bg-[#132847]/40">
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

  // --- Tab badges, "Updated" labels, and staleness (Oct 14, 2026) ---
  // Data freshness section deleted; each surface now carries its own
  // small label from the source's actual data date, plus an amber dot
  // when a feed has been silent >48h (weekly feeds >7d, census >35d).
  const filings7d = filings.filter((f) => f.status !== "dismissed" && f.filingDate && Date.now() - +new Date(f.filingDate) <= 7 * 864e5).length;
  const lastOkMs = (jobs: string[]) => {
    let m = 0;
    for (const s of syncLog) if (jobs.includes(s.job) && s.status === "ok") m = Math.max(m, +new Date(s.ranAt));
    return m;
  };
  const feedStale = (jobs: string[], hours: number) => {
    const m = lastOkMs(jobs);
    return syncLog.length > 0 && (m === 0 || Date.now() - m > hours * 3600_000);
  };
  const fitStale = spineSeen ? Date.now() - +new Date(spineSeen) > 8 * 864e5 : false;
  const multStale = feedStale(["multiples"], 48);
  const acqStale = feedStale(["news", "econ_events", "bankruptcy_news", "filings"], 48);
  const azStale = feedStale(["county_permits", "sector_counts", "susb_sizes"], 168) || feedStale(["census"], 840);
  const multUpdated = multiples.length ? fmtDate(multiples.reduce((a, m) => (m.createdAt > a ? m.createdAt : a), "")) : "";
  const acqUpdated = acquisitions.length ? fmtDate(acquisitions.reduce((a, x) => (x.announcedDate > a ? x.announcedDate : a), "")) : "";
  const staleMark = (stale: boolean) =>
    stale ? <span className="ml-1.5 text-amber-500" title="Feed has not updated within its expected window">● stale</span> : null;

  return (
    <div className="min-h-screen">
      {!embedded && (
        <PageHero eyebrow="Canny Capital Partners" title="Market Intel" subtitle="Arizona market activity" />
      )}

      <main className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6">
        {(pull > 8 || refreshing) && (
          <div className="pointer-events-none fixed inset-x-0 top-3 z-50 flex justify-center">
            <span className="rounded-full bg-[#0d1f3c] px-3.5 py-1.5 text-xs font-semibold text-white shadow-lg">
              {pullPillLabel(pull, refreshing)}
            </span>
          </div>
        )}
        {error && (
          <div className="mb-4 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
            Couldn&apos;t load market data: {error}. {error.includes("DATABASE_URL") ? "Market Intel needs the Postgres database." : "Data loads after the first daily ingest runs."}
          </div>
        )}

        {/* Stat cards */}
        <div className="mb-4 grid grid-cols-2 items-start gap-3 lg:grid-cols-4">
          {statCards.map((c) => {
            const isEvent = c.label.includes("Top Market Event");
            return (
              <div
                key={c.label}
                className={
                  isEvent
                    ? "rounded-xl border-2 border-[#b8975a] bg-gradient-to-br from-[#b8975a]/20 via-white to-white p-3 shadow-[0_0_28px_rgba(184,151,90,0.35)] dark:via-[#132847]/70 dark:to-[#132847]/70"
                    : "rounded-xl border border-slate-200 bg-white p-3 dark:border-white/10 dark:bg-[#132847]/60"
                }
              >
                <p
                  className={
                    isEvent
                      ? "flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-[#8a6d3b] dark:text-[#d9bc7a]"
                      : "text-xs font-medium uppercase tracking-wider text-slate-500 dark:text-white/50"
                  }
                >
                  {isEvent && (
                    <span className="relative flex h-2 w-2 shrink-0">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#b8975a] opacity-60" />
                      <span className="relative inline-flex h-2 w-2 rounded-full bg-[#b8975a]" />
                    </span>
                  )}
                  {c.label}
                </p>
                <p className={isEvent ? "mt-0.5 text-sm font-semibold leading-snug text-[#0d1f3c] dark:text-white" : "mt-0.5 text-xl font-bold text-[#0d1f3c] dark:text-white"}>{c.value}</p>
                <p className="mt-0.5 line-clamp-2 text-xs leading-snug text-slate-400 dark:text-white/40">
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

        {/* News & Intelligence (redesign Wave 2b): sits between Major
            Events and the tabbed panel; self-contained and defensive —
            it fetches its own feed and never blocks the page. */}
        <NewsIntel />

        {/* Single tabbed panel (Ethan, Oct 14, 2026 restructure): Fit Targets | Industries & Multiples | Arizona Economic Data | Acquisitions & Filings — one panel under the Updates tiles, page ends after it. */}
        <div className="mb-6 rounded-2xl border border-slate-200 bg-white/60 dark:border-white/10 dark:bg-[#132847]/30">
          <div className="sticky top-0 z-20 flex flex-wrap items-center gap-2 rounded-t-2xl border-b-2 border-[#b8975a]/50 bg-white/95 px-3 py-3 backdrop-blur dark:bg-[#0d1f3c]/95 sm:px-4">
            <button onClick={() => selectMainTab("fit")} className={tabBtn(mainTab === "fit")}>
              Fit Targets{fitTotal !== null && <span className="ml-1.5 rounded-full bg-[#b8975a]/15 px-1.5 py-0.5 text-[11px] font-semibold text-[#8a6f3c] dark:text-[#d4b37a]">{fitTotal.toLocaleString()}</span>}
            </button>
            <button onClick={() => selectMainTab("multiples")} className={tabBtn(mainTab === "multiples")}>Industries &amp; Multiples</button>
            <button onClick={() => selectMainTab("azdata")} className={tabBtn(mainTab === "azdata")}>Arizona Economic Data</button>
            <button onClick={() => selectMainTab("acq")} className={tabBtn(mainTab === "acq")}>
              Acquisitions &amp; Filings{filings7d > 0 && <span className="ml-1.5 rounded-full bg-[#b8975a]/15 px-1.5 py-0.5 text-[11px] font-semibold text-[#8a6f3c] dark:text-[#d4b37a]">{filings7d} new</span>}
            </button>
            <span className="ml-auto hidden text-xs text-slate-400 dark:text-white/40 sm:block">
              {mainTab === "fit" && <>Spines updated {spineSeen ? fmtDate(spineSeen) : "—"}{staleMark(fitStale)}</>}
              {mainTab === "multiples" && <>Multiples data as of {multUpdated || "—"}{staleMark(multStale)}</>}
              {mainTab === "azdata" && <>Background datasets, linked at the source{staleMark(azStale)}</>}
              {mainTab === "acq" && <>Latest announced {acqUpdated || "—"} · last 7 days shown{staleMark(acqStale)}</>}
            </span>
          </div>
          <div className="p-3 sm:p-4">
            {mainTab === "fit" && <FitTargets />}
            {mainTab === "multiples" && (
<div className="rounded-2xl border border-[#b8975a]/40 bg-gradient-to-br from-[#e6edf6] via-white to-[#f7f1e3] p-3 shadow-sm dark:from-[#132847] dark:via-[#0d1f3c] dark:to-[#1a3358] sm:p-4">
          <IndustryExplorer
            multiples={multiples}
            dark={dark}
            onMultiplesAdded={async () => setMultiples(await getJSON("/api/market/multiples"))}
            overview={overviewNode}
            extras={sectorExtras}
          />
        </div>
            )}
            {mainTab === "azdata" && (
              <div>
                <p className="mb-3 text-sm text-slate-600 dark:text-white/70">
                  The background datasets behind our scoring, linked at the source. We keep ingesting them — demographics, sector employment, and permits feed target and tailwind scoring — but the charts live with the providers now.
                </p>
        <div className="grid gap-2 sm:grid-cols-2">
          {[
            { name: "Economic Indicators", url: "https://fred.stlouisfed.org", note: "State jobs, income, and housing trends behind demand in our sectors." },
            { name: "State Revenue & Spending", url: "https://www.census.gov/programs-surveys/govfin.html", note: "Arizona's fiscal health and spending mix (AHCCCS/Medicaid, education) that healthcare and trades demand rides on." },
            { name: "Demographics", url: "https://data.census.gov", note: "Tract-level age, income, and population growth — the demand-tailwind inputs for healthcare, hospitality, and construction." },
            { name: "Commodity Prices", url: "https://fred.stlouisfed.org", note: "Copper, energy, and farm input costs that drive operator margins across the focus sectors." },
            { name: "Layoffs & WARN Notices", url: "https://github.com/APVentureEngine/warn-act-notices", note: "Layoff notices often precede sales — worth a look when a target-industry employer appears." },
            { name: "Housing Permits", url: "https://www.census.gov/construction/bps/index.html", note: "Residential construction pulse by county (Census Building Permits Survey)." },
          ].map((l) => (
            <a key={l.name} href={l.url} target="_blank" rel="noreferrer" className="block rounded-xl border border-slate-200 px-3.5 py-3 transition hover:border-[#b8975a] dark:border-white/10">
              <span className="text-sm font-semibold text-[#0d1f3c] dark:text-white">{l.name} <span className="text-[#b8975a]">↗</span></span>
              <span className="mt-0.5 block text-xs text-slate-500 dark:text-white/50">{l.note}</span>
              <span className="mt-1 block text-[11px] text-slate-400 dark:text-white/30">{l.url.replace("https://", "")}</span>
            </a>
          ))}
        </div>
        <TailwindDetail />
              </div>
            )}
            {mainTab === "acq" && (
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
            <table className="tbl-grad w-full border-collapse bg-white dark:bg-[#132847]/40">
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
                      <td className={td}>{a.industry ? <SectorChip sector={a.industry} /> : "—"}</td>
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
            <div className="mb-3 flex flex-wrap items-center gap-2">
              {[["all", "All"], ["acquisition", "M&A 8-Ks"], ["form_d", "Form D"], ["expansion", "Expansion"], ["bankruptcy", "Bankruptcies"]].map(([v, l]) => (
                <button key={v} onClick={() => setFilingCat(v)} className={tabBtn(filingCat === v)}>{l}</button>
              ))}
              <span className="ml-auto flex flex-wrap items-center gap-2">
                <span className="text-xs text-slate-400 dark:text-white/40">Last</span>
                {[7, 30, 90].map((d) => (
                  <button key={d} onClick={() => setFilingWindow(d)} className={tabBtn(filingWindow === d)}>{d} days</button>
                ))}
                <button onClick={() => setShowDismissed((v) => !v)} className={tabBtn(showDismissed)}>Show dismissed</button>
                <button onClick={() => setShowOtherD((v) => !v)} className={tabBtn(showOtherD)}>Show &lsquo;Other&rsquo; Form Ds</button>
              </span>
            </div>
            <div className={tableWrap}>
              <table className="tbl-grad w-full border-collapse bg-white dark:bg-[#132847]/40">
                <thead><tr className="border-b border-slate-200 dark:border-white/10">
                  <th className={th}>Company</th><th className={th}>Form</th><th className={th}>Sector</th><th className={th}>Filed</th><th className={th}>What happened</th><th className={th}></th>
                </tr></thead>
                <tbody>
                  {filteredFilings.map((f) => {
                    let fd: { industryGroup?: string; relatedPersons?: string[]; totalOffering?: number | null; totalSold?: number | null; firstSale?: string; chapter?: string; subV?: boolean; docketNumber?: string } | null = null;
                    try { fd = f.details ? JSON.parse(f.details) : null; } catch { fd = null; }
                    const tagCls = f.tag === "Competing capital"
                      ? "bg-violet-500/15 text-violet-700 dark:text-violet-300"
                      : f.tag === "Operating company raise"
                        ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
                        : f.tag === "Distress / asset sale"
                          ? "bg-red-500/15 text-red-700 dark:text-red-400"
                          : f.tag === "Possible exit buyer"
                            ? "bg-sky-500/15 text-sky-700 dark:text-sky-300"
                            : "bg-slate-500/15 text-slate-500 dark:text-white/50";
                    return (
                      <tr key={f.id} {...rowProps(`filing:${f.id}`)} style={{ ...rowStyle(`filing:${f.id}`), opacity: f.status === "dismissed" ? 0.55 : undefined }}>
                        <td className={td}>
                          {f.url ? <a href={f.url} target="_blank" rel="noreferrer" className="font-medium text-[#8a6f3c] underline dark:text-[#d4b37a]">{cleanCo(f.company)}</a> : <span className="font-medium">{cleanCo(f.company)}</span>}
                          <span className="mt-1 flex flex-wrap gap-1 text-xs">
                            {f.tag && <span className={`rounded-full px-1.5 py-0.5 ${tagCls}`}>{f.tag}</span>}
                            {f.azCompany && <span className="rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-emerald-700 dark:text-emerald-400">AZ company</span>}
                            {f.majorEvent && <span className="rounded-full bg-red-500/15 px-1.5 py-0.5 text-red-700 dark:text-red-400">Major event</span>}
                            {f.status === "dismissed" && <span className="rounded-full bg-slate-500/15 px-1.5 py-0.5 text-slate-500 dark:text-white/50">Dismissed</span>}
                            {f.status === "keep" && <span className="rounded-full bg-[#b8975a]/20 px-1.5 py-0.5 text-[#8a6f3c] dark:text-[#d4b37a]">Kept</span>}
                          </span>
                        </td>
                        <td className={td}><span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs dark:bg-white/10">{f.form}</span></td>
                        <td className={td}><SectorChip sector={f.sector} /></td>
                        <td className={`${td} whitespace-nowrap`}>{f.filingDate ? fmtDate(f.filingDate) : "—"}</td>
                        <td className={`${td} max-w-md`}>
                          <span>{f.summary || "—"}</span>
                          {f.category === "form_d" && fd && (fd.industryGroup || (fd.relatedPersons && fd.relatedPersons.length > 0)) && (
                            <span className="mt-0.5 block text-xs text-slate-400 dark:text-white/40">
                              {fd.industryGroup ? `Industry: ${fd.industryGroup}` : ""}{fd.firstSale ? ` · First sale: ${fd.firstSale}` : ""}{fd.relatedPersons && fd.relatedPersons.length > 0 ? ` · Related: ${uniqueStrings(fd.relatedPersons).join(", ")}` : ""}
                            </span>
                          )}
                          {f.category === "bankruptcy" && fd && fd.docketNumber && (
                            <span className="mt-0.5 block text-xs text-slate-400 dark:text-white/40">Docket {fd.docketNumber} · U.S. Bankruptcy Court, D. Arizona</span>
                          )}
                          {f.why && <span className="mt-0.5 block text-xs italic text-[#8a6f3c] dark:text-[#d4b37a]">Why this matters: {f.why}</span>}
                        </td>
                        <td className={`${td} whitespace-nowrap`}>
                          {f.status !== "keep" && <button onClick={() => setStatus("filings", f.id, "keep")} className="mr-2 text-xs text-emerald-600 dark:text-emerald-400">Keep</button>}
                          {f.status !== "dismissed" && <button onClick={() => setStatus("filings", f.id, "dismissed")} className="text-xs text-slate-400">Dismiss</button>}
                        </td>
                      </tr>
                    );
                  })}
                  {filteredFilings.length === 0 && <tr><td className={td} colSpan={6}>No filings in the last {filingWindow} days.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        )}

          </div>
                <div className="mt-8">
                  <h3 className="mb-1 text-sm font-semibold text-[#0d1f3c] dark:text-white">Competing Buyers — repeat acquirers &amp; platforms</h3>
                  <p className="mb-3 text-xs text-slate-500 dark:text-white/40">Acquirers with 2+ Arizona deals in the acquisitions feed over the last 12 months — the repeat buyers and PE-backed platforms most likely to bid against us on add-ons.</p>
                  <div className={tableWrap}>
                    <table className="tbl-grad w-full border-collapse bg-white dark:bg-[#132847]/40">
                      <thead><tr className="border-b border-slate-200 dark:border-white/10">
                        <th className={th}>Acquirer / platform</th><th className={th}>Deals</th><th className={th}>What was bought</th><th className={th}>Total size</th>
                      </tr></thead>
                      <tbody>
                        {buyers.map((b) => (
                          <tr key={b.acquirer} {...rowProps(`buyer:${b.acquirer}`)}>
                            <td className={`${td} font-medium`}>{decodeEntities(b.acquirer)}</td>
                            <td className={td}>{b.dealCount}</td>
                            <td className={td}>
                              {b.deals.map((d, i) => (
                                <span key={i} className="block text-xs">
                                  {decodeEntities(d.target || d.headline || "Deal")}{d.announcedDate ? ` · ${fmtDate(d.announcedDate)}` : ""}{d.dealValue ? ` · ${fmtMoney(d.dealValue)}` : ""}
                                </span>
                              ))}
                            </td>
                            <td className={`${td} whitespace-nowrap`}>{b.totalValue ? fmtMoney(b.totalValue) : "—"}</td>
                          </tr>
                        ))}
                        {buyers.length === 0 && <tr><td className={td} colSpan={4}>No repeat acquirers yet — a buyer appears here after its second Arizona deal in the feed.</td></tr>}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

      </main>
    </div>
  );
}

/* ---------------- multiples panel ---------------- */


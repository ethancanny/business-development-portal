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

const TABS = ["acquisitions", "filings", "warn", "multiples"] as const;
type Tab = (typeof TABS)[number];

export default function MarketIntelPage() {
  const { theme } = useTheme();
  const dark = theme === "dark";
  const [latest, setLatest] = useState<LatestMap>({});
  const [obs, setObs] = useState<MiIndicatorObs[]>([]);
  const [tab, setTab] = useState<Tab>("acquisitions");
  const [acquisitions, setAcquisitions] = useState<MiAcquisition[]>([]);
  const [filings, setFilings] = useState<MiFiling[]>([]);
  const [filingCat, setFilingCat] = useState("all");
  const [multMetric, setMultMetric] = useState<"ebitda" | "revenue">("ebitda");
  const [multBand, setMultBand] = useState("EV $5–25M");
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
            "/api/market/indicators?series=AZUR,UNRATE,AZMFG,MANEMP,AZCONS,USCONS,AZBPPRIV,PERMIT,AZSTHPI,USSTHPI,SMS04000006562000001,CEU6500000001,AZNA,PAYEMS,AZ_DOD_CONTRACTS,AZ_AEROSPACE_CONTRACTS"
          ),
          getJSON<MiAcquisition[]>("/api/market/acquisitions?status=all"),
          getJSON<MiFiling[]>("/api/market/filings"),
          getJSON<MiWarnNotice[]>("/api/market/warn?limit=50"),
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

  const unempRows = useMemo(
    () => seriesToRows(obs.filter((o) => ["AZUR", "UNRATE"].includes(o.seriesId)), ["AZUR", "UNRATE"]).slice(-60),
    [obs]
  );
  const empRows = useMemo(
    () =>
      indexRows(
        seriesToRows(
          obs.filter((o) => ["AZMFG", "AZCONS", "SMS04000006562000001"].includes(o.seriesId)),
          ["AZMFG", "AZCONS", "SMS04000006562000001"]
        ).slice(-60),
        ["AZMFG", "AZCONS", "SMS04000006562000001"]
      ),
    [obs]
  );
  const permitRows = useMemo(
    () => seriesToRows(obs.filter((o) => o.seriesId === "AZBPPRIV"), ["AZBPPRIV"]).slice(-36),
    [obs]
  );
  const hpiRows = useMemo(
    () =>
      indexRows(
        seriesToRows(
          obs.filter((o) => ["AZSTHPI", "USSTHPI"].includes(o.seriesId)),
          ["AZSTHPI", "USSTHPI"]
        ).slice(-40),
        ["AZSTHPI", "USSTHPI"]
      ),
    [obs]
  );

  const defenseRows = useMemo(() => {
    const rows = seriesToRows(
      obs.filter((o) => ["AZ_DOD_CONTRACTS", "AZ_AEROSPACE_CONTRACTS"].includes(o.seriesId)),
      ["AZ_DOD_CONTRACTS", "AZ_AEROSPACE_CONTRACTS"]
    ).slice(-24);
    // display in $M
    return rows.map((r) => ({
      date: r.date,
      AZ_DOD_CONTRACTS: typeof r.AZ_DOD_CONTRACTS === "number" ? Math.round(r.AZ_DOD_CONTRACTS / 1e6) : null,
      AZ_AEROSPACE_CONTRACTS: typeof r.AZ_AEROSPACE_CONTRACTS === "number" ? Math.round(r.AZ_AEROSPACE_CONTRACTS / 1e6) : null,
    }));
  }, [obs]);

  const statCards = useMemo(() => {
    const card = (id: string, label: string, format: (v: number) => string) => {
      const l = latest[id];
      if (!l || l.value === null) return null;
      const chg = yoyChange(obs, id);
      return { label, value: format(l.value), date: l.obsDate, chg };
    };
    return [
      card("AZUR", "AZ Unemployment", (v) => `${v.toFixed(1)}%`),
      card("UNRATE", "US Unemployment", (v) => `${v.toFixed(1)}%`),
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
    return Array.from(byInd.values())
      .map((m) => ({
        industry: (m.industry.split("—")[1] || m.industry).trim(),
        full: m.industry,
        value: multMetric === "ebitda" ? m.evEbitdaMedian : m.evRevenueMedian,
        notes: m.notes,
      }))
      .filter((d) => d.value !== null && d.value !== undefined)
      .sort((a, b) => (b.value as number) - (a.value as number));
  }, [multiples, multBand, multMetric]);

  const headlines = useMemo(() => {
    const items: { id: string; kind: string; title: string; detail: string; date: string; url: string }[] = [];
    for (const a of acquisitions) {
      if (a.eventType === "bankruptcy" && a.status !== "dismissed") {
        items.push({
          id: `news-${a.id}`,
          kind: "Bankruptcy",
          title: a.target || "Unnamed company",
          detail: `${a.publisher || "News"}${a.industry ? ` · ${a.industry}` : ""}`,
          date: a.announcedDate,
          url: a.sourceUrl,
        });
      }
    }
    for (const f of filings) {
      if (f.majorEvent && f.status !== "dismissed") {
        items.push({
          id: `edgar-${f.id}`,
          kind: "8-K Bankruptcy",
          title: f.company || "Unnamed company",
          detail: `${f.form}${f.azCompany ? " · AZ company" : " · National"}`,
          date: f.filingDate,
          url: f.url,
        });
      }
    }
    // Latest AZ acquisitions
    const recentAcq = acquisitions
      .filter((a) => a.eventType !== "bankruptcy" && a.status !== "dismissed" && a.announcedDate)
      .sort((x, y) => (y.announcedDate || "").localeCompare(x.announcedDate || ""))
      .slice(0, 3);
    for (const a of recentAcq) {
      items.push({
        id: `acq-${a.id}`,
        kind: "Acquisition",
        title: a.target || a.acquirer || "Unnamed deal",
        detail: `${a.acquirer && a.target ? `${a.acquirer} → ${a.target}` : a.publisher || "News"}${a.industry ? ` · ${a.industry}` : ""}`,
        date: a.announcedDate,
        url: a.sourceUrl,
      });
    }
    // Large layoffs
    const bigWarn = warn
      .filter((w) => (w.headcount ?? 0) >= 300)
      .sort((x, y) => (y.noticeDate || "").localeCompare(x.noticeDate || ""))
      .slice(0, 2);
    for (const w of bigWarn) {
      items.push({
        id: `warn-${w.id}`,
        kind: "Major layoffs",
        title: w.employer,
        detail: `${w.headcount} affected · ${w.location}${w.industry ? ` · ${w.industry}` : ""}`,
        date: w.noticeDate,
        url: "",
      });
    }
    return items.sort((x, y) => (y.date || "").localeCompare(x.date || "")).slice(0, 8);
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
              Major events <span className="ml-1 rounded-full bg-red-500/15 px-2 py-0.5 text-xs normal-case text-red-700 dark:text-red-400">AZ headlines</span>
            </h2>
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
              {headlines.map((h) => (
                <a
                  key={h.id}
                  href={h.url || undefined}
                  target={h.url ? "_blank" : undefined}
                  rel="noreferrer"
                  className="rounded-xl border border-red-200 bg-red-50/60 p-4 transition hover:shadow-md dark:border-red-500/25 dark:bg-red-500/10"
                >
                  <p className="text-xs font-semibold uppercase tracking-wider text-red-700 dark:text-red-400">{h.kind}</p>
                  <p className="mt-1 text-base font-bold text-[#0d1f3c] dark:text-white">{h.title}</p>
                  <p className="mt-1 text-xs text-slate-500 dark:text-white/50">
                    {h.detail}{h.date ? ` · ${fmtDate(h.date)}` : ""}
                  </p>
                </a>
              ))}
            </div>
          </div>
        )}

        {/* Charts */}
        <div className="mb-6 grid gap-4 lg:grid-cols-2">
          <div className={chartCard}>
            <h3 className="mb-1 text-sm font-semibold text-[#0d1f3c] dark:text-white">Unemployment — AZ vs US</h3>
            <p className="mb-3 text-xs text-slate-500 dark:text-white/40">Monthly, %, FRED</p>
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
            <p className="mb-3 text-xs text-slate-500 dark:text-white/40">Indexed to 100, monthly, FRED</p>
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
            <h3 className="mb-1 text-sm font-semibold text-[#0d1f3c] dark:text-white">AZ Housing Permits</h3>
            <p className="mb-3 text-xs text-slate-500 dark:text-white/40">New private units authorized, monthly, FRED</p>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={permitRows} margin={{ top: 5, right: 10, left: -5, bottom: 0 }}>
                  <CartesianGrid stroke={grid} strokeDasharray="3 3" />
                  <XAxis dataKey="date" tick={{ fontSize: 11, fill: tick }} tickFormatter={shortDate} minTickGap={50} />
                  <YAxis tick={{ fontSize: 11, fill: tick }} />
                  <Tooltip contentStyle={{ background: dark ? "#0d1f3c" : "#fff", border: `1px solid ${grid}`, fontSize: 12 }} />
                  <Bar dataKey="AZBPPRIV" name="Permits" fill={gold} radius={[2, 2, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className={chartCard}>
            <h3 className="mb-1 text-sm font-semibold text-[#0d1f3c] dark:text-white">House Prices — AZ vs US</h3>
            <p className="mb-3 text-xs text-slate-500 dark:text-white/40">FHFA index, indexed to 100, quarterly, FRED</p>
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
            <h3 className="mb-1 text-sm font-semibold text-[#0d1f3c] dark:text-white">Defense Contracts — Arizona</h3>
            <p className="mb-3 text-xs text-slate-500 dark:text-white/40">Monthly obligations, $M, USASpending.gov</p>
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
        {/* Market multiples — full width */}
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
          </p>
          <div className="h-96">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={multChartData} layout="vertical" margin={{ top: 5, right: 20, left: 10, bottom: 0 }}>
                <CartesianGrid stroke={grid} strokeDasharray="3 3" />
                <XAxis type="number" tick={{ fontSize: 11, fill: tick }} />
                <YAxis type="category" dataKey="industry" width={190} tick={{ fontSize: 12, fill: tick }} />
                <Tooltip
                  contentStyle={{ background: dark ? "#0d1f3c" : "#fff", border: `1px solid ${grid}`, fontSize: 12 }}
                  formatter={(v, _name, props) => [`${v}x`, (props?.payload as { full?: string })?.full || ""]}
                />
                <Bar dataKey="value" fill={gold} radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          {multChartData.length === 0 && (
            <p className="py-4 text-center text-sm text-slate-400">No {multMetric === "ebitda" ? "EV/EBITDA" : "EV/Revenue"} data for this size band yet.</p>
          )}
        </div>
        </div>

        {/* Tabs */}
        <div className="mb-4 flex flex-wrap gap-2">
          {(TABS as readonly string[]).map((t) => (
            <button key={t} onClick={() => setTab(t as Tab)} className={tabBtn(tab === t)}>
              {t === "acquisitions" ? "Acquisitions" : t === "filings" ? "Filings" : t === "warn" ? "WARN Notices" : "Multiples"}
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

        {tab === "warn" && (
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
        )}

        {tab === "multiples" && (
          <MultiplesPanel multiples={multiples} onAdded={async () => setMultiples(await getJSON("/api/market/multiples"))} />
        )}

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

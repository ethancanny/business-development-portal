"use client";

import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import MultiplesPanel from "@/components/MultiplesPanel";
import type { MiMultiple } from "@/lib/types";

/** Combined Industries & Multiples explorer (Ethan, Oct 10, 2026 —
 * replaces the separate Market Multiples hero and Industries sections).
 * An industry switcher at the top drives everything below it: private
 * multiples broken down by subindustry (ExitValue), public comps
 * (Damodaran), and a per-industry deal-structure breakdown. Cells with
 * no published multiple show a best-guess estimate (the industry's own
 * median for that size band) flagged "est" — Ethan approved best
 * guesses where data isn't available. Focus-sector detail blocks
 * (sector charts, size profiles, company targets) are passed in from
 * the page as `extras` and render under the selected focus industry;
 * the all-industries overview (CBP sector chart/table) is `overview`. */

export const INDUSTRY_GROUPS = [
  "Aerospace & Defense",
  "Healthcare",
  "Advanced Manufacturing",
  "Specialty Trades & Construction",
  "Business Services",
  "Consumer & Retail",
  "Technology & Media",
  "Energy & Utilities",
  "Financial Services",
  "Transportation & Logistics",
];

const FOCUS = ["Aerospace & Defense", "Healthcare", "Advanced Manufacturing", "Specialty Trades & Construction"];
const BANDS = ["EV < $5M", "EV $5–25M", "EV $25–100M", "EV $100–500M", "EV > $500M"];
const ALL_BANDS = [...BANDS, "Public comps"];

const BLURBS: Record<string, string> = {
  "Aerospace & Defense": "Our market — Arizona's defense and aerospace supply chain, from precision machining to MRO.",
  Healthcare: "Providers, practices, and healthcare services across the Valley and Tucson.",
  "Advanced Manufacturing": "Industrial equipment, metal fabrication, electronics, plastics, and packaging.",
  "Specialty Trades & Construction": "Specialty contractors and construction trades riding Arizona's building boom.",
  "Business Services": "Agencies, consulting, IT services, and other B2B service firms.",
  "Consumer & Retail": "Restaurants, retail, dealerships, gaming, and consumer products.",
  "Technology & Media": "SaaS, enterprise software, e-commerce, digital media, and broadcast.",
  "Energy & Utilities": "Utilities, oil & gas services, and energy infrastructure.",
  "Financial Services": "Insurance agencies and other financial-service firms.",
  "Transportation & Logistics": "Trucking, freight brokerage, food and wholesale distribution.",
};

/** Per-industry deal structure. Baseline is the IBBA & M&A Source
 * Market Pulse Q2 2026 national lower-middle-market norm (cash at
 * close 83–92%, seller financing under 10%, ~11–12 months to close);
 * the per-industry splits are Canny estimates — no per-industry
 * structure dataset is published — and are labeled as such on the page. */
const DEAL_STRUCTURE: Record<string, { cash: string; seller: string; contingent: string; close: string; note: string }> = {
  "Aerospace & Defense": {
    cash: "85–90%",
    seller: "5–10%",
    contingent: "5–10% earnout / rollover",
    close: "~12 months",
    note: "Customer concentration, ITAR and clearance diligence stretch timelines; earnouts often hinge on contract recompetes and backlog conversion.",
  },
  Healthcare: {
    cash: "80–88%",
    seller: "8–12%",
    contingent: "Rollover equity common",
    close: "~10–12 months",
    note: "Change-of-ownership and payer-enrollment approvals add steps; PE platforms frequently ask sellers to roll 10–30% equity.",
  },
  "Advanced Manufacturing": {
    cash: "83–90%",
    seller: "5–10%",
    contingent: "~5% earnout",
    close: "~10–11 months",
    note: "Equipment-heavy balance sheets support senior debt, keeping cash at close high; customer concentration is the diligence focus.",
  },
  "Specialty Trades & Construction": {
    cash: "78–86%",
    seller: "10–15%",
    contingent: "5–10% earnout on backlog",
    close: "~9–11 months",
    note: "Seller notes are more common here than in any other focus sector; licensing, bonding, and WIP/backlog quality drive the contingent pieces.",
  },
  "Business Services": {
    cash: "82–90%",
    seller: "5–10%",
    contingent: "5–10% earnout",
    close: "~10–12 months",
    note: "People-heavy businesses: retention of key staff and client concentration shape earnouts.",
  },
  "Consumer & Retail": {
    cash: "80–88%",
    seller: "8–12%",
    contingent: "~5% earnout",
    close: "~9–11 months",
    note: "Inventory valuation and lease assignments feature heavily; franchised concepts add franchisor approval.",
  },
  "Technology & Media": {
    cash: "85–92%",
    seller: "under 8%",
    contingent: "8–15% earnout / retention",
    close: "~9–12 months",
    note: "SaaS and software deals lean cash-heavy with retention earnouts for founders and key engineers.",
  },
  "Energy & Utilities": {
    cash: "83–90%",
    seller: "5–10%",
    contingent: "5–10% earnout",
    close: "~11–13 months",
    note: "Commodity exposure, environmental diligence, and regulated assets lengthen the path to close.",
  },
  "Financial Services": {
    cash: "82–90%",
    seller: "5–12%",
    contingent: "Retention earnouts common",
    close: "~10–12 months",
    note: "For insurance agencies the multiple rides on book retention, so earnouts tied to retained revenue are standard.",
  },
  "Transportation & Logistics": {
    cash: "80–88%",
    seller: "8–12%",
    contingent: "~5% earnout",
    close: "~10–12 months",
    note: "Fleet condition and capex needs are diligenced hard; asset value supports the debt piece.",
  },
};

/** Damodaran public-comp industries that belong to each group. */
const PUBLIC_MAP: Record<string, string[]> = {
  "Aerospace & Defense": ["Aerospace/Defense", "Shipbuilding & Marine"],
  Healthcare: [
    "Healthcare Products",
    "Healthcare Support Services",
    "Hospitals/Healthcare Facilities",
    "Heathcare Information and Technology",
    "Drugs (Pharmaceutical)",
    "Drugs (Biotechnology)",
  ],
  "Advanced Manufacturing": [
    "Machinery",
    "Electrical Equipment",
    "Electronics (General)",
    "Semiconductor",
    "Semiconductor Equip",
    "Auto Parts",
    "Steel",
    "Packaging & Container",
    "Building Materials",
    "Construction Supplies",
    "Chemical (Specialty)",
  ],
  "Specialty Trades & Construction": ["Engineering/Construction", "Homebuilding", "Construction Supplies", "Building Materials"],
  "Business Services": ["Business & Consumer Services", "Computer Services", "Information Services", "Office Equipment & Services", "Education"],
  "Consumer & Retail": [
    "Retail (General)",
    "Retail (Special Lines)",
    "Retail (Grocery and Food)",
    "Retail (Automotive)",
    "Retail (Building Supply)",
    "Restaurant/Dining",
    "Hotel/Gaming",
    "Apparel",
    "Household Products",
    "Food Processing",
    "Beverage (Soft)",
    "Beverage (Alcoholic)",
    "Recreation",
    "Entertainment",
  ],
  "Technology & Media": [
    "Software (System & Application)",
    "Software (Internet)",
    "Software (Entertainment)",
    "Computers/Peripherals",
    "Electronics (Consumer & Office)",
    "Telecom. Equipment",
    "Telecom. Services",
    "Telecom (Wireless)",
    "Broadcasting",
    "Cable TV",
    "Publishing & Newspapers",
  ],
  "Energy & Utilities": [
    "Oil/Gas (Integrated)",
    "Oil/Gas (Production and Exploration)",
    "Oil/Gas Distribution",
    "Oilfield Svcs/Equip.",
    "Power",
    "Utility (General)",
    "Utility (Water)",
    "Green & Renewable Energy",
    "Coal & Related Energy",
  ],
  "Financial Services": [
    "Financial Svcs. (Non-bank & Insurance)",
    "Insurance (General)",
    "Insurance (Life)",
    "Insurance (Prop/Cas.)",
    "Reinsurance",
    "Investments & Asset Management",
  ],
  "Transportation & Logistics": ["Transportation", "Transportation (Railroads)", "Trucking", "Air Transport"],
};

function splitIndustry(ind: string): [string, string] {
  const i = ind.indexOf(" — ");
  if (i < 0) return [ind.trim(), ""];
  return [ind.slice(0, i).trim(), ind.slice(i + 3).trim()];
}

function median(vals: number[]): number | null {
  if (!vals.length) return null;
  const s = vals.slice().sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

const pill = (active: boolean) =>
  active
    ? "rounded-full bg-[#d7e1f0] px-3.5 py-1.5 text-sm font-semibold text-[#0d1f3c] dark:bg-[#b8975a]/30 dark:text-[#e8cf9a]"
    : "rounded-full border border-slate-300 px-3.5 py-1.5 text-sm text-slate-600 hover:border-[#b8975a] dark:border-white/15 dark:text-white/60";
const pillSm = (active: boolean) =>
  active
    ? "rounded-full bg-[#d7e1f0] px-3 py-1 text-xs font-semibold text-[#0d1f3c] dark:bg-[#b8975a]/30 dark:text-[#e8cf9a]"
    : "rounded-full border border-slate-300 px-3 py-1 text-xs text-slate-500 hover:border-[#b8975a] dark:border-white/15 dark:text-white/50";

export default function IndustryExplorer({
  multiples,
  dark,
  onMultiplesAdded,
  overview,
  extras,
}: {
  multiples: MiMultiple[];
  dark: boolean;
  onMultiplesAdded: () => void;
  overview?: ReactNode;
  extras?: Record<string, ReactNode>;
}) {
  const [industry, setIndustry] = useState<string>("All Industries");
  const [metric, setMetric] = useState<"revenue" | "ebitda">("revenue");
  const [band, setBand] = useState<string>("EV $5–25M");
  const [hovRow, setHovRow] = useState("");

  const grid = dark ? "rgba(255,255,255,0.08)" : "rgba(13,31,60,0.08)";
  const tick = dark ? "rgba(255,255,255,0.55)" : "#64748b";
  const gold = "#b8975a";
  const card = "rounded-xl border border-slate-200 bg-white p-4 dark:border-white/10 dark:bg-[#132847]/60";
  const th = "px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-white/50";
  const td = "px-3 py-2 text-sm text-slate-700 dark:text-white/80";

  const evRows = useMemo(() => multiples.filter((m) => m.sourceReport.includes("ExitValue")), [multiples]);
  const damRows = useMemo(() => multiples.filter((m) => m.sourceReport.includes("Damodaran")), [multiples]);

  // Subindustries present per group, from ExitValue industry strings.
  const subsByGroup = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const m of evRows) {
      const [g, sub] = splitIndustry(m.industry);
      if (!sub) continue;
      if (!map[g]) map[g] = [];
      if (!map[g].includes(sub)) map[g].push(sub);
    }
    for (const g of Object.keys(map)) map[g].sort();
    return map;
  }, [evRows]);

  const cellOf = (group: string, sub: string, b: string): { v: number | null; est: boolean; notes: string } => {
    let best: MiMultiple | null = null;
    for (const m of evRows) {
      const [g, s] = splitIndustry(m.industry);
      if (g === group && s === sub && m.sizeBand === b) {
        if (!best || (m.period || "") > (best.period || "")) best = m;
      }
    }
    const raw = best ? (metric === "ebitda" ? best.evEbitdaMedian : best.evRevenueMedian) : null;
    if (raw !== null && raw !== undefined) return { v: raw, est: false, notes: best?.notes || "" };
    // Best guess: this industry's own median for the same band + metric.
    const peers: number[] = [];
    for (const m of evRows) {
      const [g] = splitIndustry(m.industry);
      if (g !== group || m.sizeBand !== b) continue;
      const v = metric === "ebitda" ? m.evEbitdaMedian : m.evRevenueMedian;
      if (v !== null && v !== undefined) peers.push(v);
    }
    const est = median(peers);
    return { v: est, est: est !== null, notes: "" };
  };

  const groupMedian = (group: string, b: string): number | null => {
    const vals: number[] = [];
    for (const m of evRows) {
      const [g] = splitIndustry(m.industry);
      if (g !== group || m.sizeBand !== b) continue;
      const v = metric === "ebitda" ? m.evEbitdaMedian : m.evRevenueMedian;
      if (v !== null && v !== undefined) vals.push(v);
    }
    return median(vals);
  };

  // All-industries chart (one bar per subindustry / public comp).
  const effMetric = band === "Public comps" ? "ebitda" : metric;
  const chartData = useMemo(() => {
    const latest: Record<string, MiMultiple> = {};
    const pool = band === "Public comps" ? damRows : evRows;
    for (const m of pool) {
      if (m.sizeBand !== band) continue;
      const cur = latest[m.industry];
      if (!cur || (m.period || "") > (cur.period || "")) latest[m.industry] = m;
    }
    return Object.keys(latest)
      .map((k) => {
        const m = latest[k];
        const [g, sub] = splitIndustry(m.industry);
        return {
          label: sub ? `${g}: ${sub}` : m.industry,
          short: sub || m.industry,
          value: effMetric === "ebitda" ? m.evEbitdaMedian : m.evRevenueMedian,
          ad: /aerospace|defense/i.test(m.industry),
        };
      })
      .filter((d) => d.value !== null && d.value !== undefined)
      .sort((a, b) => (b.value as number) - (a.value as number));
  }, [evRows, damRows, band, effMetric]);

  const rowStyle = (key: string, hot = false) => ({
    backgroundColor:
      hovRow === key
        ? hot
          ? "rgba(184,151,90,0.22)"
          : dark
            ? "rgba(255,255,255,0.08)"
            : "rgb(230,237,246)"
        : hot
          ? "rgba(184,151,90,0.10)"
          : undefined,
    transition: "background-color 200ms ease",
  });

  const subs = industry !== "All Industries" ? subsByGroup[industry] ?? [] : [];
  const pubComps = industry !== "All Industries" ? (PUBLIC_MAP[industry] ?? [])
    .map((name) => damRows.find((m) => m.industry === name))
    .filter((m): m is MiMultiple => !!m && m.evEbitdaMedian !== null && m.evEbitdaMedian !== undefined) : [];
  const ds = industry !== "All Industries" ? DEAL_STRUCTURE[industry] : null;
  const isFocus = FOCUS.includes(industry);

  return (
    <div>
      {/* Industry switcher */}
      <div className="mb-4 flex flex-wrap gap-2">
        <button onClick={() => setIndustry("All Industries")} className={pill(industry === "All Industries")}>
          All Industries
        </button>
        {INDUSTRY_GROUPS.map((g) => (
          <button key={g} onClick={() => setIndustry(g)} className={pill(industry === g)}>
            {FOCUS.includes(g) ? "★ " : ""}{g}
          </button>
        ))}
      </div>

      {industry === "All Industries" && (
        <div>
          {chartData.length > 0 && (
            <div className="mb-4 flex flex-wrap gap-2">
              <span className="rounded-full border border-[#b8975a]/60 bg-white/80 px-3 py-1 text-xs font-semibold text-[#0d1f3c] dark:bg-white/10 dark:text-white">
                ★ Highest: {chartData[0].label} — {Number(chartData[0].value).toFixed(1)}×
              </span>
              <span className="rounded-full border border-[#b8975a]/40 bg-white/60 px-3 py-1 text-xs font-medium text-slate-600 dark:bg-white/5 dark:text-white/70">
                {chartData.length} industries in view
              </span>
              <span className="rounded-full border border-[#b8975a]/40 bg-white/60 px-3 py-1 text-xs font-medium text-slate-600 dark:bg-white/5 dark:text-white/70">
                {effMetric === "ebitda" ? "EV/EBITDA" : "EV/Revenue"} · {band} deals
              </span>
            </div>
          )}
          <div className={card}>
            <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-[#0d1f3c] dark:text-white">Market Multiples by Industry</h3>
              <div className="flex flex-wrap gap-2">
                {(["ebitda", "revenue"] as const).map((v) => (
                  <button key={v} onClick={() => setMetric(v)} className={pillSm(metric === v)}>
                    {v === "ebitda" ? "EV/EBITDA" : "EV/Revenue"}
                  </button>
                ))}
                {ALL_BANDS.map((b) => (
                  <button key={b} onClick={() => setBand(b)} className={pillSm(band === b)}>{b}</button>
                ))}
              </div>
            </div>
            <p className="mb-3 text-xs text-slate-500 dark:text-white/40">
              Median {effMetric === "ebitda" ? "EV/EBITDA" : "EV/Revenue"} multiples, {band} deal size. Sources: ExitValue.ai private-deal data, Damodaran (NYU Stern) public comps, manual entries.
              {effMetric === "ebitda" && band !== "Public comps" && <span className="ml-1 italic">EBITDA data is sparse for smaller deals — try EV/Revenue or a larger band.</span>}
              {band === "Public comps" && <span className="ml-1 italic">Public comps publish EV/EBITDA only.</span>}
            </p>
            <div className="h-[420px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} layout="vertical" margin={{ top: 5, right: 20, left: 10, bottom: 0 }}>
                  <CartesianGrid stroke={grid} strokeDasharray="3 3" />
                  <XAxis type="number" tick={{ fontSize: 11, fill: tick }} />
                  <YAxis type="category" dataKey="label" width={230} tick={{ fontSize: 12, fill: tick }} />
                  <Tooltip
                    contentStyle={{ background: dark ? "#0d1f3c" : "#fff", border: `1px solid ${grid}`, fontSize: 12 }}
                    formatter={(v) => [`${v}x`, ""]}
                  />
                  <Bar dataKey="value" radius={[0, 4, 4, 0]} barSize={14}>
                    {chartData.map((d) => (
                      <Cell key={d.label} fill={d.ad ? (dark ? "#e8cf9a" : "#0d1f3c") : gold} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            {chartData.length === 0 && (
              <p className="py-4 text-center text-sm text-slate-400">No {effMetric === "ebitda" ? "EV/EBITDA" : "EV/Revenue"} data for this size band yet.</p>
            )}
          </div>
          {overview}
          <div className="mt-4">
            <MultiplesPanel multiples={multiples} dark={dark} onAdded={onMultiplesAdded} />
          </div>
        </div>
      )}

      {industry !== "All Industries" && (
        <div>
          <div className="mb-4">
            <h3 className="text-base font-semibold text-[#0d1f3c] dark:text-white">
              {isFocus ? "★ " : ""}{industry}
            </h3>
            <p className="text-sm text-slate-500 dark:text-white/50">{BLURBS[industry]}</p>
          </div>

          <div className="grid gap-4 xl:grid-cols-3">
            <div className={`${card} xl:col-span-2`}>
              <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                <h4 className="text-sm font-semibold text-[#0d1f3c] dark:text-white">Multiples by subindustry</h4>
                <div className="flex gap-2">
                  {(["revenue", "ebitda"] as const).map((v) => (
                    <button key={v} onClick={() => setMetric(v)} className={pillSm(metric === v)}>
                      {v === "ebitda" ? "EV/EBITDA" : "EV/Revenue"}
                    </button>
                  ))}
                </div>
              </div>
              <p className="mb-3 text-xs text-slate-500 dark:text-white/40">
                Median private-deal multiples by EV size band (ExitValue.ai). Cells marked <span className="font-semibold">est</span> are best guesses — the industry&apos;s median for that band — where no subindustry multiple is published.
              </p>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-white/10">
                      <th className={th}>Subindustry</th>
                      {BANDS.map((b) => (
                        <th key={b} className={th}>{b.replace("EV ", "")}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    <tr
                      onMouseEnter={() => setHovRow("overall")}
                      onMouseLeave={() => setHovRow("")}
                      style={rowStyle("overall")}
                      className="border-b border-slate-200 dark:border-white/10"
                    >
                      <td className={`${td} font-semibold`}>Industry overall</td>
                      {BANDS.map((b) => {
                        const v = groupMedian(industry, b);
                        return (
                          <td key={b} className={`${td} font-semibold`}>{v !== null ? `${v.toFixed(2)}×` : "—"}</td>
                        );
                      })}
                    </tr>
                    {subs.map((sub) => (
                      <tr
                        key={sub}
                        onMouseEnter={() => setHovRow(sub)}
                        onMouseLeave={() => setHovRow("")}
                        style={rowStyle(sub, industry === "Aerospace & Defense")}
                        className="border-b border-slate-100 dark:border-white/5"
                      >
                        <td className={`${td} font-medium`}>{sub}</td>
                        {BANDS.map((b) => {
                          const c = cellOf(industry, sub, b);
                          if (c.v === null) return <td key={b} className={td}>—</td>;
                          return (
                            <td key={b} className={td} title={c.est ? "Best guess — industry median for this band" : c.notes}>
                              {c.est ? (
                                <span className="text-slate-400 dark:text-white/45">
                                  ~{c.v.toFixed(2)}× <span className="rounded bg-slate-200 px-1 py-0.5 text-[10px] font-semibold uppercase text-slate-500 dark:bg-white/10 dark:text-white/50">est</span>
                                </span>
                              ) : (
                                `${c.v.toFixed(2)}×`
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                    {subs.length === 0 && (
                      <tr><td className={td} colSpan={6}>No private multiples published for this industry yet — public comps below are the reference.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
              {industry === "Aerospace & Defense" && (
                <p className="mt-3 border-t border-slate-100 pt-2 text-xs text-slate-500 dark:border-white/10 dark:text-white/50">
                  Canny-sized targets ($500K–$2M EBITDA) land mostly in the $5–25M EV band, where the open dataset reports a revenue multiple only — private A&amp;D EBITDA multiples aren&apos;t disclosed at that size, so the $5–25M revenue figure is the working yardstick and the larger-band EBITDA figures are context, not comps.
                </p>
              )}
              {pubComps.length > 0 && (
                <div className="mt-4 border-t border-slate-100 pt-3 dark:border-white/10">
                  <h5 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-white/50">Public comps — Damodaran EV/EBITDA</h5>
                  <div className="flex flex-wrap gap-2">
                    {pubComps.map((m) => (
                      <span key={m.id} className="rounded-full border border-slate-200 px-3 py-1 text-xs text-slate-600 dark:border-white/10 dark:text-white/70">
                        {m.industry}: <strong>{m.evEbitdaMedian}×</strong>
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {ds && (
              <div className={card}>
                <h4 className="mb-1 text-sm font-semibold text-[#0d1f3c] dark:text-white">Typical deal structure — {industry}</h4>
                <p className="mb-3 text-xs text-slate-500 dark:text-white/40">How lower-middle-market deals in this industry are typically structured.</p>
                <div className="space-y-1.5 text-sm text-slate-700 dark:text-white/85">
                  <p className="flex flex-wrap items-baseline justify-between gap-x-3"><span className="font-medium text-slate-600 dark:text-white/70">Cash at close</span><span><strong>{ds.cash}</strong> of value</span></p>
                  <p className="flex flex-wrap items-baseline justify-between gap-x-3"><span className="font-medium text-slate-600 dark:text-white/70">Seller financing</span><span><strong>{ds.seller}</strong></span></p>
                  <p className="flex flex-wrap items-baseline justify-between gap-x-3"><span className="font-medium text-slate-600 dark:text-white/70">Earnout / rollover</span><span><strong>{ds.contingent}</strong></span></p>
                  <p className="flex flex-wrap items-baseline justify-between gap-x-3"><span className="font-medium text-slate-600 dark:text-white/70">Time to close</span><span><strong>{ds.close}</strong></span></p>
                </div>
                <p className="mt-3 text-xs text-slate-500 dark:text-white/50">{ds.note}</p>
                <p className="mt-3 border-t border-slate-100 pt-2 text-xs text-slate-500 dark:border-white/10 dark:text-white/50">
                  Baseline: IBBA &amp; M&amp;A Source Market Pulse Q2 2026 (national, all industries: cash at close 83–92%, seller financing under 10%, ~11–12 months to close; 87% of deals over $5M drew 3+ offers). Per-industry splits are Canny estimates — no per-industry structure dataset is published.
                </p>
              </div>
            )}
          </div>

          {extras && extras[industry]}
        </div>
      )}
    </div>
  );
}

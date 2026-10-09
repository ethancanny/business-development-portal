"use client";

import type { MiIndicatorObs } from "@/lib/types";

/** Business-size profiles (Census SUSB): AZ firm counts split into revenue
 * bands, plus a modeled EBITDA-band estimate. Receipts-class edges in $K —
 * class i spans [edges[i], edges[i+1]); the last class is open ($100M+). */
const SUSB_CLASS_EDGES_K = [0, 100, 500, 1000, 2500, 5000, 7500, 10000, 15000, 20000, 25000, 30000, 35000, 40000, 50000, 75000, 100000];
const SIZE_INDUSTRIES: { slug: string; name: string; group: string }[] = [
  { slug: "3364", name: "Aerospace & Defense", group: "Aerospace & Defense" },
  { slug: "62", name: "Healthcare", group: "Healthcare" },
  { slug: "3133", name: "Advanced Manufacturing", group: "Advanced Manufacturing" },
  { slug: "23", name: "Specialty Trades & Construction", group: "Specialty Trades & Construction" },
];

export function hasSizeProfiles(obs: MiIndicatorObs[]): boolean {
  return obs.some((o) => o.seriesId === "SUSB_AZ_23_FIRMS" && o.value !== null);
}

export default function SizeProfileRows({ obs }: { obs: MiIndicatorObs[] }) {
  const latestObs = (id: string) => {
    const s = obs
      .filter((o) => o.seriesId === id && o.value !== null)
      .sort((a, b) => a.obsDate.localeCompare(b.obsDate));
    return s.length ? s[s.length - 1] : null;
  };
  const latestVal = (id: string): number | null => latestObs(id)?.value ?? null;
  const susbYear = latestObs("SUSB_AZ_23_FIRMS")?.obsDate.slice(0, 4) ?? "";

  const profiles = SIZE_INDUSTRIES.map((ind) => {
    const firms = latestVal(`SUSB_AZ_${ind.slug}_FIRMS`);
    const emp = latestVal(`SUSB_AZ_${ind.slug}_EMP`);
    const rcpt = latestVal(`SUSB_AZ_${ind.slug}_RCPT`);
    const classes: number[] = [];
    for (let i = 0; i < 17; i++)
      classes.push(latestVal(`SUSB_AZ_${ind.slug}_CLS${String(i + 2).padStart(2, "0")}`) ?? 0);
    const classTotal = classes.reduce((a, b) => a + b, 0);
    const base = {
      ...ind,
      firms,
      emp,
      rcpt,
      below: 0,
      band: 0,
      above: 0,
      margin: null as number | null,
      ebitdaCount: null as number | null,
      revLoM: null as number | null,
      revHiM: null as number | null,
    };
    if (!firms || classTotal === 0) return base;
    // classes[i] = SUSB receipts class i+2: 02–06 are under $5M, 07–10 are
    // $5–20M (5–7.5 / 7.5–10 / 10–15 / 15–20), 11–18 are over $20M.
    const below = classes.slice(0, 5).reduce((a, b) => a + b, 0);
    const band = classes.slice(5, 9).reduce((a, b) => a + b, 0);
    const above = classes.slice(9).reduce((a, b) => a + b, 0);
    // EBITDA margin per sector from Damodaran's margin dataset (EBITDA/Sales,
    // median across the sector's public industries), stored as % of sales.
    const marginPct = latestVal(`DAMO_EBITDA_MARGIN_${ind.slug}`);
    const margin = marginPct !== null && marginPct > 1 && marginPct < 60 ? marginPct / 100 : null;
    let ebitdaCount: number | null = null;
    let revLoM: number | null = null;
    let revHiM: number | null = null;
    if (margin) {
      const revLoK = 500 / margin; // revenue ($K) where EBITDA = $500K
      const revHiK = 2000 / margin; // revenue ($K) where EBITDA = $2M
      revLoM = revLoK / 1000;
      revHiM = revHiK / 1000;
      let est = 0;
      for (let i = 0; i < 17; i++) {
        const lo = SUSB_CLASS_EDGES_K[i];
        const hi = i < 16 ? SUSB_CLASS_EDGES_K[i + 1] : lo * 10;
        if (revHiK <= lo || revLoK >= hi) continue;
        const share = Math.log(Math.min(hi, revHiK) / Math.max(lo, revLoK)) / Math.log(hi / lo);
        est += classes[i] * Math.max(0, share);
      }
      ebitdaCount = Math.round(est);
    }
    return { ...base, below: Math.round(below), band: Math.round(band), above: Math.round(above), margin, ebitdaCount, revLoM, revHiM };
  });

  return (
    <>
      {profiles
        .filter((p) => p.firms)
        .map((p) => {
          const tot = p.below + p.band + p.above || 1;
          const pct = (n: number) => ((n / tot) * 100).toFixed(1);
          return (
            <div key={p.slug} className="mb-5">
              <div className="mb-1 flex flex-wrap items-baseline justify-between gap-x-4">
                <p className="text-sm font-semibold text-[#0d1f3c] dark:text-white">{p.name}</p>
                <p className="text-xs text-slate-500 dark:text-white/50">
                  {p.firms?.toLocaleString()} AZ firms
                  {p.emp && p.firms ? ` · ${(p.emp / p.firms).toFixed(0)} avg employees` : ""}
                  {p.rcpt ? ` · $${(p.rcpt / 1e9).toFixed(1)}B receipts` : ""}
                </p>
              </div>
              <div className="flex h-7 w-full overflow-hidden rounded-lg text-[11px] font-medium text-white">
                <div className="flex items-center justify-center bg-slate-400/80 dark:bg-white/25" style={{ width: `${(p.below / tot) * 100}%` }}>
                  {p.below.toLocaleString()}
                </div>
                <div className="flex items-center justify-center bg-[#b8975a]" style={{ width: `${(p.band / tot) * 100}%` }}>
                  {p.band.toLocaleString()}
                </div>
                <div className="flex items-center justify-center bg-[#132847] dark:bg-[#54708f]" style={{ width: `${(p.above / tot) * 100}%` }}>
                  {p.above.toLocaleString()}
                </div>
              </div>
              <p className="mt-1 text-xs text-slate-500 dark:text-white/50">
                Under $5M rev: {p.below.toLocaleString()} ({pct(p.below)}%) ·{" "}
                <b className="text-[#8a6f3e] dark:text-[#d4b37a]">
                  $5–20M: {p.band.toLocaleString()} ({pct(p.band)}%)
                </b>{" "}
                · Over $20M: {p.above.toLocaleString()} ({pct(p.above)}%)
                {p.ebitdaCount !== null && p.margin !== null && (
                  <>
                    {" "}· ≈ <b>{p.ebitdaCount.toLocaleString()} firms in the $500K–$2M EBITDA band</b> (at a ~
                    {(p.margin * 100).toFixed(0)}% margin ≈ ${p.revLoM?.toFixed(1)}–${p.revHiM?.toFixed(1)}M revenue)
                  </>
                )}
              </p>
            </div>
          );
        })}
      <p className="text-xs text-slate-400 dark:text-white/30">
        Sources: U.S. Census Bureau SUSB {susbYear} (AZ firm counts + U.S. receipts-size mix), Damodaran (NYU Stern)
        public-company margins. Establishment counts are cross-checked against BLS QCEW on every refresh — see Data
        freshness (sector-xcheck). The A&D firm base is the CBP establishment count, since the SUSB state file
        doesn&apos;t break out NAICS 3364.
      </p>
    </>
  );
}

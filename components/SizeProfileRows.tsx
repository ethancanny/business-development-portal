"use client";

import type { MiIndicatorObs } from "@/lib/types";

/** Business-size profile for ONE focus industry (Census SUSB): AZ firm
 * counts split into revenue bands, a modeled $500K–$2M EBITDA-band count,
 * and the full receipts-class table. Rendered inside that industry's own
 * subsection on Market Intel. Receipts-class edges in $K — class i spans
 * [edges[i], edges[i+1]); the last class is open ($100M+). */
const SUSB_CLASS_EDGES_K = [0, 100, 500, 1000, 2500, 5000, 7500, 10000, 15000, 20000, 25000, 30000, 35000, 40000, 50000, 75000, 100000];
const CLASS_LABELS = [
  "Under $100K", "$100–500K", "$500K–$1M", "$1–2.5M", "$2.5–5M",
  "$5–7.5M", "$7.5–10M", "$10–15M", "$15–20M",
  "$20–25M", "$25–30M", "$30–35M", "$35–40M", "$40–50M", "$50–75M", "$75–100M", "$100M+",
];

export function hasSizeProfile(obs: MiIndicatorObs[], slug: string): boolean {
  return obs.some((o) => o.seriesId === `SUSB_AZ_${slug}_FIRMS` && o.value !== null);
}

/** Sub-sector breakouts per focus industry (mirrors SUSB_SUBSECTORS in
 * lib/market-ingest.ts). AZ bases are CBP establishments; band counts are
 * modeled server-side from the SUSB US receipts mix. */
export const SUBSECTORS_BY_PARENT: Record<string, { naics: string; name: string }[]> = {
  "3364": [
    { naics: "336411", name: "Aircraft Manufacturing" },
    { naics: "336412", name: "Aircraft Engines & Engine Parts" },
    { naics: "336413", name: "Other Aircraft Parts & Equipment" },
    { naics: "336414", name: "Guided Missiles & Space Vehicles" },
    { naics: "336415", name: "Missile & Space Propulsion Units/Parts" },
    { naics: "336419", name: "Other Missile & Space Vehicle Parts" },
  ],
  "62": [
    { naics: "6211", name: "Offices of Physicians" },
    { naics: "6212", name: "Offices of Dentists" },
    { naics: "6213", name: "Other Health Practitioners" },
    { naics: "6214", name: "Outpatient Care Centers" },
    { naics: "6215", name: "Medical Laboratories & Imaging" },
    { naics: "6216", name: "Home Health Care Services" },
    { naics: "6221", name: "General Medical & Surgical Hospitals" },
    { naics: "6222", name: "Psychiatric & Substance Abuse Hospitals" },
    { naics: "6223", name: "Specialty Hospitals" },
    { naics: "6231", name: "Nursing Care Facilities" },
    { naics: "6233", name: "Continuing Care & Assisted Living" },
    { naics: "6244", name: "Child Care Services" },
  ],
  "3133": [
    { naics: "334413", name: "Semiconductor & Circuit Manufacturing" },
    { naics: "334418", name: "Printed Circuit Assembly" },
    { naics: "334511", name: "Navigation & Guidance Instruments" },
    { naics: "333242", name: "Semiconductor Machinery Manufacturing" },
    { naics: "332710", name: "Machine Shops" },
    { naics: "332999", name: "Misc. Fabricated Metal Products" },
    { naics: "339112", name: "Surgical & Medical Instruments" },
    { naics: "333511", name: "Industrial Mold Manufacturing" },
    { naics: "335929", name: "Other Communication & Energy Wire/Cable" },
    { naics: "326199", name: "Other Plastics Products" },
  ],
  "23": [
    { naics: "236115", name: "New Single-Family Housing Construction" },
    { naics: "236220", name: "Commercial & Institutional Building Construction" },
    { naics: "237110", name: "Water, Sewer & Pipeline Construction" },
    { naics: "237310", name: "Highway, Street & Bridge Construction" },
    { naics: "237990", name: "Other Heavy & Civil Engineering Construction" },
    { naics: "238110", name: "Poured Concrete Contractors" },
    { naics: "238210", name: "Electrical Contractors" },
    { naics: "238220", name: "Plumbing & HVAC Contractors" },
    { naics: "238310", name: "Drywall & Insulation Contractors" },
    { naics: "238320", name: "Painting & Wall Covering Contractors" },
    { naics: "238910", name: "Site Preparation Contractors" },
  ],
};
export const SUBSECTOR_IDS_CSV = Object.values(SUBSECTORS_BY_PARENT)
  .flat()
  .flatMap((s) => [
    `CBP_AZ_SUB_${s.naics}_ESTAB`,
    `CBP_AZ_SUB_${s.naics}_EMP`,
    `SUSB_AZ_SUB_${s.naics}_FIRMS`,
    `SUSB_AZ_SUB_${s.naics}_BAND`,
    `SUSB_AZ_SUB_${s.naics}_EBD`,
  ])
  .join(",");

export default function SizeProfileRow({ obs, slug }: { obs: MiIndicatorObs[]; slug: string }) {
  const latestObs = (id: string) => {
    const s = obs
      .filter((o) => o.seriesId === id && o.value !== null)
      .sort((a, b) => a.obsDate.localeCompare(b.obsDate));
    return s.length ? s[s.length - 1] : null;
  };
  const latestVal = (id: string): number | null => latestObs(id)?.value ?? null;
  const susbYear = latestObs(`SUSB_AZ_${slug}_FIRMS`)?.obsDate.slice(0, 4) ?? "";

  const firms = latestVal(`SUSB_AZ_${slug}_FIRMS`);
  const emp = latestVal(`SUSB_AZ_${slug}_EMP`);
  const rcpt = latestVal(`SUSB_AZ_${slug}_RCPT`);
  const classes: number[] = [];
  for (let i = 0; i < 17; i++)
    classes.push(Math.round(latestVal(`SUSB_AZ_${slug}_CLS${String(i + 2).padStart(2, "0")}`) ?? 0));
  const classTotal = classes.reduce((a, b) => a + b, 0);
  if (!firms || classTotal === 0) return null;

  // classes[i] = SUSB receipts class i+2: classes 02–06 are under $5M,
  // 07–10 are the $5–20M band, 11–18 are over $20M.
  const below = classes.slice(0, 5).reduce((a, b) => a + b, 0);
  const band = classes.slice(5, 9).reduce((a, b) => a + b, 0);
  const above = classes.slice(9).reduce((a, b) => a + b, 0);
  const tot = below + band + above || 1;
  const pct = (n: number) => ((n / tot) * 100).toFixed(1);

  // EBITDA band: Damodaran margin dataset (EBITDA/Sales, sector median),
  // stored as % of sales; the $500K–$2M EBITDA range maps to a revenue
  // range, log-interpolated across the receipts classes.
  const marginPct = latestVal(`DAMO_EBITDA_MARGIN_${slug}`);
  const margin = marginPct !== null && marginPct > 1 && marginPct < 60 ? marginPct / 100 : null;
  let ebitdaCount: number | null = null;
  let revLoM: number | null = null;
  let revHiM: number | null = null;
  if (margin) {
    const revLoK = 500 / margin;
    const revHiK = 2000 / margin;
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

  const subRows = (SUBSECTORS_BY_PARENT[slug] ?? [])
    .map((s) => ({
      ...s,
      firms: latestVal(`SUSB_AZ_SUB_${s.naics}_FIRMS`) ?? latestVal(`CBP_AZ_SUB_${s.naics}_ESTAB`),
      emp: latestVal(`CBP_AZ_SUB_${s.naics}_EMP`),
      band: latestVal(`SUSB_AZ_SUB_${s.naics}_BAND`),
      ebd: latestVal(`SUSB_AZ_SUB_${s.naics}_EBD`),
    }))
    .filter((r) => r.firms !== null && r.firms > 0)
    .sort((a, b) => (b.firms ?? 0) - (a.firms ?? 0));

  const th = "sticky top-0 bg-white px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-slate-500 dark:bg-[#132847] dark:text-white/50";
  const td = "px-3 py-2 text-sm text-slate-700 dark:text-white/80";

  return (
    <div className="mb-5 mt-4">
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-x-4">
        <h3 className="text-sm font-semibold text-[#0d1f3c] dark:text-white">Company size — target bands</h3>
        <p className="text-xs text-slate-500 dark:text-white/50">
          {firms.toLocaleString()} AZ firms
          {emp ? ` · ${(emp / firms).toFixed(0)} avg employees` : ""}
          {rcpt ? ` · $${(rcpt / 1e9).toFixed(1)}B receipts` : ""}
        </p>
      </div>
      <div className="flex h-7 w-full overflow-hidden rounded-lg text-[11px] font-medium text-white">
        <div className="flex items-center justify-center bg-slate-400/80 dark:bg-white/25" style={{ width: `${(below / tot) * 100}%` }}>
          {below.toLocaleString()}
        </div>
        <div className="flex items-center justify-center bg-[#b8975a]" style={{ width: `${(band / tot) * 100}%` }}>
          {band.toLocaleString()}
        </div>
        <div className="flex items-center justify-center bg-[#132847] dark:bg-[#54708f]" style={{ width: `${(above / tot) * 100}%` }}>
          {above.toLocaleString()}
        </div>
      </div>
      <p className="mt-1 text-xs text-slate-500 dark:text-white/50">
        <b className="text-slate-500 dark:text-white/60">
          Under $5M rev: {below.toLocaleString()} ({pct(below)}%)
        </b>{" "}
        ·{" "}
        <b className="text-[#8a6f3e] dark:text-[#d4b37a]">
          $5–20M: {band.toLocaleString()} ({pct(band)}%)
        </b>{" "}
        ·{" "}
        <b className="text-[#132847] dark:text-[#9db8d4]">
          Over $20M: {above.toLocaleString()} ({pct(above)}%)
        </b>
        {ebitdaCount !== null && margin !== null && (
          <>
            {" "}· ≈ <b>{ebitdaCount.toLocaleString()} firms in the $500K–$2M EBITDA band</b> (at a ~
            {(margin * 100).toFixed(0)}% margin ≈ ${revLoM?.toFixed(1)}–${revHiM?.toFixed(1)}M revenue)
          </>
        )}
      </p>

      <div className="mb-1 mt-4 flex flex-wrap items-baseline justify-between gap-x-4">
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-white/40">Firms by revenue class</p>
        <p className="text-[11px] text-[#8a6f3e] dark:text-[#d4b37a]">gold rows = $5–20M target band</p>
      </div>
      <div className="max-h-64 overflow-auto rounded-xl border border-slate-200 dark:border-white/10">
        <table className="w-full border-collapse bg-white dark:bg-[#132847]/40">
          <thead>
            <tr className="border-b border-slate-200 dark:border-white/10">
              <th className={th}>Revenue class</th>
              <th className={th}>AZ firms</th>
              <th className={th}>Share</th>
            </tr>
          </thead>
          <tbody>
            {classes.map((n, i) => {
              const inBand = i >= 5 && i <= 8;
              return (
                <tr key={i} className={`border-b border-slate-100 dark:border-white/5 ${inBand ? "bg-[#b8975a]/10" : ""}`}>
                  <td className={`${td} ${inBand ? "font-semibold text-[#8a6f3e] dark:text-[#d4b37a]" : ""}`}>{CLASS_LABELS[i]}</td>
                  <td className={`${td} font-medium`}>{n.toLocaleString()}</td>
                  <td className={td}>{((n / classTotal) * 100).toFixed(1)}%</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {subRows.length > 0 && (
        <>
          <div className="mb-1 mt-4 flex flex-wrap items-baseline justify-between gap-x-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-white/40">Sub-sectors</p>
            <p className="text-[11px] text-slate-400 dark:text-white/30">selected NAICS breakouts · companies are CBP establishments · band counts modeled</p>
          </div>
          <div className="max-h-64 overflow-auto rounded-xl border border-slate-200 dark:border-white/10">
            <table className="w-full border-collapse bg-white dark:bg-[#132847]/40">
              <thead>
                <tr className="border-b border-slate-200 dark:border-white/10">
                  <th className={th}>Sub-sector</th>
                  <th className={th}>Companies</th>
                  <th className={th}>Employees</th>
                  <th className={th}>In $5–20M band</th>
                  <th className={th}>In EBITDA band</th>
                </tr>
              </thead>
              <tbody>
                {subRows.map((r) => (
                  <tr key={r.naics} className="border-b border-slate-100 dark:border-white/5">
                    <td className={td}>{r.name}</td>
                    <td className={`${td} font-medium`}>{r.firms?.toLocaleString()}</td>
                    <td className={td}>{r.emp !== null ? r.emp.toLocaleString() : "—"}</td>
                    <td className={`${td} font-medium text-[#8a6f3e] dark:text-[#d4b37a]`}>{r.band !== null ? `≈${r.band.toLocaleString()}` : "—"}</td>
                    <td className={td}>{r.ebd !== null ? `≈${r.ebd.toLocaleString()}` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      <p className="mt-2 text-xs text-slate-400 dark:text-white/30">
        Firm counts: Census SUSB {susbYear} (Arizona actuals). The revenue split is modeled — the industry&apos;s U.S.
        receipts-size mix applied to AZ firm counts (SUSB doesn&apos;t publish receipts size by state) — and
        cross-checked against BLS QCEW on every refresh (sector-xcheck). EBITDA band uses Damodaran (NYU Stern)
        public-company EBITDA margins. Sub-sector company counts are Census CBP establishments with the same
        receipts-mix modeling per NAICS code.
        {slug === "3364" && " A&D firm base is the CBP establishment count, since the SUSB state file doesn't break out NAICS 3364."}
      </p>
    </div>
  );
}

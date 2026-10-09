"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import type { MiCompany } from "@/lib/types";

/** Named company targets for ONE focus industry, built from public
 * registry spines (USASpending recipients, AZ ROC, NPPES, SAM.gov).
 * Rendered inside that industry's own subsection on Market Intel, under
 * the size profile. Rows expand into a profile with registry details
 * and one-click promotion into the acquisition pipeline. */
export default function CompanyTargets({ sector }: { sector: string }) {
  const [rows, setRows] = useState<MiCompany[] | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [hovId, setHovId] = useState<string | null>(null);
  // Row colors painted from state via inline styles so hover/select always
  // render regardless of stylesheet generation. (Ethan, Oct 9, 2026.)
  const rowBg = (c: MiCompany, isFit: boolean) => {
    const isDark = typeof document !== "undefined" && document.documentElement.classList.contains("dark");
    if (openId === c.id) return isFit ? "rgba(184,151,90,0.30)" : isDark ? "rgba(184,151,90,0.25)" : "rgba(13,31,60,0.14)";
    if (hovId === c.id) return isFit ? "rgba(184,151,90,0.22)" : isDark ? "rgba(255,255,255,0.08)" : "rgba(13,31,60,0.055)";
    return isFit ? "rgba(184,151,90,0.12)" : undefined;
  };
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetch(`/api/market/companies?sector=${encodeURIComponent(sector)}&limit=800`)
      .then((r) => (r.ok ? r.json() : []))
      .then((data: { companies?: MiCompany[]; total?: number } | MiCompany[]) => {
        if (!live) return;
        const list = Array.isArray(data) ? data : (data.companies ?? []);
        setRows(list);
        setTotal(Array.isArray(data) ? list.length : (data.total ?? list.length));
      })
      .catch(() => {
        if (live) setRows([]);
      });
    return () => {
      live = false;
    };
  }, [sector]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (rows ?? []).filter(
      (c) =>
        c.status !== "dismissed" &&
        (!q ||
          c.name.toLowerCase().includes(q) ||
          c.city.toLowerCase().includes(q) ||
          c.subsector.toLowerCase().includes(q))
    );
  }, [rows, query]);

  if (rows === null) {
    return <p className="mt-4 text-xs text-slate-400 dark:text-white/30">Loading company targets…</p>;
  }
  if (rows.length === 0) return null;

  const th = "sticky top-0 bg-white px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-slate-500 dark:bg-[#132847] dark:text-white/50";
  const td = "px-3 py-2 text-sm text-slate-700 dark:text-white/80";
  const sources = Array.from(new Set(rows.map((r) => r.source))).join(" · ");
  const withSignal = rows.find((r) => r.signalLabel)?.signalLabel;

  const fmtMoney = (v: number) =>
    v >= 1e9
      ? `$${(v / 1e9).toFixed(2)}B`
      : v >= 1e6
        ? `$${(v / 1e6).toFixed(1)}M`
        : v >= 1e3
          ? `$${Math.round(v / 1e3)}K`
          : `$${Math.round(v)}`;
  const yearOf = (d: string) => {
    const m = (d || "").match(/(19|20)\d{2}/);
    return m ? m[0] : "";
  };

  async function setStatus(c: MiCompany, status: MiCompany["status"]) {
    setBusy(c.id);
    try {
      await fetch("/api/market/companies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: c.id, status }),
      });
      setRows((prev) => (prev ?? []).map((r) => (r.id === c.id ? { ...r, status } : r)));
    } finally {
      setBusy(null);
    }
  }

  async function addToPipeline(c: MiCompany) {
    setBusy(c.id);
    try {
      const notes = [
        `Profile from ${c.source} (Market Intel company targets).`,
        c.subsector ? `Sub-sector: ${c.subsector}${c.naics ? ` (NAICS ${c.naics})` : ""}.` : "",
        c.signalValue ? `${c.signalLabel || "Size signal"}: ${fmtMoney(c.signalValue)}.` : "",
        c.contactName ? `Contact on file: ${c.contactName}${c.contactTitle ? `, ${c.contactTitle}` : ""}.` : "",
        c.formedDate ? `Registered/licensed since ${c.formedDate}.` : "",
      ]
        .filter(Boolean)
        .join(" ");
      const res = await fetch("/api/deals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyName: c.name,
          industry: sector,
          city: c.city ? `${c.city}, AZ` : "",
          contactName: c.contactName,
          source: `Market Intel — ${c.source}`,
          notes,
        }),
      });
      if (res.ok) await setStatus(c, "added");
    } finally {
      setBusy(null);
    }
  }

  function fitOf(c: MiCompany): { fit: boolean; why: string } {
    try {
      const d = JSON.parse(c.details || "{}") as Record<string, unknown>;
      return { fit: d.fit === true, why: typeof d.fitWhy === "string" ? d.fitWhy : "" };
    } catch {
      return { fit: false, why: "" };
    }
  }
  function profileDetails(c: MiCompany): [string, string][] {
    try {
      const d = JSON.parse(c.details || "{}") as Record<string, unknown>;
      return Object.entries(d)
        .filter(([k, v]) => k !== "note" && k !== "fit" && k !== "fitWhy" && v !== "" && v !== null && v !== undefined)
        .map(([k, v]) => {
          if (Array.isArray(v)) {
            const s = v
              .map((x) =>
                x && typeof x === "object"
                  ? Object.values(x as Record<string, unknown>).filter(Boolean).join(" · ")
                  : String(x)
              )
              .join("; ");
            return [k, s] as [string, string];
          }
          return [k, String(v)] as [string, string];
        });
    } catch {
      return [];
    }
  }
  function profileNote(c: MiCompany): string {
    try {
      return String((JSON.parse(c.details || "{}") as Record<string, unknown>).note ?? "");
    } catch {
      return "";
    }
  }

  return (
    <div className="mb-5 mt-5">
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 className="text-sm font-semibold text-[#0d1f3c] dark:text-white">Company targets</h3>
        <p className="text-xs text-slate-500 dark:text-white/50">
          {(total ?? rows.length).toLocaleString()} companies · {sources}
          {withSignal ? ` · ranked by ${withSignal.toLowerCase()}` : ""}
          {total !== null && total > rows.length ? ` · showing top ${rows.length}` : ""}
        </p>
      </div>
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search name, city, or sub-sector…"
        className="mb-2 w-full max-w-sm rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 outline-none placeholder:text-slate-400 focus:border-[#b8975a] dark:border-white/10 dark:bg-[#132847]/40 dark:text-white/85"
      />
      <div className="max-h-96 overflow-auto rounded-xl border border-slate-200 dark:border-white/10">
        <table className="w-full border-collapse bg-white dark:bg-[#132847]/40">
          <thead>
            <tr>
              <th className={th}>Company</th>
              <th className={th}>City</th>
              <th className={th}>Sub-sector</th>
              <th className={th}>Since</th>
              <th className={th}>{withSignal || "Signal"}</th>
              <th className={th}></th>
            </tr>
          </thead>
          <tbody>
            {visible.slice(0, 300).map((c) => {
              const fit = fitOf(c);
              return (
              <Fragment key={c.id}>
                <tr
                  onClick={() => setOpenId(openId === c.id ? null : c.id)}
                  onMouseEnter={() => setHovId(c.id)}
                  onMouseLeave={() => setHovId(null)}
                  style={{ backgroundColor: rowBg(c, fit.fit), transition: "background-color 200ms ease" }}
                  className={`cursor-pointer border-t ${
                    fit.fit
                      ? "border-[#b8975a]/40 dark:border-[#b8975a]/30"
                      : "border-slate-100 dark:border-white/5"
                  }`}
                >
                  <td className={`${td} font-medium`}>
                    {c.name}
                    {fit.fit && <span className="ml-2 rounded bg-[#b8975a] px-1.5 py-0.5 text-[10px] font-bold text-white">★ FIT</span>}
                    {c.status === "keep" && <span className="ml-2 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300">KEPT</span>}
                    {c.status === "added" && <span className="ml-2 rounded bg-[#b8975a]/20 px-1.5 py-0.5 text-[10px] font-semibold text-[#8a6f3c] dark:text-[#d4b37a]">IN PIPELINE</span>}
                  </td>
                  <td className={td}>{c.city || "—"}</td>
                  <td className={td}>{c.subsector || "—"}</td>
                  <td className={td}>{yearOf(c.formedDate) || "—"}</td>
                  <td className={`${td} font-medium`}>{c.signalValue ? fmtMoney(c.signalValue) : c.employees ? `${c.employees.toLocaleString()} emp` : "—"}</td>
                  <td className={td}>{openId === c.id ? "▾" : "▸"}</td>
                </tr>
                {openId === c.id && (
                  <tr key={`${c.id}-detail`} className="border-t border-slate-100 bg-slate-50/60 dark:border-white/5 dark:bg-white/5">
                    <td colSpan={6} className="px-3 py-3">
                      <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm text-slate-700 dark:text-white/80 md:grid-cols-3">
                        {c.address && <p><span className="text-slate-400 dark:text-white/40">Address </span>{c.address}{c.zip ? `, ${c.zip}` : ""}</p>}
                        {c.contactName && <p><span className="text-slate-400 dark:text-white/40">Contact </span>{c.contactName}{c.contactTitle ? ` — ${c.contactTitle}` : ""}</p>}
                        {c.phone && <p><span className="text-slate-400 dark:text-white/40">Phone </span>{c.phone}</p>}
                        {c.website && <p><span className="text-slate-400 dark:text-white/40">Web </span><a className="underline" href={c.website.startsWith("http") ? c.website : `https://${c.website}`} target="_blank" rel="noreferrer">{c.website}</a></p>}
                        {c.formedDate && <p><span className="text-slate-400 dark:text-white/40">On file since </span>{c.formedDate}</p>}
                        {c.signalValue ? <p><span className="text-slate-400 dark:text-white/40">{c.signalLabel} </span>{fmtMoney(c.signalValue)}</p> : null}
                        {profileDetails(c).map(([k, v]) => (
                          <p key={k}><span className="text-slate-400 dark:text-white/40">{k} </span>{v}</p>
                        ))}
                        <p><span className="text-slate-400 dark:text-white/40">Source </span>{c.sourceUrl ? <a className="underline" href={c.sourceUrl} target="_blank" rel="noreferrer">{c.source}</a> : c.source}</p>
                      </div>
                      {fit.fit && (
                        <p className="mt-2 rounded-lg bg-[#b8975a]/15 px-2.5 py-1.5 text-xs font-medium text-[#8a6f3c] dark:text-[#d4b37a]">
                          ★ Acquisition fit — {fit.why || "established, right-sized target in a focus sector"}
                        </p>
                      )}
                      {profileNote(c) && <p className="mt-2 text-xs text-slate-500 dark:text-white/50">{profileNote(c)}</p>}
                      <div className="mt-3 flex flex-wrap gap-2">
                        {c.status !== "added" ? (
                          <button disabled={busy === c.id} onClick={() => addToPipeline(c)} className="rounded-lg bg-[#b8975a] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">＋ Add to pipeline</button>
                        ) : (
                          <span className="rounded-lg bg-[#b8975a]/15 px-3 py-1.5 text-xs font-semibold text-[#8a6f3c] dark:text-[#d4b37a]">✓ In pipeline</span>
                        )}
                        {c.status !== "keep" && c.status !== "added" && (
                          <button disabled={busy === c.id} onClick={() => setStatus(c, "keep")} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 disabled:opacity-50 dark:border-white/20 dark:text-white/70">Keep</button>
                        )}
                        <button disabled={busy === c.id} onClick={() => setStatus(c, "dismissed")} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 disabled:opacity-50 dark:border-white/20 dark:text-white/70">Dismiss</button>
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      {visible.length > 300 && <p className="mt-1 text-xs text-slate-400 dark:text-white/30">Showing the top 300 — search to narrow the list.</p>}
      <p className="mt-1 text-xs text-slate-400 dark:text-white/30">
        Public-registry profiles. Registry data shows existence, specialty, age, and size signals — not financials; revenue and EBITDA stay modeled at the sector level above.
      </p>
    </div>
  );
}

"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import type { MiCompany } from "@/lib/types";
import { uniqueStrings, dedupeSourceTokens } from "@/lib/format";
import { normalizeSignalForDisplay } from "@/lib/signals-core";
import CompanyLogo from "@/components/CompanyLogo";
import SectorChip from "@/components/SectorChip";
import {
  OutOfFocusChip,
  ShowOutOfFocusToggle,
  useFocus,
} from "@/components/focus/FocusProvider";

/** Named company targets for ONE focus industry, built from public
 * registry spines (USASpending recipients, AZ ROC, NPPES, SAM.gov).
 * Rendered inside that industry's own subsection on Market Intel, under
 * the size profile. Rows expand into a profile with registry details
 * and one-click promotion into the acquisition pipeline. */
export default function CompanyTargets({ sector, sectors, fitOnly = false, heading }: { sector?: string; sectors?: string[]; fitOnly?: boolean; heading?: string }) {
  const sectorList = sectors ?? (sector ? [sector] : []);
  const multi = sectorList.length > 1;
  const [rows, setRows] = useState<MiCompany[] | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const [fitTotal, setFitTotal] = useState<number | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [hovId, setHovId] = useState<string | null>(null);
  // Row colors painted from state via inline styles so hover/select always
  // render regardless of stylesheet generation. (Ethan, Oct 9, 2026.)
  const rowBg = (c: MiCompany, isFit: boolean) => {
    const isDark = typeof document !== "undefined" && document.documentElement.classList.contains("dark");
    if (hovId === c.id) return isFit ? "rgba(184,151,90,0.18)" : isDark ? "rgba(255,255,255,0.08)" : "rgb(230,237,246)";
    return isFit ? "rgba(184,151,90,0.12)" : undefined;
  };
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);
  const [dismissingId, setDismissingId] = useState<string | null>(null);
  const [dismissReason, setDismissReason] = useState("");
  // Filtered Out view (chain/franchise filter, Oct 16, 2026;
  // institutional filter, Oct 17, 2026): a sibling view of the fits
  // section — chain-flagged and institutional-flagged/suspect
  // companies with their reasons and the permanent "Not a chain" /
  // "Not institutional" overrides. The page layout and banner are
  // untouched; the toggle lives in the section header.
  const [view, setView] = useState<"fits" | "filtered">("fits");
  const [filteredRows, setFilteredRows] = useState<MiCompany[] | null>(null);
  const [filteredTotal, setFilteredTotal] = useState<number | null>(null);
  // Focus & Theme §2 (Oct 26, 2026): in Focus mode, companies whose
  // sector is set and not A&D are out of focus — hidden by default
  // behind this list's local toggle, chip-flagged when shown, never
  // deleted or altered. Filtering is client-side over the rows this
  // component already fetched; in "all" mode isOutOfFocus is always
  // false and the list renders exactly as before.
  const { isOutOfFocus } = useFocus();
  const [showOutOfFocus, setShowOutOfFocus] = useState(false);

  useEffect(() => {
    let live = true;
    if (fitOnly) {
      // Fits section (Ethan, Oct 16, 2026): the server owns the stage
      // query — active fits only, newest date_added first, capped —
      // so a dismissal here refetches and the next fit backfills.
      fetch(`/api/market/companies?mode=fits&sectors=${encodeURIComponent(sectorList.join(","))}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d: { companies?: MiCompany[]; fitTotal?: number } | null) => {
          if (!live || !d) return;
          setRows(d.companies ?? []);
          setFitTotal(d.fitTotal ?? 0);
          setTotal(d.fitTotal ?? 0);
        })
        .catch(() => undefined);
      // Filtered Out (chain + institutional filters): flagged
      // companies are fetched alongside so the sibling view + its
      // count are ready.
      fetch(`/api/market/companies?mode=filtered&sectors=${encodeURIComponent(sectorList.join(","))}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d: { companies?: MiCompany[]; filteredTotal?: number; chainTotal?: number } | null) => {
          if (!live || !d) return;
          setFilteredRows(d.companies ?? []);
          setFilteredTotal(d.filteredTotal ?? d.chainTotal ?? 0);
        })
        .catch(() => undefined);
      return () => {
        live = false;
      };
    }
    Promise.all(
      sectorList.map((s) =>
        fetch(`/api/market/companies?sector=${encodeURIComponent(s)}&limit=800`)
          .then((r) => (r.ok ? r.json() : []))
          .catch(() => [])
      )
    ).then((results) => {
      if (!live) return;
      let merged: MiCompany[] = [];
      let tot = 0;
      let fits = 0;
      for (const data of results as ({ companies?: MiCompany[]; total?: number; fitTotal?: number } | MiCompany[])[]) {
        const list = Array.isArray(data) ? data : (data.companies ?? []);
        merged = merged.concat(list);
        tot += Array.isArray(data) ? list.length : (data.total ?? list.length);
        fits += Array.isArray(data) ? 0 : (data.fitTotal ?? 0);
      }
      merged.sort((a, b) => (b.signalValue ?? 0) - (a.signalValue ?? 0));
      setRows(merged);
      setTotal(tot);
      setFitTotal(fits);
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sectorList.join("|"), fitOnly, refreshTick]);

  const visiblePreFocus = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base =
      fitOnly && view === "filtered" ? (filteredRows ?? []) : (rows ?? []);
    return base.filter(
      (c) =>
        // In fitOnly mode the server already scoped rows to the fit
        // stage. In the full tables, dismissed companies stay VISIBLE
        // with a dismissed mark + restore (Ethan, Oct 16, 2026) —
        // they are only gone from the fits section. The Filtered Out
        // view lists chain- or institutional-flagged rows whatever
        // their stage.
        (fitOnly && view === "filtered"
          ? c.isChain || c.isInstitutional || c.institutionalSuspect
          : !fitOnly || c.status === "fit") &&
        (!q ||
          (c.name ?? "").toLowerCase().includes(q) ||
          (c.city ?? "").toLowerCase().includes(q) ||
          (c.subsector ?? "").toLowerCase().includes(q))
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, filteredRows, query, fitOnly, view]);

  // Focus §2 filter, applied AFTER the existing visibility rules:
  // out-of-focus rows drop out unless this list's toggle is on.
  const focusHiddenCount = showOutOfFocus
    ? 0
    : visiblePreFocus.filter((c) => isOutOfFocus(c.sector)).length;
  const visible = showOutOfFocus
    ? visiblePreFocus
    : visiblePreFocus.filter((c) => !isOutOfFocus(c.sector));

  if (rows === null) {
    return <p className="mt-4 text-xs text-slate-400 dark:text-white/30">Loading company targets…</p>;
  }
  if (rows.length === 0 && !fitOnly) return null;

  const th = "sticky top-0 bg-white px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-slate-500 dark:bg-[#132847] dark:text-white/50";
  const td = "px-3 py-2 text-sm text-slate-700 dark:text-white/80";
  const baseRows = fitOnly && view === "filtered" ? (filteredRows ?? []) : rows;
  // Dedupe at the TOKEN level: a company's source is itself composite
  // ("SAM.gov + USASpending"), so whole-string dedupe still printed
  // "USASpending" once per distinct combination (Ethan, Oct 14).
  const sourceTokens: string[] = [];
  baseRows.forEach((r) => {
    (r.source || "").split("+").forEach((t) => {
      const tok = t.trim();
      if (tok && sourceTokens.indexOf(tok) === -1) sourceTokens.push(tok);
    });
  });
  const sources =
    sourceTokens.length > 6
      ? sourceTokens.slice(0, 6).join(" · ") + ` +${sourceTokens.length - 6} more`
      : sourceTokens.join(" · ");
  const withSignal = baseRows.find((r) => r.signalLabel)?.signalLabel;
  // "Since" column (Ethan, Oct 17, 2026): rendered only when at
  // least one visible row has a since year — never an empty column.
  const showSince = visible.some((c) => sinceOf(c) !== "");

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
      const res = await fetch("/api/market/companies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: c.id, status }),
      });
      const d = (await res.json().catch(() => null)) as { status?: MiCompany["status"] } | null;
      const next = d?.status ?? status;
      setRows((prev) => (prev ?? []).map((r) => (r.id === c.id ? { ...r, status: next } : r)));
    } finally {
      setBusy(null);
    }
  }

  /** Dismiss with an optional reason (recorded server-side as
   * dismissed_reason + dismissed_at). In the fits section the row
   * leaves and the next fit backfills via refetch; in the full
   * tables the row stays, marked dismissed. */
  async function dismiss(c: MiCompany) {
    setBusy(c.id);
    try {
      const reason = dismissReason.trim();
      const res = await fetch("/api/market/companies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: c.id, status: "dismissed", reason }),
      });
      if (res.ok) {
        setDismissingId(null);
        setDismissReason("");
        if (fitOnly) {
          setRefreshTick((t) => t + 1);
        } else {
          setRows((prev) =>
            (prev ?? []).map((r) =>
              r.id === c.id
                ? { ...r, status: "dismissed" as const, dismissedAt: new Date().toISOString(), dismissedReason: reason }
                : r
            )
          );
        }
      }
    } finally {
      setBusy(null);
    }
  }

  /** Restore a dismissed company to the fit stage (or 'new' if its
   * fit stamp no longer stands) at its original date_added. */
  async function restore(c: MiCompany) {
    setBusy(c.id);
    try {
      const res = await fetch("/api/market/companies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: c.id, action: "restore" }),
      });
      const d = (await res.json().catch(() => null)) as { status?: MiCompany["status"] } | null;
      if (res.ok) {
        setRows((prev) =>
          (prev ?? []).map((r) =>
            r.id === c.id
              ? { ...r, status: d?.status ?? r.status, dismissedAt: null, dismissedReason: "" }
              : r
          )
        );
      }
    } finally {
      setBusy(null);
    }
  }

  /** "Not a chain" override (chain filter, Oct 16, 2026): clears the
   * flag server-side and records a PERMANENT exemption — detection
   * never re-flags the record. In the fits section both lists refetch
   * (the record returns at its original date_added position); in the
   * full tables the row updates in place. */
  async function notAChain(c: MiCompany) {
    setBusy(c.id);
    try {
      const res = await fetch("/api/market/companies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: c.id, action: "not-a-chain" }),
      });
      if (res.ok) {
        if (fitOnly) setRefreshTick((t) => t + 1);
        setRows((prev) =>
          (prev ?? []).map((r) =>
            r.id === c.id
              ? { ...r, isChain: false, chainReason: "", chainSuspect: false, chainExempt: true }
              : r
          )
        );
        // A row carrying both flags stays in Filtered Out on its
        // institutional flag; a chain-only row leaves the view.
        setFilteredRows((prev) =>
          (prev ?? []).flatMap((r) => {
            if (r.id !== c.id) return [r];
            const next = { ...r, isChain: false, chainReason: "", chainSuspect: false, chainExempt: true };
            return next.isInstitutional || next.institutionalSuspect ? [next] : [];
          })
        );
        setFilteredTotal((t) =>
          t !== null && !c.isInstitutional && !c.institutionalSuspect ? Math.max(0, t - 1) : t
        );
      }
    } finally {
      setBusy(null);
    }
  }

  /** "Not institutional" override (institutional filter, Oct 17,
   * 2026): clears the flag/suspect tag server-side and records a
   * PERMANENT exemption — detection never re-flags the record. In
   * the fits section both lists refetch (the record returns at its
   * original date_added position); in the full tables the row
   * updates in place. */
  async function notAnInstitution(c: MiCompany) {
    setBusy(c.id);
    try {
      const res = await fetch("/api/market/companies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: c.id, action: "not-an-institution" }),
      });
      if (res.ok) {
        if (fitOnly) setRefreshTick((t) => t + 1);
        setRows((prev) =>
          (prev ?? []).map((r) =>
            r.id === c.id
              ? { ...r, isInstitutional: false, institutionalReason: "", institutionalSuspect: false, institutionalExempt: true }
              : r
          )
        );
        setFilteredRows((prev) =>
          (prev ?? []).flatMap((r) => {
            if (r.id !== c.id) return [r];
            const next = { ...r, isInstitutional: false, institutionalReason: "", institutionalSuspect: false, institutionalExempt: true };
            return next.isChain ? [next] : [];
          })
        );
        setFilteredTotal((t) => (t !== null && !c.isChain ? Math.max(0, t - 1) : t));
      }
    } finally {
      setBusy(null);
    }
  }

  async function addToPipeline(c: MiCompany) {
    setBusy(c.id);
    try {
      const notes = [
        `Profile from ${dedupeSourceTokens(c.source)} (Market Intel company targets).`,
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
          industry: c.sector || sector || "",
          city: c.city ? `${c.city}, AZ` : "",
          contactName: c.contactName,
          source: `Market Intel — ${dedupeSourceTokens(c.source)}`,
          notes,
        }),
      });
      if (res.ok) {
        await setStatus(c, "added");
        // Advanced out of the fit stage — refetch so the next most
        // recently added fit backfills the section.
        if (fitOnly) setRefreshTick((t) => t + 1);
      }
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
  /** Keep mark for a fit: the stage stays 'fit', the mark lives in
   * details.kept (older rows may still carry status='keep'). */
  function keptOf(c: MiCompany): boolean {
    if (c.status === "keep") return true;
    try {
      return (JSON.parse(c.details || "{}") as Record<string, unknown>).kept === true;
    } catch {
      return false;
    }
  }
  /** Full date with year for "Data as of" (Ethan, Oct 17, 2026):
   * "2026-10-15" → "October 15, 2026". Parsed as UTC so the rendered
   * day never shifts with the viewer's timezone. */
  function fmtFullDate(v: string): string {
    const m = (v || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return v;
    const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
    if (Number.isNaN(d.getTime())) return v;
    return d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
  }
  /** "Since" year for a row (Ethan, Oct 17, 2026): the registered/
   * licensed year when the record carries one, else the earliest
   * permit year (hospitality groups carry no formed date — their
   * permits do). Empty when the record has neither — the column is
   * hidden for a view where no row has a value. */
  function sinceOf(c: MiCompany): string {
    const y = yearOf(c.formedDate);
    if (y) return y;
    try {
      const d = JSON.parse(c.details || "{}") as Record<string, unknown>;
      return typeof d.earliestPermitDate === "string" ? yearOf(d.earliestPermitDate) : "";
    } catch {
      return "";
    }
  }
  /** Plain-language chain reason for Filtered Out (Ethan, Oct 17,
   * 2026): "Chain/franchise: [brand]" for list matches; the stored
   * rule text, humanized, for the other rules. */
  function chainDisplayReason(c: MiCompany): string {
    const r = c.chainReason || "";
    const brand = r.match(/— "([^"]+)"/);
    if (/^(list|domain|parent|acc):/.test(r) && brand) return `Chain/franchise: ${brand[1]}`;
    if (r.startsWith("locations:")) return `Chain/franchise: ${r.slice("locations:".length).trim()}`;
    if (r.startsWith("language:")) return "Chain/franchise: franchise language in the record";
    if (r.startsWith("ownership:")) return `Chain/franchise: ${r.slice("ownership:".length).trim()}`;
    return r ? `Chain/franchise: ${r}` : "Chain/franchise";
  }
  /** Expanded-row details with readable labels (Ethan, Oct 17, 2026):
   * the raw registry field names never reach the screen. Known keys
   * carry Ethan's labels, revenue figures render as dollars
   * ($4.8M; ranges $2.4M–$7.2M), "Data as of" is a full date, and any
   * remaining key is humanized (camelCase → words) rather than raw. */
  function profileDetails(c: MiCompany): [string, string][] {
    try {
      const d = JSON.parse(c.details || "{}") as Record<string, unknown>;
      const skip = new Set(["note", "fit", "fitWhy", "signals", "fitUnscored", "kept"]);
      const out: [string, string][] = [];
      const used = new Set<string>();
      const val = (k: string) => {
        const v = d[k];
        return v === "" || v === null || v === undefined ? undefined : v;
      };
      const push = (label: string, value: string) => {
        if (value.trim() !== "") out.push([label, value]);
      };
      const money = (v: unknown) => (typeof v === "number" ? fmtMoney(v) : String(v));
      const text = (v: unknown): string => {
        if (Array.isArray(v)) {
          // Detail arrays (licenses, cities) can carry exact repeats
          // from layered enrichments — dedupe the rendered items so
          // no entry prints twice (Oct 14, 2026).
          const items = v.map((x) =>
            x && typeof x === "object"
              ? Object.values(x as Record<string, unknown>).filter(Boolean).join(" · ")
              : String(x)
          );
          return uniqueStrings(items.filter((t) => t.trim() !== "")).join("; ");
        }
        return String(v);
      };
      // Ethan's labeled fields, in his order.
      const ordered: [string, string][] = [
        ["locationCount", "Locations"],
        ["permitCount", "Permits"],
        ["licenseCount", "Licenses"],
        ["commercialLocationCount", "Commercial locations"],
        ["institutionalLocationCount", "Institutional locations"],
        ["cities", "Cities"],
        ["concept", "Concept"],
        ["ownership", "Ownership"],
        ["ownershipBasis", "Ownership basis"],
      ];
      for (const [k, label] of ordered) {
        const v = val(k);
        if (v !== undefined) {
          push(label, text(v));
          used.add(k);
        }
      }
      const revEst = val("revenueEstimate") ?? val("estRevenue");
      if (revEst !== undefined) push("Revenue estimate", money(revEst));
      used.add("revenueEstimate");
      used.add("estRevenue");
      const lo = val("estRevenueLow");
      const hi = val("estRevenueHigh");
      if (lo !== undefined && hi !== undefined) push("Estimated range", `${money(lo)}–${money(hi)}`);
      else if (lo !== undefined) push("Estimated range", money(lo));
      else if (hi !== undefined) push("Estimated range", money(hi));
      used.add("estRevenueLow");
      used.add("estRevenueHigh");
      const conf = val("estConfidence");
      if (conf !== undefined) push("Confidence", text(conf));
      used.add("estConfidence");
      const method = val("estRevenueInputs");
      if (method !== undefined) push("Revenue method", text(method));
      used.add("estRevenueInputs");
      const xc = [val("crossCheck"), val("sbaCrossCheck")]
        .filter((v) => v !== undefined)
        .map((v) => text(v))
        .join(" ");
      if (xc) push("Cross-check", xc);
      used.add("crossCheck");
      used.add("sbaCrossCheck");
      const asOf = val("dataAsOf");
      if (asOf !== undefined) push("Data as of", fmtFullDate(String(asOf)));
      used.add("dataAsOf");
      // Everything else, humanized — never a raw field name.
      const humanize = (k: string) =>
        k
          .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
          .replace(/_/g, " ")
          .replace(/^./, (ch) => ch.toUpperCase());
      for (const [k, v] of Object.entries(d)) {
        if (skip.has(k) || used.has(k) || v === "" || v === null || v === undefined) continue;
        push(humanize(k), /revenue/i.test(k) && typeof v === "number" ? money(v) : text(v));
      }
      return out;
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
  /** Owner-transition signals (Phase 4): review flags only — type,
   * date, source — rendered newest first. Legacy filing/news entries
   * are normalized onto the same shape for display. */
  function signalsOf(c: MiCompany): { type: string; date: string; label: string; source: string }[] {
    try {
      const d = JSON.parse(c.details || "{}") as Record<string, unknown>;
      const arr = Array.isArray(d.signals) ? (d.signals as unknown[]) : [];
      return arr
        .map(normalizeSignalForDisplay)
        .filter((sg) => sg.label)
        .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
    } catch {
      return [];
    }
  }

  /** Expanded profile + actions, shared by the desktop detail row and
   * the mobile card. `touch` enlarges the action buttons to ≥44px. */
  function detailBlock(c: MiCompany, isFit: boolean, touch: boolean) {
    const fit = fitOf(c);
    const btnBase = touch
      ? "flex min-h-[44px] items-center rounded-lg px-3.5 py-2 text-xs font-semibold disabled:opacity-50"
      : "rounded-lg px-3 py-1.5 text-xs disabled:opacity-50";
    return (
      <>
        {c.isInstitutional && (
          <p className="mb-2 rounded-lg bg-red-50 px-2.5 py-1.5 text-xs font-medium text-red-700 dark:bg-red-500/10 dark:text-red-300">
            🏛 Filtered out — {c.institutionalReason || "Institutional"}. It never appears in Fits
            and doesn&apos;t count toward the fits totals. If it&apos;s actually an independent,
            privately owned, for-profit business, override it below — the exemption is permanent.
          </p>
        )}
        {!c.isInstitutional && c.institutionalSuspect && (
          <p className="mb-2 rounded-lg bg-amber-50 px-2.5 py-1.5 text-xs font-medium text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
            ⚠ Possible institution — {c.institutionalReason}. The signal is ambiguous, so it is
            held out of Fits until reviewed. If it&apos;s a commercial business, override it below.
          </p>
        )}
        {!c.isInstitutional && c.isChain && (
          <p className="mb-2 rounded-lg bg-red-50 px-2.5 py-1.5 text-xs font-medium text-red-700 dark:bg-red-500/10 dark:text-red-300">
            ⛓ Filtered out — {chainDisplayReason(c)}. It never appears in Fits and doesn&apos;t
            count toward the fits cap. If it&apos;s actually an independent, owner-operated
            business, override it below — the exemption is permanent.
          </p>
        )}
        {!c.isInstitutional && !c.institutionalSuspect && !c.isChain && c.chainSuspect && (
          <p className="mb-2 rounded-lg bg-amber-50 px-2.5 py-1.5 text-xs font-medium text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
            ⚠ Possible franchise — {c.chainReason}. Weak signal only, so it stays in Fits.
          </p>
        )}
        <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm text-slate-700 dark:text-white/80 md:grid-cols-3">
          {c.address && <p><span className="text-slate-400 dark:text-white/40">Address </span>{c.address}{c.zip ? `, ${c.zip}` : ""}</p>}
          {c.contactName && <p><span className="text-slate-400 dark:text-white/40">Contact </span>{c.contactName}{c.contactTitle ? ` — ${c.contactTitle}` : ""}</p>}
          {c.phone && <p><span className="text-slate-400 dark:text-white/40">Phone </span>{c.phone}</p>}
          {c.website && <p><span className="text-slate-400 dark:text-white/40">Web </span><a className="underline" href={c.website.startsWith("http") ? c.website : `https://${c.website}`} target="_blank" rel="noreferrer">{c.website}</a></p>}
          {c.formedDate && <p><span className="text-slate-400 dark:text-white/40">On file since </span>{c.formedDate}</p>}
          {c.signalValue ? <p><span className="text-slate-400 dark:text-white/40">{c.signalLabel} </span>{fmtMoney(c.signalValue)}</p> : null}
          {profileDetails(c).map(([k, v], i) => (
            <p key={`${k}-${i}`}><span className="text-slate-400 dark:text-white/40">{k} </span>{v}</p>
          ))}
          <p><span className="text-slate-400 dark:text-white/40">Source </span>{c.sourceUrl ? <a className="underline" href={c.sourceUrl} target="_blank" rel="noreferrer">{dedupeSourceTokens(c.source)}</a> : dedupeSourceTokens(c.source)}</p>
        </div>
        {isFit && (
          <p className="mt-2 rounded-lg bg-[#b8975a]/15 px-2.5 py-1.5 text-xs font-medium text-[#8a6f3c] dark:text-[#d4b37a]">
            ★ Acquisition fit — {fit.why || "established, right-sized target in a focus sector"}
          </p>
        )}
        {profileNote(c) && <p className="mt-2 text-xs text-slate-500 dark:text-white/50">{profileNote(c)}</p>}
        {signalsOf(c).length > 0 && (
          <div className="mt-2 rounded-lg bg-slate-50 px-2.5 py-1.5 dark:bg-white/5">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-white/40">Review signals</p>
            <ul className="mt-1 space-y-1">
              {signalsOf(c).slice(0, 8).map((sg, i) => (
                <li key={`${sg.type}-${sg.date}-${i}`} className="flex items-baseline justify-between gap-3 text-xs text-slate-600 dark:text-white/75">
                  <span>⚑ {sg.label}</span>
                  <span className="shrink-0 text-slate-400 dark:text-white/40">{sg.date}{sg.source ? ` · ${sg.source}` : ""}</span>
                </li>
              ))}
            </ul>
            {signalsOf(c).length > 8 && (
              <p className="mt-1 text-[11px] text-slate-400 dark:text-white/40">+{signalsOf(c).length - 8} earlier signals</p>
            )}
          </div>
        )}
        {c.status === "dismissed" && (
          <p className="mt-2 rounded-lg bg-red-50 px-2.5 py-1.5 text-xs font-medium text-red-700 dark:bg-red-500/10 dark:text-red-300">
            ✕ Dismissed{c.dismissedAt ? ` ${c.dismissedAt.slice(0, 10)}` : ""}
            {c.dismissedReason ? ` — ${c.dismissedReason}` : ""}. It stays out of the fits
            section and no sync will re-add it; restore returns it at its original position.
          </p>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          {(c.isInstitutional || c.institutionalSuspect) && (
            <button disabled={busy === c.id} onClick={() => notAnInstitution(c)} className={`${btnBase} bg-emerald-600 font-semibold text-white`}>✓ Not institutional — return to Fits</button>
          )}
          {c.isChain && (
            <button disabled={busy === c.id} onClick={() => notAChain(c)} className={`${btnBase} bg-emerald-600 font-semibold text-white`}>✓ Not a chain — return to Fits</button>
          )}
          {c.status === "dismissed" ? (
            <button disabled={busy === c.id} onClick={() => restore(c)} className={`${btnBase} bg-[#b8975a] font-semibold text-white`}>↩ Restore</button>
          ) : dismissingId === c.id ? (
            <>
              <input
                value={dismissReason}
                onChange={(e) => setDismissReason(e.target.value)}
                placeholder="Reason (optional)"
                maxLength={300}
                className="min-h-[36px] w-56 max-w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-700 outline-none placeholder:text-slate-400 focus:border-[#b8975a] dark:border-white/20 dark:bg-white/5 dark:text-white/85"
              />
              <button disabled={busy === c.id} onClick={() => dismiss(c)} className={`${btnBase} bg-red-600 font-semibold text-white`}>Confirm dismiss</button>
              <button disabled={busy === c.id} onClick={() => { setDismissingId(null); setDismissReason(""); }} className={`${btnBase} border border-slate-300 font-medium text-slate-600 dark:border-white/20 dark:text-white/70`}>Cancel</button>
            </>
          ) : (
            <>
              {c.status !== "added" ? (
                <button disabled={busy === c.id} onClick={() => addToPipeline(c)} className={`${btnBase} bg-[#b8975a] font-semibold text-white`}>＋ Add to pipeline</button>
              ) : (
                <span className={`${btnBase} bg-[#b8975a]/15 font-semibold text-[#8a6f3c] dark:text-[#d4b37a]`}>✓ In pipeline</span>
              )}
              {!keptOf(c) && c.status !== "added" && (
                <button disabled={busy === c.id} onClick={() => setStatus(c, "keep")} className={`${btnBase} border border-slate-300 font-medium text-slate-600 dark:border-white/20 dark:text-white/70`}>Keep</button>
              )}
              <button disabled={busy === c.id} onClick={() => { setDismissingId(c.id); setDismissReason(""); }} className={`${btnBase} border border-slate-300 font-medium text-slate-600 dark:border-white/20 dark:text-white/70`}>Dismiss</button>
            </>
          )}
        </div>
      </>
    );
  }

  return (
    <div className="mb-5 mt-5">
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-semibold text-[#0d1f3c] dark:text-white">{heading ?? "Company targets"}</h3>
          {fitOnly && (
            <span className="inline-flex gap-1">
              <button
                onClick={() => setView("fits")}
                className={`rounded-full border border-slate-200 px-2.5 py-0.5 text-xs font-medium text-slate-600 dark:border-white/15 dark:text-white/70 ${
                  view === "fits" ? "shadow-[0_0_0_1px_#b8975a] text-[#0d1f3c] dark:text-white" : ""
                }`}
              >
                ★ Fits
              </button>
              <button
                onClick={() => setView("filtered")}
                className={`rounded-full border border-slate-200 px-2.5 py-0.5 text-xs font-medium text-slate-600 dark:border-white/15 dark:text-white/70 ${
                  view === "filtered" ? "shadow-[0_0_0_1px_#b8975a] text-[#0d1f3c] dark:text-white" : ""
                }`}
              >
                Filtered out{filteredTotal !== null ? ` (${filteredTotal.toLocaleString()})` : ""}
              </button>
            </span>
          )}
        </div>
        <p className="text-xs text-slate-500 dark:text-white/50">
          {fitOnly && view === "filtered" ? (
            <>
              {(filteredTotal ?? 0).toLocaleString()} filtered out — chains/franchises and institutions · {sources}
            </>
          ) : fitOnly ? (
            <>
              Showing {rows.length.toLocaleString()} of {(fitTotal ?? 0).toLocaleString()} fits · {sources}
            </>
          ) : (
            <>
              {(total ?? rows.length).toLocaleString()} companies · {sources}
              {withSignal ? ` · ranked by ${withSignal.toLowerCase()}` : ""}
              {total !== null && total > rows.length ? ` · showing top ${rows.length}` : ""}
            </>
          )}
        </p>
      </div>
      <div className="mb-2 flex flex-wrap items-center gap-3">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search name, city, or sub-sector…"
          className="w-full max-w-sm rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 outline-none placeholder:text-slate-400 focus:border-[#b8975a] dark:border-white/10 dark:bg-[#132847]/40 dark:text-white/85"
        />
        <ShowOutOfFocusToggle
          show={showOutOfFocus}
          onChange={setShowOutOfFocus}
          hiddenCount={focusHiddenCount}
        />
      </div>
      {fitOnly && visible.length === 0 && (
        <p className="mb-2 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-500 dark:border-white/10 dark:text-white/50">
          {view === "filtered"
            ? (filteredTotal ?? 0) === 0
              ? "Nothing is currently filtered out as a chain/franchise or institution in this scope."
              : "No filtered-out companies match your search."
            : fitTotal === 0
              ? "No companies in this industry currently pass the fit rules (size, independence, focus sector)."
              : "No fits match your search."}
        </p>
      )}
      <div className="hidden max-h-96 overflow-auto rounded-xl border border-slate-200 dark:border-white/10 md:block">
        <table className="tbl-grad w-full border-collapse bg-white dark:bg-[#132847]/40">
          <thead>
            <tr>
              <th className={th}>Company</th>
              {multi && <th className={th}>Industry</th>}
              <th className={th}>City</th>
              <th className={th}>Sub-sector</th>
              {showSince && <th className={th}>Since</th>}
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
                    <span className="mr-2 inline-flex align-middle"><CompanyLogo name={c.name} website={c.website} sector={c.sector} /></span>
                    {c.name}
                    {fit.fit && <span className="ml-2 rounded bg-[#b8975a] px-1.5 py-0.5 text-[10px] font-bold text-white">★ FIT</span>}
                    {keptOf(c) && <span className="ml-2 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300">KEPT</span>}
                    {c.status === "added" && <span className="ml-2 rounded bg-[#b8975a]/20 px-1.5 py-0.5 text-[10px] font-semibold text-[#8a6f3c] dark:text-[#d4b37a]">IN PIPELINE</span>}
                    {c.status === "dismissed" && <span className="ml-2 rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold text-red-700 dark:bg-red-500/20 dark:text-red-300">DISMISSED</span>}
                    {c.isChain && <span className="ml-2 rounded bg-red-600 px-1.5 py-0.5 text-[10px] font-bold text-white">CHAIN</span>}
                    {!c.isChain && c.chainSuspect && <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800 dark:bg-amber-500/20 dark:text-amber-300">POSSIBLE FRANCHISE</span>}
                    {c.isInstitutional && <span className="ml-2 rounded bg-red-600 px-1.5 py-0.5 text-[10px] font-bold text-white">INSTITUTIONAL</span>}
                    {!c.isInstitutional && c.institutionalSuspect && <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800 dark:bg-amber-500/20 dark:text-amber-300">POSSIBLE INSTITUTION</span>}
                    {isOutOfFocus(c.sector) && <span className="ml-2 inline-flex align-middle"><OutOfFocusChip /></span>}
                  </td>
                  {multi && <td className={td}><SectorChip sector={c.sector} /></td>}
                  <td className={td}>{c.city || "—"}</td>
                  <td className={td}>{c.subsector || "—"}</td>
                  {showSince && <td className={td}>{sinceOf(c) || "—"}</td>}
                  <td className={`${td} font-medium`}>{c.signalValue ? fmtMoney(c.signalValue) : c.employees ? `${c.employees.toLocaleString()} emp` : "—"}</td>
                  <td className={td}>{openId === c.id ? "▾" : "▸"}</td>
                </tr>
                {openId === c.id && (
                  <tr key={`${c.id}-detail`} className="border-t border-slate-100 bg-slate-50/60 dark:border-white/5 dark:bg-white/5">
                    <td colSpan={(multi ? 7 : 6) - (showSince ? 0 : 1)} className="px-3 py-3">
                      {detailBlock(c, fit.fit, false)}
                    </td>
                  </tr>
                )}
              </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      {/* Mobile: stacked cards (same rows; tap expands the profile). */}
      <div className="space-y-2.5 md:hidden">
        {visible.slice(0, 300).map((c) => {
          const fit = fitOf(c);
          const open = openId === c.id;
          return (
            <div
              key={c.id}
              className={`overflow-hidden rounded-xl border bg-white shadow-sm dark:bg-[#132847]/40 ${
                fit.fit
                  ? "border-[#b8975a]/50 dark:border-[#b8975a]/40"
                  : "border-slate-200 dark:border-white/10"
              }`}
            >
              <button
                onClick={() => setOpenId(open ? null : c.id)}
                aria-expanded={open}
                className="flex min-h-[44px] w-full items-center gap-2 p-3.5 text-left"
              >
                <CompanyLogo name={c.name} website={c.website} sector={c.sector} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-slate-900 dark:text-white">
                    {c.name}
                    {fit.fit && <span className="ml-2 rounded bg-[#b8975a] px-1.5 py-0.5 text-[10px] font-bold text-white">★ FIT</span>}
                    {keptOf(c) && <span className="ml-2 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300">KEPT</span>}
                    {c.status === "added" && <span className="ml-2 rounded bg-[#b8975a]/20 px-1.5 py-0.5 text-[10px] font-semibold text-[#8a6f3c] dark:text-[#d4b37a]">IN PIPELINE</span>}
                    {c.status === "dismissed" && <span className="ml-2 rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold text-red-700 dark:bg-red-500/20 dark:text-red-300">DISMISSED</span>}
                    {c.isChain && <span className="ml-2 rounded bg-red-600 px-1.5 py-0.5 text-[10px] font-bold text-white">CHAIN</span>}
                    {!c.isChain && c.chainSuspect && <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800 dark:bg-amber-500/20 dark:text-amber-300">POSSIBLE FRANCHISE</span>}
                    {c.isInstitutional && <span className="ml-2 rounded bg-red-600 px-1.5 py-0.5 text-[10px] font-bold text-white">INSTITUTIONAL</span>}
                    {!c.isInstitutional && c.institutionalSuspect && <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800 dark:bg-amber-500/20 dark:text-amber-300">POSSIBLE INSTITUTION</span>}
                    {isOutOfFocus(c.sector) && <span className="ml-2 inline-flex align-middle"><OutOfFocusChip /></span>}
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-slate-500 dark:text-white/50">
                    {[c.city, c.subsector, sinceOf(c) ? `since ${sinceOf(c)}` : ""]
                      .filter(Boolean)
                      .join(" · ") || "—"}
                  </span>
                </span>
                <span className="whitespace-nowrap text-sm font-semibold text-slate-800 dark:text-[#e8dfc8]">
                  {c.signalValue ? fmtMoney(c.signalValue) : c.employees ? `${c.employees.toLocaleString()} emp` : "—"}
                </span>
                <span className="text-slate-400 dark:text-white/40">{open ? "▾" : "▸"}</span>
              </button>
              {multi && (
                <div className="px-3.5 pb-2">
                  <SectorChip sector={c.sector} />
                </div>
              )}
              {open && (
                <div className="border-t border-slate-100 bg-slate-50/60 px-3.5 py-3 dark:border-white/5 dark:bg-white/5">
                  {detailBlock(c, fit.fit, true)}
                </div>
              )}
            </div>
          );
        })}
        {visible.length === 0 && (
          <p className="rounded-xl border border-slate-200 bg-white px-3 py-6 text-center text-sm text-slate-400 dark:border-white/10 dark:bg-[#132847]/40 dark:text-white/40">
            No companies match.
          </p>
        )}
      </div>
      {visible.length > 300 && <p className="mt-1 text-xs text-slate-400 dark:text-white/30">Showing the top 300 — search to narrow the list.</p>}
      <p className="mt-1 text-xs text-slate-400 dark:text-white/30">
        {fitOnly && view === "filtered"
          ? "Filtered out by the institutional filter (run first) and the chain/franchise filter — these records are kept, never deleted, and never count toward the fits cap. “Not institutional” / “Not a chain” on a record returns it to Fits and exempts it permanently."
          : fitOnly
            ? "Fits pass Canny's fit rules — right-sized, independent, in a focus sector. Expand any row to convert it into the acquisition pipeline."
            : "Public-registry profiles. Registry data shows existence, specialty, age, and size signals — not financials; revenue and EBITDA stay modeled at the sector level above."}
      </p>
    </div>
  );
}

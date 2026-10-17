"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import PageHero from "@/components/PageHero";
import { fmtMoney, uniqueStrings } from "@/lib/format";
import type { Deal, Executive, Interaction, Task } from "@/lib/types";
import TaskList from "@/components/TaskList";
import type { Investor } from "@/lib/investors-db";
import CompanyLogo from "@/components/CompanyLogo";
import PersonAvatar from "@/components/PersonAvatar";
import DirectoryGrid from "@/components/DirectoryGrid";
import { ExecutiveModal } from "@/components/Modals";
import SectorChip, { SectorLegend, StageChip } from "@/components/SectorChip";
import { SECTOR_COLORS } from "@/lib/sector-colors";
import { dealFocusSector } from "@/lib/valuation";
import { dealWebsite } from "@/components/DealTable";

/**
 * Directory (Ethan, Oct 9, 2026): every operator and business the firm
 * interacts with, on one page, with a pull-up profile for each — contact
 * details, background/notes, pairings, and a link into the Pipeline.
 * Investors tab added the same day: investor contacts imported from
 * Ethan's "Investment Database" sheet (only those marked Contacted).
 */

interface Entry {
  kind: "operator" | "business" | "investor";
  id: string;
  name: string;
  sub: string;
  stage: string;
  owner: string;
  tags: string[];
  searchText: string;
  /** Focus sector for chip/logo coloring, when the entry maps to one. */
  sector?: string;
  website?: string;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-white/40">
        {label}
      </p>
      <div className="mt-0.5 text-sm font-medium text-[#0d1f3c] dark:text-white">{children}</div>
    </div>
  );
}

export default function Directory() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [execs, setExecs] = useState<Executive[]>([]);
  const [investors, setInvestors] = useState<Investor[]>([]);
  const [q, setQ] = useState("");
  const [tab, setTab] = useState<"operator" | "business" | "investor">("operator");
  const [sel, setSel] = useState<{ kind: string; id: string } | null>(null);
  const [execModal, setExecModal] = useState<{ exec: Executive | null } | null>(null);
  const [touchMode, setTouchMode] = useState(false);
  // List | Grid view (Wave 3): List is the default; the choice
  // persists in localStorage — it never reorders the control.
  const [view, setView] = useState<"list" | "grid">("list");
  const [interactions, setInteractions] = useState<Interaction[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);

  const loadTasks = async () => {
    try {
      const r = await fetch("/api/tasks");
      if (r.ok) {
        const d = await r.json();
        if (Array.isArray(d)) setTasks(d);
      }
    } catch {
      /* follow-ups are an enhancement on this page — never break profiles */
    }
  };

  useEffect(() => {
    try {
      const v = window.localStorage.getItem("ccp-dir-view");
      if (v === "grid" || v === "list") setView(v);
    } catch {
      /* storage unavailable — stay on List */
    }
  }, []);

  const chooseView = (v: "list" | "grid") => {
    setView(v);
    try {
      window.localStorage.setItem("ccp-dir-view", v);
    } catch {
      /* non-fatal */
    }
  };

  useEffect(() => {
    (async () => {
      try {
        const [meRes, dealsRes, execsRes, invRes, ixRes, tasksRes] = await Promise.all([
          fetch("/api/auth/me"),
          fetch("/api/deals"),
          fetch("/api/executives"),
          fetch("/api/investors"),
          fetch("/api/interactions"),
          fetch("/api/tasks"),
        ]);
        if (meRes.status === 401 || dealsRes.status === 401) {
          router.replace("/login");
          return;
        }
        if (dealsRes.ok) setDeals(await dealsRes.json());
        if (execsRes.ok) setExecs(await execsRes.json());
        if (ixRes.ok) {
          const ix = await ixRes.json();
          if (Array.isArray(ix)) setInteractions(ix);
        }
        if (tasksRes.ok) {
          const tk = await tasksRes.json();
          if (Array.isArray(tk)) setTasks(tk);
        }
        if (invRes.ok) {
          const d = await invRes.json();
          if (Array.isArray(d.investors)) setInvestors(d.investors);
        }
        const param = new URLSearchParams(window.location.search).get("q");
        if (param) setQ(param);
        const sp = new URLSearchParams(window.location.search);
        if (sp.get("new") === "contact") setExecModal({ exec: null });
        if (sp.get("touch") === "1") {
          setTouchMode(true);
          setTab("operator");
        }
      } finally {
        setLoading(false);
      }
    })();
  }, [router]);

  const entries = useMemo<Entry[]>(() => {
    const ops: Entry[] = execs.map((e) => ({
      kind: "operator",
      id: e.id,
      name: e.name,
      sub: e.currentTitle || e.targetRole || "Operator",
      stage: e.stage,
      owner: e.owner,
      tags: uniqueStrings(e.industries ?? []),
      sector: (e.industries ?? []).map((i) => dealFocusSector(i)).find(Boolean) ?? undefined,
      searchText:
        `${e.name} ${e.currentTitle} ${e.targetRole} ${(e.industries ?? []).join(" ")} ${e.background} ${e.notes}`.toLowerCase(),
    }));
    const biz: Entry[] = deals.map((d) => ({
      kind: "business",
      id: d.id,
      name: d.companyName,
      sub: d.industry || "Business",
      stage: d.stage,
      owner: d.owner,
      tags: [d.city, d.broker].filter((s) => s && s.trim()),
      sector: dealFocusSector(d.industry) ?? d.industry,
      website: dealWebsite(d),
      searchText:
        `${d.companyName} ${d.industry} ${d.city} ${d.broker} ${d.contactName} ${d.notes}`.toLowerCase(),
    }));
    const inv: Entry[] = investors.map((i) => ({
      kind: "investor",
      id: i.id,
      name: i.name,
      sub: [i.title, i.firm].filter((s) => s && s.trim()).join(" · ") || "Investor",
      stage: i.status || "",
      owner: "",
      tags: [i.industry, i.investmentType].filter((s) => s && s.trim()),
      sector: SECTOR_COLORS[i.industry] ? i.industry : undefined,
      website: i.website || undefined,
      searchText:
        `${i.name} ${i.firm} ${i.title} ${i.email} ${i.industry} ${i.investmentType} ${i.notes}`.toLowerCase(),
    }));
    return [...ops, ...biz, ...inv];
  }, [deals, execs, investors]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return entries;
    return entries.filter((e) => e.searchText.includes(needle));
  }, [entries, q]);

  const visible = useMemo(
    () => filtered.filter((e) => e.kind === tab),
    [filtered, tab]
  );

  const selected = useMemo(() => {
    if (sel && sel.kind === tab) {
      const hit = visible.find((e) => e.id === sel.id);
      if (hit) return hit;
    }
    return visible[0] ?? null;
  }, [visible, sel, tab]);

  // If a search (e.g. a /directory?q= deep link) only matches another tab,
  // switch to it automatically.
  useEffect(() => {
    if (!q.trim() || visible.length > 0) return;
    const kinds: Entry["kind"][] = ["operator", "business", "investor"];
    const hit = kinds.find(
      (k) => k !== tab && filtered.some((e) => e.kind === k)
    );
    if (hit) setTab(hit);
  }, [q, visible, filtered, tab]);

  const selExec =
    selected?.kind === "operator" ? execs.find((e) => e.id === selected.id) : undefined;
  const selDeal =
    selected?.kind === "business" ? deals.find((d) => d.id === selected.id) : undefined;
  const selInvestor =
    selected?.kind === "investor"
      ? investors.find((i) => i.id === selected.id)
      : undefined;
  const pairedExecs = selDeal
    ? execs.filter((e) => (selDeal.operatorIds ?? []).indexOf(e.id) >= 0)
    : [];
  const pairedDeals = selExec
    ? deals.filter((d) => (d.operatorIds ?? []).indexOf(selExec.id) >= 0)
    : [];

  // Last touch (established semantics, same as Overview): the latest
  // logged interaction for the record, falling back to the record's
  // updatedAt. Investors have no interactions — updatedAt is their
  // last-touch date. No record type carries a next-step field.
  const lastTouchByKey = useMemo(() => {
    const m = new Map<string, string>();
    interactions.forEach((ix) => {
      const key = ix.dealId ? `deal:${ix.dealId}` : ix.execId ? `exec:${ix.execId}` : null;
      if (!key) return;
      const cur = m.get(key);
      if (!cur || ix.occurredAt > cur) m.set(key, ix.occurredAt);
    });
    return m;
  }, [interactions]);

  const lastTouchFor = (kind: Entry["kind"], id: string): string | null => {
    const rec =
      kind === "operator"
        ? execs.find((x) => x.id === id)
        : kind === "business"
          ? deals.find((x) => x.id === id)
          : investors.find((x) => x.id === id);
    const updated = rec?.updatedAt ?? null;
    if (kind === "investor") return updated;
    const ixMax = lastTouchByKey.get(`${kind === "operator" ? "exec" : "deal"}:${id}`) ?? null;
    if (ixMax && updated) {
      return new Date(ixMax).getTime() >= new Date(updated).getTime() ? ixMax : updated;
    }
    return ixMax ?? updated;
  };

  // One click behavior for list rows and grid cards alike (including
  // the FAB "log a touch" mode, which opens the operator's record).
  const handleEntryClick = (e: { kind: Entry["kind"]; id: string }, fromGrid = false) => {
    if (touchMode && e.kind === "operator") {
      const ex = execs.find((x) => x.id === e.id);
      if (ex) {
        setExecModal({ exec: ex });
        return;
      }
    }
    setSel({ kind: e.kind, id: e.id });
    if (fromGrid) {
      requestAnimationFrame(() => {
        document
          .getElementById("dir-profile")
          ?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    }
  };

  const group = (kind: Entry["kind"]) => {
    const rows = filtered.filter((e) => e.kind === kind);
    if (rows.length === 0) return null;
    return (
      <div className="mb-6">
        <ul className="space-y-1.5">
          {rows.map((e) => {
            const active = selected?.kind === e.kind && selected?.id === e.id;
            return (
              <li key={`${e.kind}-${e.id}`}>
                <button
                  onClick={() => handleEntryClick(e)}
                  className={`w-full rounded-xl border px-3 py-2.5 text-left transition ${
                    active
                      ? "border-[#b8975a] bg-[#b8975a]/10 ring-1 ring-[#b8975a]"
                      : "border-slate-200 bg-white hover:border-[#b8975a]/60 dark:border-white/10 dark:bg-[#132847]/60"
                  }`}
                >
                  <span className="flex items-start gap-2.5">
                    {e.kind === "business" ? (
                      <CompanyLogo name={e.name} website={e.website} sector={e.sector} size={28} />
                    ) : (
                      <PersonAvatar name={e.name} photoUrl={(e as { photoUrl?: string }).photoUrl} size={28} />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline justify-between gap-2">
                        <span className="truncate text-sm font-semibold text-[#0d1f3c] dark:text-white">
                          {e.name}
                        </span>
                        {e.kind === "investor" ? (
                          <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-500 dark:bg-white/10 dark:text-white/60">
                            {e.stage}
                          </span>
                        ) : (
                          <span className="shrink-0">
                            <StageChip stage={e.stage} />
                          </span>
                        )}
                      </span>
                      <span className="mt-0.5 block truncate text-xs text-slate-400 dark:text-white/40">
                        {e.kind === "business"
                          ? e.tags.join(" · ") || e.sub
                          : e.sub}
                        {e.kind === "investor" && e.tags.length > 0 ? ` · ${e.tags.join(" · ")}` : ""}
                      </span>
                      {e.kind === "operator" && e.tags.length > 0 && (
                        <span className="mt-1.5 flex flex-wrap gap-1">
                          {e.tags.map((t) => (
                            <SectorChip key={t} sector={dealFocusSector(t) ?? t} />
                          ))}
                        </span>
                      )}
                      {e.kind === "business" && e.sector && (
                        <span className="mt-1.5 block">
                          <SectorChip sector={e.sector} />
                        </span>
                      )}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    );
  };

  return (
    <div>
      <PageHero
        eyebrow="Canny Capital Partners"
        title="Directory"
        subtitle="Every operator, business, and investor we interact with — pull up a profile"
      />
      <div className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6">
        {loading ? (
          <p className="text-sm text-slate-400 dark:text-white/40">Loading directory…</p>
        ) : (
          <div
            className={`grid items-start gap-6 ${view === "list" ? "lg:grid-cols-[380px_1fr]" : ""}`}
          >
            <div>
              {touchMode && (
                <div className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-[#b8975a]/50 bg-[#b8975a]/10 px-3.5 py-2.5">
                  <p className="text-xs font-medium text-[#8a6f3c] dark:text-[#d4b37a]">
                    Log a touch: tap a person to open their record — saving stamps the touch and refreshes their last-touch date.
                  </p>
                  <button
                    onClick={() => setTouchMode(false)}
                    className="shrink-0 rounded-lg bg-[#0d1f3c] px-3 py-2 text-xs font-semibold text-white dark:bg-[#b8975a] dark:text-[#0d1f3c]"
                  >
                    Done
                  </button>
                </div>
              )}
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search people, companies, industries…"
                className="mb-4 w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-[#0d1f3c] outline-none placeholder:text-slate-300 focus:border-[#b8975a] dark:border-white/10 dark:bg-[#132847]/60 dark:text-white dark:placeholder:text-white/30"
              />
              <div className="mb-4 flex flex-wrap gap-2">
                {(
                  [
                    ["operator", "Operators"],
                    ["business", "Businesses"],
                    ["investor", "Investors"],
                  ] as const
                ).map(([k, label]) => (
                  <button
                    key={k}
                    onClick={() => setTab(k)}
                    className={`rounded-lg px-3.5 py-1.5 text-sm font-semibold transition ${
                      tab === k
                        ? "bg-[#0d1f3c] text-white dark:bg-[#b8975a] dark:text-[#0d1f3c]"
                        : "border border-slate-200 text-slate-500 hover:border-[#b8975a]/60 dark:border-white/10 dark:text-white/60"
                    }`}
                  >
                    {label} · {entries.filter((e) => e.kind === k).length}
                  </button>
                ))}
                <div className="ml-auto flex shrink-0 overflow-hidden rounded-lg border border-slate-200 dark:border-white/15">
                  {(
                    [
                      ["list", "List"],
                      ["grid", "Grid"],
                    ] as const
                  ).map(([v, label]) => (
                    <button
                      key={v}
                      onClick={() => chooseView(v)}
                      className={`px-3 py-1.5 text-sm font-semibold transition ${
                        view === v
                          ? "bg-[#0d1f3c] text-white dark:bg-[#b8975a] dark:text-[#0d1f3c]"
                          : "bg-white text-slate-500 hover:bg-slate-100 dark:bg-transparent dark:text-white/60"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              {(() => {
                const present: string[] = [];
                for (const e of entries) {
                  if (e.sector && SECTOR_COLORS[e.sector] && !present.includes(e.sector))
                    present.push(e.sector);
                }
                return present.length > 1 ? (
                  <div className="mb-3">
                    <SectorLegend sectors={present} />
                  </div>
                ) : null;
              })()}
              {view === "list" ? (
                group(tab)
              ) : (
                <DirectoryGrid
                  entries={visible}
                  execs={execs}
                  deals={deals}
                  investors={investors}
                  selected={sel && sel.kind === tab ? sel : selected ? { kind: selected.kind, id: selected.id } : null}
                  lastTouchFor={lastTouchFor}
                  onSelect={(e) => handleEntryClick(e, true)}
                />
              )}
              {visible.length === 0 && (
                <p className="text-sm text-slate-400 dark:text-white/40">
                  Nothing here matches that search.
                </p>
              )}
            </div>

            <div
              id="dir-profile"
              className="scroll-mt-20 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-[#132847]/60 lg:sticky lg:top-4"
            >
              {!selected ? (
                <p className="text-sm text-slate-400 dark:text-white/40">
                  No profiles yet — operators and businesses appear here as they enter the
                  pipeline.
                </p>
              ) : (
                <>
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                        selected.kind === "operator"
                          ? "bg-violet-100 text-violet-800 dark:bg-violet-500/15 dark:text-violet-300"
                          : selected.kind === "business"
                            ? "bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-300"
                            : "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300"
                      }`}
                    >
                      {selected.kind === "operator"
                        ? "Operator"
                        : selected.kind === "business"
                          ? "Business"
                          : "Investor"}
                    </span>
                    {selected.kind === "investor" ? (
                      <span className="rounded-full bg-[#b8975a]/15 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[#8a6f3e] dark:text-[#d4b37a]">
                        {selected.stage}
                      </span>
                    ) : (
                      <StageChip stage={selected.stage} />
                    )}
                    {selected.sector && SECTOR_COLORS[selected.sector] && (
                      <SectorChip sector={selected.sector} />
                    )}
                    {selected.owner && (
                      <span className="text-xs text-slate-400 dark:text-white/40">
                        Claimed by {selected.owner}
                      </span>
                    )}
                  </div>
                  <h3 className="mt-3 flex items-center gap-3 text-2xl font-bold text-[#0d1f3c] dark:text-white">
                    {selected.kind === "business" ? (
                      <CompanyLogo name={selected.name} website={selected.website} sector={selected.sector} size={36} />
                    ) : (
                      <PersonAvatar name={selected.name} photoUrl={(selected as { photoUrl?: string }).photoUrl} size={36} />
                    )}
                    {selected.name}
                  </h3>
                  <p className="mt-0.5 text-sm text-slate-500 dark:text-white/60">
                    {selected.sub}
                  </p>

                  {selExec && (
                    <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-3">
                      <Field label="Current title">{selExec.currentTitle || "—"}</Field>
                      <Field label="Target role">{selExec.targetRole || "—"}</Field>
                      <Field label="Industries">
                        {(selExec.industries ?? []).length > 0 ? (
                          <span className="flex flex-wrap gap-1">
                            {uniqueStrings(selExec.industries ?? []).map((ind) => (
                              <SectorChip key={ind} sector={dealFocusSector(ind) ?? ind} />
                            ))}
                          </span>
                        ) : (
                          "—"
                        )}
                      </Field>
                    </div>
                  )}
                  {selDeal && (
                    <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-3">
                      <Field label="Industry">
                        {selDeal.industry ? (
                          <SectorChip sector={dealFocusSector(selDeal.industry) ?? selDeal.industry} />
                        ) : (
                          "—"
                        )}
                      </Field>
                      <Field label="Location">
                        {selDeal.city ? (
                          <a
                            href={`https://www.google.com/maps/search/${encodeURIComponent(selDeal.city)}`}
                            target="_blank"
                            rel="noreferrer"
                            className="underline decoration-[#b8975a] decoration-2 underline-offset-2"
                          >
                            {selDeal.city}
                          </a>
                        ) : (
                          "—"
                        )}
                      </Field>
                      <Field label="Broker">{selDeal.broker || "—"}</Field>
                      {selDeal.askingPrice != null && (
                        <Field label="Asking price">{fmtMoney(selDeal.askingPrice)}</Field>
                      )}
                      {selDeal.revenue != null && (
                        <Field label="Revenue">{fmtMoney(selDeal.revenue)}</Field>
                      )}
                      {selDeal.ebitda != null && (
                        <Field label="EBITDA">{fmtMoney(selDeal.ebitda)}</Field>
                      )}
                      {selDeal.dealValue > 0 && (
                        <Field label="Deal value">{fmtMoney(selDeal.dealValue)}</Field>
                      )}
                      {(selDeal.contactName || selDeal.contactEmail) && (
                        <Field label="Contact">
                          {selDeal.contactEmail ? (
                            <a
                              href={`mailto:${selDeal.contactEmail}`}
                              className="underline decoration-[#b8975a] decoration-2 underline-offset-2"
                            >
                              {selDeal.contactName || selDeal.contactEmail}
                            </a>
                          ) : (
                            selDeal.contactName
                          )}
                        </Field>
                      )}
                      <Field label="Source">{selDeal.source || "—"}</Field>
                    </div>
                  )}
                  {selInvestor && (
                    <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-3">
                      <Field label="Firm">{selInvestor.firm || "—"}</Field>
                      <Field label="Title">{selInvestor.title || "—"}</Field>
                      <Field label="Status">{selInvestor.status || "—"}</Field>
                      {selInvestor.email && (
                        <Field label="Email">
                          <a
                            href={`mailto:${selInvestor.email}`}
                            className="underline decoration-[#b8975a] decoration-2 underline-offset-2"
                          >
                            {selInvestor.email}
                          </a>
                        </Field>
                      )}
                      {selInvestor.phone && (
                        <Field label="Phone">
                          <a href={`tel:${selInvestor.phone.replace(/[^+\d]/g, "")}`}>
                            {selInvestor.phone}
                          </a>
                        </Field>
                      )}
                      {selInvestor.website && (
                        <Field label="Website">
                          <a
                            href={
                              /^https?:\/\//i.test(selInvestor.website)
                                ? selInvestor.website
                                : `https://${selInvestor.website}`
                            }
                            target="_blank"
                            rel="noreferrer"
                            className="underline decoration-[#b8975a] decoration-2 underline-offset-2"
                          >
                            {selInvestor.website.replace(/^https?:\/\//i, "")}
                          </a>
                        </Field>
                      )}
                      {selInvestor.investmentType && (
                        <Field label="Investment type">{selInvestor.investmentType}</Field>
                      )}
                      {selInvestor.industry && (
                        <Field label="Industry focus">
                          {SECTOR_COLORS[selInvestor.industry] ? (
                            <SectorChip sector={selInvestor.industry} />
                          ) : (
                            selInvestor.industry
                          )}
                        </Field>
                      )}
                      {selInvestor.ebitdaSize && (
                        <Field label="EBITDA size">{selInvestor.ebitdaSize}</Field>
                      )}
                      {selInvestor.checkSize && (
                        <Field label="Check size">{selInvestor.checkSize}</Field>
                      )}
                      {selInvestor.source && (
                        <Field label="Source">{selInvestor.source}</Field>
                      )}
                    </div>
                  )}

                  {selExec && selExec.background && (
                    <div className="mt-5">
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-white/40">
                        Background
                      </p>
                      <div className="mt-1 max-h-56 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-sm leading-relaxed text-slate-600 dark:bg-white/[0.04] dark:text-white/75">
                        {selExec.background}
                      </div>
                    </div>
                  )}
                  {((selExec && selExec.notes) ||
                    (selDeal && selDeal.notes) ||
                    (selInvestor && selInvestor.notes)) && (
                    <div className="mt-4">
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-white/40">
                        Notes
                      </p>
                      <div className="mt-1 max-h-56 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-sm leading-relaxed text-slate-600 dark:bg-white/[0.04] dark:text-white/75">
                        {selExec ? selExec.notes : selDeal ? selDeal.notes : selInvestor?.notes}
                      </div>
                    </div>
                  )}

                  {pairedExecs.length > 0 && (
                    <div className="mt-5">
                      <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-white/40">
                        Paired operators
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {pairedExecs.map((e) => (
                          <button
                            key={e.id}
                            onClick={() => setSel({ kind: "operator", id: e.id })}
                            className="rounded-full border border-[#b8975a]/50 px-2.5 py-1 text-xs font-semibold text-[#0d1f3c] transition hover:bg-[#b8975a]/15 dark:text-white"
                          >
                            ◈ {e.name}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  {pairedDeals.length > 0 && (
                    <div className="mt-5">
                      <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-white/40">
                        Paired businesses
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {pairedDeals.map((d) => (
                          <button
                            key={d.id}
                            onClick={() => setSel({ kind: "business", id: d.id })}
                            className="rounded-full border border-[#b8975a]/50 px-2.5 py-1 text-xs font-semibold text-[#0d1f3c] transition hover:bg-[#b8975a]/15 dark:text-white"
                          >
                            ◈ {d.companyName}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {(selExec || selDeal) && (
                    <div className="mt-6 border-t border-slate-100 pt-4 dark:border-white/10">
                      <p className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-white/40">
                        Follow-ups
                      </p>
                      <TaskList
                        tasks={tasks.filter((t) =>
                          selExec
                            ? t.relatedKind === "executive" && t.relatedId === selExec.id
                            : t.relatedKind === "deal" && t.relatedId === selDeal?.id
                        )}
                        deals={[]}
                        execs={execs}
                        onChanged={loadTasks}
                        presetLink={
                          selExec
                            ? { kind: "executive", id: selExec.id, name: selExec.name }
                            : {
                                kind: "deal",
                                id: selDeal!.id,
                                name: selDeal!.companyName,
                              }
                        }
                      />
                    </div>
                  )}

                  {selected.kind !== "investor" && (
                    <div className="mt-6 border-t border-slate-100 pt-4 dark:border-white/10">
                      <Link
                        href="/pipeline"
                        className="text-sm font-semibold text-[#8a6f3e] underline decoration-[#b8975a] decoration-2 underline-offset-2 dark:text-[#d4b37a]"
                      >
                        Open in Pipeline →
                      </Link>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        )}
      </div>
      {execModal && (
        <ExecutiveModal
          exec={execModal.exec}
          onClose={() => setExecModal(null)}
          onSaved={() => {
            setExecModal(null);
            setTouchMode(false);
            window.location.reload();
          }}
          onDeleted={() => {
            setExecModal(null);
            window.location.reload();
          }}
        />
      )}
    </div>
  );
}

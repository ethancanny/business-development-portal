"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import KanbanBoard from "@/components/KanbanBoard";
import DealTable from "@/components/DealTable";
import ExecTable from "@/components/ExecTable";
import PairingTable, { type Pairing } from "@/components/PairingTable";
import { DealModal, ExecutiveModal } from "@/components/Modals";
import PageHero from "@/components/PageHero";
import { DEAL_STAGES, EXEC_STAGES, type Deal, type Executive } from "@/lib/types";
import { fmtMoney } from "@/lib/format";

export default function Dashboard() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"deals" | "execs" | "paired">("deals");
  const [view, setView] = useState<"kanban" | "table">("kanban");
  const [deals, setDeals] = useState<Deal[]>([]);
  const [execs, setExecs] = useState<Executive[]>([]);
  const [search, setSearch] = useState("");
  const [ownerFilter, setOwnerFilter] = useState("");
  const [stageFilter, setStageFilter] = useState("");
  const [dealModal, setDealModal] = useState<{ deal: Deal | null } | null>(null);
  const [execModal, setExecModal] = useState<{ exec: Executive | null } | null>(null);

  const load = async () => {
    try {
      const [dealsRes, execsRes] = await Promise.all([
        fetch("/api/deals"),
        fetch("/api/executives"),
      ]);
      if (dealsRes.status === 401 || execsRes.status === 401) {
        router.replace("/login");
        return;
      }
      if (dealsRes.ok) setDeals(await dealsRes.json());
      if (execsRes.ok) setExecs(await execsRes.json());
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const owners = useMemo(() => {
    const s = new Set<string>();
    deals.forEach((d) => d.owner && s.add(d.owner));
    execs.forEach((e) => e.owner && s.add(e.owner));
    return Array.from(s).sort();
  }, [deals, execs]);

  const stages = tab === "deals" ? DEAL_STAGES : EXEC_STAGES;

  const filteredDeals = useMemo(
    () =>
      deals.filter((d) => {
        const q = search.trim().toLowerCase();
        const hay =
          `${d.companyName} ${d.industry} ${d.contactName} ${d.contactEmail}`.toLowerCase();
        return (
          (!q || hay.includes(q)) &&
          (!ownerFilter || d.owner === ownerFilter) &&
          (!stageFilter || d.stage === stageFilter)
        );
      }),
    [deals, search, ownerFilter, stageFilter]
  );

  const filteredExecs = useMemo(
    () =>
      execs.filter((e) => {
        const q = search.trim().toLowerCase();
        const hay =
          `${e.name} ${e.currentTitle} ${e.targetRole}`.toLowerCase();
        return (
          (!q || hay.includes(q)) &&
          (!ownerFilter || e.owner === ownerFilter) &&
          (!stageFilter || e.stage === stageFilter)
        );
      }),
    [execs, search, ownerFilter, stageFilter]
  );

  const pairings = useMemo<Pairing[]>(() => {
    const list: Pairing[] = [];
    deals.forEach((d) => {
      (d.operatorIds ?? []).forEach((oid) => {
        const op = execs.find((e) => e.id === oid);
        if (!op) return;
        const isMatch =
          d.industry.trim() !== "" &&
          (op.industries ?? []).some(
            (i) => i.toLowerCase() === d.industry.trim().toLowerCase()
          );
        list.push({ deal: d, operator: op, isMatch });
      });
    });
    return list;
  }, [deals, execs]);

  const filteredPairings = useMemo(
    () =>
      pairings.filter((p) => {
        const q = search.trim().toLowerCase();
        const hay =
          `${p.deal.companyName} ${p.deal.industry} ${p.operator.name} ${p.operator.currentTitle}`.toLowerCase();
        return (
          (!q || hay.includes(q)) &&
          (!ownerFilter ||
            p.deal.owner === ownerFilter ||
            p.operator.owner === ownerFilter) &&
          (!stageFilter || p.deal.stage === stageFilter)
        );
      }),
    [pairings, search, ownerFilter, stageFilter]
  );

  const unpairedDeals = useMemo(
    () => deals.filter((d) => !(d.operatorIds ?? []).length),
    [deals]
  );
  const unpairedExecs = useMemo(() => {
    const pairedIds = new Set(pairings.map((p) => p.operator.id));
    return execs.filter((e) => !pairedIds.has(e.id));
  }, [execs, pairings]);

  const refreshAndClose = () => {
    setDealModal(null);
    setExecModal(null);
    load();
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-sm text-slate-500 dark:text-white/50">Loading pipeline…</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen">


      <PageHero
        eyebrow="Canny Capital Partners"
        title={tab === "deals" ? "Acquisition Pipeline" : tab === "execs" ? "Executive Sourcing" : "Paired Operators"}
        subtitle="Arizona-focused lower-middle-market growth"
      />

      <main className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6">
        {/* Tabs */}
        <div className="mb-4 flex gap-2">
          <button
            onClick={() => setTab("deals")}
            className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${
              tab === "deals"
                ? "bg-[#0d1f3c] text-white dark:bg-[#b8975a] dark:text-[#0d1f3c]"
                : "bg-white text-slate-600 hover:bg-slate-200 dark:bg-white/10 dark:text-[#c8bfa8] dark:hover:bg-white/15"
            }`}
          >
            Acquisitions ({deals.length})
          </button>
          <button
            onClick={() => setTab("execs")}
            className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${
              tab === "execs"
                ? "bg-[#0d1f3c] text-white dark:bg-[#b8975a] dark:text-[#0d1f3c]"
                : "bg-white text-slate-600 hover:bg-slate-200 dark:bg-white/10 dark:text-[#c8bfa8] dark:hover:bg-white/15"
            }`}
          >
            Executive Sourcing ({execs.length})
          </button>
          <button
            onClick={() => setTab("paired")}
            className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${
              tab === "paired"
                ? "bg-[#0d1f3c] text-white dark:bg-[#b8975a] dark:text-[#0d1f3c]"
                : "bg-white text-slate-600 hover:bg-slate-200 dark:bg-white/10 dark:text-[#c8bfa8] dark:hover:bg-white/15"
            }`}
          >
            ◈ Paired ({pairings.length})
          </button>
        </div>

        {/* Toolbar */}
        <div className="mb-4 flex flex-col gap-2 rounded-xl border border-slate-200 bg-white p-3 shadow-sm sm:flex-row sm:items-center dark:border-white/10 dark:bg-[#132847] dark:shadow-none">
          {(
            <div className="flex shrink-0 overflow-hidden rounded-lg border border-slate-200 dark:border-white/15">
              <button
                onClick={() => setView("kanban")}
                className={`px-3 py-2 text-sm font-semibold transition ${
                  view === "kanban"
                    ? "bg-[#0d1f3c] text-white dark:bg-[#b8975a] dark:text-[#0d1f3c]"
                    : "bg-white text-slate-500 hover:bg-slate-100 dark:bg-transparent dark:text-white/60"
                }`}
              >
                Kanban
              </button>
              <button
                onClick={() => setView("table")}
                className={`px-3 py-2 text-sm font-semibold transition ${
                  view === "table"
                    ? "bg-[#0d1f3c] text-white dark:bg-[#b8975a] dark:text-[#0d1f3c]"
                    : "bg-white text-slate-500 hover:bg-slate-100 dark:bg-transparent dark:text-white/60"
                }`}
              >
                Table
              </button>
            </div>
          )}
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={tab === "deals" ? "Search companies, contacts…" : tab === "execs" ? "Search candidates, titles…" : "Search deals, operators…"}
            className="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-[#b8975a] focus:outline-none dark:border-white/15 dark:bg-[#0d1f3c] dark:text-[#e8dfc8] dark:placeholder:text-white/30"
          />
          <select
            value={ownerFilter}
            onChange={(e) => setOwnerFilter(e.target.value)}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-[#b8975a] focus:outline-none dark:border-white/15 dark:bg-[#0d1f3c] dark:text-[#e8dfc8]"
          >
            <option value="">All owners</option>
            {owners.map((o) => (
              <option key={o} value={o}>{o}</option>
            ))}
          </select>
          <select
            value={stageFilter}
            onChange={(e) => setStageFilter(e.target.value)}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-[#b8975a] focus:outline-none dark:border-white/15 dark:bg-[#0d1f3c] dark:text-[#e8dfc8]"
          >
            <option value="">All stages</option>
            {stages.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          {tab !== "paired" && (
          <button
            onClick={() =>
              tab === "deals" ? setDealModal({ deal: null }) : setExecModal({ exec: null })
            }
            className="rounded-lg bg-[#0d1f3c] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1a3455] dark:bg-[#b8975a] dark:text-[#0d1f3c] dark:hover:bg-[#d4b37a]"
          >
            + {tab === "deals" ? "Add deal" : "Add candidate"}
          </button>
          )}
        </div>

        {/* Board */}
        {tab === "deals" ? (
          view === "table" ? (
            <DealTable
              deals={filteredDeals}
              execs={execs}
              onSelect={(d) => setDealModal({ deal: d })}
            />
          ) : (
          <KanbanBoard<Deal>
            stages={DEAL_STAGES}
            items={filteredDeals}
            getId={(d) => d.id}
            getStage={(d) => d.stage}
            onSelect={(d) => setDealModal({ deal: d })}
            emptyText="No deals"
            renderCard={(d) => (
              <div>
                <p className="text-sm font-semibold text-slate-900 dark:text-white">{d.companyName}</p>
                {d.industry && <p className="text-xs text-slate-500 dark:text-[#c8bfa8]">{d.industry}</p>}
                <div className="mt-2 flex items-center justify-between">
                  <span className="text-sm font-medium text-slate-700 dark:text-[#e8dfc8]">{fmtMoney(d.dealValue)}</span>
                </div>
                {d.operatorIds && d.operatorIds.length > 0 ? (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {d.operatorIds.map((oid) => (
                      <span
                        key={oid}
                        className="rounded-full bg-violet-100 px-2 py-0.5 text-[11px] font-semibold text-violet-700 dark:bg-violet-500/20 dark:text-violet-200"
                      >
                        ◈ {execs.find((e) => e.id === oid)?.name ?? "—"}
                      </span>
                    ))}
                  </div>
                ) : (
                  <span className="mt-1.5 inline-block rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
                    No operator paired
                  </span>
                )}
                <div className="mt-2">
                  {d.owner ? (
                    <span className="inline-block rounded-full bg-[#0d1f3c] px-2.5 py-0.5 text-[11px] font-semibold text-white dark:bg-[#b8975a] dark:text-[#0d1f3c]">
                      Claimed by {d.owner}
                    </span>
                  ) : (
                    <span className="inline-block rounded-full border border-dashed border-slate-300 px-2.5 py-0.5 text-[11px] font-medium text-slate-400 dark:border-white/25 dark:text-white/50">
                      Unclaimed
                    </span>
                  )}
                </div>
              </div>
            )}
          />
          )
        ) : tab === "execs" ? (
          view === "table" ? (
            <ExecTable
              execs={filteredExecs}
              deals={deals}
              onSelect={(e) => setExecModal({ exec: e })}
            />
          ) : (
          <KanbanBoard<Executive>
            stages={EXEC_STAGES}
            items={filteredExecs}
            getId={(e) => e.id}
            getStage={(e) => e.stage}
            onSelect={(e) => setExecModal({ exec: e })}
            emptyText="No candidates"
            renderCard={(e) => (
              <div>
                <p className="text-sm font-semibold text-slate-900 dark:text-white">{e.name}</p>
                {e.currentTitle && <p className="text-xs text-slate-500 dark:text-[#c8bfa8]">{e.currentTitle}</p>}
                {e.targetRole && (
                  <p className="mt-1 text-xs text-slate-600 dark:text-[#e8dfc8]">
                    <span className="text-slate-400 dark:text-white/40">Target:</span> <span className="text-slate-600 dark:text-[#e8dfc8]">{e.targetRole}</span>
                  </p>
                )}
                <div className="mt-2">
                  {e.owner ? (
                    <span className="inline-block rounded-full bg-[#0d1f3c] px-2.5 py-0.5 text-[11px] font-semibold text-white dark:bg-[#b8975a] dark:text-[#0d1f3c]">
                      Claimed by {e.owner}
                    </span>
                  ) : (
                    <span className="inline-block rounded-full border border-dashed border-slate-300 px-2.5 py-0.5 text-[11px] font-medium text-slate-400 dark:border-white/25 dark:text-white/50">
                      Unclaimed
                    </span>
                  )}
                </div>
              </div>
            )}
          />
          )
        ) : (
          <div>
            <div className="mb-4 flex flex-wrap gap-2 text-xs">
              <span className="rounded-full bg-violet-100 px-3 py-1 font-semibold text-violet-700 dark:bg-violet-500/20 dark:text-violet-200">
                ◈ {pairings.length} {pairings.length === 1 ? "pairing" : "pairings"}
              </span>
              <span className="rounded-full bg-amber-100 px-3 py-1 font-semibold text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
                {unpairedDeals.length} {unpairedDeals.length === 1 ? "deal" : "deals"} without an operator
              </span>
              <span className="rounded-full bg-slate-100 px-3 py-1 font-semibold text-slate-600 dark:bg-white/10 dark:text-white/60">
                {unpairedExecs.length} {unpairedExecs.length === 1 ? "operator" : "operators"} not paired
              </span>
            </div>
            {view === "table" ? (
              <PairingTable
                pairings={filteredPairings}
                onSelectDeal={(d) => setDealModal({ deal: d })}
              />
            ) : (
              <KanbanBoard<Pairing>
                stages={DEAL_STAGES}
                items={filteredPairings}
                getId={(x) => `${x.deal.id}-${x.operator.id}`}
                getStage={(x) => x.deal.stage}
                onSelect={(x) => setDealModal({ deal: x.deal })}
                emptyText="No pairings"
                renderCard={({ deal: d, operator: op, isMatch }) => (
                  <div>
                    <p className="text-sm font-semibold text-slate-900 dark:text-white">{d.companyName}</p>
                    {d.industry && <p className="text-xs text-slate-500 dark:text-[#c8bfa8]">{d.industry}</p>}
                    <div className="mt-2 flex items-center justify-between">
                      <span className="text-sm font-medium text-slate-700 dark:text-[#e8dfc8]">{fmtMoney(d.dealValue)}</span>
                    </div>
                    <div className="mt-1.5 rounded-lg bg-violet-50 px-2 py-1.5 dark:bg-violet-500/10">
                      <p className="text-xs font-semibold text-violet-800 dark:text-violet-200">
                        ◈ {op.name}
                      </p>
                      {op.currentTitle && (
                        <p className="text-[11px] text-violet-600 dark:text-violet-300/80">{op.currentTitle}</p>
                      )}
                      {isMatch && (
                        <span className="mt-1 inline-block rounded-full bg-emerald-100 px-1.5 py-px text-[10px] font-bold text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300">
                          ✓ industry match
                        </span>
                      )}
                    </div>
                  </div>
                )}
              />
            )}
          </div>
        )}
      </main>

      {/* Modals */}
      {dealModal && (
        <DealModal
          deal={dealModal.deal}
          executives={execs}
          allDeals={deals}
          onClose={() => setDealModal(null)}
          onSaved={refreshAndClose}
          onDeleted={refreshAndClose}
        />
      )}
      {execModal && (
        <ExecutiveModal
          exec={execModal.exec}
          onClose={() => setExecModal(null)}
          onSaved={refreshAndClose}
          onDeleted={refreshAndClose}
        />
      )}
    </div>
  );
}

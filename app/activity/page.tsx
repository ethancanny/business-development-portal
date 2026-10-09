"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import PageHero from "@/components/PageHero";
import type { DealFlowItem, DealFlowKind, DealFlowStatus } from "@/lib/types";

const KIND_META: Record<DealFlowKind, { label: string; cls: string }> = {
  business_for_sale: {
    label: "Business for sale",
    cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
  },
  operator_available: {
    label: "Operator available",
    cls: "bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300",
  },
  market_note: {
    label: "Market note",
    cls: "bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300",
  },
};

const STATUS_FILTERS: ("all" | DealFlowStatus)[] = [
  "all",
  "new",
  "reviewed",
  "added",
  "dismissed",
];

export default function ActivityPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<DealFlowItem[]>([]);
  const [filter, setFilter] = useState<"all" | DealFlowStatus>("new");
  const [kindTab, setKindTab] = useState<DealFlowKind>("business_for_sale");
  const [showAdd, setShowAdd] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const load = async () => {
    try {
      const res = await fetch("/api/deal-flow");
      if (res.status === 401) {
        router.replace("/login");
        return;
      }
      if (res.ok) setItems(await res.json());
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(
    () => (filter === "all" ? items : items.filter((i) => i.status === filter)),
    [items, filter]
  );
  const tabItems = filtered.filter((i) => i.kind === kindTab);

  const newCount = items.filter((i) => i.status === "new").length;

  const setStatus = async (id: string, status: DealFlowStatus) => {
    setBusy(id);
    await fetch(`/api/deal-flow/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    setBusy(null);
    load();
  };

  const convert = async (item: DealFlowItem) => {
    setBusy(item.id);
    try {
      if (item.kind === "operator_available") {
        const res = await fetch("/api/executives", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: item.title,
            industries: item.industry ? [item.industry] : [],
            notes: `${item.why}\n\nSource: ${item.source}${
              item.sourceDetail ? ` — ${item.sourceDetail}` : ""
            }`,
            stage: "Sourcing",
          }),
        });
        if (res.ok) {
          const exec = await res.json();
          await fetch(`/api/deal-flow/${item.id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status: "added", relatedExecId: exec.id }),
          });
        }
      } else {
        const res = await fetch("/api/deals", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            companyName: item.title,
            industry: item.industry,
            city: item.location,
            notes: `${item.why}\n\nSource: ${item.source}${
              item.sourceDetail ? ` — ${item.sourceDetail}` : ""
            }`,
            stage: "Sourcing",
          }),
        });
        if (res.ok) {
          const deal = await res.json();
          await fetch(`/api/deal-flow/${item.id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status: "added", relatedDealId: deal.id }),
          });
        }
      }
    } finally {
      setBusy(null);
      load();
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <p className="text-sm text-slate-500 dark:text-white/50">Loading deal flow…</p>
      </div>
    );
  }

  return (
    <>
      <PageHero
        eyebrow="Market pulse"
        title="Activity"
        subtitle="Fresh businesses for sale, operators on the market, and local notes — triage them into the pipeline."
      />
      <main className="mx-auto max-w-[1100px] px-4 py-6 sm:px-6">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          {STATUS_FILTERS.map((s) => (
            <button
              key={s}
              onClick={() => setFilter(s)}
              className={`rounded-full px-3 py-1.5 text-xs font-semibold capitalize transition ${
                filter === s
                  ? "bg-[#0d1f3c] text-white dark:bg-[#b8975a] dark:text-[#0d1f3c]"
                  : "bg-white text-slate-500 hover:bg-slate-100 dark:bg-white/10 dark:text-white/60"
              }`}
            >
              {s === "all" ? `All (${items.length})` : s}
            </button>
          ))}
          <button
            onClick={() => setShowAdd((v) => !v)}
            className="ml-auto rounded-lg bg-[#0d1f3c] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1a3455] dark:bg-[#b8975a] dark:text-[#0d1f3c] dark:hover:bg-[#d4b37a]"
          >
            {showAdd ? "Cancel" : "+ Add item"}
          </button>
        </div>

        {showAdd && <AddFlowItem onDone={() => { setShowAdd(false); load(); }} />}

        {filtered.length === 0 && (
          <div className="rounded-xl border border-dashed border-slate-300 p-10 text-center dark:border-white/15">
            <p className="text-sm text-slate-500 dark:text-white/50">
              {newCount === 0 && filter === "all"
                ? "Nothing in the feed yet. The morning sweep will add fresh opportunities here."
                : "Nothing with this status."}
            </p>
          </div>
        )}

        {/* Kind tabs — each feed type gets its own tab */}
        <div className="mb-4 flex flex-wrap gap-2">
          {(
            [
              { kind: "business_for_sale", label: "Businesses for Sale" },
              { kind: "operator_available", label: "Operators Available" },
              { kind: "market_note", label: "Market Notes" },
            ] as const
          ).map((t) => {
            const n = filtered.filter((i) => i.kind === t.kind).length;
            const active = kindTab === t.kind;
            return (
              <button
                key={t.kind}
                onClick={() => setKindTab(t.kind)}
                className={`rounded-lg px-3.5 py-2 text-sm font-semibold transition ${
                  active
                    ? "bg-[#0d1f3c] text-white dark:bg-[#b8975a] dark:text-[#0d1f3c]"
                    : "bg-white text-slate-500 hover:bg-slate-100 dark:bg-white/10 dark:text-white/60"
                }`}
              >
                {t.label} <span className="opacity-70">({n})</span>
              </button>
            );
          })}
        </div>

        {tabItems.length === 0 && filtered.length > 0 && (
          <div className="rounded-xl border border-dashed border-slate-300 p-10 text-center dark:border-white/15">
            <p className="text-sm text-slate-500 dark:text-white/50">Nothing in this tab with the current status filter.</p>
          </div>
        )}

        <div className="flex flex-col gap-3">
          {tabItems.map((item) => {
const km = KIND_META[item.kind];
            const isBusy = busy === item.id;
            return (
              <article
                key={item.id}
                className={`rounded-xl border bg-white p-5 dark:bg-[#132847] ${
                  item.status === "new"
                    ? "border-[#b8975a] shadow-sm dark:border-[#b8975a]/60"
                    : "border-slate-200 dark:border-white/10"
                }`}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${km.cls}`}
                  >
                    {km.label}
                  </span>
                  {item.status === "new" && (
                    <span className="rounded-full bg-[#b8975a] px-2.5 py-0.5 text-[11px] font-bold text-[#0d1f3c]">
                      NEW
                    </span>
                  )}
                  <span className="ml-auto text-xs text-slate-400 dark:text-white/40">
                    {item.spottedAt || item.createdAt.slice(0, 10)}
                    {item.source && ` · ${item.source}`}
                  </span>
                </div>
                <h3 className="mt-2 text-lg font-bold text-slate-900 dark:text-white">
                  {item.title}
                </h3>
                {(item.industry || item.location) && (
                  <p className="text-xs text-slate-500 dark:text-white/50">
                    {[item.industry, item.location].filter(Boolean).join(" · ")}
                  </p>
                )}
                {item.why && (
                  <p className="mt-2 text-sm text-slate-700 dark:text-[#e8dfc8]">
                    {item.why}
                  </p>
                )}
                {item.sourceDetail && (
                  <p className="mt-1 text-xs text-slate-400 dark:text-white/40">
                    {item.sourceDetail}
                  </p>
                )}
                {item.status !== "dismissed" && item.status !== "added" && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      onClick={() => convert(item)}
                      disabled={isBusy}
                      className="rounded-lg bg-[#0d1f3c] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#1a3455] disabled:opacity-50 dark:bg-[#b8975a] dark:text-[#0d1f3c] dark:hover:bg-[#d4b37a]"
                    >
                      {isBusy
                        ? "Working…"
                        : item.kind === "operator_available"
                          ? "→ Add as candidate"
                          : "→ Add to pipeline"}
                    </button>
                    {item.status === "new" && (
                      <button
                        onClick={() => setStatus(item.id, "reviewed")}
                        disabled={isBusy}
                        className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50 dark:border-white/20 dark:text-white/70 dark:hover:bg-white/5"
                      >
                        Mark reviewed
                      </button>
                    )}
                    <button
                      onClick={() => setStatus(item.id, "dismissed")}
                      disabled={isBusy}
                      className="rounded-lg px-3 py-1.5 text-xs font-semibold text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-50 dark:text-white/40 dark:hover:bg-red-500/10 dark:hover:text-red-300"
                    >
                      Dismiss
                    </button>
                  </div>
                )}
                {item.status === "added" && (
                  <p className="mt-3 text-xs font-semibold text-emerald-600 dark:text-emerald-300">
                    ✓ Moved into the pipeline
                  </p>
                )}
              </article>
            );
          })}
        </div>
      </main>
    </>
  );
}

function AddFlowItem({ onDone }: { onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    title: "",
    kind: "business_for_sale" as DealFlowKind,
    source: "",
    industry: "",
    location: "",
    why: "",
  });

  const save = async () => {
    if (!form.title.trim()) return;
    setBusy(true);
    const res = await fetch("/api/deal-flow", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    setBusy(false);
    if (res.ok) onDone();
  };

  const inputCls =
    "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 focus:border-[#b8975a] focus:outline-none dark:border-white/15 dark:bg-[#0d1f3c] dark:text-[#e8dfc8]";

  return (
    <div className="mb-4 flex flex-col gap-2 rounded-xl border border-slate-200 bg-white p-4 dark:border-white/10 dark:bg-[#132847]">
      <div className="grid gap-2 sm:grid-cols-2">
        <input
          className={inputCls}
          placeholder="Title * (company or person)"
          value={form.title}
          onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
        />
        <select
          className={inputCls}
          value={form.kind}
          onChange={(e) =>
            setForm((f) => ({ ...f, kind: e.target.value as DealFlowKind }))
          }
        >
          <option value="business_for_sale">Business for sale</option>
          <option value="operator_available">Operator available</option>
          <option value="market_note">Market note</option>
        </select>
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        <input
          className={inputCls}
          placeholder="Source (broker email, news…)"
          value={form.source}
          onChange={(e) => setForm((f) => ({ ...f, source: e.target.value }))}
        />
        <input
          className={inputCls}
          placeholder="Industry"
          value={form.industry}
          onChange={(e) => setForm((f) => ({ ...f, industry: e.target.value }))}
        />
        <input
          className={inputCls}
          placeholder="Location"
          value={form.location}
          onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))}
        />
      </div>
      <textarea
        className={inputCls}
        rows={2}
        placeholder="Why it matters…"
        value={form.why}
        onChange={(e) => setForm((f) => ({ ...f, why: e.target.value }))}
      />
      <button
        onClick={save}
        disabled={busy || !form.title.trim()}
        className="self-start rounded-lg bg-[#0d1f3c] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1a3455] disabled:opacity-50 dark:bg-[#b8975a] dark:text-[#0d1f3c] dark:hover:bg-[#d4b37a]"
      >
        {busy ? "Adding…" : "Add to feed"}
      </button>
    </div>
  );
}

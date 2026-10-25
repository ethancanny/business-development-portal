"use client";

/**
 * Investors panel (Phase 7) — the capital investor list: Directory
 * people tagged as investors, each with their capital profile
 * extension. Search + status filter hit the API (server-side);
 * selecting a row opens the full investor detail below the list.
 * "Add investor" creates the Directory person + capital profile in
 * one POST — identity is stored once, in the Directory.
 */

import { useCallback, useEffect, useState } from "react";
import { Button, CardSkeleton, EmptyState, ErrorState } from "@/components/ui";
import {
  API,
  INVESTOR_STATUSES,
  INVESTOR_TYPES,
  api,
  cardCls,
  fmtDateShort,
  fmtRange,
  inputCls,
  investorStatusBadge,
  labelCls,
  listFrom,
  labelOf,
  parseNum,
  selectCls,
  tdCls,
  thCls,
  type InvestorListItem,
} from "@/components/capital/types";
import InvestorDetail from "@/components/capital/InvestorDetail";
import { GenerateDocumentButton } from "@/components/docgen/GenerateDocument";

const PAGE_SIZE = 25;

export default function InvestorsPanel() {
  const [items, setItems] = useState<InvestorListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [showAdd, setShowAdd] = useState(false);
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState("");
  const [form, setForm] = useState({
    name: "",
    firm: "",
    title: "",
    email: "",
    phone: "",
    investorType: "",
    status: "exploring",
    introSource: "",
    checkSizeMin: "",
    checkSizeMax: "",
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String(offset),
      });
      if (q.trim()) params.set("q", q.trim());
      if (status) params.set("status", status);
      const data = await api<Record<string, unknown>>(
        `${API}/investors?${params.toString()}`
      );
      setItems(listFrom<InvestorListItem>(data, "items", "investors"));
      setTotal(typeof data.total === "number" ? data.total : 0);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [q, status, offset]);

  useEffect(() => {
    void load();
  }, [load]);

  const applySearch = () => {
    setOffset(0);
    void load();
  };

  const addInvestor = async () => {
    if (!form.name.trim() || adding) return;
    setAdding(true);
    setAddError("");
    try {
      const data = await api<{ personId: string }>(`${API}/investors`, {
        method: "POST",
        body: JSON.stringify({
          name: form.name.trim(),
          firm: form.firm.trim() || undefined,
          title: form.title.trim() || undefined,
          email: form.email.trim() || undefined,
          phone: form.phone.trim() || undefined,
          investorType: form.investorType || undefined,
          status: form.status || undefined,
          introSource: form.introSource.trim() || undefined,
          checkSizeMin: parseNum(form.checkSizeMin),
          checkSizeMax: parseNum(form.checkSizeMax),
        }),
      });
      setShowAdd(false);
      setForm({
        name: "",
        firm: "",
        title: "",
        email: "",
        phone: "",
        investorType: "",
        status: "exploring",
        introSource: "",
        checkSizeMin: "",
        checkSizeMax: "",
      });
      setOffset(0);
      await load();
      if (data.personId) setSelectedId(data.personId);
    } catch {
      setAddError("Could not add that investor. Check the name and try again.");
    } finally {
      setAdding(false);
    }
  };

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.floor(offset / PAGE_SIZE) + 1;

  return (
    <div className={cardCls}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-xl font-semibold text-[#0d1f3c] dark:text-white">
            Investors
          </h2>
          <p className="mt-0.5 text-sm text-slate-500 dark:text-white/50">
            Directory people with a capital profile — thesis, check size and
            status live here; identity lives once, in the Directory.
          </p>
        </div>
        <span className="flex flex-wrap gap-2">
          <GenerateDocumentButton
            scope="investor"
            label="Draft document"
            className="btn btn-secondary min-h-[44px]"
          />
          <Button
            variant={showAdd ? "secondary" : "primary"}
            onClick={() => setShowAdd((s) => !s)}
            className="min-h-[44px]"
          >
            {showAdd ? "Cancel" : "Add investor"}
          </Button>
        </span>
      </div>

      {showAdd && (
        <div className="mt-4 rounded-2xl border border-slate-200 p-4 dark:border-white/10">
          {addError && (
            <p role="alert" className="mb-3 rounded-xl bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-300">
              {addError}
            </p>
          )}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <label className={labelCls}>Name *</label>
              <input className={`${inputCls} min-h-[44px]`} value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Full name" />
            </div>
            <div>
              <label className={labelCls}>Firm</label>
              <input className={`${inputCls} min-h-[44px]`} value={form.firm} onChange={(e) => setForm((f) => ({ ...f, firm: e.target.value }))} />
            </div>
            <div>
              <label className={labelCls}>Title</label>
              <input className={`${inputCls} min-h-[44px]`} value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} />
            </div>
            <div>
              <label className={labelCls}>Email</label>
              <input type="email" className={`${inputCls} min-h-[44px]`} value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
            </div>
            <div>
              <label className={labelCls}>Phone</label>
              <input type="tel" className={`${inputCls} min-h-[44px]`} value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} />
            </div>
            <div>
              <label className={labelCls}>Investor type</label>
              <select className={`${selectCls} min-h-[44px]`} value={form.investorType} onChange={(e) => setForm((f) => ({ ...f, investorType: e.target.value }))}>
                <option value="">—</option>
                {INVESTOR_TYPES.map((t) => (
                  <option key={t.key} value={t.key}>{t.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls}>Status</label>
              <select className={`${selectCls} min-h-[44px]`} value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}>
                {INVESTOR_STATUSES.map((s) => (
                  <option key={s.key} value={s.key}>{s.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls}>Intro source</label>
              <input className={`${inputCls} min-h-[44px]`} value={form.introSource} onChange={(e) => setForm((f) => ({ ...f, introSource: e.target.value }))} placeholder="Referral, conference…" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className={labelCls}>Check min ($)</label>
                <input inputMode="numeric" className={`${inputCls} min-h-[44px]`} value={form.checkSizeMin} onChange={(e) => setForm((f) => ({ ...f, checkSizeMin: e.target.value }))} placeholder="250,000" />
              </div>
              <div>
                <label className={labelCls}>Check max ($)</label>
                <input inputMode="numeric" className={`${inputCls} min-h-[44px]`} value={form.checkSizeMax} onChange={(e) => setForm((f) => ({ ...f, checkSizeMax: e.target.value }))} placeholder="1,000,000" />
              </div>
            </div>
          </div>
          <div className="mt-4">
            <Button onClick={() => void addInvestor()} loading={adding} disabled={!form.name.trim()} className="min-h-[44px]">
              {adding ? "Adding…" : "Add investor"}
            </Button>
          </div>
        </div>
      )}

      {/* Search + filter */}
      <div className="mt-4 flex flex-wrap items-end gap-2">
        <div className="min-w-[200px] flex-1">
          <label className={labelCls}>Search</label>
          <input
            className={`${inputCls} min-h-[44px]`}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") applySearch();
            }}
            placeholder="Name, firm, email…"
          />
        </div>
        <div className="w-full sm:w-48">
          <label className={labelCls}>Status</label>
          <select
            className={`${selectCls} min-h-[44px]`}
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setOffset(0);
            }}
          >
            <option value="">All statuses</option>
            {INVESTOR_STATUSES.map((s) => (
              <option key={s.key} value={s.key}>{s.label}</option>
            ))}
          </select>
        </div>
        <Button variant="secondary" onClick={applySearch} className="min-h-[44px]">
          Search
        </Button>
      </div>

      {/* List */}
      <div className="mt-4">
        {loading ? (
          <div className="space-y-3" aria-busy="true">
            {Array.from({ length: 4 }).map((_, i) => (
              <CardSkeleton key={i} lines={2} />
            ))}
          </div>
        ) : error ? (
          <ErrorState onRetry={() => void load()} />
        ) : items.length === 0 ? (
          <EmptyState
            title="No investors match"
            message="No Directory investors fit this search. Clear the filters, or add an investor above — they appear in the Directory too, as one record."
          />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px]">
                <thead>
                  <tr className="border-b border-slate-100 dark:border-white/5">
                    <th className={thCls}>Investor</th>
                    <th className={thCls}>Type</th>
                    <th className={thCls}>Status</th>
                    <th className={thCls}>Check size</th>
                    <th className={thCls}>Last touch</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((inv) => {
                    const p = inv.profile;
                    const selected = selectedId === inv.personId;
                    return (
                      <tr
                        key={inv.personId}
                        onClick={() => setSelectedId(selected ? null : inv.personId)}
                        className={`cursor-pointer border-t border-slate-100 transition hover:bg-[#f0f4fa] dark:border-white/5 dark:hover:bg-white/5 ${
                          selected ? "bg-[#b8975a]/10 hover:bg-[#b8975a]/10" : ""
                        }`}
                        aria-selected={selected}
                      >
                        <td className={tdCls}>
                          <span className="font-semibold">{inv.name || "Unnamed"}</span>
                          {(inv.firm || inv.title) && (
                            <span className="block text-xs text-slate-500 dark:text-white/50">
                              {[inv.title, inv.firm].filter(Boolean).join(" · ")}
                            </span>
                          )}
                          {!p?.exists && (
                            <span className="mt-0.5 block text-xs text-slate-400 dark:text-white/40">
                              No capital profile yet — open to add one
                            </span>
                          )}
                        </td>
                        <td className={tdCls}>
                          {p?.investorType ? labelOf(INVESTOR_TYPES, p.investorType) : "—"}
                        </td>
                        <td className={tdCls}>
                          {p?.exists ? (
                            <span className={`badge ${investorStatusBadge(p.status)}`}>
                              {labelOf(INVESTOR_STATUSES, p.status)}
                            </span>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className={`${tdCls} tnum`}>
                          {fmtRange(p?.checkSizeMin, p?.checkSizeMax)}
                        </td>
                        <td className={tdCls}>{fmtDateShort(p?.lastTouchAt)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm text-slate-500 dark:text-white/50">
              <span>
                {total} investor{total === 1 ? "" : "s"} · page {page} of {pageCount}
              </span>
              <span className="flex gap-2">
                <button
                  type="button"
                  className="btn btn-secondary btn-sm min-h-[44px]"
                  disabled={offset === 0}
                  onClick={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))}
                >
                  ← Prev
                </button>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm min-h-[44px]"
                  disabled={offset + PAGE_SIZE >= total}
                  onClick={() => setOffset((o) => o + PAGE_SIZE)}
                >
                  Next →
                </button>
              </span>
            </div>
          </>
        )}
      </div>

      {selectedId && (
        <div className="mt-5 border-t border-slate-100 pt-5 dark:border-white/5">
          <InvestorDetail
            key={selectedId}
            personId={selectedId}
            onClose={() => setSelectedId(null)}
            onChanged={() => void load()}
          />
        </div>
      )}
    </div>
  );
}

"use client";

/**
 * Investor detail (Phase 7) — one Directory person, three clearly
 * separated sources:
 * 1. The Directory record itself (name/firm/contact — edited in the
 *    Directory, linked from here, never re-entered).
 * 2. "From Investment Database" — the imported sheet record, shown
 *    verbatim and labeled as the imported record when present.
 * 3. The capital profile — this module's own fields, edited here.
 * The two are never merged visually into one source.
 *
 * Below: lifetime reporting totals, commitments across deals
 * (each links into that deal's capital workspace), linked deals
 * and the activity log.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Button, ErrorState, SkeletonRows, StatTile } from "@/components/ui";
import GenerateReportButton from "@/components/comms/GenerateReportButton";
import { GenerateDocumentButton } from "@/components/docgen/GenerateDocument";
import ContractsPanel from "@/components/docgen/ContractsPanel";
import {
  API,
  INVESTOR_STATUSES,
  INVESTOR_TYPES,
  api,
  cardCls,
  commitmentStageBadge,
  fmtDateShort,
  fmtMoneyN,
  fmtUpdated,
  inputCls,
  labelCls,
  labelOf,
  parseNum,
  selectCls,
  tdCls,
  thCls,
  type InvestorDetailData,
} from "@/components/capital/types";

interface ProfileForm {
  investorType: string;
  status: string;
  introSource: string;
  lastTouchAt: string;
  thesisSectors: string;
  dealSizeMin: string;
  dealSizeMax: string;
  checkSizeMin: string;
  checkSizeMax: string;
  structurePrefs: string;
  notes: string;
}

function formFrom(detail: InvestorDetailData): ProfileForm {
  const p = detail.profile;
  const num = (v: number | null | undefined) =>
    v === null || v === undefined ? "" : String(v);
  return {
    investorType: p?.investorType ?? "",
    status: p?.status ?? "exploring",
    introSource: p?.introSource ?? "",
    lastTouchAt: p?.lastTouchAt ? p.lastTouchAt.slice(0, 10) : "",
    thesisSectors: (p?.thesisSectors ?? []).join(", "),
    dealSizeMin: num(p?.dealSizeMin),
    dealSizeMax: num(p?.dealSizeMax),
    checkSizeMin: num(p?.checkSizeMin),
    checkSizeMax: num(p?.checkSizeMax),
    structurePrefs: p?.structurePrefs ?? "",
    notes: p?.notes ?? "",
  };
}

export default function InvestorDetail({
  personId,
  onClose,
  onChanged,
}: {
  personId: string;
  onClose?: () => void;
  onChanged?: () => void;
}) {
  const [detail, setDetail] = useState<InvestorDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [form, setForm] = useState<ProfileForm | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveNote, setSaveNote] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setLoadFailed(false);
    try {
      const data = await api<{ detail: InvestorDetailData }>(
        `${API}/investors/${encodeURIComponent(personId)}`
      );
      setDetail(data.detail);
      setForm(formFrom(data.detail));
    } catch {
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, [personId]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    if (!form || saving) return;
    setSaving(true);
    setError("");
    setSaveNote("");
    try {
      await api(`${API}/investors/${encodeURIComponent(personId)}`, {
        method: "PUT",
        body: JSON.stringify({
          investorType: form.investorType,
          status: form.status,
          introSource: form.introSource.trim(),
          lastTouchAt: form.lastTouchAt || null,
          thesisSectors: form.thesisSectors
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
          dealSizeMin: parseNum(form.dealSizeMin),
          dealSizeMax: parseNum(form.dealSizeMax),
          checkSizeMin: parseNum(form.checkSizeMin),
          checkSizeMax: parseNum(form.checkSizeMax),
          structurePrefs: form.structurePrefs.trim(),
          notes: form.notes.trim(),
        }),
      });
      setSaveNote("Capital profile saved.");
      await load();
      onChanged?.();
    } catch {
      setError("Could not save the capital profile. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <SkeletonRows rows={5} />;
  if (loadFailed || !detail || !form)
    return <ErrorState onRetry={() => void load()} />;

  const rec = detail.record ?? {};
  const name = String(rec.name ?? "Investor");
  const firm = String(rec.firm ?? "");
  const title = String(rec.title ?? "");
  const email = String(rec.email ?? "");
  const phone = String(rec.phone ?? "");
  const legacy = detail.legacyInvestor;
  const totals = detail.reportTotals ?? { called: 0, distributed: 0, nav: 0 };

  const set = (patch: Partial<ProfileForm>) =>
    setForm((f) => (f ? { ...f, ...patch } : f));

  const legacyRows: Array<[string, string]> = legacy
    ? [
        ["Investment type", legacy.investmentType],
        ["Industry focus", legacy.industry],
        ["EBITDA size", legacy.ebitdaSize],
        ["Check size", legacy.checkSize],
        ["Status (sheet)", legacy.status],
        ["Website", legacy.website],
      ].filter(([, v]) => v && String(v).trim()) as Array<[string, string]>
    : [];

  return (
    <div className="space-y-5">
      {/* Header — the Directory record */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-display text-2xl font-semibold text-[#0d1f3c] dark:text-white">
            {name}
          </h3>
          <p className="mt-0.5 text-sm text-slate-500 dark:text-white/50">
            {[title, firm].filter(Boolean).join(" · ") || "Directory record"}
          </p>
          <p className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm">
            {email && (
              <a href={`mailto:${email}`} className="text-gold-700 hover:underline dark:text-gold-400">
                {email}
              </a>
            )}
            {phone && <span className="text-slate-600 dark:text-white/70">{phone}</span>}
          </p>
          {(detail.types ?? []).length > 0 && (
            <p className="mt-2 flex flex-wrap gap-1.5">
              {detail.types.map((t) => (
                <span key={t} className="badge badge-neutral">{t}</span>
              ))}
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href={`/directory?q=${encodeURIComponent(name)}`}
            className="btn btn-secondary btn-sm min-h-[44px]"
          >
            Open in Directory
          </Link>
          <GenerateReportButton subjectKind="investor" personId={personId} />
          <GenerateDocumentButton
            scope="investor"
            investorPersonId={personId}
            label="Generate contract"
            className="btn btn-secondary btn-sm min-h-[44px]"
          />
          {onClose && (
            <Button variant="ghost" size="sm" onClick={onClose} className="min-h-[44px]">
              Close
            </Button>
          )}
        </div>
      </div>

      {/* Lifetime reporting totals */}
      <div className="grid grid-cols-3 gap-4">
        <div className="card-surface p-4">
          <StatTile label="Called (all deals)" display={fmtMoneyN(totals.called)} caption="Capital calls to date" />
        </div>
        <div className="card-surface p-4">
          <StatTile label="Distributed" display={fmtMoneyN(totals.distributed)} caption="Returned to this investor" />
        </div>
        <div className="card-surface p-4">
          <StatTile label="Current NAV" display={fmtMoneyN(totals.nav)} caption="Latest reported value" />
        </div>
      </div>

      {error && (
        <p role="alert" className="rounded-xl bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-300">
          {error}
        </p>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        {/* Capital profile — this module's fields */}
        <div className={cardCls}>
          <h4 className="font-display text-lg font-semibold text-[#0d1f3c] dark:text-white">
            Capital profile
          </h4>
          <p className="mt-0.5 text-xs text-slate-400 dark:text-white/40">
            Canny Capital&apos;s own investor record
            {detail.profile?.updatedAt
              ? ` · updated ${fmtUpdated(detail.profile.updatedAt)}`
              : " · not created yet — saving creates it"}
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div>
              <label className={labelCls}>Investor type</label>
              <select className={`${selectCls} min-h-[44px]`} value={form.investorType} onChange={(e) => set({ investorType: e.target.value })}>
                <option value="">—</option>
                {INVESTOR_TYPES.map((t) => (
                  <option key={t.key} value={t.key}>{t.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls}>Status</label>
              <select className={`${selectCls} min-h-[44px]`} value={form.status} onChange={(e) => set({ status: e.target.value })}>
                {INVESTOR_STATUSES.map((s) => (
                  <option key={s.key} value={s.key}>{s.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls}>Intro source</label>
              <input className={`${inputCls} min-h-[44px]`} value={form.introSource} onChange={(e) => set({ introSource: e.target.value })} />
            </div>
            <div>
              <label className={labelCls}>Last touch</label>
              <input type="date" className={`${inputCls} min-h-[44px]`} value={form.lastTouchAt} onChange={(e) => set({ lastTouchAt: e.target.value })} />
            </div>
            <div className="sm:col-span-2">
              <label className={labelCls}>Thesis sectors (comma-separated)</label>
              <input className={`${inputCls} min-h-[44px]`} value={form.thesisSectors} onChange={(e) => set({ thesisSectors: e.target.value })} placeholder="Healthcare, Aerospace & Defense…" />
            </div>
            <div>
              <label className={labelCls}>Deal size min ($)</label>
              <input inputMode="numeric" className={`${inputCls} min-h-[44px]`} value={form.dealSizeMin} onChange={(e) => set({ dealSizeMin: e.target.value })} />
            </div>
            <div>
              <label className={labelCls}>Deal size max ($)</label>
              <input inputMode="numeric" className={`${inputCls} min-h-[44px]`} value={form.dealSizeMax} onChange={(e) => set({ dealSizeMax: e.target.value })} />
            </div>
            <div>
              <label className={labelCls}>Check size min ($)</label>
              <input inputMode="numeric" className={`${inputCls} min-h-[44px]`} value={form.checkSizeMin} onChange={(e) => set({ checkSizeMin: e.target.value })} />
            </div>
            <div>
              <label className={labelCls}>Check size max ($)</label>
              <input inputMode="numeric" className={`${inputCls} min-h-[44px]`} value={form.checkSizeMax} onChange={(e) => set({ checkSizeMax: e.target.value })} />
            </div>
            <div className="sm:col-span-2">
              <label className={labelCls}>Structure preferences</label>
              <input className={`${inputCls} min-h-[44px]`} value={form.structurePrefs} onChange={(e) => set({ structurePrefs: e.target.value })} placeholder="Prefers minority co-invest, no control…" />
            </div>
            <div className="sm:col-span-2">
              <label className={labelCls}>Notes</label>
              <textarea className={`${inputCls} min-h-[72px]`} value={form.notes} onChange={(e) => set({ notes: e.target.value })} />
            </div>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button onClick={() => void save()} loading={saving} className="min-h-[44px]">
              {saving ? "Saving…" : "Save capital profile"}
            </Button>
            {saveNote && <span className="text-sm text-emerald-700 dark:text-emerald-300">{saveNote}</span>}
          </div>
        </div>

        <div className="space-y-5">
          {/* Imported sheet record — separate source, never merged */}
          {legacy && (
            <div className="rounded-2xl border border-slate-300 bg-slate-50 p-5 dark:border-white/15 dark:bg-white/5 sm:p-6">
              <h4 className="font-display text-lg font-semibold text-[#0d1f3c] dark:text-white">
                From Investment Database
              </h4>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-white/50">
                The imported sheet record, shown as imported. It is a
                separate source from the capital profile — figures here are
                not carried into it.
              </p>
              {legacyRows.length === 0 ? (
                <p className="mt-3 text-sm text-slate-500 dark:text-white/50">
                  The imported record has no populated fields.
                </p>
              ) : (
                <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2">
                  {legacyRows.map(([k, v]) => (
                    <div key={k}>
                      <dt className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-white/40">{k}</dt>
                      <dd className="mt-0.5 break-words text-sm text-[#0d1f3c] dark:text-white/90">
                        {k === "Website" ? (
                          <a href={v.startsWith("http") ? v : `https://${v}`} target="_blank" rel="noreferrer" className="text-gold-700 hover:underline dark:text-gold-400">
                            {v}
                          </a>
                        ) : (
                          v
                        )}
                      </dd>
                    </div>
                  ))}
                </dl>
              )}
            </div>
          )}

          {/* Commitments */}
          <div className={cardCls}>
            <h4 className="font-display text-lg font-semibold text-[#0d1f3c] dark:text-white">
              Commitments
            </h4>
            {(detail.commitments ?? []).length === 0 ? (
              <p className="mt-2 text-sm text-slate-500 dark:text-white/50">
                No commitments yet. Add this investor to a deal&apos;s raise
                from that deal&apos;s capital workspace.
              </p>
            ) : (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[380px]">
                  <thead>
                    <tr className="border-b border-slate-100 dark:border-white/5">
                      <th className={thCls}>Deal</th>
                      <th className={`${thCls} text-right`}>Amount</th>
                      <th className={thCls}>Kind</th>
                      <th className={thCls}>Stage</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.commitments.map((c) => (
                      <tr key={c.id} className="border-t border-slate-100 dark:border-white/5">
                        <td className={tdCls}>
                          <Link
                            href={`/investors-capital/${encodeURIComponent(c.dealId)}`}
                            className="font-semibold text-gold-700 hover:underline dark:text-gold-400"
                          >
                            {c.dealName || "Deal"}
                          </Link>
                        </td>
                        <td className={`${tdCls} tnum text-right`}>{fmtMoneyN(c.amount)}</td>
                        <td className={tdCls}>{c.kind}</td>
                        <td className={tdCls}>
                          <span className={`badge ${commitmentStageBadge(c.stage)}`}>{c.stage}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Linked deals */}
          {(detail.linkedDeals ?? []).length > 0 && (
            <div className={cardCls}>
              <h4 className="font-display text-lg font-semibold text-[#0d1f3c] dark:text-white">
                Linked deals
              </h4>
              <ul className="mt-2 space-y-1.5">
                {detail.linkedDeals.map((d) => (
                  <li key={d.dealId} className="flex flex-wrap items-center gap-2 text-sm">
                    <Link
                      href={`/investors-capital/${encodeURIComponent(d.dealId)}`}
                      className="font-semibold text-gold-700 hover:underline dark:text-gold-400"
                    >
                      {d.dealName || d.companyName || "Deal"}
                    </Link>
                    {d.companyName && d.dealName && (
                      <span className="text-slate-500 dark:text-white/50">{d.companyName}</span>
                    )}
                    {d.stage && <span className="badge badge-neutral">{d.stage}</span>}
                    {d.role && <span className="text-slate-500 dark:text-white/50">{d.role}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Documents (Contract generation, Oct 24, 2026): investor
              documents register on the investor, mirroring how
              contracts hang off a company. */}
          <ContractsPanel investorPersonId={personId} />

          {/* Activity */}
          <div className={cardCls}>
            <h4 className="font-display text-lg font-semibold text-[#0d1f3c] dark:text-white">
              Activity
            </h4>
            {(detail.activity ?? []).length === 0 ? (
              <p className="mt-2 text-sm text-slate-500 dark:text-white/50">
                No recorded activity for this investor yet.
              </p>
            ) : (
              <ul className="mt-3 space-y-2.5">
                {detail.activity.map((a, i) => (
                  <li key={`${a.createdAt}-${i}`} className="border-l-2 border-[#b8975a]/50 pl-3">
                    <p className="text-sm text-slate-600 dark:text-white/80">{a.message}</p>
                    <p className="text-xs text-slate-400 dark:text-white/40">
                      {fmtDateShort(a.createdAt)}
                      {a.actor ? ` · ${a.actor}` : ""}
                      {a.kind ? ` · ${a.kind}` : ""}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

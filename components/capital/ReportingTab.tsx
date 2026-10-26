"use client";

/**
 * Reporting tab (Phase 7) — the deal's investor reporting ledger:
 * capital calls, distributions and NAV marks, per investor and in
 * total, plus report templates rendered against this deal's real
 * figures. Template sections that depend on Portfolio Monitoring
 * render the Phase 8 marker text the API returns — shown verbatim,
 * never filled in here.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, EmptyState, ErrorState, SkeletonRows, StatTile } from "@/components/ui";
import {
  API,
  REPORT_ENTRY_TYPES,
  api,
  cardCls,
  fmtDateShort,
  fmtMoneyCompact,
  fmtMoneyN,
  inputCls,
  labelCls,
  labelOf,
  parseNum,
  selectCls,
  tdCls,
  thCls,
  todayIso,
  type CapitalTabProps,
  type InvestorListItem,
  type ReportEntry,
  type ReportTemplate,
  type ReportTotals,
} from "@/components/capital/types";
import {
  fetchBundle,
  typeKeyOf,
  typeLabelOf,
  type WorkspaceBundle,
} from "@/components/capital/workspace/shared";

/** A real delivery record from the comms module (Send anywhere,
 * Oct 25, 2026) — the tab's log reads GET …/reports/deliveries,
 * which returns comms delivery rows for this deal's reports.
 * emailOpenedAt is the open-pixel stamp; openedAt/viewedAt are the
 * stronger portal-link signals — labeled distinctly, never merged. */
interface DeliveryRow {
  id: string;
  reportTitle: string;
  recipientName: string;
  recipientEmail: string;
  status: string;
  emailStatus: string;
  deliveredAt: string;
  emailOpenedAt: string | null;
  openedAt: string | null;
  viewedAt: string | null;
  downloadedAt: string | null;
}

interface ReportingData {
  entries: ReportEntry[];
  totals: ReportTotals;
}

interface ByInvestorRow {
  key: string;
  name: string;
  called: number;
  distributed: number;
  nav: number;
}

/** byInvestor arrives as an array of rows or a personId-keyed map —
 * normalize both to display rows without inventing figures. */
function normalizeByInvestor(raw: unknown): ByInvestorRow[] {
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  if (Array.isArray(raw)) {
    return raw.map((r, i) => {
      const row = (r ?? {}) as Record<string, unknown>;
      return {
        key: String(row.investorPersonId ?? row.investorName ?? i),
        name: String(row.investorName ?? row.investorPersonId ?? "Investor"),
        called: num(row.called),
        distributed: num(row.distributed),
        nav: num(row.nav ?? row.navLatest),
      };
    });
  }
  if (raw && typeof raw === "object") {
    return Object.entries(raw as Record<string, unknown>).map(([k, v]) => {
      const row = (v ?? {}) as Record<string, unknown>;
      return {
        key: k,
        name: String(row.investorName ?? k),
        called: num(row.called),
        distributed: num(row.distributed),
        nav: num(row.nav ?? row.navLatest),
      };
    });
  }
  return [];
}

function entryTypeBadge(t: string): string {
  if (t === "capital_call") return "badge-warn";
  if (t === "distribution") return "badge-fit";
  return "badge-neutral";
}

export default function ReportingTab({ dealId, refreshSummary }: CapitalTabProps) {
  const base = `${API}/deals/${encodeURIComponent(dealId)}/reporting`;
  const [data, setData] = useState<ReportingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [error, setError] = useState("");

  const [investors, setInvestors] = useState<InvestorListItem[]>([]);
  const [form, setForm] = useState({
    investorPersonId: "",
    entryType: "capital_call",
    amount: "",
    asOf: todayIso(),
    notes: "",
  });
  const [adding, setAdding] = useState(false);
  const [busyId, setBusyId] = useState("");

  // Redesign Step 1: raise bundle for recipient selection + type,
  // and any delivery records the reporting payload carries.
  const [bundle, setBundle] = useState<WorkspaceBundle | null>(null);
  const [recipients, setRecipients] = useState<Set<string> | null>(null);
  const [deliveries, setDeliveries] = useState<DeliveryRow[]>([]);

  const [templates, setTemplates] = useState<ReportTemplate[]>([]);
  const [tplForm, setTplForm] = useState({ name: "", kind: "investor_update", body: "" });
  const [creatingTpl, setCreatingTpl] = useState(false);
  const [renderSel, setRenderSel] = useState({ templateId: "", investorPersonId: "" });
  const [rendering, setRendering] = useState(false);
  const [rendered, setRendered] = useState<{ text: string; values: Record<string, unknown> } | null>(null);
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState<Array<{
    recipientName: string;
    recipientEmail: string;
    emailStatus: string;
    link?: string;
  }> | null>(null);

  const loadDeliveries = useCallback(async () => {
    try {
      const d = await api<{ deliveries: DeliveryRow[] }>(
        `${API}/deals/${encodeURIComponent(dealId)}/reports/deliveries`
      );
      setDeliveries(Array.isArray(d.deliveries) ? d.deliveries : []);
    } catch {
      /* the log is additive — a failure leaves the last known rows */
    }
  }, [dealId]);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadFailed(false);
    try {
      const d = await api<ReportingData>(base);
      setData({
        entries: Array.isArray(d.entries) ? d.entries : [],
        totals: d.totals ?? { called: 0, distributed: 0, navLatest: 0, byInvestor: null },
      });
      void loadDeliveries();
    } catch {
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, [base, loadDeliveries]);

  const loadTemplates = useCallback(async () => {
    try {
      const d = await api<{ templates: ReportTemplate[] }>(
        `${API}/report-templates`
      );
      setTemplates(Array.isArray(d.templates) ? d.templates : []);
    } catch {
      setTemplates([]);
    }
  }, []);

  useEffect(() => {
    void load();
    void loadTemplates();
  }, [load, loadTemplates]);

  useEffect(() => {
    let live = true;
    fetchBundle(dealId)
      .then((b) => {
        if (live) setBundle(b);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [dealId]);

  /** Raise participants (unique commitment investors) — the
   * recipient list defaults to all of them. */
  const participants = useMemo(() => {
    const seen = new Map<string, string>();
    for (const c of bundle?.commitments ?? []) {
      if (c.investorPersonId && !seen.has(c.investorPersonId)) {
        seen.set(c.investorPersonId, c.investorName || c.investorPersonId);
      }
    }
    return Array.from(seen.entries()).map(([personId, name]) => ({ personId, name }));
  }, [bundle]);

  useEffect(() => {
    if (bundle && recipients === null) {
      setRecipients(new Set(participants.map((p) => p.personId)));
    }
  }, [bundle, participants, recipients]);

  /** Type-flavored ordering: templates whose name/kind mentions the
   * deal's type come first and are labeled as matching it. */
  const typeKey = typeKeyOf(bundle);
  const typeLabel = typeLabelOf(bundle);
  const templateMatchesType = useCallback(
    (t: ReportTemplate) => {
      if (!bundle) return false;
      const hay = `${t.name} ${t.kind}`.toLowerCase();
      const tokens = [
        typeKey,
        typeLabel.toLowerCase(),
        ...typeKey.split("_"),
        ...typeLabel.toLowerCase().split(/\s+/),
      ].filter((tok) => tok.length >= 3);
      return tokens.some((tok) => hay.includes(tok));
    },
    [bundle, typeKey, typeLabel]
  );
  const sortedTemplates = useMemo(() => {
    const withFlag = templates.map((t) => ({ t, match: templateMatchesType(t) }));
    return [
      ...withFlag.filter((x) => x.match).map((x) => x.t),
      ...withFlag.filter((x) => !x.match).map((x) => x.t),
    ];
  }, [templates, templateMatchesType]);

  useEffect(() => {
    let live = true;
    // The investors API returns { items, total } — reading a
    // `investors` key here silently emptied every investor dropdown
    // on this tab (fixed in the Send anywhere build, Oct 25, 2026).
    api<{ items?: InvestorListItem[]; investors?: InvestorListItem[] }>(
      `${API}/investors?limit=100`
    )
      .then((d) => {
        if (live) {
          setInvestors(
            Array.isArray(d.items)
              ? d.items
              : Array.isArray(d.investors)
                ? d.investors
                : []
          );
        }
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  /** personId → email, from the investors list (its items carry the
   * Directory email; commitments do not). */
  const emailByPerson = useMemo(() => {
    const m = new Map<string, string>();
    for (const inv of investors) {
      if (inv.personId && inv.email) m.set(inv.personId, inv.email);
    }
    return m;
  }, [investors]);

  const addEntry = async () => {
    const amount = parseNum(form.amount);
    if (amount === null || adding) return;
    setAdding(true);
    setError("");
    try {
      await api(base, {
        method: "POST",
        body: JSON.stringify({
          investorPersonId: form.investorPersonId || null,
          entryType: form.entryType,
          amount,
          asOf: form.asOf,
          notes: form.notes.trim(),
        }),
      });
      setForm((f) => ({ ...f, amount: "", notes: "" }));
      await load();
      refreshSummary?.();
    } catch {
      setError("Could not add that entry. Please try again.");
    } finally {
      setAdding(false);
    }
  };

  const removeEntry = async (id: string) => {
    if (!window.confirm("Delete this reporting entry?")) return;
    setBusyId(id);
    setError("");
    try {
      await api(`${base}/${encodeURIComponent(id)}`, { method: "DELETE" });
      await load();
      refreshSummary?.();
    } catch {
      setError("Could not delete that entry. Please try again.");
    } finally {
      setBusyId("");
    }
  };

  const createTemplate = async () => {
    if (!tplForm.name.trim() || !tplForm.body.trim() || creatingTpl) return;
    setCreatingTpl(true);
    setError("");
    try {
      await api(`${API}/report-templates`, {
        method: "POST",
        body: JSON.stringify({
          name: tplForm.name.trim(),
          kind: tplForm.kind,
          body: tplForm.body,
        }),
      });
      setTplForm({ name: "", kind: "investor_update", body: "" });
      await loadTemplates();
    } catch {
      setError("Could not save that template. Please try again.");
    } finally {
      setCreatingTpl(false);
    }
  };

  const render = async () => {
    if (!renderSel.templateId || rendering) return;
    setRendering(true);
    setError("");
    try {
      // Preview render only — for one investor or the whole deal.
      // Sending (below) goes through the reports/send endpoint,
      // which bridges the render into comms and delivers it.
      const selected = recipients ? Array.from(recipients) : [];
      const effectiveInvestorId =
        renderSel.investorPersonId ||
        (selected.length === 1 ? selected[0] : "") ||
        "";
      const d = await api<{ text: string; values: Record<string, unknown> }>(
        `${API}/report-templates/render`,
        {
          method: "POST",
          body: JSON.stringify({
            dealId,
            templateId: renderSel.templateId,
            investorPersonId: effectiveInvestorId || undefined,
          }),
        }
      );
      setRendered({ text: d.text ?? "", values: d.values ?? {} });
    } catch {
      setError("Could not render that report. Pick a template and try again.");
    } finally {
      setRendering(false);
    }
  };

  /** Send the selected template to the selected recipients
   * (Send anywhere, Oct 25, 2026): the server renders (personalized
   * when exactly one recipient is selected), bridges the render into
   * comms, and delivers with per-recipient tracked links. Recipients
   * without an email on file are reported, never silently dropped
   * from the count. */
  const sendReport = async () => {
    if (!renderSel.templateId || sending) return;
    const selectedIds = recipients ? Array.from(recipients) : [];
    const sendable = participants
      .filter((p) => selectedIds.includes(p.personId))
      .map((p) => ({
        personId: p.personId,
        name: p.name,
        email: emailByPerson.get(p.personId) ?? "",
      }))
      .filter((r) => r.email.includes("@"));
    if (!sendable.length) {
      setError(
        "None of the selected recipients has an email on file — add one on their Directory record first."
      );
      return;
    }
    setSending(true);
    setError("");
    setSendResult(null);
    try {
      const d = await api<{
        deliveries: Array<{
          recipientName: string;
          recipientEmail: string;
          emailStatus: string;
          link?: string;
        }>;
      }>(`${API}/deals/${encodeURIComponent(dealId)}/reports/send`, {
        method: "POST",
        body: JSON.stringify({
          templateId: renderSel.templateId,
          recipients: sendable,
        }),
      });
      setSendResult(Array.isArray(d.deliveries) ? d.deliveries : []);
      await loadDeliveries();
    } catch (err) {
      const e = err as { status?: number; body?: Record<string, unknown> };
      if (e.status === 409 && e.body?.error === "send_blocked") {
        const check = (e.body.check ?? {}) as {
          blocked?: Array<{ message: string }>;
        };
        const msgs = (check.blocked ?? []).map((b) => b.message).join(" ");
        setError(
          `Delivery is blocked by the pre-send check.${msgs ? ` ${msgs}` : ""} Resolve it (or send from the report in Communications, where an override with a reason is available).`
        );
      } else {
        setError("Could not send that report. Pick a template and recipients and try again.");
      }
    } finally {
      setSending(false);
    }
  };

  if (loading) return <SkeletonRows rows={5} />;
  if (loadFailed || !data) return <ErrorState onRetry={() => void load()} />;

  const byInvestor = normalizeByInvestor(data.totals.byInvestor);

  return (
    <div className="space-y-5">
      {error && (
        <p role="alert" className="rounded-xl bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-300">{error}</p>
      )}

      {/* Totals */}
      <div className="grid grid-cols-3 gap-4">
        <div className="card-surface p-4">
          <StatTile label="Capital called" display={fmtMoneyCompact(data.totals.called)} title={fmtMoneyN(data.totals.called)} caption="All investors, to date" />
        </div>
        <div className="card-surface p-4">
          <StatTile label="Distributed" display={fmtMoneyCompact(data.totals.distributed)} title={fmtMoneyN(data.totals.distributed)} caption="All investors, to date" />
        </div>
        <div className="card-surface p-4">
          <StatTile label="Latest NAV" display={fmtMoneyCompact(data.totals.navLatest)} title={fmtMoneyN(data.totals.navLatest)} caption="Most recent NAV marks" />
        </div>
      </div>

      {/* Per-investor totals */}
      {byInvestor.length > 0 && (
        <div className={cardCls}>
          <h3 className="font-display text-lg font-semibold text-[#0d1f3c] dark:text-white">
            By investor
          </h3>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[520px]">
              <thead>
                <tr className="border-b border-slate-100 dark:border-white/5">
                  <th className={thCls}>Investor</th>
                  <th className={`${thCls} text-right`}>Called</th>
                  <th className={`${thCls} text-right`}>Distributed</th>
                  <th className={`${thCls} text-right`}>NAV</th>
                </tr>
              </thead>
              <tbody>
                {byInvestor.map((row) => (
                  <tr key={row.key} className="border-t border-slate-100 dark:border-white/5">
                    <td className={`${tdCls} font-semibold`}>{row.name}</td>
                    <td className={`${tdCls} tnum text-right`}>{fmtMoneyN(row.called)}</td>
                    <td className={`${tdCls} tnum text-right`}>{fmtMoneyN(row.distributed)}</td>
                    <td className={`${tdCls} tnum text-right`}>{fmtMoneyN(row.nav)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Delivery log — real comms delivery records for this deal */}
      <div className={cardCls}>
        <h3 className="font-display text-lg font-semibold text-[#0d1f3c] dark:text-white">
          Delivery log
        </h3>
        {deliveries.length === 0 ? (
          <p className="mt-2 max-w-2xl text-sm text-slate-500 dark:text-white/50">
            No reports have been sent for this deal yet. Pick a template and
            recipients under Investor reports below and use Send — every
            delivery lands here with its email outcome and open tracking.
            (The ledger below is the record of capital calls, distributions
            and NAV marks, not of sends.)
          </p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[760px]">
              <thead>
                <tr className="border-b border-slate-100 dark:border-white/5">
                  <th className={thCls}>Investor</th>
                  <th className={thCls}>What was sent</th>
                  <th className={thCls}>Sent</th>
                  <th className={thCls}>Email</th>
                  <th className={thCls}>Opened (pixel-detected)</th>
                  <th className={thCls}>Opened / Viewed / Downloaded</th>
                  <th className={thCls}>Status</th>
                </tr>
              </thead>
              <tbody>
                {deliveries.map((d) => (
                  <tr key={d.id} className="border-t border-slate-100 dark:border-white/5">
                    <td className={`${tdCls} font-semibold`}>
                      {d.recipientName || d.recipientEmail}
                      {d.recipientName && (
                        <span className="block text-xs font-normal text-slate-400 dark:text-white/40">
                          {d.recipientEmail}
                        </span>
                      )}
                    </td>
                    <td className={tdCls}>{d.reportTitle}</td>
                    <td className={tdCls}>{d.deliveredAt ? fmtDateShort(d.deliveredAt) : "—"}</td>
                    <td className={tdCls}>{d.emailStatus || "—"}</td>
                    <td className={tdCls}>{d.emailOpenedAt ? fmtDateShort(d.emailOpenedAt) : "—"}</td>
                    <td className={tdCls}>
                      {d.openedAt ? fmtDateShort(d.openedAt) : "—"} /{" "}
                      {d.viewedAt ? fmtDateShort(d.viewedAt) : "—"} /{" "}
                      {d.downloadedAt ? fmtDateShort(d.downloadedAt) : "—"}
                    </td>
                    <td className={tdCls}>
                      <span className={`badge ${d.status === "revoked" ? "badge-danger" : "badge-fit"}`}>
                        {d.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Ledger */}
      <div className={cardCls}>
        <h3 className="font-display text-lg font-semibold text-[#0d1f3c] dark:text-white">
          Reporting ledger
        </h3>
        {data.entries.length === 0 ? (
          <div className="mt-3">
            <EmptyState
              title="No reporting entries yet"
              message="Capital calls, distributions and NAV marks for this deal land here. Add the first entry below — leave the investor blank for a deal-level entry."
            />
          </div>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[640px]">
              <thead>
                <tr className="border-b border-slate-100 dark:border-white/5">
                  <th className={thCls}>As of</th>
                  <th className={thCls}>Investor</th>
                  <th className={thCls}>Type</th>
                  <th className={`${thCls} text-right`}>Amount</th>
                  <th className={thCls}>Notes</th>
                  <th className={thCls}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {data.entries.map((e) => (
                  <tr key={e.id} className="border-t border-slate-100 dark:border-white/5">
                    <td className={tdCls}>{fmtDateShort(e.asOf)}</td>
                    <td className={tdCls}>{e.investorName || "Deal level"}</td>
                    <td className={tdCls}>
                      <span className={`badge ${entryTypeBadge(e.entryType)}`}>
                        {labelOf(REPORT_ENTRY_TYPES, e.entryType)}
                      </span>
                    </td>
                    <td className={`${tdCls} tnum text-right font-semibold`}>{fmtMoneyN(e.amount)}</td>
                    <td className={tdCls}>{e.notes || "—"}</td>
                    <td className={tdCls}>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm min-h-[44px]"
                        disabled={busyId === e.id}
                        onClick={() => void removeEntry(e.id)}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="mt-5 border-t border-slate-100 pt-4 dark:border-white/5">
          <h4 className="text-sm font-semibold text-[#0d1f3c] dark:text-white">Add an entry</h4>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_150px_150px_150px_1fr_auto] lg:items-end">
            <div>
              <label className={labelCls}>Investor (blank = deal level)</label>
              <select className={`${selectCls} min-h-[44px]`} value={form.investorPersonId} onChange={(e) => setForm((f) => ({ ...f, investorPersonId: e.target.value }))}>
                <option value="">Deal level</option>
                {investors.map((inv) => (
                  <option key={inv.personId} value={inv.personId}>
                    {inv.name}{inv.firm ? ` — ${inv.firm}` : ""}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls}>Type</label>
              <select className={`${selectCls} min-h-[44px]`} value={form.entryType} onChange={(e) => setForm((f) => ({ ...f, entryType: e.target.value }))}>
                {REPORT_ENTRY_TYPES.map((t) => (
                  <option key={t.key} value={t.key}>{t.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls}>Amount ($)</label>
              <input inputMode="numeric" className={`${inputCls} min-h-[44px]`} value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} placeholder="250,000" />
            </div>
            <div>
              <label className={labelCls}>As of</label>
              <input type="date" className={`${inputCls} min-h-[44px]`} value={form.asOf} onChange={(e) => setForm((f) => ({ ...f, asOf: e.target.value }))} />
            </div>
            <div>
              <label className={labelCls}>Notes</label>
              <input className={`${inputCls} min-h-[44px]`} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
            </div>
            <Button onClick={() => void addEntry()} loading={adding} disabled={parseNum(form.amount) === null} className="min-h-[44px]">
              Add
            </Button>
          </div>
        </div>
      </div>

      {/* Templates + render */}
      <div className={cardCls}>
        <h3 className="font-display text-lg font-semibold text-[#0d1f3c] dark:text-white">
          Investor reports
        </h3>
        <p className="mt-0.5 max-w-2xl text-sm text-slate-500 dark:text-white/50">
          Render a template against this deal&apos;s real figures. Sections
          that depend on Portfolio Monitoring show the Phase 8 marker until
          that module exists — the rendered text is shown exactly as the
          API returns it.
        </p>

        {/* Recipients — from this raise's investors */}
        <div className="mt-4 rounded-2xl border border-slate-100 p-4 dark:border-white/5">
          <h4 className="text-sm font-semibold text-[#0d1f3c] dark:text-white">
            Recipients — this raise&apos;s investors
          </h4>
          {participants.length === 0 ? (
            <p className="mt-1 text-sm text-slate-500 dark:text-white/50">
              No investors are in this raise yet, so there is no one to select.
            </p>
          ) : (
            <>
              <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {participants.map((p) => {
                  const checked = recipients?.has(p.personId) ?? false;
                  return (
                    <label key={p.personId} className="flex min-h-[44px] cursor-pointer items-center gap-2 rounded-xl bg-slate-50 px-3 py-2 text-sm text-[#0d1f3c] dark:bg-white/5 dark:text-white/90">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) =>
                          setRecipients((prev) => {
                            const next = new Set(prev ?? []);
                            if (e.target.checked) next.add(p.personId);
                            else next.delete(p.personId);
                            return next;
                          })
                        }
                      />
                      <span>
                        {p.name}
                        <span className="block text-xs text-slate-400 dark:text-white/40">
                          {emailByPerson.get(p.personId) ?? "No email on file — can't be sent to"}
                        </span>
                      </span>
                    </label>
                  );
                })}
              </div>
              <p className="mt-2 text-xs text-slate-400 dark:text-white/40">
                {recipients ? `${recipients.size} of ${participants.length} selected. ` : ""}
                Sending delivers through the portal&apos;s report pipeline
                (tracked personal links, 30-day expiry): when exactly one
                recipient is selected the report is personalized to them;
                with several, the whole-deal render is sent and each
                recipient&apos;s copy is prepared for them.
              </p>
            </>
          )}
        </div>
        {bundle && templates.some((t) => templateMatchesType(t)) && (
          <p className="mt-3 flex flex-wrap gap-1.5">
            <span className="text-xs text-slate-400 dark:text-white/40">Templates matching this deal&apos;s type ({typeLabel}), listed first:</span>
            {templates.filter((t) => templateMatchesType(t)).map((t) => (
              <span key={t.id} className="badge badge-fit">{t.name} — matches {typeLabel}</span>
            ))}
          </p>
        )}
        <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_1fr_auto_auto] sm:items-end">
          <div>
            <label className={labelCls}>Template</label>
            <select className={`${selectCls} min-h-[44px]`} value={renderSel.templateId} onChange={(e) => setRenderSel((s) => ({ ...s, templateId: e.target.value }))}>
              <option value="">Select template…</option>
              {sortedTemplates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}{t.isSystem ? " (system)" : ""}{templateMatchesType(t) ? ` — matches ${typeLabel}` : ""}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls}>Investor (optional)</label>
            <select className={`${selectCls} min-h-[44px]`} value={renderSel.investorPersonId} onChange={(e) => setRenderSel((s) => ({ ...s, investorPersonId: e.target.value }))}>
              <option value="">Whole deal</option>
              {investors.map((inv) => (
                <option key={inv.personId} value={inv.personId}>{inv.name}</option>
              ))}
            </select>
          </div>
          <Button onClick={() => void render()} loading={rendering} disabled={!renderSel.templateId} className="min-h-[44px]">
            Render report
          </Button>
          <Button
            onClick={() => void sendReport()}
            loading={sending}
            disabled={!renderSel.templateId || !recipients || recipients.size === 0}
            className="min-h-[44px]"
          >
            Send to selected recipients
          </Button>
        </div>

        {sendResult && (
          <div className="mt-4 space-y-2 rounded-2xl border border-slate-100 p-4 dark:border-white/5">
            <p className="text-sm font-semibold text-[#0d1f3c] dark:text-white">
              Sent — per-recipient outcomes
            </p>
            {sendResult.map((d, i) => (
              <div key={i} className="text-sm text-slate-600 dark:text-white/70">
                <p>
                  <span className="font-semibold">{d.recipientName || d.recipientEmail}</span>{" "}
                  — email: {d.emailStatus || "unknown"}
                </p>
                {d.link && d.emailStatus !== "sent" && (
                  <p className="mt-1 break-all rounded-lg bg-slate-100 px-3 py-2 text-xs dark:bg-white/10">
                    Recipient link (shown once — copy it now if the email
                    above was not sent):{" "}
                    <span className="font-mono">{d.link}</span>
                  </p>
                )}
              </div>
            ))}
            <p className="text-xs text-slate-400 dark:text-white/40">
              Deliveries are tracked in the Delivery log above; the sent
              report also lives in Communications.
            </p>
          </div>
        )}

        {rendered && (
          <div className="mt-4">
            <pre className="max-h-[480px] overflow-auto whitespace-pre-wrap rounded-2xl border border-slate-200 bg-slate-50 p-4 font-sans text-sm leading-relaxed text-[#0d1f3c] dark:border-white/10 dark:bg-white/5 dark:text-white/90">
              {rendered.text}
            </pre>
            {Object.keys(rendered.values).length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {Object.entries(rendered.values).map(([k, v]) => (
                  <span key={k} className="badge badge-neutral">
                    {k}: {typeof v === "number" ? fmtMoneyN(v) : String(v)}
                  </span>
                ))}
              </div>
            )}
            <div className="mt-3">
              <Button
                variant="secondary"
                size="sm"
                className="min-h-[44px]"
                onClick={() => {
                  void navigator.clipboard?.writeText(rendered.text).catch(() => undefined);
                }}
              >
                Copy rendered text
              </Button>
            </div>
          </div>
        )}

        <div className="mt-5 border-t border-slate-100 pt-4 dark:border-white/5">
          <h4 className="text-sm font-semibold text-[#0d1f3c] dark:text-white">New template</h4>
          <p className="mt-1 text-xs text-slate-400 dark:text-white/40">
            Placeholders: {"{{investor_name}}"}, {"{{company_name}}"}, {"{{deal_name}}"}, {"{{as_of}}"}, {"{{committed}}"}, {"{{capital_called}}"}, {"{{distributions}}"}, {"{{nav}}"}, {"{{monitoring_section}}"}.
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div>
              <label className={labelCls}>Name</label>
              <input className={`${inputCls} min-h-[44px]`} value={tplForm.name} onChange={(e) => setTplForm((f) => ({ ...f, name: e.target.value }))} placeholder="Quarterly investor update" />
            </div>
            <div>
              <label className={labelCls}>Kind</label>
              <select className={`${selectCls} min-h-[44px]`} value={tplForm.kind} onChange={(e) => setTplForm((f) => ({ ...f, kind: e.target.value }))}>
                <option value="investor_update">Investor update</option>
                <option value="capital_statement">Capital statement</option>
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className={labelCls}>Body</label>
              <textarea className={`${inputCls} min-h-[120px]`} value={tplForm.body} onChange={(e) => setTplForm((f) => ({ ...f, body: e.target.value }))} />
            </div>
          </div>
          <div className="mt-3">
            <Button variant="secondary" onClick={() => void createTemplate()} loading={creatingTpl} disabled={!tplForm.name.trim() || !tplForm.body.trim()} className="min-h-[44px]">
              Save template
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

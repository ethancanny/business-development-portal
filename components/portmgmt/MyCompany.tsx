"use client";

/**
 * Scoped portfolio-company portal (Phase 9) — what a management
 * (role 'guest') user sees at /my-company. Their world is exactly one
 * (or a few) companies from GET /api/portmgmt/me:
 *  (a) Reporting — periods from the monitoring periods API, each open
 *      period submittable three ways: chunked file upload (portmgmt
 *      uploads protocol) + submit, in-portal statement entry, or KPI
 *      entry; statement/KPI templates download from /api/portmgmt/
 *      templates/[kind].
 *  (b) KPI dashboard — read-only, from the monitoring kpis endpoint.
 *  (c) Documents — upload (kind picker) + the company's list.
 *  (d) Board meetings — list; a generated pack links through the
 *      document file route (noted in place — access depends on the
 *      caller's grant, no download is faked).
 * Internal users (companyIds null) get a short notice + a link to
 * Portfolio Monitoring instead — this portal is not for them.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Button, EmptyState, ErrorState, SkeletonRows, StatTile } from "@/components/ui";
import { ErrorBanner, Section, SimpleTable } from "@/components/monitoring/shared";
import {
  API as MON_API,
  companyBase,
  dateOnly,
  fmtDateShort,
  fmtFractionPct,
  fmtMoneyC,
  fmtMoneyN,
  inputCls,
  labelCls,
  listFrom,
  parseNum,
  selectCls,
  statusBadge,
  type Rec,
} from "@/components/monitoring/types";
import { api, num, pick, pmCompany, rowsFrom, str, uploadFilePortmgmt } from "@/components/portmgmt/pm";

/* Statement lines offered by the in-portal entry grid. Labels mirror
 * the Phase 4 canonical template; the server maps/validates them. */
const STATEMENT_LINES = [
  { lineKey: "revenue", label: "Revenue" },
  { lineKey: "cogs", label: "Cost of goods sold" },
  { lineKey: "gross_profit", label: "Gross profit" },
  { lineKey: "operating_expenses", label: "Operating expenses" },
  { lineKey: "ebitda", label: "EBITDA" },
  { lineKey: "depreciation_amortization", label: "Depreciation & amortization" },
  { lineKey: "ebit", label: "EBIT" },
  { lineKey: "interest", label: "Interest" },
  { lineKey: "taxes", label: "Taxes" },
  { lineKey: "net_income", label: "Net income" },
  { lineKey: "cash", label: "Cash & equivalents" },
  { lineKey: "accounts_receivable", label: "Accounts receivable" },
  { lineKey: "inventory", label: "Inventory" },
  { lineKey: "accounts_payable", label: "Accounts payable" },
  { lineKey: "total_debt", label: "Total debt" },
  { lineKey: "total_equity", label: "Total equity" },
  { lineKey: "operating_cash_flow", label: "Operating cash flow" },
  { lineKey: "net_change_in_cash", label: "Net change in cash" },
] as const;

const DOC_KINDS = [
  { key: "board_deck", label: "Board deck" },
  { key: "bank_statement", label: "Bank statement" },
  { key: "financial_statement", label: "Financial statement" },
  { key: "other", label: "Other" },
] as const;

type PortalTab = "reporting" | "kpis" | "documents" | "meetings";

interface MeCompany {
  id: string;
  name: string;
}

export default function MyCompany() {
  const router = useRouter();
  const [phase, setPhase] = useState<"loading" | "ready" | "internal" | "error">("loading");
  const [userName, setUserName] = useState("");
  const [companies, setCompanies] = useState<MeCompany[]>([]);
  const [companyId, setCompanyId] = useState("");
  const [tab, setTab] = useState<PortalTab>("reporting");

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const res = await fetch("/api/portmgmt/me", { cache: "no-store" });
        if (res.status === 401) {
          router.replace("/login");
          return;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const d = (await res.json()) as Rec;
        if (!live) return;
        const user = (pick(d, "user") ?? {}) as Rec;
        setUserName(str(pick(user, "name")) || str(pick(d, "name")));
        const ids = pick(d, "companyIds");
        if (ids === null || ids === undefined) {
          setPhase("internal");
          return;
        }
        const list = rowsFrom(d, "companies").map((c) => ({
          id: str(pick(c, "id", "companyId")),
          name: str(pick(c, "name", "companyName")) || str(pick(c, "id")),
        })).filter((c) => c.id);
        // Fall back to bare ids if the companies array is absent.
        const fallback = Array.isArray(ids)
          ? (ids as unknown[]).map(String).filter((id) => !list.some((c) => c.id === id)).map((id) => ({ id, name: id }))
          : [];
        const all = [...list, ...fallback];
        setCompanies(all);
        setCompanyId(all[0]?.id ?? "");
        setPhase("ready");
      } catch {
        if (live) setPhase("error");
      }
    })();
    return () => {
      live = false;
    };
  }, [router]);

  const signOut = async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      /* session cookie may already be gone — still route to login */
    }
    router.replace("/login");
  };

  const companyName = companies.find((c) => c.id === companyId)?.name ?? "";

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-[#0a1730]">
      {/* Minimal branded shell — navy header, company name, sign out. */}
      <header className="bg-[#0d1f3c] pt-safe">
        <div className="mx-auto flex min-h-14 max-w-[1100px] flex-wrap items-center justify-between gap-2 px-4 py-2.5 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <img
              src="https://cannycapitalpartners.com/canny-logo-white.png"
              alt="Canny Capital Partners"
              className="h-8 w-auto"
            />
            <span className="hidden border-l border-[#b8975a]/50 pl-3 text-sm font-semibold text-white sm:block">
              Company Portal
            </span>
          </div>
          <div className="flex items-center gap-3">
            {userName && <span className="hidden text-xs text-[#c8bfa8] sm:block">{userName}</span>}
            <button
              type="button"
              onClick={() => void signOut()}
              className="min-h-[44px] rounded-lg border border-[#b8975a]/60 px-3 py-1.5 text-sm font-semibold text-[#e8dfc8] transition hover:bg-[#b8975a] hover:text-[#0d1f3c]"
            >
              Sign out
            </button>
          </div>
        </div>
        <div className="h-0.5 bg-[#b8975a]" />
      </header>

      <main className="mx-auto max-w-[1100px] px-4 py-6 sm:px-6">
        {phase === "loading" && <SkeletonRows rows={6} />}
        {phase === "error" && (
          <ErrorState
            title="Could not load your portal"
            message="Your company access could not be loaded. Try again, or contact Canny Capital if it persists."
            onRetry={() => window.location.reload()}
          />
        )}
        {phase === "internal" && (
          <div className="card-surface px-6 py-10 text-center">
            <p className="font-display text-2xl font-semibold text-navy-900 dark:text-white">
              This portal is for portfolio-company management
            </p>
            <p className="caption mx-auto mt-2 max-w-md">
              You are signed in with an internal Canny Capital account, which
              is not scoped to a single company. Your companies live in
              Portfolio Monitoring.
            </p>
            <div className="mt-5">
              <Link href="/portfolio-monitoring" className="btn btn-primary min-h-[44px]">
                Open Portfolio Monitoring
              </Link>
            </div>
          </div>
        )}
        {phase === "ready" && companies.length === 0 && (
          <EmptyState
            title="No company assigned yet"
            message="Your account is not linked to a portfolio company yet. Canny Capital will link your company — check back shortly."
          />
        )}
        {phase === "ready" && companies.length > 0 && (
          <>
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h1 className="font-display text-3xl font-semibold text-[#0d1f3c] dark:text-white">
                  {companyName}
                </h1>
                <p className="mt-0.5 text-sm text-slate-500 dark:text-white/50">
                  Reporting, KPIs, documents and board meetings for your company.
                </p>
              </div>
              {companies.length > 1 && (
                <div>
                  <label className={labelCls} htmlFor="mc-company">Company</label>
                  <select
                    id="mc-company"
                    className={`${selectCls} min-h-[44px] w-auto`}
                    value={companyId}
                    onChange={(e) => setCompanyId(e.target.value)}
                  >
                    {companies.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            <div className="mt-5 flex gap-1.5 overflow-x-auto pb-1" role="tablist" aria-label="Company portal sections">
              {(
                [
                  ["reporting", "Reporting"],
                  ["kpis", "KPI dashboard"],
                  ["documents", "Documents"],
                  ["meetings", "Board meetings"],
                ] as Array<[PortalTab, string]>
              ).map(([key, label]) => (
                <button
                  key={key}
                  role="tab"
                  aria-selected={tab === key}
                  onClick={() => setTab(key)}
                  className={`chip min-h-[44px] shrink-0 ${tab === key ? "chip-active" : ""}`}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="mt-5" key={companyId}>
              {tab === "reporting" && <ReportingPanel companyId={companyId} />}
              {tab === "kpis" && <KpiPanel companyId={companyId} />}
              {tab === "documents" && <DocumentsPanel companyId={companyId} />}
              {tab === "meetings" && <MeetingsPanel companyId={companyId} />}
            </div>
          </>
        )}
      </main>
    </div>
  );
}

/* ------------------------------ Reporting ------------------------------ */

function ReportingPanel({ companyId }: { companyId: string }) {
  const monBase = companyBase(companyId);
  const pmBase = pmCompany(companyId);
  const [periods, setPeriods] = useState<Rec[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setLoadFailed(false);
    try {
      const d = await api<Rec>(`${monBase}/periods`);
      setPeriods(listFrom(d, "periods", "items"));
    } catch {
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, [monBase]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) return <SkeletonRows rows={5} />;
  if (loadFailed) return <ErrorState onRetry={() => void load()} />;

  return (
    <div className="space-y-5">
      <ErrorBanner message={error} />
      {notice && (
        <p role="status" className="rounded-xl bg-emerald-500/10 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-300">
          {notice}
        </p>
      )}
      <Section
        title="Reporting periods"
        caption="Submit each open period by uploading your statements file, entering the figures in the portal, and adding the period's KPIs. Templates match the portal's expected layout."
        actions={
          <>
            <a href="/api/portmgmt/templates/statements" className="btn btn-secondary btn-sm min-h-[44px]">
              Statements template
            </a>
            <a href="/api/portmgmt/templates/kpis" className="btn btn-secondary btn-sm min-h-[44px]">
              KPI template
            </a>
          </>
        }
      >
        {periods.length === 0 ? (
          <EmptyState
            title="No reporting periods yet"
            message="Canny Capital opens reporting periods here — when the first one is due, it will appear with its due date."
          />
        ) : (
          <div className="space-y-4">
            {periods.map((p, i) => (
              <PeriodCard
                key={str(pick(p, "id", "periodId")) || String(i)}
                period={p}
                pmBase={pmBase}
                onSubmitted={(msg) => {
                  setNotice(msg);
                  void load();
                }}
                onError={setError}
              />
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}

function PeriodCard({
  period,
  pmBase,
  onSubmitted,
  onError,
}: {
  period: Rec;
  pmBase: string;
  onSubmitted: (msg: string) => void;
  onError: (msg: string) => void;
}) {
  const periodId = str(pick(period, "id", "periodId"));
  const periodEnd = dateOnly(pick(period, "periodEnd"));
  const status = str(pick(period, "status", "reportingStatus"));
  const isOpen =
    status.toLowerCase() !== "received" && !pick(period, "receivedAt") && Boolean(periodId);

  const fileRef = useRef<HTMLInputElement | null>(null);
  const [uploadPct, setUploadPct] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [showEntry, setShowEntry] = useState(false);
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [savingEntry, setSavingEntry] = useState(false);

  const [showKpis, setShowKpis] = useState(false);
  const [kpiForm, setKpiForm] = useState({ headcount: "", customerCount: "", customKey: "", customValue: "" });
  const [savingKpis, setSavingKpis] = useState(false);

  const submitFile = async (file: File) => {
    setSubmitting(true);
    setUploadPct(0);
    onError("");
    try {
      const companyId = pmBase.split("/companies/")[1]?.split("/")[0] ?? "";
      const doc = await uploadFilePortmgmt(file, decodeURIComponent(companyId), setUploadPct);
      await api(`${pmBase}/periods/${encodeURIComponent(periodId)}/submit`, {
        method: "POST",
        body: JSON.stringify({ documentId: doc.id }),
      });
      onSubmitted(`Statements for the period ending ${fmtDateShort(periodEnd)} were submitted.`);
    } catch {
      onError("The upload or submission failed. Check the file and try again.");
    } finally {
      setSubmitting(false);
      setUploadPct(null);
    }
  };

  const submitEntry = async () => {
    const lines = STATEMENT_LINES.map((l) => ({
      lineKey: l.lineKey,
      label: l.label,
      amount: parseNum(amounts[l.lineKey] ?? ""),
    })).filter((l) => l.amount !== null);
    if (lines.length === 0 || savingEntry) return;
    setSavingEntry(true);
    onError("");
    try {
      await api(`${pmBase}/periods/${encodeURIComponent(periodId)}/entry`, {
        method: "POST",
        body: JSON.stringify({ lines, periodEnd }),
      });
      setShowEntry(false);
      onSubmitted(`Figures for the period ending ${fmtDateShort(periodEnd)} were submitted.`);
    } catch {
      onError("Could not submit those figures. Check the amounts and try again.");
    } finally {
      setSavingEntry(false);
    }
  };

  const submitKpis = async () => {
    if (savingKpis) return;
    setSavingKpis(true);
    onError("");
    const custom: Record<string, number> = {};
    const cv = parseNum(kpiForm.customValue);
    if (kpiForm.customKey.trim() && cv !== null) custom[kpiForm.customKey.trim()] = cv;
    try {
      await api(`${pmBase}/periods/${encodeURIComponent(periodId)}/kpis`, {
        method: "POST",
        body: JSON.stringify({
          headcount: parseNum(kpiForm.headcount),
          customerCount: parseNum(kpiForm.customerCount),
          custom,
        }),
      });
      setShowKpis(false);
      onSubmitted(`KPIs for the period ending ${fmtDateShort(periodEnd)} were saved.`);
    } catch {
      onError("Could not save those KPIs.");
    } finally {
      setSavingKpis(false);
    }
  };

  return (
    <div className="rounded-xl border border-slate-200 p-4 dark:border-white/10">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-[#0d1f3c] dark:text-white">
            Period ending {fmtDateShort(periodEnd)}
          </p>
          <p className="text-xs text-slate-400 dark:text-white/40">
            {str(pick(period, "cadence", "periodType")) || "Monthly"}
            {pick(period, "dueDate") ? ` · Due ${fmtDateShort(dateOnly(pick(period, "dueDate")))}` : ""}
          </p>
        </div>
        {status && <span className={`badge ${statusBadge(status)}`}>{status}</span>}
      </div>

      {isOpen ? (
        <div className="mt-3 space-y-3">
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              className="min-h-[44px]"
              loading={submitting}
              onClick={() => fileRef.current?.click()}
            >
              {uploadPct !== null ? `Uploading… ${uploadPct}%` : "Upload statements"}
            </Button>
            <input
              ref={fileRef}
              type="file"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void submitFile(f);
                e.target.value = "";
              }}
            />
            <Button size="sm" variant="secondary" className="min-h-[44px]" onClick={() => setShowEntry((v) => !v)}>
              Enter figures
            </Button>
            <Button size="sm" variant="secondary" className="min-h-[44px]" onClick={() => setShowKpis((v) => !v)}>
              Enter KPIs
            </Button>
          </div>

          {showEntry && (
            <div className="rounded-xl bg-slate-50 p-3 dark:bg-white/5">
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {STATEMENT_LINES.map((l) => (
                  <div key={l.lineKey}>
                    <label className={labelCls} htmlFor={`entry-${periodId}-${l.lineKey}`}>{l.label} ($)</label>
                    <input
                      id={`entry-${periodId}-${l.lineKey}`}
                      inputMode="numeric"
                      className={`${inputCls} min-h-[44px]`}
                      value={amounts[l.lineKey] ?? ""}
                      onChange={(e) => setAmounts((a) => ({ ...a, [l.lineKey]: e.target.value }))}
                    />
                  </div>
                ))}
              </div>
              <div className="mt-3 flex gap-2">
                <Button size="sm" className="min-h-[44px]" loading={savingEntry} onClick={() => void submitEntry()}>
                  Submit figures
                </Button>
                <Button size="sm" variant="ghost" className="min-h-[44px]" onClick={() => setShowEntry(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          )}

          {showKpis && (
            <div className="rounded-xl bg-slate-50 p-3 dark:bg-white/5">
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                <div>
                  <label className={labelCls}>Headcount</label>
                  <input inputMode="numeric" className={`${inputCls} min-h-[44px]`} value={kpiForm.headcount} onChange={(e) => setKpiForm((f) => ({ ...f, headcount: e.target.value }))} />
                </div>
                <div>
                  <label className={labelCls}>Customer count</label>
                  <input inputMode="numeric" className={`${inputCls} min-h-[44px]`} value={kpiForm.customerCount} onChange={(e) => setKpiForm((f) => ({ ...f, customerCount: e.target.value }))} />
                </div>
                <div>
                  <label className={labelCls}>Custom metric name</label>
                  <input className={`${inputCls} min-h-[44px]`} value={kpiForm.customKey} onChange={(e) => setKpiForm((f) => ({ ...f, customKey: e.target.value }))} placeholder="e.g. Locations" />
                </div>
                <div>
                  <label className={labelCls}>Custom metric value</label>
                  <input inputMode="numeric" className={`${inputCls} min-h-[44px]`} value={kpiForm.customValue} onChange={(e) => setKpiForm((f) => ({ ...f, customValue: e.target.value }))} />
                </div>
              </div>
              <div className="mt-3 flex gap-2">
                <Button size="sm" className="min-h-[44px]" loading={savingKpis} onClick={() => void submitKpis()}>
                  Save KPIs
                </Button>
                <Button size="sm" variant="ghost" className="min-h-[44px]" onClick={() => setShowKpis(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </div>
      ) : (
        <p className="mt-2 text-sm text-slate-500 dark:text-white/50">
          {pick(period, "receivedAt")
            ? `Received ${fmtDateShort(dateOnly(pick(period, "receivedAt")) || str(pick(period, "receivedAt")))}.`
            : "This period is closed."}
        </p>
      )}
    </div>
  );
}

/* ------------------------------ KPI dashboard ------------------------------ */

function KpiPanel({ companyId }: { companyId: string }) {
  const monBase = companyBase(companyId);
  const [rows, setRows] = useState<Rec[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadFailed(false);
    try {
      const d = await api<Rec>(`${monBase}/kpis`);
      const list = listFrom(d, "kpis", "rows", "items", "periods");
      setRows(
        [...list].sort((a, b) =>
          dateOnly(pick(a, "periodEnd")).localeCompare(dateOnly(pick(b, "periodEnd")))
        )
      );
    } catch {
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, [monBase]);

  useEffect(() => {
    void load();
  }, [load]);

  const chartData = useMemo(
    () =>
      rows.map((r) => ({
        label: dateOnly(pick(r, "periodEnd")) || "—",
        revenue: num(pick(r, "revenue")),
        ebitda: num(pick(r, "ebitda")),
      })),
    [rows]
  );

  if (loading) return <SkeletonRows rows={5} />;
  if (loadFailed) return <ErrorState onRetry={() => void load()} />;

  const latest = rows[rows.length - 1] ?? {};
  const margin = num(pick(latest, "grossMarginPct", "grossMargin"));
  const marginIsFraction = margin !== null && Math.abs(margin) <= 1.5;

  return (
    <div className="space-y-5">
      <Section title="KPI dashboard" caption="Read-only — these are the figures Canny Capital holds for your company, latest reported period first-class. Margins are shown as percentages.">
        {rows.length === 0 ? (
          <EmptyState
            title="No KPIs yet"
            message="Once your first period is submitted and posted, revenue, EBITDA, margin and cash appear here."
          />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
              <div className="card-surface p-4">
                <StatTile label="Revenue" display={fmtMoneyC(num(pick(latest, "revenue")))} title={fmtMoneyN(num(pick(latest, "revenue")))} caption={`Period ending ${fmtDateShort(dateOnly(pick(latest, "periodEnd")))}`} />
              </div>
              <div className="card-surface p-4">
                <StatTile label="EBITDA" display={fmtMoneyC(num(pick(latest, "ebitda")))} title={fmtMoneyN(num(pick(latest, "ebitda")))} caption="Latest period" />
              </div>
              <div className="card-surface p-4">
                <StatTile
                  label="Gross margin"
                  display={marginIsFraction ? fmtFractionPct(margin) : margin === null ? "—" : `${margin.toFixed(1)}%`}
                  caption="Latest period"
                />
              </div>
              <div className="card-surface p-4">
                <StatTile label="Cash" display={fmtMoneyC(num(pick(latest, "cash", "cashBalance")))} title={fmtMoneyN(num(pick(latest, "cash", "cashBalance")))} caption="Latest snapshot" />
              </div>
              <div className="card-surface p-4">
                <StatTile label="Headcount" display={num(pick(latest, "headcount")) === null ? "—" : String(Math.round(num(pick(latest, "headcount")) as number))} caption="Latest period" />
              </div>
              <div className="card-surface p-4">
                <StatTile label="Customers" display={num(pick(latest, "customerCount", "customer_count")) === null ? "—" : String(Math.round(num(pick(latest, "customerCount", "customer_count")) as number))} caption="Latest period" />
              </div>
            </div>

            {chartData.length >= 2 && (
              <div className="mt-5 h-60">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                    <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" />
                    <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#64748b" }} minTickGap={30} />
                    <YAxis tick={{ fontSize: 11, fill: "#64748b" }} tickFormatter={(v: number) => fmtMoneyC(v)} />
                    <Tooltip formatter={(v) => [fmtMoneyN(typeof v === "number" ? v : null), ""]} />
                    <Line type="monotone" dataKey="revenue" name="Revenue" stroke="#0d1f3c" strokeWidth={2} dot={{ r: 3 }} />
                    <Line type="monotone" dataKey="ebitda" name="EBITDA" stroke="#b8975a" strokeWidth={2} dot={{ r: 3 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}

            <div className="mt-5">
              <SimpleTable
                rows={[...rows].reverse()}
                rowKey={(r, i) => dateOnly(pick(r, "periodEnd")) || String(i)}
                columns={[
                  { key: "periodEnd", label: "Period end", value: (r) => fmtDateShort(dateOnly(pick(r, "periodEnd"))) },
                  { key: "revenue", label: "Revenue", align: "right", value: (r) => fmtMoneyN(num(pick(r, "revenue"))) },
                  { key: "ebitda", label: "EBITDA", align: "right", value: (r) => fmtMoneyN(num(pick(r, "ebitda"))) },
                  {
                    key: "margin",
                    label: "Gross margin",
                    align: "right",
                    value: (r) => {
                      const m = num(pick(r, "grossMarginPct", "grossMargin"));
                      if (m === null) return "—";
                      return Math.abs(m) <= 1.5 ? fmtFractionPct(m) : `${m.toFixed(1)}%`;
                    },
                  },
                  { key: "cash", label: "Cash", align: "right", value: (r) => fmtMoneyN(num(pick(r, "cash", "cashBalance"))) },
                ]}
              />
            </div>
          </>
        )}
      </Section>
      <p className="text-xs text-slate-400 dark:text-white/40">
        Data refreshes when Canny Capital posts your submissions. Source: {MON_API} company KPIs.
      </p>
    </div>
  );
}

/* ------------------------------ Documents ------------------------------ */

function DocumentsPanel({ companyId }: { companyId: string }) {
  const pmBase = pmCompany(companyId);
  const [docs, setDocs] = useState<Rec[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [kind, setKind] = useState<string>("board_deck");
  const [pct, setPct] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadFailed(false);
    try {
      const d = await api<Rec>(`${pmBase}/documents`);
      setDocs(rowsFrom(d, "documents", "items"));
    } catch {
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, [pmBase]);

  useEffect(() => {
    void load();
  }, [load]);

  const upload = async (file: File) => {
    setPct(0);
    setError("");
    setNotice("");
    try {
      const doc = await uploadFilePortmgmt(file, companyId, setPct);
      try {
        await api(`${pmBase}/documents`, {
          method: "POST",
          body: JSON.stringify({ documentId: doc.id, kind, name: file.name }),
        });
      } catch {
        /* The upload itself already registered the document; the kind
         * link is best-effort and the list refresh shows the truth. */
      }
      setNotice(`“${file.name}” uploaded as ${DOC_KINDS.find((k) => k.key === kind)?.label ?? kind}.`);
      await load();
    } catch {
      setError("That upload failed. Check the file and try again.");
    } finally {
      setPct(null);
    }
  };

  if (loading) return <SkeletonRows rows={5} />;
  if (loadFailed) return <ErrorState onRetry={() => void load()} />;

  return (
    <div className="space-y-5">
      <ErrorBanner message={error} />
      {notice && (
        <p role="status" className="rounded-xl bg-emerald-500/10 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-300">
          {notice}
        </p>
      )}
      <Section
        title="Documents"
        caption="Files shared with Canny Capital for your company. Pick the kind, then upload — files transfer in resumable chunks."
        actions={
          <div className="flex items-end gap-2">
            <div>
              <label className={labelCls} htmlFor="mc-doc-kind">Kind</label>
              <select
                id="mc-doc-kind"
                className={`${selectCls} min-h-[44px] w-auto`}
                value={kind}
                onChange={(e) => setKind(e.target.value)}
              >
                {DOC_KINDS.map((k) => (
                  <option key={k.key} value={k.key}>{k.label}</option>
                ))}
              </select>
            </div>
            <Button className="min-h-[44px]" loading={pct !== null} onClick={() => fileRef.current?.click()}>
              {pct !== null ? `Uploading… ${pct}%` : "Upload document"}
            </Button>
            <input
              ref={fileRef}
              type="file"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void upload(f);
                e.target.value = "";
              }}
            />
          </div>
        }
      >
        {docs.length === 0 ? (
          <EmptyState title="No documents yet" message="Board decks and bank statements you upload will be listed here." />
        ) : (
          <SimpleTable
            rows={docs}
            rowKey={(r, i) => str(pick(r, "id")) || String(i)}
            columns={[
              { key: "name", label: "Document", value: (r) => str(pick(r, "name", "filename", "title")) || "—" },
              { key: "kind", label: "Kind", value: (r) => str(pick(r, "kind")) || "—" },
              { key: "uploaded", label: "Uploaded", value: (r) => fmtDateShort(dateOnly(pick(r, "createdAt", "uploadedAt")) || str(pick(r, "createdAt"))) },
            ]}
          />
        )}
      </Section>
    </div>
  );
}

/* ------------------------------ Board meetings ------------------------------ */

function MeetingsPanel({ companyId }: { companyId: string }) {
  const pmBase = pmCompany(companyId);
  const [meetings, setMeetings] = useState<Rec[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadFailed(false);
    try {
      const d = await api<Rec>(`${pmBase}/meetings`);
      const list = rowsFrom(d, "meetings", "items");
      setMeetings(
        [...list].sort((a, b) =>
          (dateOnly(pick(b, "scheduledAt", "date", "meetingDate")) || "").localeCompare(
            dateOnly(pick(a, "scheduledAt", "date", "meetingDate")) || ""
          )
        )
      );
    } catch {
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, [pmBase]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) return <SkeletonRows rows={5} />;
  if (loadFailed) return <ErrorState onRetry={() => void load()} />;

  return (
    <Section title="Board meetings" caption="Your company's board meetings. When Canny Capital generates a board pack, it is attached to the meeting here.">
      {meetings.length === 0 ? (
        <EmptyState title="No board meetings scheduled" message="Meetings Canny Capital schedules for your company will appear here." />
      ) : (
        <div className="space-y-3">
          {meetings.map((m, i) => {
            const status = str(pick(m, "status"));
            const packId = str(pick(m, "pack_document_id", "packDocumentId"));
            const decisions = pick(m, "decisions");
            return (
              <div key={str(pick(m, "id")) || String(i)} className="rounded-xl border border-slate-200 p-4 dark:border-white/10">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-[#0d1f3c] dark:text-white">
                    {str(pick(m, "title")) || "Board meeting"}
                  </p>
                  {status && <span className={`badge ${statusBadge(status)}`}>{status}</span>}
                </div>
                <p className="mt-0.5 text-xs text-slate-400 dark:text-white/40">
                  {fmtDateShort(dateOnly(pick(m, "scheduledAt", "date", "meetingDate")) || str(pick(m, "scheduledAt")))}
                </p>
                {Array.isArray(decisions) && decisions.length > 0 && (
                  <ul className="mt-2 list-inside list-disc text-sm text-slate-600 dark:text-white/70">
                    {(decisions as unknown[]).map((d, j) => (
                      <li key={j}>{String(d)}</li>
                    ))}
                  </ul>
                )}
                {packId ? (
                  <div className="mt-3">
                    <a
                      href={`/api/platform/documents/${encodeURIComponent(packId)}/file`}
                      className="btn btn-secondary btn-sm min-h-[44px]"
                    >
                      Download board pack
                    </a>
                    <p className="mt-1.5 text-xs text-slate-400 dark:text-white/40">
                      The pack opens through the portal document route — if your
                      access does not include it, ask Canny Capital to re-send the pack.
                    </p>
                  </div>
                ) : (
                  <p className="mt-2 text-xs text-slate-400 dark:text-white/40">No board pack attached yet.</p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Section>
  );
}

"use client";

/**
 * Lender tab (Phase 9, internal) — the company's lender package:
 * latest covenant/lender tests summary from GET …/lender, a Generate
 * certificate action (POST …/lender/certificate), and the borrowing-
 * base panel (advance-rate inputs → POST …/lender/borrowing-base).
 * When the company has no lender facility the tab says so plainly —
 * certificate / borrowing-base controls are hidden, never faked.
 */

import { useCallback, useEffect, useState } from "react";
import { Button, EmptyState, ErrorState, SkeletonRows } from "@/components/ui";
import { ErrorBanner, KeyValues, Section, SimpleTable } from "@/components/monitoring/shared";
import {
  dateOnly,
  fmtDateShort,
  fmtMoneyN,
  inputCls,
  labelCls,
  parseNum,
  statusBadge,
  type MonitoringTabProps,
} from "@/components/monitoring/types";
import { api, num, pick, pmCompany, rowsFrom, scalarEntries, str, type Rec } from "@/components/portmgmt/pm";

export default function LenderTab({ companyId }: MonitoringTabProps) {
  const base = `${pmCompany(companyId)}/lender`;
  const [data, setData] = useState<Rec | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");

  const [bbForm, setBbForm] = useState({
    eligibleAr: "",
    arAdvanceRate: "80",
    eligibleInventory: "",
    inventoryAdvanceRate: "50",
    eligibleOther: "",
  });
  const [bbResult, setBbResult] = useState<Rec | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadFailed(false);
    try {
      const d = await api<Rec>(base);
      setData(d);
      const bb = (pick(d, "borrowingBase", "borrowing_base") ?? null) as Rec | null;
      if (bb) setBbResult(bb);
    } catch {
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, [base]);

  useEffect(() => {
    void load();
  }, [load]);

  const generateCertificate = async () => {
    setBusy("cert");
    setError("");
    setNotice("");
    try {
      const d = await api<Rec>(`${base}/certificate`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      const cert = (pick(d, "certificate") ?? d) as Rec;
      const docId = str(pick(cert, "documentId", "document_id"));
      setNotice(
        docId
          ? "Compliance certificate generated and filed to the company's documents."
          : "Compliance certificate generated."
      );
      await load();
    } catch {
      setError("Could not generate the compliance certificate.");
    } finally {
      setBusy("");
    }
  };

  const computeBorrowingBase = async () => {
    setBusy("bb");
    setError("");
    try {
      const d = await api<Rec>(`${base}/borrowing-base`, {
        method: "POST",
        body: JSON.stringify({
          eligibleAr: parseNum(bbForm.eligibleAr),
          arAdvanceRate: parseNum(bbForm.arAdvanceRate),
          eligibleInventory: parseNum(bbForm.eligibleInventory),
          inventoryAdvanceRate: parseNum(bbForm.inventoryAdvanceRate),
          eligibleOther: parseNum(bbForm.eligibleOther),
        }),
      });
      setBbResult((pick(d, "borrowingBase", "result") ?? d) as Rec);
      await load();
    } catch {
      setError("Could not compute the borrowing base. Check the eligible amounts and rates.");
    } finally {
      setBusy("");
    }
  };

  if (loading) return <SkeletonRows rows={5} />;
  if (loadFailed) return <ErrorState onRetry={() => void load()} />;

  const tests = data ? rowsFrom(data, "tests", "latestTests", "lenderTests") : [];
  const certificate = data ? ((pick(data, "certificate", "latestCertificate") ?? null) as Rec | null) : null;
  const certDocId = certificate ? str(pick(certificate, "documentId", "document_id")) : "";
  const applicable =
    pick(data ?? {}, "applicable") !== false &&
    (tests.length > 0 || certificate !== null || Boolean(pick(data ?? {}, "facility", "lenderName", "borrowingBase")));

  return (
    <div className="space-y-5">
      <ErrorBanner message={error} />
      {notice && (
        <p role="status" className="rounded-xl bg-emerald-500/10 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-300">
          {notice}
        </p>
      )}

      {!applicable ? (
        <Section title="Lender package">
          <EmptyState
            title="No lender facility recorded"
            message="This company has no lender tests, certificate or borrowing base on file — the lender package is not applicable until a facility is recorded in Cash & Debt / Covenants."
          />
        </Section>
      ) : (
        <>
          <Section
            title="Latest lender tests"
            caption="The most recent lender-facing test results the backend holds for this company — rendered as served, never recomputed here."
            actions={
              <Button className="min-h-[44px]" loading={busy === "cert"} onClick={() => void generateCertificate()}>
                Generate certificate
              </Button>
            }
          >
            {tests.length === 0 ? (
              <EmptyState
                title="No lender tests yet"
                message="Lender tests will appear here once covenant computations or lender submissions are recorded."
              />
            ) : (
              <SimpleTable
                rows={tests}
                rowKey={(r, i) => str(pick(r, "id", "covenantKey", "label")) || String(i)}
                columns={[
                  { key: "label", label: "Test", value: (r) => str(pick(r, "label", "covenantKey", "name")) || "—" },
                  { key: "periodEnd", label: "Period end", value: (r) => fmtDateShort(dateOnly(pick(r, "periodEnd")) || str(pick(r, "periodEnd"))) },
                  {
                    key: "computed",
                    label: "Computed",
                    align: "right",
                    value: (r) => {
                      const n = num(pick(r, "computedValue", "value"));
                      return n === null ? str(pick(r, "computedValue")) || "—" : String(Math.round(n * 100) / 100);
                    },
                  },
                  {
                    key: "threshold",
                    label: "Threshold",
                    align: "right",
                    value: (r) => {
                      const n = num(pick(r, "threshold"));
                      return n === null ? "—" : String(Math.round(n * 100) / 100);
                    },
                  },
                  {
                    key: "status",
                    label: "Status",
                    render: (r) => {
                      const s = str(pick(r, "status"));
                      return s ? <span className={`badge ${statusBadge(s)}`}>{s}</span> : "—";
                    },
                  },
                ]}
              />
            )}
            {certificate && (
              <div className="mt-4 rounded-xl bg-slate-50 px-4 py-3 text-sm dark:bg-white/5">
                <span className="font-semibold text-[#0d1f3c] dark:text-white">Latest certificate: </span>
                <span className="text-slate-600 dark:text-white/70">
                  {fmtDateShort(dateOnly(pick(certificate, "generatedAt", "createdAt")) || str(pick(certificate, "generatedAt")))}
                  {str(pick(certificate, "status")) ? ` · ${str(pick(certificate, "status"))}` : ""}
                </span>
                {certDocId && (
                  <>
                    {" · "}
                    <a
                      href={`/api/platform/documents/${encodeURIComponent(certDocId)}/file`}
                      className="font-semibold text-gold-700 hover:underline dark:text-gold-400"
                    >
                      Download
                    </a>
                  </>
                )}
              </div>
            )}
          </Section>

          <Section
            title="Borrowing base"
            caption="Eligible collateral × advance rates, computed by the server. Enter the eligible amounts and rates, then Compute — the stored result is what renders below."
          >
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <div>
                <label className={labelCls}>Eligible AR ($)</label>
                <input inputMode="numeric" className={`${inputCls} min-h-[44px]`} value={bbForm.eligibleAr} onChange={(e) => setBbForm((f) => ({ ...f, eligibleAr: e.target.value }))} />
              </div>
              <div>
                <label className={labelCls}>AR advance rate (%)</label>
                <input inputMode="numeric" className={`${inputCls} min-h-[44px]`} value={bbForm.arAdvanceRate} onChange={(e) => setBbForm((f) => ({ ...f, arAdvanceRate: e.target.value }))} />
              </div>
              <div>
                <label className={labelCls}>Eligible inventory ($)</label>
                <input inputMode="numeric" className={`${inputCls} min-h-[44px]`} value={bbForm.eligibleInventory} onChange={(e) => setBbForm((f) => ({ ...f, eligibleInventory: e.target.value }))} />
              </div>
              <div>
                <label className={labelCls}>Inventory advance rate (%)</label>
                <input inputMode="numeric" className={`${inputCls} min-h-[44px]`} value={bbForm.inventoryAdvanceRate} onChange={(e) => setBbForm((f) => ({ ...f, inventoryAdvanceRate: e.target.value }))} />
              </div>
              <div>
                <label className={labelCls}>Other eligible ($)</label>
                <input inputMode="numeric" className={`${inputCls} min-h-[44px]`} value={bbForm.eligibleOther} onChange={(e) => setBbForm((f) => ({ ...f, eligibleOther: e.target.value }))} />
              </div>
              <div className="flex items-end">
                <Button className="min-h-[44px] w-full sm:w-auto" loading={busy === "bb"} onClick={() => void computeBorrowingBase()}>
                  Compute
                </Button>
              </div>
            </div>
            {bbResult && (
              <div className="mt-4 border-t border-slate-100 pt-4 dark:border-white/5">
                <KeyValues rows={scalarEntries(bbResult, fmtMoneyN)} />
              </div>
            )}
          </Section>
        </>
      )}
    </div>
  );
}

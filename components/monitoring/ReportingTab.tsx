"use client";

/**
 * Reporting tab (Phase 8) — the company's reporting periods: create a
 * period, mark it received against a document from the company's
 * Documents library (GET /api/platform/documents?companyId=…, the
 * Phase 3 list API; a document-id text input is the fallback when the
 * library read is unavailable), run the due check, and watch each
 * period's status chip. Status values are the server's — this tab
 * never derives a status locally.
 */

import { useCallback, useEffect, useState } from "react";
import { Button, EmptyState, ErrorState, SkeletonRows } from "@/components/ui";
import { ErrorBanner, Section, SimpleTable } from "@/components/monitoring/shared";
import {
  API,
  companyBase,
  api,
  dateOnly,
  fmtDateShort,
  inputCls,
  labelCls,
  listFrom,
  pick,
  selectCls,
  statusBadge,
  str,
  todayIso,
  type MonitoringTabProps,
  type Rec,
} from "@/components/monitoring/types";

interface DocItem {
  id: string;
  name: string;
}

export default function ReportingTab({ companyId, refreshHeader }: MonitoringTabProps) {
  const base = companyBase(companyId);
  const [periods, setPeriods] = useState<Rec[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState("");

  const [docs, setDocs] = useState<DocItem[] | null>(null);
  const [receiveFor, setReceiveFor] = useState<string | null>(null);
  const [receiveDocId, setReceiveDocId] = useState("");
  const [receiving, setReceiving] = useState(false);

  const [form, setForm] = useState({
    periodType: "monthly",
    periodStart: "",
    periodEnd: "",
    dueDate: "",
  });
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadFailed(false);
    try {
      const d = await api<Rec>(`${base}/periods`);
      setPeriods(listFrom(d, "items", "periods"));
    } catch {
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, [base]);

  useEffect(() => {
    void load();
  }, [load]);

  // Company documents for the Receive picker (Phase 3 list API takes
  // a companyId filter). Failure → docs stays null → text-input fallback.
  useEffect(() => {
    let live = true;
    api<Rec>(`/api/platform/documents?companyId=${encodeURIComponent(companyId)}&limit=50`)
      .then((d) => {
        if (!live) return;
        const items = listFrom(d, "items", "documents").map((r) => ({
          id: str(pick(r, "id")),
          name: str(pick(r, "name", "title", "filename")) || str(pick(r, "id")),
        })).filter((x) => x.id);
        setDocs(items);
      })
      .catch(() => {
        if (live) setDocs(null);
      });
    return () => {
      live = false;
    };
  }, [companyId]);

  const createPeriod = async () => {
    if (!form.periodEnd || creating) return;
    setCreating(true);
    setError("");
    try {
      await api(`${base}/periods`, {
        method: "POST",
        body: JSON.stringify({
          cadence: form.periodType,
          periodStart: form.periodStart || undefined,
          periodEnd: form.periodEnd,
          dueDate: form.dueDate || undefined,
        }),
      });
      setForm({ periodType: "monthly", periodStart: "", periodEnd: "", dueDate: "" });
      await load();
      refreshHeader?.();
    } catch {
      setError("Could not create that period. Check the dates and try again.");
    } finally {
      setCreating(false);
    }
  };

  const receive = async (periodId: string) => {
    if (!receiveDocId.trim() || receiving) return;
    setReceiving(true);
    setError("");
    try {
      // Period actions live at the top level (companyId is taken from
      // the period server-side, never trusted from the client).
      await api(`${API}/periods/${encodeURIComponent(periodId)}/receive`, {
        method: "POST",
        body: JSON.stringify({ documentId: receiveDocId.trim() }),
      });
      setReceiveFor(null);
      setReceiveDocId("");
      await load();
      refreshHeader?.();
    } catch {
      setError("Could not mark that period received. Check the document and try again.");
    } finally {
      setReceiving(false);
    }
  };

  const checkDue = async (periodId: string) => {
    setBusyId(periodId);
    setError("");
    try {
      await api(`${API}/periods/${encodeURIComponent(periodId)}/check-due`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      await load();
      refreshHeader?.();
    } catch {
      setError("Could not run the due check for that period.");
    } finally {
      setBusyId("");
    }
  };

  if (loading) return <SkeletonRows rows={5} />;
  if (loadFailed) return <ErrorState onRetry={() => void load()} />;

  const periodId = (r: Rec) => str(pick(r, "id", "periodId"));

  return (
    <div className="space-y-5">
      <ErrorBanner message={error} />
      <Section
        title="Reporting periods"
        caption="One row per reporting period. Receive links the period to the document that satisfied it; Check due re-evaluates the period against its due date."
      >
        {periods.length === 0 ? (
          <EmptyState
            title="No reporting periods yet"
            message="Create the first period below — monthly by default — and mark it received when the company's financials arrive."
          />
        ) : (
          <SimpleTable
            rows={periods}
            rowKey={(r, i) => periodId(r) || String(i)}
            columns={[
              {
                key: "periodEnd",
                label: "Period end",
                value: (r) => fmtDateShort(dateOnly(pick(r, "periodEnd"))),
              },
              {
                key: "cadence",
                label: "Cadence",
                value: (r) => str(pick(r, "cadence", "periodType", "type")) || "—",
              },
              {
                key: "dueDate",
                label: "Due",
                value: (r) => fmtDateShort(dateOnly(pick(r, "dueDate"))),
              },
              {
                key: "status",
                label: "Status",
                render: (r) => {
                  const s = str(pick(r, "status", "reportingStatus"));
                  return s ? (
                    <span className={`badge ${statusBadge(s)}`}>{s}</span>
                  ) : (
                    "—"
                  );
                },
              },
              {
                key: "received",
                label: "Received",
                value: (r) =>
                  fmtDateShort(
                    dateOnly(pick(r, "receivedAt", "receivedDate")) ||
                      str(pick(r, "receivedAt"))
                  ),
              },
              {
                key: "actions",
                label: "Actions",
                render: (r) => {
                  const id = periodId(r);
                  const s = str(pick(r, "status", "reportingStatus")).toLowerCase();
                  const alreadyReceived = s === "received" || Boolean(pick(r, "receivedAt"));
                  return receiveFor === id ? (
                    <div className="flex min-w-[220px] flex-col gap-2">
                      {docs && docs.length > 0 ? (
                        <select
                          className={`${selectCls} min-h-[44px]`}
                          value={receiveDocId}
                          onChange={(e) => setReceiveDocId(e.target.value)}
                          aria-label="Document that satisfies this period"
                        >
                          <option value="">Select document…</option>
                          {docs.map((d) => (
                            <option key={d.id} value={d.id}>
                              {d.name}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          className={`${inputCls} min-h-[44px]`}
                          value={receiveDocId}
                          onChange={(e) => setReceiveDocId(e.target.value)}
                          placeholder="Document ID"
                          aria-label="Document ID that satisfies this period"
                        />
                      )}
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          className="min-h-[44px]"
                          loading={receiving}
                          disabled={!receiveDocId.trim()}
                          onClick={() => void receive(id)}
                        >
                          Confirm receive
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="min-h-[44px]"
                          onClick={() => {
                            setReceiveFor(null);
                            setReceiveDocId("");
                          }}
                        >
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {!alreadyReceived && (
                        <Button
                          variant="secondary"
                          size="sm"
                          className="min-h-[44px]"
                          onClick={() => {
                            setReceiveFor(id);
                            setReceiveDocId("");
                          }}
                        >
                          Receive…
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        className="min-h-[44px]"
                        loading={busyId === id}
                        onClick={() => void checkDue(id)}
                      >
                        Check due
                      </Button>
                    </div>
                  );
                },
              },
            ]}
          />
        )}

        <div className="mt-5 border-t border-slate-100 pt-4 dark:border-white/5">
          <h4 className="text-sm font-semibold text-[#0d1f3c] dark:text-white">
            New period
          </h4>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-[140px_1fr_1fr_1fr_auto] lg:items-end">
            <div>
              <label className={labelCls}>Type</label>
              <select
                className={`${selectCls} min-h-[44px]`}
                value={form.periodType}
                onChange={(e) => setForm((f) => ({ ...f, periodType: e.target.value }))}
              >
                <option value="monthly">Monthly</option>
                <option value="quarterly">Quarterly</option>
                <option value="annual">Annual</option>
              </select>
            </div>
            <div>
              <label className={labelCls}>Period start</label>
              <input
                type="date"
                className={`${inputCls} min-h-[44px]`}
                value={form.periodStart}
                onChange={(e) => setForm((f) => ({ ...f, periodStart: e.target.value }))}
              />
            </div>
            <div>
              <label className={labelCls}>Period end</label>
              <input
                type="date"
                className={`${inputCls} min-h-[44px]`}
                value={form.periodEnd}
                onChange={(e) => setForm((f) => ({ ...f, periodEnd: e.target.value }))}
              />
            </div>
            <div>
              <label className={labelCls}>Due date</label>
              <input
                type="date"
                className={`${inputCls} min-h-[44px]`}
                value={form.dueDate}
                onChange={(e) => setForm((f) => ({ ...f, dueDate: e.target.value }))}
              />
            </div>
            <Button
              onClick={() => void createPeriod()}
              loading={creating}
              disabled={!form.periodEnd}
              className="min-h-[44px]"
            >
              Create period
            </Button>
          </div>
          <p className="mt-2 text-xs text-slate-400 dark:text-white/40">
            Today is {fmtDateShort(todayIso())} — due dates are evaluated by the
            server when you run Check due.
          </p>
        </div>
      </Section>
    </div>
  );
}

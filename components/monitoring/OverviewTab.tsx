"use client";

/**
 * Overview tab (Phase 8) — the deal_closed baseline copy held by
 * Portfolio Monitoring: closing baseline, underwriting copy and
 * participants copy (all rendered verbatim from the company detail —
 * monitoring owns these copies so it stays separable), plus the
 * latest KPI snapshot and the company's open alerts.
 */

import { useCallback, useEffect, useState } from "react";
import { EmptyState, SkeletonRows } from "@/components/ui";
import { KeyValues, Section, SimpleTable } from "@/components/monitoring/shared";
import {
  companyBase,
  api,
  dateOnly,
  fmtDateShort,
  fmtFractionPct,
  fmtMoneyN,
  fmtMultiple,
  fmtPctPoints,
  listFrom,
  num,
  pick,
  severityBadge,
  str,
  type MonitoringTabProps,
  type Rec,
} from "@/components/monitoring/types";

const MONEY_KEY = /revenue|ebitda|value|price|equity|debt|cash|capital|amount|nav|check/i;
const SKIP_KEYS = new Set([
  "id",
  "company",
  "summary",
  "monitoringSummary",
  "kpis",
  "baseline",
  "underwriting",
  "participants",
]);

function prettify(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .replace(/^\w/, (c) => c.toUpperCase());
}

function scalarRows(rec: Rec | null | undefined, prefix = ""): Array<{ label: string; value: string }> {
  if (!rec) return [];
  const out: Array<{ label: string; value: string }> = [];
  for (const [k, v] of Object.entries(rec)) {
    if (SKIP_KEYS.has(k) || v === null || v === undefined || v === "") continue;
    if (typeof v === "object") continue;
    const label = prettify(prefix ? `${prefix} ${k}` : k);
    const n = num(v);
    let display = String(v);
    if (n !== null && MONEY_KEY.test(k)) display = fmtMoneyN(n);
    // Baseline/underwriting copies don't declare a margin convention —
    // render small values as fractions and large ones as points.
    else if (n !== null && /margin|pct|percent/i.test(k))
      display = Math.abs(n) <= 1.5 ? fmtFractionPct(n) : fmtPctPoints(n);
    else if (n !== null && /multiple/i.test(k)) display = fmtMultiple(n);
    else if (/At$|Date$|End$|Start$/.test(k) || k === "asOf") display = fmtDateShort(dateOnly(v) || String(v));
    out.push({ label, value: display });
  }
  return out;
}

export default function OverviewTab({ companyId, company, summary }: MonitoringTabProps) {
  const [alerts, setAlerts] = useState<Rec[]>([]);
  const [loadingAlerts, setLoadingAlerts] = useState(true);

  const loadAlerts = useCallback(async () => {
    setLoadingAlerts(true);
    try {
      const d = await api<Rec>(`${companyBase(companyId)}/alerts`);
      const all = listFrom(d, "alerts", "items");
      setAlerts(
        all.filter((a) => {
          const s = str(pick(a, "status"));
          return !s || s === "open" || s === "acked" || s === "acknowledged";
        })
      );
    } catch {
      setAlerts([]);
    } finally {
      setLoadingAlerts(false);
    }
  }, [companyId]);

  useEffect(() => {
    void loadAlerts();
  }, [loadAlerts]);

  const c = company ?? {};
  // PortfolioCompanyDetail copies: baselineCompany (company snapshot),
  // baselineFinancials (financials summary copy), underwriting,
  // participants — all top-level fields on the detail record.
  const baselineCompany = (pick(c, "baselineCompany") ?? {}) as Rec;
  const baselineFinancials = (pick(c, "baselineFinancials") ?? {}) as Rec;
  const baselineLatest = (pick(baselineFinancials, "latest") ?? {}) as Rec;
  const underwriting = (pick(c, "underwriting") ?? {}) as Rec;
  const participantsRaw = pick(c, "participants");
  const participants: Rec[] = Array.isArray(participantsRaw)
    ? (participantsRaw as Rec[])
    : [];

  const baselineRows = [
    ...scalarRows(c),
    ...scalarRows(baselineCompany),
    ...scalarRows(baselineLatest, "Baseline"),
  ].filter(
    (r, i, arr) => arr.findIndex((x) => x.label === r.label) === i
  );
  const underwritingRows = scalarRows(underwriting);
  const kpis = (pick(summary ?? {}, "kpis") ?? pick(c, "kpis") ?? {}) as Rec;
  const kpiRows = [
    { label: "Revenue", value: fmtMoneyN(num(pick(kpis, "revenue"))) },
    { label: "EBITDA", value: fmtMoneyN(num(pick(kpis, "ebitda"))) },
    { label: "Gross margin", value: fmtFractionPct(num(pick(kpis, "grossMarginPct", "grossMargin"))) },
    { label: "Cash", value: fmtMoneyN(num(pick(kpis, "cash"))) },
    {
      label: "Latest period end",
      value: fmtDateShort(dateOnly(pick(summary ?? {}, "latestPeriodEnd")) || dateOnly(pick(c, "latestPeriodEnd"))),
    },
    { label: "Reporting status", value: str(pick(summary ?? {}, "reportingStatus")) || "—" },
    { label: "Covenant status", value: str(pick(summary ?? {}, "covenantStatus")) || "—" },
    { label: "Updated", value: fmtDateShort(str(pick(summary ?? {}, "updatedAt")) || str(pick(c, "updatedAt"))) },
  ];

  return (
    <div className="space-y-5">
      <Section title="Latest KPIs" caption="The monitoring summary snapshot for this company — the same values the exports and the Phase 7 investor templates read.">
        <KeyValues rows={kpiRows} />
      </Section>

      <Section title="Closing baseline" caption="Copied at deal close (the deal_closed handoff). Monitoring's own copy — later pipeline edits do not rewrite it.">
        {baselineRows.length ? (
          <KeyValues rows={baselineRows} />
        ) : (
          <EmptyState
            title="No baseline recorded"
            message="The deal_closed handoff baseline for this company has no recorded fields yet."
          />
        )}
      </Section>

      {underwritingRows.length > 0 && (
        <Section title="Underwriting copy" caption="The underwriting figures copied at close — the benchmark the variance view compares actuals against.">
          <KeyValues rows={underwritingRows} />
        </Section>
      )}

      <Section title="Participants" caption="Deal participants as copied at close (names referenced from the Directory, never duplicated).">
        {participants.length ? (
          <SimpleTable
            rows={participants}
            rowKey={(r, i) => str(pick(r, "personId", "organizationId", "id")) || String(i)}
            columns={[
              {
                key: "name",
                label: "Participant",
                value: (r) => str(pick(r, "name", "personName", "organizationName", "personId", "organizationId")) || "—",
              },
              { key: "role", label: "Role", value: (r) => str(pick(r, "role", "kind")) || "—" },
              {
                key: "share",
                label: "Share",
                align: "right",
                value: (r) => {
                  const n = num(pick(r, "sharePct", "share", "ownershipPct"));
                  return n === null ? "—" : fmtPctPoints(n > 1.5 ? n : n * 100);
                },
              },
            ]}
          />
        ) : (
          <EmptyState
            title="No participants copied"
            message="No deal participants were recorded on the closing handoff for this company."
          />
        )}
      </Section>

      <Section title="Open alerts" caption="Open and acknowledged alerts for this company. Acknowledge or resolve them in the Alerts tab.">
        {loadingAlerts ? (
          <SkeletonRows rows={3} />
        ) : alerts.length === 0 ? (
          <EmptyState title="No open alerts" message="Nothing needs attention on this company right now." />
        ) : (
          <div className="space-y-2">
            {alerts.slice(0, 10).map((a, i) => (
              <div
                key={str(pick(a, "id")) || i}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-100 px-3 py-2.5 dark:border-white/10"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-[#0d1f3c] dark:text-white">
                    {str(pick(a, "title", "label", "message", "ruleName")) || "Alert"}
                  </p>
                  <p className="text-xs text-slate-400 dark:text-white/40">
                    {fmtDateShort(dateOnly(pick(a, "createdAt", "triggeredAt")) || str(pick(a, "createdAt")))}
                    {str(pick(a, "status")) ? ` · ${str(pick(a, "status"))}` : ""}
                  </p>
                </div>
                {str(pick(a, "severity")) && (
                  <span className={`badge ${severityBadge(str(pick(a, "severity")))}`}>
                    {str(pick(a, "severity"))}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}

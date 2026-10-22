"use client";

/**
 * Value Creation index (Phase 6) — every value creation plan as a
 * card (company, plan start, open initiatives, weighted impact,
 * exit readiness, last updated), plus the "Start a value creation
 * plan" flow (components/valuecreation/StartPlanForm.tsx, extracted
 * for the navigation restructure so the Due Diligence hub's New plan
 * dialog shares it): company picker, plan start date, create →
 * navigate to the company workspace.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import PageHero from "@/components/PageHero";
import { CardSkeleton, EmptyState, ErrorState } from "@/components/ui";
import StartPlanForm from "@/components/valuecreation/StartPlanForm";
import {
  API,
  api,
  cardCls,
  fmtDateShort,
  fmtMoneyCompact,
  fmtMoneyN,
  fmtUpdated,
  listFrom,
  type PlanListItem,
} from "@/components/valuecreation/types";

export default function ValueCreationPage() {
  const router = useRouter();
  const [items, setItems] = useState<PlanListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const data = await api<Record<string, unknown>>(`${API}/plans`);
      setItems(listFrom<PlanListItem>(data, "items", "plans"));
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div>
      <PageHero
        eyebrow="Platform"
        title="Value Creation"
        subtitle="Initiatives, 100-day plans, driver trees, scenarios and exit readiness — the thesis turned into operating results"
      />
      <div className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6">
        {/* Start a plan */}
        <div className={cardCls}>
          <h2 className="font-display text-xl font-semibold text-[#0d1f3c] dark:text-white">
            Start a value creation plan
          </h2>
          <p className="mt-0.5 text-sm text-slate-500 dark:text-white/50">
            Pick the portfolio company and the day the plan clock starts (day 0 of the 100-day plan).
          </p>
          <StartPlanForm
            onCreated={(companyId) =>
              router.push(`/value-creation/${encodeURIComponent(companyId)}`)
            }
          />
        </div>

        {/* Plan cards */}
        <div className="mt-6">
          {loading ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true">
              {Array.from({ length: 6 }).map((_, i) => (
                <CardSkeleton key={i} lines={3} />
              ))}
            </div>
          ) : error ? (
            <ErrorState onRetry={() => void load()} />
          ) : items.length === 0 ? (
            <EmptyState
              title="No value creation plans yet"
              message="Start the first plan above — pick a portfolio company and its plan start date, and the workspace opens with initiatives, a 100-day plan, targets and exit readiness."
            />
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {items.map((item) => (
                <div key={item.id} className={cardCls}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="truncate font-display text-xl font-semibold text-[#0d1f3c] dark:text-white">
                        <Link
                          href={`/value-creation/${encodeURIComponent(item.companyId)}`}
                          className="hover:text-gold-700 hover:underline dark:hover:text-gold-400"
                        >
                          {item.companyName || item.name}
                        </Link>
                      </h3>
                      {item.name && item.companyName && item.name !== item.companyName && (
                        <p className="truncate text-sm text-slate-500 dark:text-white/50">{item.name}</p>
                      )}
                    </div>
                    {item.status && (
                      <span className="badge badge-neutral shrink-0">{item.status}</span>
                    )}
                  </div>
                  <p className="mt-2 text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-white/40">
                    Plan start {fmtDateShort(item.planStartDate)}
                    {item.updatedAt ? ` · updated ${fmtUpdated(item.updatedAt)}` : ""}
                  </p>
                  <div className="mt-3 grid grid-cols-3 gap-3">
                    <div>
                      <p className="micro-label">Open initiatives</p>
                      <p className="tnum mt-0.5 font-display text-2xl font-semibold text-[#0d1f3c] dark:text-white">
                        {item.summary?.openInitiatives ?? 0}
                      </p>
                    </div>
                    <div>
                      <p className="micro-label">Weighted impact</p>
                      <p
                        className="tnum mt-0.5 font-display text-2xl font-semibold text-[#0d1f3c] dark:text-white"
                        title={fmtMoneyN(item.summary?.impactWeighted)}
                      >
                        {fmtMoneyCompact(item.summary?.impactWeighted ?? 0)}
                      </p>
                    </div>
                    <div>
                      <p className="micro-label">Exit readiness</p>
                      <p className="tnum mt-0.5 font-display text-2xl font-semibold text-[#0d1f3c] dark:text-white">
                        {item.summary?.exitOverall === null || item.summary?.exitOverall === undefined
                          ? "—"
                          : `${item.summary.exitOverall}/100`}
                      </p>
                    </div>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Link
                      href={`/value-creation/${encodeURIComponent(item.companyId)}`}
                      className="btn btn-primary btn-sm min-h-[44px]"
                    >
                      Open workspace
                    </Link>
                    <Link
                      href={`/companies/${encodeURIComponent(item.companyId)}`}
                      className="btn btn-secondary btn-sm min-h-[44px]"
                    >
                      Company profile
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

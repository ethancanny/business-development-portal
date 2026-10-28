"use client";

/**
 * Due Diligence hub (navigation restructure, WS-C) — one page, three
 * sections behind a sticky tab bar, each fed ONLY by its compact
 * summary endpoint under /api/platform/hubs/ (fetch on mount):
 * - Diligence Workspaces → /api/platform/hubs/dd-workspaces
 * - Value Creation Plans → /api/platform/hubs/dd-plans (+ New plan
 *   dialog rendering the shared StartPlanForm)
 * - Data Rooms (compact) → /api/platform/hubs/dd-rooms
 * - Playbook & Ideas → compile-time static reference content
 *   (components/diligence/PlaybookSection; no endpoint, no fetch —
 *   curated diligence suggestions, kept separate from the live
 *   workspaces' checklists; added Oct 27, 2026)
 * Ethan, Oct 23, 2026: hub tab bars are true tabs — only the selected
 * tab's section renders (so an unselected section never fetches);
 * the tab restores from the URL hash (#dd-workspaces / #dd-plans /
 * #dd-rooms / #dd-playbook).
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import PageHero from "@/components/PageHero";
import { CardSkeleton, EmptyState, ErrorState, SkeletonRows } from "@/components/ui";
import StartPlanForm from "@/components/valuecreation/StartPlanForm";
import PlaybookSection from "@/components/diligence/PlaybookSection";
import { cardCls, fmtDateShort } from "@/components/diligence/types";
import { fmtMoney, fmtMoneyCompact, fmtRelTime } from "@/lib/format";

/* ------------------------------- types -------------------------------- */

interface WsWorkstream {
  key: string;
  label: string;
  done: number;
  total: number;
}
interface WsItem {
  dealId: string;
  companyId: string | null;
  companyName: string;
  owner: string;
  workstreams: WsWorkstream[];
  findings: { critical: number; high: number; medium: number; low: number };
  nextMilestone: { label: string; dueDate: string } | null;
}
interface PlanItem {
  companyId: string;
  companyName: string;
  planId: string;
  planName: string;
  planStartDate: string | null;
  dayOfPlan: number | null;
  hundredDayProgress: number;
  initiatives: {
    total: number;
    onTrack: number;
    atRisk: number;
    offTrack: number;
    done: number;
  };
  impactPreview: {
    baseEbitda: number | null;
    projectedEbitda: number | null;
    weightedImpact: number;
  };
}
interface RoomItem {
  roomId: string;
  dealId: string;
  companyId: string | null;
  companyName: string;
  completenessPct: number;
  missingCount: number;
  lastActivityAt: string;
  status: string;
}

/* ---------------------------- fetch helper ----------------------------- */

function useSection<T>(url: string) {
  const [items, setItems] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const data = (await res.json()) as { items?: T[] };
      setItems(Array.isArray(data.items) ? data.items : []);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [url]);
  useEffect(() => {
    void load();
  }, [load]);
  return { items, loading, error, reload: load };
}

/* --------------------------- section heading ---------------------------- */

function SectionHeading({
  title,
  blurb,
  action,
}: {
  title: string;
  blurb: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
      <div>
        <h2 className="font-display text-2xl font-semibold text-[#0d1f3c] dark:text-white">
          {title}
        </h2>
        <p className="mt-0.5 text-sm text-slate-500 dark:text-white/50">{blurb}</p>
      </div>
      {action}
    </div>
  );
}

/* ------------------------- workspaces section --------------------------- */

const PAGE_SIZE = 12;

function WorkspacesSection() {
  const { items, loading, error, reload } = useSection<WsItem>(
    "/api/platform/hubs/dd-workspaces?limit=50"
  );
  const [page, setPage] = useState(0);
  const pageCount = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const visible = items.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  return (
    <div>
      <SectionHeading
        title="Diligence Workspaces"
        blurb="Deals under diligence — checklist progress by workstream, open findings, and the next milestone."
      />
      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true">
          {Array.from({ length: 6 }).map((_, i) => (
            <CardSkeleton key={i} lines={4} />
          ))}
        </div>
      ) : error ? (
        <ErrorState onRetry={() => void reload()} />
      ) : items.length === 0 ? (
        <EmptyState
          title="No diligence workspaces yet"
          message="Workspaces appear here once diligence is started on a deal."
        />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {visible.map((item) => {
              const totalDone = item.workstreams.reduce((a, w) => a + w.done, 0);
              const totalAll = item.workstreams.reduce((a, w) => a + w.total, 0);
              const sev: Array<{ label: string; count: number; cls: string }> = [
                { label: "critical", count: item.findings.critical, cls: "badge-danger" },
                { label: "high", count: item.findings.high, cls: "badge-danger" },
                { label: "medium", count: item.findings.medium, cls: "badge-warn" },
                { label: "low", count: item.findings.low, cls: "badge-neutral" },
              ];
              return (
                <Link
                  key={item.dealId}
                  href={`/due-diligence/${encodeURIComponent(item.dealId)}`}
                  className={`${cardCls} block transition hover:border-[#b8975a]/60 hover:shadow-md`}
                >
                  <h3 className="truncate font-display text-xl font-semibold text-[#0d1f3c] dark:text-white">
                    {item.companyName}
                  </h3>
                  <p className="mt-0.5 text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-white/40">
                    {item.owner ? `Claimed by ${item.owner}` : "Unclaimed"}
                    {totalAll > 0 ? ` · Checklist ${totalDone}/${totalAll}` : ""}
                  </p>

                  <div className="mt-3 grid grid-cols-3 gap-x-3 gap-y-2">
                    {item.workstreams.map((w) => {
                      const pct = w.total > 0 ? Math.round((100 * w.done) / w.total) : 0;
                      return (
                        <div key={w.key} title={`${w.label}: ${w.done}/${w.total} done`}>
                          <div className="flex items-baseline justify-between gap-1">
                            <span className="truncate text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-white/40">
                              {w.label}
                            </span>
                            <span className="tnum text-[10px] text-slate-500 dark:text-white/50">
                              {w.done}/{w.total}
                            </span>
                          </div>
                          <div className="mt-0.5 h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-white/10">
                            <div
                              className="h-full rounded-full bg-[#b8975a]"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {sev.map((s) => (
                      <span key={s.label} className={`badge ${s.cls}`}>
                        {s.count} {s.label}
                      </span>
                    ))}
                  </div>

                  <p className="mt-3 text-sm text-slate-600 dark:text-white/70">
                    {item.nextMilestone ? (
                      <>
                        <span className="font-semibold text-[#0d1f3c] dark:text-white">
                          Next:
                        </span>{" "}
                        {item.nextMilestone.label} ·{" "}
                        {fmtDateShort(item.nextMilestone.dueDate)}
                      </>
                    ) : (
                      <span className="text-slate-400 dark:text-white/40">
                        No dated milestone open
                      </span>
                    )}
                  </p>
                </Link>
              );
            })}
          </div>

          {pageCount > 1 && (
            <div className="mt-4 flex items-center justify-center gap-3">
              <button
                type="button"
                className="btn btn-secondary btn-sm min-h-[44px]"
                disabled={safePage === 0}
                onClick={() => setPage(safePage - 1)}
              >
                ← Prev
              </button>
              <span className="text-sm text-slate-500 dark:text-white/50">
                Page {safePage + 1} of {pageCount}
              </span>
              <button
                type="button"
                className="btn btn-secondary btn-sm min-h-[44px]"
                disabled={safePage >= pageCount - 1}
                onClick={() => setPage(safePage + 1)}
              >
                Next →
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* ----------------------------- plans section ---------------------------- */

function PlansSection() {
  const router = useRouter();
  const { items, loading, error, reload } = useSection<PlanItem>(
    "/api/platform/hubs/dd-plans?limit=50"
  );
  const [dialogOpen, setDialogOpen] = useState(false);

  useEffect(() => {
    if (!dialogOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDialogOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dialogOpen]);

  return (
    <div>
      <SectionHeading
        title="Value Creation Plans"
        blurb="100-day progress, initiative health, and the stored EBITDA impact preview for each plan."
        action={
          <button
            type="button"
            className="btn btn-primary btn-sm min-h-[44px]"
            onClick={() => setDialogOpen(true)}
          >
            New plan
          </button>
        }
      />
      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true">
          {Array.from({ length: 3 }).map((_, i) => (
            <CardSkeleton key={i} lines={4} />
          ))}
        </div>
      ) : error ? (
        <ErrorState onRetry={() => void reload()} />
      ) : items.length === 0 ? (
        <EmptyState
          title="No value creation plans yet"
          message="Start the first plan with the New plan button — pick a portfolio company and its plan start date."
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((item) => {
            const pct = Math.round(item.hundredDayProgress * 100);
            const init = item.initiatives;
            const impact = item.impactPreview;
            return (
              <Link
                key={item.planId}
                href={`/value-creation/${encodeURIComponent(item.companyId)}`}
                className={`${cardCls} block transition hover:border-[#b8975a]/60 hover:shadow-md`}
              >
                <h3 className="truncate font-display text-xl font-semibold text-[#0d1f3c] dark:text-white">
                  {item.companyName}
                </h3>
                <p className="truncate text-sm text-slate-500 dark:text-white/50">
                  {item.planName}
                </p>
                <p className="mt-1 text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-white/40">
                  Plan start {fmtDateShort(item.planStartDate)}
                  {item.dayOfPlan !== null ? ` · Day ${item.dayOfPlan} of 100` : ""}
                </p>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-white/10">
                  <div
                    className="h-full rounded-full bg-[#b8975a]"
                    style={{ width: `${pct}%` }}
                  />
                </div>

                <div className="mt-3 flex flex-wrap gap-1.5">
                  <span className="badge badge-fit">{init.onTrack} on track</span>
                  <span className="badge badge-warn">{init.atRisk} at risk</span>
                  <span className="badge badge-danger">{init.offTrack} off track</span>
                  <span className="badge badge-neutral">{init.done} done</span>
                </div>

                <p className="mt-3 text-sm text-slate-600 dark:text-white/70">
                  {impact.baseEbitda !== null ? (
                    <>
                      EBITDA{" "}
                      <span
                        className="tnum font-semibold text-[#0d1f3c] dark:text-white"
                        title={fmtMoney(impact.baseEbitda)}
                      >
                        {fmtMoneyCompact(impact.baseEbitda)}
                      </span>{" "}
                      →{" "}
                      <span
                        className="tnum font-semibold text-[#0d1f3c] dark:text-white"
                        title={
                          impact.projectedEbitda !== null
                            ? fmtMoney(impact.projectedEbitda)
                            : undefined
                        }
                      >
                        {impact.projectedEbitda !== null
                          ? fmtMoneyCompact(impact.projectedEbitda)
                          : "—"}
                      </span>{" "}
                      · weighted impact{" "}
                      <span
                        className="tnum font-semibold text-[#0d1f3c] dark:text-white"
                        title={fmtMoney(impact.weightedImpact)}
                      >
                        {fmtMoneyCompact(impact.weightedImpact)}
                      </span>
                    </>
                  ) : (
                    <>
                      Weighted impact{" "}
                      <span
                        className="tnum font-semibold text-[#0d1f3c] dark:text-white"
                        title={fmtMoney(impact.weightedImpact)}
                      >
                        {fmtMoneyCompact(impact.weightedImpact)}
                      </span>{" "}
                      · no scenario base yet
                    </>
                  )}
                </p>
              </Link>
            );
          })}
        </div>
      )}

      {dialogOpen && (
        <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Start a value creation plan">
          <button
            type="button"
            aria-label="Close"
            className="absolute inset-0 h-full w-full bg-[#0d1f3c]/50"
            onClick={() => setDialogOpen(false)}
          />
          <div className="relative mx-auto mt-[8vh] w-[calc(100vw-2rem)] max-w-3xl rounded-2xl bg-white p-5 shadow-2xl dark:bg-[#132847] sm:p-6">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="font-display text-xl font-semibold text-[#0d1f3c] dark:text-white">
                  Start a value creation plan
                </h3>
                <p className="mt-0.5 text-sm text-slate-500 dark:text-white/50">
                  Pick the portfolio company and the day the plan clock starts (day 0 of the 100-day plan).
                </p>
              </div>
              <button
                type="button"
                className="btn btn-ghost btn-sm min-h-[44px] shrink-0"
                onClick={() => setDialogOpen(false)}
              >
                Close
              </button>
            </div>
            <StartPlanForm
              onCreated={(companyId) => {
                setDialogOpen(false);
                router.push(`/value-creation/${encodeURIComponent(companyId)}`);
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

/* ----------------------------- rooms section ---------------------------- */

function RoomsSection() {
  const { items, loading, error, reload } = useSection<RoomItem>(
    "/api/platform/hubs/dd-rooms?limit=50"
  );

  return (
    <div>
      <SectionHeading
        title="Data Rooms"
        blurb="Rooms by company — completeness and the latest room activity."
      />
      {loading ? (
        <SkeletonRows rows={4} />
      ) : error ? (
        <ErrorState onRetry={() => void reload()} />
      ) : items.length === 0 ? (
        <EmptyState
          title="No data rooms yet"
          message="Rooms are created per deal from the Data Rooms list."
          actionLabel="Open Data Rooms"
          href="/data-rooms"
        />
      ) : (
        <div className="card-surface px-4 py-2 sm:px-5">
          <ul className="divide-y divide-slate-100 dark:divide-white/5">
            {items.map((room) => (
              <li
                key={room.roomId}
                className="flex flex-wrap items-center gap-x-4 gap-y-1.5 py-2.5"
              >
                <span className="min-w-[160px] flex-1 truncate text-sm font-medium text-[#0d1f3c] dark:text-white">
                  {room.companyName}
                </span>
                <span className="flex items-center gap-2">
                  <span className="h-1.5 w-24 overflow-hidden rounded-full bg-slate-100 dark:bg-white/10">
                    <span
                      className="block h-full rounded-full bg-[#b8975a]"
                      style={{ width: `${room.completenessPct}%` }}
                    />
                  </span>
                  <span className="tnum text-xs text-slate-500 dark:text-white/50">
                    {room.completenessPct}%
                  </span>
                </span>
                <span className="text-xs text-slate-500 dark:text-white/50">
                  {room.missingCount} missing
                </span>
                <span className="text-xs text-slate-400 dark:text-white/40">
                  {room.lastActivityAt
                    ? `Active ${fmtRelTime(room.lastActivityAt)}`
                    : ""}
                </span>
                <span className="badge badge-neutral">{room.status}</span>
                <Link
                  href={`/data-rooms/${encodeURIComponent(room.roomId)}`}
                  className="btn btn-secondary btn-sm min-h-[44px]"
                >
                  Open
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/* --------------------------------- page --------------------------------- */

const SECTIONS = [
  { id: "dd-workspaces", label: "Diligence Workspaces" },
  { id: "dd-plans", label: "Value Creation Plans" },
  { id: "dd-rooms", label: "Data Rooms" },
  { id: "dd-playbook", label: "Playbook & Ideas" },
] as const;

export default function DueDiligencePage() {
  const [active, setActive] = useState<string>(SECTIONS[0].id);

  // Restore the tab from the URL hash on first mount (deep links).
  useEffect(() => {
    const h = window.location.hash.replace("#", "");
    if (SECTIONS.some((s) => s.id === h)) setActive(h);
  }, []);

  const select = (id: string) => (e: React.MouseEvent) => {
    e.preventDefault();
    setActive(id);
    try {
      window.history.replaceState(null, "", "#" + id);
    } catch {
      /* hash sync is an enhancement — the tab still switches */
    }
  };

  return (
    <div>
      <PageHero
        eyebrow="Platform"
        title="Due Diligence"
        subtitle="Diligence workspaces, value creation plans, and data rooms — checklists, findings, 100-day plans, and closing"
      />
      <div className="mx-auto max-w-[1400px] px-4 sm:px-6">
        {/* Sticky tab bar */}
        <div className="sticky top-14 z-20 -mx-4 bg-white/85 px-4 backdrop-blur dark:bg-[#0d1f3c]/85 sm:-mx-6 sm:px-6">
          <nav
            aria-label="Due Diligence sections"
            role="tablist"
            className="flex gap-1.5 overflow-x-auto py-2.5"
          >
            {SECTIONS.map((s) => (
              <a
                key={s.id}
                href={`#${s.id}`}
                onClick={select(s.id)}
                role="tab"
                aria-selected={active === s.id}
                aria-current={active === s.id ? "true" : undefined}
                className={`chip min-h-[44px] shrink-0 ${active === s.id ? "chip-active" : ""}`}
              >
                {s.label}
              </a>
            ))}
          </nav>
        </div>

        <div className="py-6">
          {active === "dd-workspaces" && (
            <section id="dd-workspaces">
              <WorkspacesSection />
            </section>
          )}
          {active === "dd-plans" && (
            <section id="dd-plans">
              <PlansSection />
            </section>
          )}
          {active === "dd-rooms" && (
            <section id="dd-rooms">
              <RoomsSection />
            </section>
          )}
          {active === "dd-playbook" && (
            <section id="dd-playbook">
              <PlaybookSection />
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

"use client";

/**
 * Company profile (Phase 1, Oct 21, 2026 — workstream C).
 *
 * Company is the central entity (PROJECT_RULES): this page renders one
 * company from GET /api/platform/companies/[id] — profile card fields,
 * photo gallery, participants (paired operators & capital sources),
 * activity timeline, and a linked-records panel (deals / tasks /
 * documents). Fetched once on mount; no polling.
 *
 * Defensive by contract: while the Neon DB is down the fetch fails and
 * the page shows a clean error state instead of crashing.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { EmptyState, SkeletonRows } from "@/components/ui";
import {
  ragDot,
  STAGE_GROUP_LABELS,
  type CompanyCard,
} from "@/components/CompanyCards";
import { fmtDate, fmtRelTime } from "@/lib/format";
import Comments from "@/components/Comments";
import ActivityFeed from "@/components/ActivityFeed";
import DataRoomButton from "@/components/hubs/DataRoomButton";
import GenerateReportButton from "@/components/comms/GenerateReportButton";
import FinancialsSection from "@/components/FinancialsSection";
import FinancialAnalysis from "@/components/FinancialAnalysis";
import DocGenPanel from "@/components/docgen/DocGenPanel";
import ContractsPanel from "@/components/docgen/ContractsPanel";
import AddonsSection from "@/components/AddonsSection";

interface CompanyDetail extends CompanyCard {
  source: string | null;
  gallery: string[];
  notes: string | null;
}

interface Participant {
  id: string;
  entityKind: string;
  entityId: string;
  name: string;
  role: string | null;
  status: string | null;
}

interface TimelineEntry {
  id: string;
  at: string;
  actor: string | null;
  kind: string | null;
  message: string;
}

interface CompanyPayload {
  company: CompanyDetail;
  participants: Participant[];
  timeline: TimelineEntry[];
  linked: {
    deals: { id: string; name: string; stage: string | null }[];
    tasks: { id: string; title: string; dueDate: string | null; done: boolean }[];
    documents: { id: string; name: string; at: string | null }[];
  };
}

type LoadState =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "notfound" }
  | { kind: "ready"; data: CompanyPayload };

const STATUS_BADGE: Record<string, string> = {
  identified: "badge-neutral",
  "in talks": "badge-warn",
  committed: "bg-green-100 text-green-800 dark:bg-green-500/15 dark:text-green-300",
};

function statusBadgeClass(status: string | null): string {
  if (!status) return "badge-neutral";
  return STATUS_BADGE[status.trim().toLowerCase()] ?? "badge-neutral";
}

function FactRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2 first:pt-0 last:pb-0">
      <span className="micro-label shrink-0 pt-0.5">{label}</span>
      <span className="min-w-0 text-right text-sm text-slate-800 dark:text-white/90">
        {children}
      </span>
    </div>
  );
}

export default function CompanyProfilePage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [reloadTick, setReloadTick] = useState(0);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setState({ kind: "loading" });
    (async () => {
      try {
        const res = await fetch(`/api/platform/companies/${encodeURIComponent(id)}`);
        if (cancelled) return;
        if (res.status === 404) {
          setState({ kind: "notfound" });
          return;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as CompanyPayload;
        if (cancelled) return;
        if (!data?.company) {
          setState({ kind: "notfound" });
          return;
        }
        setState({
          kind: "ready",
          data: {
            company: data.company,
            participants: Array.isArray(data.participants) ? data.participants : [],
            timeline: Array.isArray(data.timeline) ? data.timeline : [],
            linked: {
              deals: data.linked?.deals ?? [],
              tasks: data.linked?.tasks ?? [],
              documents: data.linked?.documents ?? [],
            },
          },
        });
      } catch {
        if (!cancelled) setState({ kind: "error" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, reloadTick]);

  if (state.kind === "loading") {
    return (
      <main className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6">
        <SkeletonRows rows={6} />
      </main>
    );
  }

  if (state.kind === "error") {
    return (
      <main className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6">
        <EmptyState
          title="Could not load this company"
          message="The company profile could not be loaded — the database may be unavailable. Try again in a moment."
          actionLabel="Try again"
          onAction={() => setReloadTick((t) => t + 1)}
        />
      </main>
    );
  }

  if (state.kind === "notfound") {
    return (
      <main className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6">
        <EmptyState
          title="Company not found"
          message="This company isn't in the platform yet, or the link is out of date."
          actionLabel="Back to Overview"
          href="/overview"
        />
      </main>
    );
  }

  const { company: c, participants, timeline, linked } = state.data;
  const initial = (c.name || "?").trim().charAt(0).toUpperCase();
  const place = [c.city, c.state].filter(Boolean).join(", ");

  const participantGroups = new Map<string, Participant[]>();
  for (const p of participants) {
    const role = (p.role ?? "Participant").trim() || "Participant";
    const list = participantGroups.get(role) ?? [];
    list.push(p);
    participantGroups.set(role, list);
  }

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6">
      {/* Breadcrumbs */}
      <nav aria-label="Breadcrumb" className="mb-4 flex flex-wrap items-center gap-1.5 text-xs text-caption">
        <Link href="/overview" className="font-semibold hover:text-gold-700 dark:hover:text-gold-400">
          Overview
        </Link>
        <span aria-hidden>/</span>
        <Link href="/overview" className="font-semibold hover:text-gold-700 dark:hover:text-gold-400">
          Companies
        </Link>
        <span aria-hidden>/</span>
        <span className="min-w-0 truncate font-semibold text-[#0d1f3c] dark:text-white">
          {c.name}
        </span>
      </nav>

      {/* Hero banner */}
      <div className="card-surface overflow-hidden">
        <div className="relative h-40 w-full bg-[#0d1f3c] sm:h-52">
          {c.heroUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={c.heroUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <div
              aria-hidden
              className="h-full w-full"
              style={{
                background:
                  "radial-gradient(120% 160% at 15% 0%, #1d3a63 0%, #0d1f3c 55%, #081426 100%)",
              }}
            />
          )}
          <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/45 to-transparent" />
        </div>
        <div className="flex flex-wrap items-start gap-4 p-5 sm:p-6">
          {c.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={c.logoUrl}
              alt=""
              loading="lazy"
              className="-mt-12 h-20 w-20 shrink-0 rounded-2xl bg-white object-contain ring-1 ring-slate-200 dark:ring-white/10"
            />
          ) : (
            <span
              aria-hidden
              className="-mt-12 flex h-20 w-20 shrink-0 items-center justify-center rounded-2xl bg-[#0d1f3c] font-display text-4xl font-semibold text-[#b8975a] ring-1 ring-white/20"
            >
              {initial}
            </span>
          )}
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-display text-3xl font-semibold text-[#0d1f3c] dark:text-white">
                {c.name}
              </h1>
              {c.stage === "portfolio" && ragDot(c.rag)}
            </div>
            <p className="mt-1 text-sm text-caption">
              {[c.vertical, place].filter(Boolean).join(" · ") || "—"}
            </p>
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              <span className="badge badge-fit">
                {STAGE_GROUP_LABELS[c.stage] ?? c.stage}
              </span>
              {c.dealStage && <span className="badge badge-neutral">{c.dealStage}</span>}
              {c.vertical && <span className="badge badge-neutral">{c.vertical}</span>}
            </div>
            <p className="mt-2.5 text-xs text-slate-400 dark:text-white/35">
              {c.source ? `Source: ${c.source}` : "Source: —"}
              {c.lastActivityAt
                ? ` · Last updated ${fmtRelTime(c.lastActivityAt)}`
                : ""}
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <DataRoomButton companyId={c.id} />
            <GenerateReportButton subjectKind="company" companyId={c.id} />
          </div>
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <div className="min-w-0 space-y-4 lg:col-span-2">
          {/* Key facts */}
          <section className="card-surface p-5" aria-label="Key facts">
            <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-[#0d1f3c] dark:text-white">
              Key facts
            </h2>
            <div className="divide-y divide-slate-100 dark:divide-white/5">
              <FactRow label="Stage">
                {STAGE_GROUP_LABELS[c.stage] ?? c.stage}
                {c.dealStage ? ` · ${c.dealStage}` : ""}
              </FactRow>
              <FactRow label="Location">{place || "—"}</FactRow>
              <FactRow label="Thesis fit">{c.thesisFit || "—"}</FactRow>
              <FactRow label="Owner / seller">{c.ownerContext || "—"}</FactRow>
              <FactRow label="Next action">{c.nextAction || "—"}</FactRow>
              <FactRow label="Key financials">
                <a href="#financials" className="font-semibold text-gold-700 hover:underline dark:text-gold-400">
                  See Financials below
                </a>
              </FactRow>
            </div>
            {c.notes && (
              <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-slate-700 dark:text-white/80">
                {c.notes}
              </p>
            )}
          </section>

          <FinancialsSection companyId={c.id} companyName={c.name} />

          <FinancialAnalysis companyId={c.id} />

          <DocGenPanel companyId={c.id} />

          <ContractsPanel companyId={c.id} />

          <AddonsSection dealIds={linked.deals.map((d) => d.id)} />

          {/* Photo gallery */}
          <section className="card-surface p-5" aria-label="Photos">
            <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-[#0d1f3c] dark:text-white">
              Photos
            </h2>
            {c.gallery && c.gallery.length > 0 ? (
              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
                {c.gallery.map((src, i) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    key={`${src}-${i}`}
                    src={src}
                    alt={`${c.name} photo ${i + 1}`}
                    loading="lazy"
                    className="aspect-[4/3] w-full rounded-xl object-cover"
                  />
                ))}
              </div>
            ) : (
              <p className="text-sm text-caption">No photos yet.</p>
            )}
          </section>

          {/* Paired operators & capital sources */}
          <section className="card-surface p-5" aria-label="Participants">
            <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-[#0d1f3c] dark:text-white">
              Paired operators &amp; capital sources
            </h2>
            {participants.length === 0 ? (
              <p className="text-sm text-caption">
                No operators or capital partners paired yet.
              </p>
            ) : (
              <div className="space-y-4">
                {Array.from(participantGroups.entries()).map(([role, people]) => (
                  <div key={role}>
                    <p className="micro-label mb-1.5">{role}</p>
                    <ul className="divide-y divide-slate-100 dark:divide-white/5">
                      {people.map((p) => (
                        <li
                          key={p.id}
                          className="flex flex-wrap items-center gap-2 py-2 first:pt-0 last:pb-0"
                        >
                          <Link
                            href={`/directory?q=${encodeURIComponent(p.name)}`}
                            className="min-w-0 truncate text-sm font-medium text-slate-800 hover:text-gold-700 dark:text-white/90 dark:hover:text-gold-400"
                          >
                            {p.name}
                          </Link>
                          {p.status && (
                            <span className={`badge ${statusBadgeClass(p.status)}`}>
                              {p.status}
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Activity timeline */}
          <section className="card-surface p-5" aria-label="Activity">
            <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-[#0d1f3c] dark:text-white">
              Activity
            </h2>
            {timeline.length === 0 ? (
              <p className="text-sm text-caption">No activity recorded yet.</p>
            ) : (
              <ol className="relative space-y-4 border-l border-slate-200 pl-4 dark:border-white/10">
                {timeline.map((t) => (
                  <li key={t.id} className="relative">
                    <span
                      aria-hidden
                      className="absolute -left-[1.3rem] top-1.5 h-2 w-2 rounded-full bg-[#b8975a]"
                    />
                    <p className="text-sm leading-snug text-slate-800 dark:text-white/90">
                      {t.message}
                    </p>
                    <p className="mt-0.5 text-xs text-caption">
                      {[t.actor, t.at ? fmtDate(t.at) : null, t.at ? fmtRelTime(t.at) : null]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </li>
                ))}
              </ol>
            )}
          </section>

          {/* Discussion (Phase 2, workstream D): comments + @mentions */}
          <section className="card-surface p-5" aria-label="Discussion">
            <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-[#0d1f3c] dark:text-white">
              Discussion
            </h2>
            <Comments entityKind="company" entityId={c.id} />
          </section>

          {/* Platform activity feed (Phase 2, workstream D) */}
          <section className="card-surface p-5" aria-label="Activity feed">
            <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-[#0d1f3c] dark:text-white">
              Activity feed
            </h2>
            <ActivityFeed entityKind="company" entityId={c.id} />
          </section>
        </div>

        {/* Linked records */}
        <aside className="min-w-0">
          <section className="card-surface p-5" aria-label="Linked records">
            <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-[#0d1f3c] dark:text-white">
              Linked records
            </h2>

            <p className="micro-label mb-1.5">Deals</p>
            {linked.deals.length === 0 ? (
              <p className="mb-4 text-sm text-caption">No linked deals.</p>
            ) : (
              <ul className="mb-4 space-y-1.5">
                {linked.deals.map((d) => (
                  <li key={d.id}>
                    <Link
                      href={`/deals/${d.id}`}
                      className="flex items-center justify-between gap-2 text-sm font-medium text-slate-800 hover:text-gold-700 dark:text-white/90 dark:hover:text-gold-400"
                    >
                      <span className="min-w-0 truncate">{d.name}</span>
                      {d.stage && (
                        <span className="badge badge-neutral shrink-0">{d.stage}</span>
                      )}
                    </Link>
                  </li>
                ))}
              </ul>
            )}

            <p className="micro-label mb-1.5">Tasks</p>
            {linked.tasks.length === 0 ? (
              <p className="mb-4 text-sm text-caption">No open tasks.</p>
            ) : (
              <ul className="mb-4 space-y-1.5">
                {linked.tasks.map((t) => (
                  <li key={t.id}>
                    <Link
                      href="/overview"
                      className="flex items-center justify-between gap-2 text-sm text-slate-800 hover:text-gold-700 dark:text-white/90 dark:hover:text-gold-400"
                    >
                      <span
                        className={`min-w-0 truncate ${t.done ? "text-caption line-through" : ""}`}
                      >
                        {t.title}
                      </span>
                      {t.dueDate && (
                        <span className="shrink-0 text-xs text-caption">
                          {fmtDate(t.dueDate)}
                        </span>
                      )}
                    </Link>
                  </li>
                ))}
              </ul>
            )}

            <p className="micro-label mb-1.5">Documents</p>
            {linked.documents.length === 0 ? (
              <p className="text-sm text-caption">No documents yet.</p>
            ) : (
              <ul className="space-y-1.5">
                {linked.documents.map((d) => (
                  <li
                    key={d.id}
                    className="flex items-center justify-between gap-2 text-sm text-slate-800 dark:text-white/90"
                  >
                    <span className="min-w-0 truncate">{d.name}</span>
                    {d.at && (
                      <span className="shrink-0 text-xs text-caption">
                        {fmtDate(d.at)}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </aside>
      </div>
    </main>
  );
}

"use client";

import type { Deal, Executive } from "@/lib/types";
import type { Investor } from "@/lib/investors-db";
import { fmtDate } from "@/lib/format";
import { dealFocusSector } from "@/lib/valuation";
import CompanyMark from "@/components/identity/CompanyMark";
import PersonAvatar from "@/components/PersonAvatar";
import SectorChip, { StageChip } from "@/components/SectorChip";
import { dealWebsite } from "@/components/DealTable";

/**
 * Directory grid view (Premium redesign Wave 3): profile cards for
 * the active Directory tab, sharing one card frame across operators,
 * businesses, and investors. Presentation only — clicking a card runs
 * the exact same selection handler as a list row.
 *
 * "Last touch" follows the portal's established semantics (the page
 * resolves it): the latest logged interaction for the record, falling
 * back to the record's updatedAt; investors use updatedAt. No record
 * type carries a next-step field, so cards show none.
 */

export interface DirEntry {
  kind: "operator" | "business" | "investor";
  id: string;
  name: string;
  sub: string;
  stage: string;
  owner: string;
  tags: string[];
  sector?: string;
  website?: string;
}

export default function DirectoryGrid({
  entries,
  execs,
  deals,
  investors,
  selected,
  lastTouchFor,
  onSelect,
}: {
  entries: DirEntry[];
  execs: Executive[];
  deals: Deal[];
  investors: Investor[];
  selected: { kind: string; id: string } | null;
  lastTouchFor: (kind: DirEntry["kind"], id: string) => string | null;
  onSelect: (e: DirEntry) => void;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {entries.map((e) => {
        const active = selected?.kind === e.kind && selected?.id === e.id;
        const exec = e.kind === "operator" ? execs.find((x) => x.id === e.id) : undefined;
        const deal = e.kind === "business" ? deals.find((x) => x.id === e.id) : undefined;
        const inv = e.kind === "investor" ? investors.find((x) => x.id === e.id) : undefined;
        const touch = lastTouchFor(e.kind, e.id);
        return (
          <button
            key={`${e.kind}-${e.id}`}
            onClick={() => onSelect(e)}
            className={`card-surface w-full p-4 text-left transition hover:shadow-lg ${
              active ? "border-[#b8975a] ring-1 ring-[#b8975a]" : ""
            }`}
          >
            <span className="flex items-start gap-3">
              {e.kind === "business" ? (
                <CompanyMark
                  companyId={deal ? `co_${deal.id}` : undefined}
                  name={e.name}
                  logoVersion={deal?.logoVersion ?? 0}
                  size={44}
                />
              ) : (
                <PersonAvatar
                  name={e.name}
                  photoUrl={exec?.photoUrl ?? inv?.photoUrl}
                  size={44}
                />
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xl font-semibold leading-snug text-[#0d1f3c] dark:text-white">
                  {e.name}
                </span>
                <span className="mt-0.5 block truncate text-sm text-slate-500 dark:text-white/55">
                  {e.sub}
                </span>
                {inv && inv.firm && (
                  <span className="mt-1 flex items-center gap-1.5 text-xs text-slate-500 dark:text-white/50">
                    <CompanyMark name={inv.firm} size={16} />
                    <span className="truncate">{inv.firm}</span>
                  </span>
                )}
                {deal && deal.city && (
                  <span className="mt-1 block truncate text-xs text-slate-500 dark:text-white/50">
                    {deal.city}
                    {deal.broker ? ` · ${deal.broker}` : ""}
                  </span>
                )}
              </span>
            </span>

            <span className="mt-3 flex flex-wrap items-center gap-1.5">
              {e.kind === "investor" ? (
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-500 dark:bg-white/10 dark:text-white/60">
                  {e.stage}
                </span>
              ) : (
                <StageChip stage={e.stage} />
              )}
              {e.kind === "operator" &&
                e.tags.slice(0, 3).map((t) => (
                  <SectorChip key={t} sector={dealFocusSector(t) ?? t} />
                ))}
              {e.kind === "business" && e.sector && <SectorChip sector={e.sector} />}
              {e.kind === "investor" &&
                e.tags.map((t) => (
                  <span
                    key={t}
                    className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500 dark:bg-white/10 dark:text-white/55"
                  >
                    {t}
                  </span>
                ))}
            </span>

            <span className="mt-3 flex items-center justify-between gap-2 border-t border-slate-100 pt-2.5 text-xs text-slate-400 dark:border-white/10 dark:text-white/40">
              <span>
                {touch ? (
                  <>
                    Last touch · <span className="tnum">{fmtDate(touch)}</span>
                  </>
                ) : (
                  "Last touch · —"
                )}
              </span>
              {e.owner && <span className="truncate">Claimed by {e.owner}</span>}
            </span>
          </button>
        );
      })}
    </div>
  );
}

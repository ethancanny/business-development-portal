"use client";

/**
 * Directory — unified records (Phase 2, Oct 21, 2026).
 *
 * One record system over core.people / core.organizations replaces the
 * old Operators / Businesses / Investors tabs. This module holds the
 * shared record types, the type taxonomy, and the responsive card
 * grid used by app/directory/page.tsx. The detail slide-over lives in
 * DirectoryDetail.tsx; import in DirectoryImport.tsx; email templates
 * in DirectoryTemplates.tsx.
 */

import CompanyLogo from "@/components/CompanyLogo";
import PersonAvatar from "@/components/PersonAvatar";
import { fmtDate } from "@/lib/format";

export type DirectoryKind = "person" | "organization";

export interface DirectoryItem {
  id: string;
  kind: DirectoryKind;
  name: string;
  title?: string | null;
  types: string[];
  email?: string | null;
  phone?: string | null;
  photoUrl?: string | null;
  organizationName?: string | null;
  website?: string | null;
  linkedDealCount?: number;
  updatedAt?: string | null;
  source?: string | null;
}

export interface LegacyInvestor {
  investmentType?: string | null;
  industryFocus?: string | null;
  ebitdaSize?: string | null;
  checkSize?: string | null;
  status?: string | null;
  website?: string | null;
  comments?: string | null;
}

export interface LinkedDeal {
  dealId: string;
  dealName: string;
  role?: string | null;
  status?: string | null;
}

export interface DirectoryRecord {
  id: string;
  kind?: DirectoryKind;
  name: string;
  title?: string | null;
  email?: string | null;
  phone?: string | null;
  photoUrl?: string | null;
  organizationName?: string | null;
  website?: string | null;
  notes?: string | null;
  source?: string | null;
  updatedAt?: string | null;
  createdAt?: string | null;
  [key: string]: unknown;
}

export interface DirectoryDetailPayload {
  record: DirectoryRecord;
  types: string[];
  linkedDeals: LinkedDeal[];
  legacyInvestor: LegacyInvestor | null;
}

/** Type taxonomy (Phase 2 contract — single source for chips/forms). */
export const DIRECTORY_TYPES: { id: string; label: string }[] = [
  { id: "operator", label: "Operator" },
  { id: "investor", label: "Investor" },
  { id: "lp", label: "LP" },
  { id: "lender", label: "Lender" },
  { id: "broker", label: "Broker" },
  { id: "attorney", label: "Attorney" },
  { id: "accountant", label: "Accountant" },
  { id: "advisor", label: "Advisor" },
  { id: "seller", label: "Seller" },
  { id: "portfolio_contact", label: "Portfolio contact" },
  { id: "contact", label: "Contact" },
];

export function typeLabel(id: string): string {
  const hit = DIRECTORY_TYPES.find((t) => t.id === id);
  return hit ? hit.label : id.replace(/_/g, " ");
}

export function TypeBadge({ typeId }: { typeId: string }) {
  return (
    <span className="rounded-full bg-[#0d1f3c]/5 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[#0d1f3c] ring-1 ring-inset ring-[#b8975a]/50 dark:bg-white/10 dark:text-white/80">
      {typeLabel(typeId)}
    </span>
  );
}

export function KindBadge({ kind }: { kind: DirectoryKind }) {
  return (
    <span
      className={
        kind === "person"
          ? "rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-violet-800 dark:bg-violet-500/15 dark:text-violet-300"
          : "rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-sky-800 dark:bg-sky-500/15 dark:text-sky-300"
      }
    >
      {kind === "person" ? "Person" : "Organization"}
    </span>
  );
}

/** Subtitle line for a card: title · firm for people, title for orgs. */
export function itemSubtitle(item: DirectoryItem): string {
  if (item.kind === "person") {
    const parts = [item.title, item.organizationName].filter(
      (s) => s && String(s).trim()
    );
    return parts.join(" · ") || "Person";
  }
  return item.title || item.organizationName || "Organization";
}

export default function DirectoryGrid({
  items,
  selectedId,
  onSelect,
}: {
  items: DirectoryItem[];
  selectedId?: string | null;
  onSelect: (item: DirectoryItem) => void;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {items.map((item) => {
        const active = selectedId === item.id;
        return (
          <button
            key={`${item.kind}-${item.id}`}
            type="button"
            onClick={() => onSelect(item)}
            className={`card-surface w-full p-4 text-left transition hover:shadow-lg ${
              active ? "border-[#b8975a] ring-1 ring-[#b8975a]" : ""
            }`}
          >
            <span className="flex items-start gap-3">
              {item.kind === "organization" ? (
                <CompanyLogo
                  name={item.name}
                  website={item.website || undefined}
                  size={44}
                />
              ) : (
                <PersonAvatar
                  name={item.name}
                  photoUrl={item.photoUrl || undefined}
                  size={44}
                />
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-base font-semibold leading-snug text-[#0d1f3c] dark:text-white">
                  {item.name}
                </span>
                <span className="mt-0.5 block truncate text-sm text-slate-500 dark:text-white/55">
                  {itemSubtitle(item)}
                </span>
                {item.email && (
                  <span className="mt-0.5 block truncate text-xs text-slate-400 dark:text-white/40">
                    {item.email}
                  </span>
                )}
              </span>
            </span>

            <span className="mt-3 flex flex-wrap items-center gap-1.5">
              <KindBadge kind={item.kind} />
              {(item.types || []).map((t) => (
                <TypeBadge key={t} typeId={t} />
              ))}
            </span>

            <span className="mt-3 flex items-center justify-between gap-2 border-t border-slate-100 pt-2.5 text-xs text-slate-400 dark:border-white/10 dark:text-white/40">
              <span>
                {typeof item.linkedDealCount === "number"
                  ? item.linkedDealCount === 1
                    ? "1 linked deal"
                    : `${item.linkedDealCount} linked deals`
                  : "Linked deals · —"}
              </span>
              <span className="tnum shrink-0">
                {item.updatedAt ? `Updated ${fmtDate(item.updatedAt)}` : ""}
              </span>
            </span>
            {item.source && (
              <span className="mt-1 block truncate text-[11px] text-slate-400 dark:text-white/35">
                Source: {item.source}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

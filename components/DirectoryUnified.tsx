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

import CompanyMark from "@/components/identity/CompanyMark";
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
  logoVersion?: number;
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
  // Legacy "lp" tags display as Investor (Ethan, Oct 23, 2026 — the
  // Directory only uses "Investor"; the type itself is retired).
  if (id === "lp") return "Investor";
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

/** Display types for a record: legacy "lp" folds into "investor" and
 * duplicates collapse, so a contact never shows two Investor badges. */
export function displayTypes(types: string[] | undefined): string[] {
  const out: string[] = [];
  for (const t of types ?? []) {
    const id = t === "lp" ? "investor" : t;
    if (id && !out.includes(id)) out.push(id);
  }
  return out;
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
                <CompanyMark
                  companyId={item.id}
                  name={item.name}
                  logoVersion={item.logoVersion ?? 0}
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
              {displayTypes(item.types).map((t) => (
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

/** Table view (Ethan, Oct 23, 2026): the Directory's default view —
 * the same records as the card (Kanban) grid in the portal's standard
 * table styling (.tbl-grad: navy header, cream text, gold rule).
 * Clicking a row opens the record, exactly like a card. */
export function DirectoryTable({
  items,
  selectedId,
  onSelect,
}: {
  items: DirectoryItem[];
  selectedId?: string | null;
  onSelect: (item: DirectoryItem) => void;
}) {
  const th =
    "px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wider";
  const td = "px-3 py-2.5 text-sm text-slate-700 dark:text-white/80";
  return (
    <div className="card-surface overflow-x-auto">
      <table className="tbl-grad w-full border-collapse">
        <thead>
          <tr>
            <th className={th}>Name</th>
            <th className={th}>Title</th>
            <th className={th}>Organization</th>
            <th className={th}>Type</th>
            <th className={th}>Email</th>
            <th className={th}>Phone</th>
            <th className={th}>Updated</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const active = selectedId === item.id;
            return (
              <tr
                key={`${item.kind}-${item.id}`}
                onClick={() => onSelect(item)}
                className={`cursor-pointer border-b border-slate-100 transition hover:bg-[#f0f4fa] dark:border-white/5 dark:hover:bg-white/5 ${
                  active ? "bg-[#f7f1e3] dark:bg-white/10" : ""
                }`}
              >
                <td className={`${td} font-medium`}>
                  <span className="flex items-center gap-2.5">
                    {item.kind === "organization" ? (
                      <CompanyMark
                        companyId={item.id}
                        name={item.name}
                        logoVersion={item.logoVersion ?? 0}
                        size={28}
                      />
                    ) : (
                      <PersonAvatar
                        name={item.name}
                        photoUrl={item.photoUrl || undefined}
                        size={28}
                      />
                    )}
                    <span className="truncate text-[#0d1f3c] dark:text-white">
                      {item.name}
                    </span>
                  </span>
                </td>
                <td className={td}>{item.title || "—"}</td>
                <td className={td}>{item.organizationName || "—"}</td>
                <td className={td}>
                  <span className="flex flex-wrap gap-1">
                    {displayTypes(item.types).map((t) => (
                      <TypeBadge key={t} typeId={t} />
                    ))}
                  </span>
                </td>
                <td className={td}>{item.email || "—"}</td>
                <td className={td}>{item.phone || "—"}</td>
                <td className={`${td} whitespace-nowrap`}>
                  {item.updatedAt ? fmtDate(item.updatedAt) : "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

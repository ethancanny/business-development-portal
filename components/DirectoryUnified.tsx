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

/** Relationship profile (CRM Phase 1 — Lane A fills this on detail;
 * list items carry the summary fields inline, below). */
export interface RelationshipProfile {
  entityKind?: string;
  entityId?: string;
  tier: string;
  stage: string;
  cadenceDays?: number | null;
  owner: string;
  source: string;
  introducedByPersonId?: string | null;
  commPrefs: string;
  importantDates: { label: string; date: string }[];
  lastTouchAt?: string | null;
  nextTouchDue?: string | null;
  touchCount90d: number;
  openTaskCount: number;
  isTestData?: boolean;
}

export interface TimelineItem {
  key: string;
  kind: string; // interaction | email | task | document | event
  /** Interaction subtype (call/meeting/…) when the API provides it. */
  type?: string | null;
  /** Completion flag for task items (CRM Phase 1). */
  done?: boolean;
  ts: string;
  title: string;
  detail?: string | null;
  href?: string | null;
}

export const RELATIONSHIP_TIERS = ["A", "B", "C"] as const;
export const RELATIONSHIP_STAGES = ["New", "Engaged", "Active", "Dormant"] as const;

export function isOverdueItem(item: { nextTouchDue?: string | null }): boolean {
  if (!item.nextTouchDue) return false;
  const t = Date.parse(item.nextTouchDue);
  return Number.isFinite(t) && t < Date.now();
}

export interface DirectoryItem {
  id: string;
  kind: DirectoryKind;
  name: string;
  /* CRM Phase 1 summary fields (Lane A listDirectory) */
  tier?: string | null;
  stage?: string | null;
  relOwner?: string | null;
  lastTouchAt?: string | null;
  nextTouchDue?: string | null;
  touchCount90d?: number | null;
  openTaskCount?: number | null;
  tags?: string[];
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
  /* CRM Phase 1 (Lane A) — additive */
  relationship?: RelationshipProfile | null;
  tags?: string[];
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
  { id: "owner", label: "Owner" },
  { id: "ad_contact", label: "A&D contact" },
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
            {(item.tier || item.stage || item.lastTouchAt || item.nextTouchDue) && (
              <span className="mt-1 flex flex-wrap gap-x-2 text-[11px] text-slate-400 dark:text-white/35">
                {item.tier ? <span>Tier {item.tier}</span> : null}
                {item.stage ? <span>{item.stage}</span> : null}
                {item.lastTouchAt ? <span>Last touch {fmtDate(item.lastTouchAt)}</span> : null}
                {item.nextTouchDue ? (
                  <span className={isOverdueItem(item) ? "font-semibold text-red-600 dark:text-red-300" : ""}>
                    Next due {fmtDate(item.nextTouchDue)}
                  </span>
                ) : null}
              </span>
            )}
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
export type DirectorySortKey = "name" | "lastTouch" | "nextDue" | "updated";
export type DirectorySortDir = "asc" | "desc";

export function DirectoryTable({
  items,
  selectedId,
  onSelect,
  selectedIds,
  onToggleSelect,
  onToggleAll,
  sortKey,
  sortDir,
  onSort,
}: {
  items: DirectoryItem[];
  selectedId?: string | null;
  onSelect: (item: DirectoryItem) => void;
  /* CRM Phase 1: row selection + server sort (optional — the table
   * renders read-only exactly as before when these are omitted). */
  selectedIds?: Set<string>;
  onToggleSelect?: (item: DirectoryItem, checked: boolean) => void;
  onToggleAll?: (checked: boolean) => void;
  sortKey?: DirectorySortKey;
  sortDir?: DirectorySortDir;
  onSort?: (key: DirectorySortKey) => void;
}) {
  const th =
    "px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wider";
  const td = "px-3 py-2.5 text-sm text-slate-700 dark:text-white/80";
  const selectable = !!selectedIds && !!onToggleSelect;
  const allSelected =
    selectable && items.length > 0 && items.every((i) => selectedIds.has(i.id));

  const sortHeader = (label: string, key: DirectorySortKey) => (
    <button
      type="button"
      onClick={() => onSort?.(key)}
      className="inline-flex min-h-[32px] items-center gap-1 uppercase tracking-wider hover:text-[#d4b37a]"
      aria-label={`Sort by ${label}`}
    >
      {label}
      <span aria-hidden className="text-[10px]">
        {sortKey === key ? (sortDir === "asc" ? "▲" : "▼") : "↕"}
      </span>
    </button>
  );

  return (
    <div className="card-surface overflow-x-auto">
      <table className="tbl-grad w-full border-collapse">
        <thead>
          <tr>
            {selectable && (
              <th className={th}>
                <input
                  type="checkbox"
                  aria-label="Select all"
                  checked={allSelected}
                  onChange={(e) => onToggleAll?.(e.target.checked)}
                  className="h-4 w-4 accent-[#b8975a]"
                />
              </th>
            )}
            <th className={th}>{onSort ? sortHeader("Name", "name") : "Name"}</th>
            <th className={th}>Title</th>
            <th className={th}>Organization</th>
            <th className={th}>Type</th>
            <th className={th}>Tier</th>
            <th className={th}>Stage</th>
            <th className={th}>{onSort ? sortHeader("Last touch", "lastTouch") : "Last touch"}</th>
            <th className={th}>{onSort ? sortHeader("Next due", "nextDue") : "Next due"}</th>
            <th className={th}>Tags</th>
            <th className={th}>{onSort ? sortHeader("Updated", "updated") : "Updated"}</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const active = selectedId === item.id;
            const overdue = isOverdueItem(item);
            return (
              <tr
                key={`${item.kind}-${item.id}`}
                onClick={() => onSelect(item)}
                className={`cursor-pointer border-b border-slate-100 transition hover:bg-[#f0f4fa] dark:border-white/5 dark:hover:bg-white/5 ${
                  active ? "bg-[#f7f1e3] dark:bg-white/10" : ""
                }`}
              >
                {selectable && (
                  <td className={td} onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      aria-label={`Select ${item.name}`}
                      checked={selectedIds.has(item.id)}
                      onChange={(e) => onToggleSelect(item, e.target.checked)}
                      className="h-4 w-4 accent-[#b8975a]"
                    />
                  </td>
                )}
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
                <td className={td}>{item.tier || "—"}</td>
                <td className={td}>{item.stage || "—"}</td>
                <td className={`${td} whitespace-nowrap`}>
                  {item.lastTouchAt ? fmtDate(item.lastTouchAt) : "—"}
                </td>
                <td
                  className={`${td} whitespace-nowrap ${
                    overdue ? "font-semibold text-red-600 dark:text-red-300" : ""
                  }`}
                >
                  {item.nextTouchDue ? fmtDate(item.nextTouchDue) : "—"}
                  {overdue ? " · overdue" : ""}
                </td>
                <td className={td}>
                  <span className="flex flex-wrap gap-1">
                    {(item.tags ?? []).map((t) => (
                      <span key={t} className="rounded-full bg-[#b8975a]/15 px-2 py-0.5 text-[10px] font-semibold text-[#0d1f3c] dark:text-[#d4b37a]">{t}</span>
                    ))}
                  </span>
                </td>
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

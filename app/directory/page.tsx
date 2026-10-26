"use client";

/**
 * Directory (Phase 2, Oct 21, 2026 — unified record system).
 *
 * One directory over core.people / core.organizations, replacing the
 * legacy Operators / Businesses / Investors tabs (their data is fully
 * projected into core; investor investment fields return through the
 * detail API as legacyInvestor). Server-side search / type filtering
 * via GET /api/platform/directory, paginated at 50.
 *
 * People only (Ethan, Oct 23, 2026): this is a CONTACTS list. A
 * contact's company is their affiliation (organizationName), never a
 * second contact — the list, counts, exports, add form, and import
 * are all scoped to kind="person". Organization records themselves
 * are untouched and remain reachable via the record routes.
 *
 * Deep links keep working: /directory?q=<name> initializes the search
 * from ?q= and, once results land, auto-opens the record only on an
 * exact match (the person's name, or their organization's name).
 */

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import PageHero from "@/components/PageHero";
import { BulkActionBar, CardSkeleton, EmptyState, ErrorState, SavedViewChips } from "@/components/ui";
import { useQuickLog } from "@/components/directory/QuickLog";
import { showToast } from "@/components/Toast";
import DirectoryGrid, {
  DIRECTORY_TYPES,
  DirectoryTable,
  type DirectoryItem,
  type DirectoryKind,
  type DirectorySortDir,
  type DirectorySortKey,
} from "@/components/DirectoryUnified";
import DirectoryDetail from "@/components/DirectoryDetail";
import DirectoryImport from "@/components/DirectoryImport";
import DirectoryTemplates from "@/components/DirectoryTemplates";

const PAGE_SIZE = 50;

const inputCls =
  "w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-[#0d1f3c] outline-none placeholder:text-slate-300 focus:border-[#b8975a] dark:border-white/10 dark:bg-[#132847]/60 dark:text-white dark:placeholder:text-white/30";
const labelCls =
  "mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-white/40";

function buildListUrl(opts: {
  type: string;
  q: string;
  offset: number;
  kind?: DirectoryKind;
  tier?: string;
  stage?: string;
  owner?: string;
  tag?: string;
  overdueOnly?: boolean;
  lastTouchBefore?: string;
  lastTouchAfter?: string;
  sort?: string;
  sortDir?: string;
}): string {
  const params = new URLSearchParams();
  params.set("kind", opts.kind ?? "person");
  if (opts.type !== "all") params.set("type", opts.type);
  if (opts.q.trim()) params.set("q", opts.q.trim());
  if (opts.tier) params.set("tier", opts.tier);
  if (opts.stage) params.set("stage", opts.stage);
  if (opts.owner?.trim()) params.set("owner", opts.owner.trim());
  if (opts.tag?.trim()) params.set("tag", opts.tag.trim());
  if (opts.overdueOnly) { params.set("overdueOnly", "true"); params.set("overdue", "true"); }
  if (opts.lastTouchBefore) params.set("lastTouchBefore", opts.lastTouchBefore);
  if (opts.lastTouchAfter) params.set("lastTouchAfter", opts.lastTouchAfter);
  if (opts.sort) params.set("sort", opts.sort);
  if (opts.sortDir) params.set("sortDir", opts.sortDir);
  params.set("limit", String(PAGE_SIZE));
  params.set("offset", String(opts.offset));
  return `/api/platform/directory?${params.toString()}`;
}

function buildExportHref(format: "xlsx" | "csv", type: string, q: string, kind: DirectoryKind = "person"): string {
  const params = new URLSearchParams();
  params.set("format", format);
  params.set("kind", kind);
  if (type !== "all") params.set("type", type);
  if (q.trim()) params.set("q", q.trim());
  return `/api/platform/directory/export?${params.toString()}`;
}

function normalizeList(data: unknown): { items: DirectoryItem[]; total: number } {
  if (data && typeof data === "object") {
    const obj = data as Record<string, unknown>;
    const items = Array.isArray(obj.items) ? (obj.items as DirectoryItem[]) : [];
    const total = typeof obj.total === "number" ? obj.total : items.length;
    return { items, total };
  }
  return { items: [], total: 0 };
}

/* ---------------- Add-record modal ---------------- */

function AddRecordModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (item: DirectoryItem | null) => void;
}) {
  const kind: DirectoryKind = "person";
  const [form, setForm] = useState({
    name: "",
    title: "",
    email: "",
    phone: "",
    organizationName: "",
    website: "",
    notes: "",
  });
  const [types, setTypes] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const toggleType = (t: string) =>
    setTypes((prev) =>
      prev.indexOf(t) >= 0 ? prev.filter((x) => x !== t) : [...prev, t]
    );

  const submit = async () => {
    if (!form.name.trim() || busy) return;
    setBusy(true);
    setMsg("");
    try {
      const r = await fetch("/api/platform/directory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind,
          name: form.name.trim(),
          title: form.title.trim() || undefined,
          email: form.email.trim() || undefined,
          phone: form.phone.trim() || undefined,
          organizationName: form.organizationName.trim() || undefined,
          website: form.website.trim() || undefined,
          notes: form.notes || undefined,
          types,
        }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data: unknown = await r.json().catch(() => null);
      let created: DirectoryItem | null = null;
      if (data && typeof data === "object") {
        const obj = data as Record<string, unknown>;
        const rec = (obj.record ?? obj.item ?? obj) as Record<string, unknown>;
        if (rec && typeof rec.id === "string") {
          created = {
            id: rec.id,
            kind: (rec.kind as DirectoryKind) || kind,
            name: String(rec.name || form.name.trim()),
            title: (rec.title as string) || form.title || null,
            types: Array.isArray(rec.types) ? (rec.types as string[]) : types,
            email: (rec.email as string) || form.email || null,
            phone: (rec.phone as string) || form.phone || null,
            photoUrl: (rec.photoUrl as string) || null,
            organizationName:
              (rec.organizationName as string) || form.organizationName || null,
            website: (rec.website as string) || form.website || null,
            updatedAt: (rec.updatedAt as string) || null,
          };
        }
      }
      onCreated(created);
    } catch {
      setMsg("Could not create the contact — please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true">
      <button
        type="button"
        aria-label="Close add record"
        onClick={onClose}
        className="absolute inset-0 h-full w-full bg-[#0d1f3c]/50"
      />
      <div className="absolute inset-x-0 bottom-0 max-h-[92vh] overflow-y-auto rounded-t-3xl bg-white p-5 shadow-2xl dark:bg-[#0f2242] sm:inset-x-auto sm:bottom-auto sm:right-0 sm:top-0 sm:h-full sm:w-full sm:max-w-[520px] sm:rounded-none">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h3 className="font-display text-2xl font-semibold text-[#0d1f3c] dark:text-white">
            Add contact
          </h3>
          <button type="button" onClick={onClose} className="btn btn-secondary btn-sm">
            Close
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <label className={labelCls} htmlFor="dir-add-name">Name</label>
            <input
              id="dir-add-name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Full name"
              className={inputCls}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className={labelCls} htmlFor="dir-add-title">Title</label>
              <input
                id="dir-add-title"
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls} htmlFor="dir-add-org">
                Organization
              </label>
              <input
                id="dir-add-org"
                value={form.organizationName}
                onChange={(e) => setForm({ ...form, organizationName: e.target.value })}
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls} htmlFor="dir-add-email">Email</label>
              <input
                id="dir-add-email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls} htmlFor="dir-add-phone">Phone</label>
              <input
                id="dir-add-phone"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                className={inputCls}
              />
            </div>
          </div>
          <div>
            <label className={labelCls} htmlFor="dir-add-notes">Notes</label>
            <textarea
              id="dir-add-notes"
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              rows={4}
              className={inputCls}
            />
          </div>
          <div>
            <p className={labelCls}>Types</p>
            <div className="flex flex-wrap gap-1.5">
              {DIRECTORY_TYPES.map((t) => {
                const active = types.indexOf(t.id) >= 0;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => toggleType(t.id)}
                    className={`chip ${active ? "chip-active" : ""}`}
                    aria-pressed={active}
                  >
                    {t.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={busy || !form.name.trim()}
            onClick={() => void submit()}
            className="btn btn-primary min-h-[44px]"
          >
            {busy ? "Creating…" : "Create contact"}
          </button>
          {msg && (
            <span className="text-xs text-red-700 dark:text-red-300">{msg}</span>
          )}
        </div>
      </div>
    </div>
  );
}

/* ---------------- Page ---------------- */

export default function Directory() {
  const router = useRouter();
  const { openQuickLog } = useQuickLog();
  const [typeFilter, setTypeFilter] = useState("all");
  /* CRM Phase 1 list state */
  const [kindFilter, setKindFilter] = useState<DirectoryKind>("person");
  const [tierFilter, setTierFilter] = useState("");
  const [stageFilter, setStageFilter] = useState("");
  const [ownerFilter, setOwnerFilter] = useState("");
  const [tagFilter, setTagFilter] = useState("");
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [lastTouchBefore, setLastTouchBefore] = useState("");
  const [lastTouchAfter, setLastTouchAfter] = useState("");
  const [sortKey, setSortKey] = useState<DirectorySortKey>("updated");
  const [sortDir, setSortDir] = useState<DirectorySortDir>("desc");
  const [crmView, setCrmView] = useState<"all" | "overdue" | "atier">("all");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkAction, setBulkAction] = useState("assign_owner");
  const [bulkValue, setBulkValue] = useState("");
  const [bulkDue, setBulkDue] = useState("");
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkMsg, setBulkMsg] = useState("");
  const [lists, setLists] = useState<{ id: string; name: string }[]>([]);
  const [newListName, setNewListName] = useState("");
  const [q, setQ] = useState("");
  const [items, setItems] = useState<DirectoryItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);
  const [selected, setSelected] = useState<{ kind: DirectoryKind; id: string } | null>(null);
  const [selectedItem, setSelectedItem] = useState<DirectoryItem | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);
  // "Investors" saved view (Investors & Capital Redesign Step 1,
  // Oct 25, 2026): people/organizations with a capital profile. The
  // capital investors list is fetched once when the view is first
  // opened; its personId set filters the directory list client-side.
  const [investorsView, setInvestorsView] = useState(false);
  const [investorIds, setInvestorIds] = useState<Set<string> | null>(null);
  const [investorIdsTick, setInvestorIdsTick] = useState(0);
  const investorIdsLoadedRef = useRef(false);
  // View switch (Ethan, Oct 23, 2026): Table is the default; Kanban is
  // the card grid. The choice persists for the session.
  const [view, setView] = useState<"table" | "kanban">("table");
  useEffect(() => {
    try {
      const saved = window.sessionStorage.getItem("ccp-dir-view");
      if (saved === "kanban" || saved === "table") setView(saved);
    } catch {
      /* storage unavailable — table default stands */
    }
  }, []);
  const selectView = (v: "table" | "kanban") => {
    setView(v);
    try {
      window.sessionStorage.setItem("ccp-dir-view", v);
    } catch {
      /* storage unavailable — view still switches */
    }
  };

  // Deep link: ?q= is read once on mount; after the first result set
  // for that query lands, the matching record auto-opens (old-page
  // behavior). The ref is consumed exactly once so later searches the
  // user types never auto-open anything.
  const deepLinkQRef = useRef<string | null>(null);
  const deepLinkPendingRef = useRef(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const param = params.get("q");
    if (param) {
      setQ(param);
      deepLinkQRef.current = param;
      deepLinkPendingRef.current = true;
    }
    // Deep links: ?view=investors opens the Investors saved view;
    // ?action=add-investor (the Investors & Capital page's "Add
    // investor" shortcut) opens the view plus the Add form in person
    // mode (AddRecordModal is person-only by design).
    if (
      params.get("view") === "investors" ||
      params.get("action") === "add-investor"
    ) {
      setInvestorsView(true);
    }
    if (params.get("action") === "add-investor") {
      setShowAdd(true);
    }
    // ?touch=1 (legacy FAB deep link) opens QuickLog, then the param
    // is stripped so a refresh does not reopen it.
    if (params.get("touch") === "1") {
      openQuickLog();
      try {
        const url = new URL(window.location.href);
        url.searchParams.delete("touch");
        window.history.replaceState(null, "", url.toString());
      } catch { /* non-fatal */ }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Refresh the list after a QuickLog interaction is saved anywhere.
  useEffect(() => {
    const onLogged = () => setReloadTick((t) => t + 1);
    window.addEventListener("ccp:interaction-logged", onLogged);
    return () => window.removeEventListener("ccp:interaction-logged", onLogged);
  }, []);

  // Lists for the bulk "Add to list" picker — loaded lazily when a
  // selection exists.
  useEffect(() => {
    if (selectedIds.size === 0) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch("/api/platform/directory/lists");
        if (!r.ok || cancelled) return;
        const data: unknown = await r.json().catch(() => null);
        const items = data && typeof data === "object" && Array.isArray((data as { items?: unknown }).items)
          ? ((data as { items: { id: string; name: string }[] }).items)
          : Array.isArray(data) ? (data as { id: string; name: string }[]) : [];
        if (!cancelled) setLists(items);
      } catch { /* picker is optional */ }
    })();
    return () => { cancelled = true; };
  }, [selectedIds.size]);

  // Capital investors list — fetched once when the Investors view is
  // first opened (and re-fetched on refresh once loaded). Only the
  // personId membership set is kept; directory rows render as usual.
  useEffect(() => {
    if (!investorsView) return;
    if (investorIdsLoadedRef.current && investorIdsTick === 0) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch("/api/platform/capital/investors?limit=200");
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const data: unknown = await r.json().catch(() => null);
        const items =
          data && typeof data === "object" && Array.isArray((data as { items?: unknown }).items)
            ? ((data as { items: Array<{ personId?: unknown }> }).items)
            : [];
        if (cancelled) return;
        const ids = new Set<string>();
        for (const it of items) {
          if (it && typeof it.personId === "string") ids.add(it.personId);
        }
        investorIdsLoadedRef.current = true;
        setInvestorIds(ids);
      } catch {
        // Leave investorIds null so the view shows its loading state
        // and a later refresh retries; never fake an empty set.
        if (!cancelled && investorIdsLoadedRef.current) {
          /* keep the previously loaded set on a failed re-fetch */
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [investorsView, investorIdsTick]);

  // Server-side list fetch — refetch on filter/search change
  // (search debounced 250ms so typing doesn't hammer the endpoint).
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(false);
    const timer = window.setTimeout(() => {
      (async () => {
        try {
          const sortParam = sortKey === "name" ? "name" : sortKey === "lastTouch" ? "lastTouch" : sortKey === "nextDue" ? "nextDue" : "updated";
          const r = await fetch(buildListUrl({
            type: typeFilter, q, offset: 0, kind: kindFilter,
            tier: tierFilter, stage: stageFilter, owner: ownerFilter, tag: tagFilter,
            overdueOnly, lastTouchBefore, lastTouchAfter, sort: sortParam, sortDir,
          }));
          if (cancelled) return;
          if (r.status === 401) {
            router.replace("/login");
            return;
          }
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          const parsed = normalizeList(await r.json());
          if (cancelled) return;
          setItems(parsed.items);
          setTotal(parsed.total);
        } catch {
          if (!cancelled) setError(true);
        } finally {
          if (!cancelled) setLoading(false);
        }
      })();
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [typeFilter, q, reloadTick, router, kindFilter, tierFilter, stageFilter, ownerFilter, tagFilter, overdueOnly, lastTouchBefore, lastTouchAfter, sortKey, sortDir]);

  // Deep-link auto-open: exact match only — the person's name, or
  // their organization's name; never an unrelated first result.
  useEffect(() => {
    if (!deepLinkPendingRef.current || loading) return;
    if (deepLinkQRef.current === null) return;
    if (q.trim() !== deepLinkQRef.current.trim()) return;
    deepLinkPendingRef.current = false;
    if (items.length === 0) return;
    const needle = deepLinkQRef.current.trim().toLowerCase();
    const hit = items.find(
      (i) =>
        i.name.toLowerCase() === needle ||
        (i.organizationName ?? "").toLowerCase() === needle
    );
    if (hit) {
      setSelected({ kind: hit.kind, id: hit.id });
      setSelectedItem(hit);
    }
  }, [items, loading, q]);

  const loadMore = async () => {
    if (loadingMore || items.length >= total) return;
    setLoadingMore(true);
    try {
      const sortParam = sortKey === "name" ? "name" : sortKey === "lastTouch" ? "lastTouch" : sortKey === "nextDue" ? "nextDue" : "updated";
      const r = await fetch(
        buildListUrl({
          type: typeFilter, q, offset: items.length, kind: kindFilter,
          tier: tierFilter, stage: stageFilter, owner: ownerFilter, tag: tagFilter,
          overdueOnly, lastTouchBefore, lastTouchAfter, sort: sortParam, sortDir,
        })
      );
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const parsed = normalizeList(await r.json());
      setItems((prev) => {
        const seen = new Set(prev.map((i) => `${i.kind}-${i.id}`));
        const fresh = parsed.items.filter((i) => !seen.has(`${i.kind}-${i.id}`));
        return [...prev, ...fresh];
      });
      setTotal(parsed.total);
    } catch {
      /* keep what's loaded; the button stays available */
    } finally {
      setLoadingMore(false);
    }
  };

  const openRecord = (item: DirectoryItem) => {
    setSelected({ kind: item.kind, id: item.id });
    setSelectedItem(item);
  };

  const refresh = () => {
    setReloadTick((t) => t + 1);
    // A created/updated capital profile changes view membership.
    setInvestorIdsTick((t) => t + 1);
  };

  const selectSavedView = (id: string) => {
    if (id === "investors") {
      // PRESERVED (Investors & Capital Step 1): the Investors saved
      // view is a client-side capital-profile membership filter —
      // see investorIds effect above. Do not change its semantics.
      setInvestorsView(true);
      setTypeFilter("all");
      setCrmView("all");
      setOverdueOnly(false);
      setTierFilter("");
    } else if (id === "overdue") {
      setInvestorsView(false);
      setTypeFilter("all");
      setCrmView("overdue");
      setOverdueOnly(true);
    } else if (id === "atier") {
      setInvestorsView(false);
      setTypeFilter("all");
      setCrmView("atier");
      setTierFilter("A");
      setOverdueOnly(false);
    } else {
      setInvestorsView(false);
      setCrmView("all");
      setOverdueOnly(false);
      if (id !== "all" && tierFilter === "A") setTierFilter("");
      setTypeFilter(id);
    }
  };

  const typeViews = [
    { id: "all", label: "All" },
    ...DIRECTORY_TYPES.map((t) => ({ id: t.id, label: t.label })),
    { id: "investors", label: "Investors" },
    { id: "overdue", label: "Overdue" },
    { id: "atier", label: "A tier" },
  ];

  const activeViewId = investorsView
    ? "investors"
    : crmView !== "all"
      ? crmView === "overdue" ? "overdue" : "atier"
      : typeFilter;

  const onSort = (key: DirectorySortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "name" ? "asc" : "desc");
    }
  };

  const toggleSelect = (item: DirectoryItem, checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(item.id); else next.delete(item.id);
      return next;
    });
  };
  const toggleSelectAll = (checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const i of visibleItems) {
        if (checked) next.add(i.id); else next.delete(i.id);
      }
      return next;
    });
  };

  const createListForBulk = async () => {
    const name = newListName.trim();
    if (!name) return;
    try {
      const r = await fetch("/api/platform/directory/lists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data: unknown = await r.json().catch(() => null);
      const obj = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
      const rec = (obj.list ?? obj.item ?? obj) as Record<string, unknown>;
      if (typeof rec.id === "string") {
        setLists((prev) => [...prev, { id: rec.id as string, name: String(rec.name || name) }]);
        setBulkValue(rec.id as string);
        setBulkAction("add_to_list");
      }
      setNewListName("");
    } catch { setBulkMsg("Could not create that list."); }
  };

  const runBulk = async () => {
    if (bulkBusy || selectedIds.size === 0) return;
    let value: unknown = bulkValue;
    if (bulkAction === "create_task") value = { title: bulkValue, dueDate: bulkDue || undefined };
    if ((bulkAction === "assign_owner" || bulkAction === "add_tag" || bulkAction === "add_to_list") && !String(bulkValue).trim()) {
      setBulkMsg("Enter a value for the bulk action first.");
      return;
    }
    if (bulkAction === "create_task" && !bulkValue.trim()) {
      setBulkMsg("Enter a task title first.");
      return;
    }
    setBulkBusy(true);
    setBulkMsg("");
    try {
      const r = await fetch("/api/platform/directory/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: kindFilter, ids: Array.from(selectedIds), action: bulkAction, value }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      showToast(`Bulk action applied to ${selectedIds.size} record${selectedIds.size === 1 ? "" : "s"}`);
      setSelectedIds(new Set());
      refresh();
    } catch {
      setBulkMsg("Bulk action failed — please try again.");
    } finally { setBulkBusy(false); }
  };

  // Client-side membership filter for the Investors view.
  const visibleItems =
    investorsView && investorIds
      ? items.filter((i) => investorIds.has(i.id))
      : items;

  return (
    <div>
      <PageHero
        eyebrow="Canny Capital Partners"
        title="Directory"
        subtitle="Every contact we interact with — people only; their companies appear as affiliations, not separate contacts"
      />
      <div className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6">
        {/* Search + actions */}
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search people, titles, companies…"
              aria-label="Search directory"
              className={`${inputCls} min-w-0 flex-1 sm:max-w-md`}
            />
            <button
              type="button"
              onClick={() => setShowAdd(true)}
              className="btn btn-primary min-h-[44px]"
            >
              Add contact
            </button>
            <button
              type="button"
              onClick={() => setShowImport(true)}
              className="btn btn-secondary min-h-[44px]"
            >
              Import CSV
            </button>
            <button
              type="button"
              onClick={() => setShowTemplates((s) => !s)}
              className="btn btn-secondary min-h-[44px]"
              aria-pressed={showTemplates}
            >
              Email templates
            </button>
            <span className="ml-auto flex shrink-0 gap-1.5">
              <a
                href={buildExportHref("xlsx", typeFilter, q, kindFilter)}
                className="btn btn-ghost btn-sm min-h-[44px]"
              >
                Export Excel
              </a>
              <a
                href={buildExportHref("csv", typeFilter, q, kindFilter)}
                className="btn btn-ghost btn-sm min-h-[44px]"
              >
                Export CSV
              </a>
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <SavedViewChips
              views={typeViews}
              activeId={activeViewId}
              onSelect={selectSavedView}
            />
            <span className="ml-auto flex shrink-0 gap-1.5" role="group" aria-label="Directory view">
              <button
                type="button"
                onClick={() => selectView("table")}
                aria-pressed={view === "table"}
                className={`chip ${view === "table" ? "chip-active" : ""}`}
              >
                Table
              </button>
              <button
                type="button"
                onClick={() => selectView("kanban")}
                aria-pressed={view === "kanban"}
                className={`chip ${view === "kanban" ? "chip-active" : ""}`}
              >
                Kanban
              </button>
            </span>
          </div>
        </div>

        
        {/* CRM Phase 1: kind toggle + relationship filters */}
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <div className="flex gap-1.5" role="group" aria-label="Record kind">
            {(["person", "organization"] as const).map((k) => (
              <button key={k} type="button" aria-pressed={kindFilter === k}
                onClick={() => { setKindFilter(k); setSelectedIds(new Set()); }}
                className={`chip min-h-[44px] ${kindFilter === k ? "chip-active" : ""}`}>
                {k === "person" ? "People" : "Organizations"}
              </button>
            ))}
          </div>
          <label className="block">
            <span className={labelCls}>Tier</span>
            <select value={tierFilter} onChange={(e) => setTierFilter(e.target.value)} className={`${inputCls} min-h-[44px] w-28`}>
              <option value="">All</option><option value="A">A</option><option value="B">B</option><option value="C">C</option>
            </select>
          </label>
          <label className="block">
            <span className={labelCls}>Stage</span>
            <select value={stageFilter} onChange={(e) => setStageFilter(e.target.value)} className={`${inputCls} min-h-[44px] w-32`}>
              <option value="">All</option>
              {["New", "Engaged", "Active", "Dormant"].map((st) => <option key={st} value={st}>{st}</option>)}
            </select>
          </label>
          <label className="block">
            <span className={labelCls}>Owner</span>
            <input value={ownerFilter} onChange={(e) => setOwnerFilter(e.target.value)} placeholder="Owner" className={`${inputCls} min-h-[44px] w-32`} />
          </label>
          <label className="block">
            <span className={labelCls}>Tag</span>
            <input value={tagFilter} onChange={(e) => setTagFilter(e.target.value)} placeholder="Tag" className={`${inputCls} min-h-[44px] w-32`} />
          </label>
          <label className="block">
            <span className={labelCls}>Last touch after</span>
            <input type="date" value={lastTouchAfter} onChange={(e) => setLastTouchAfter(e.target.value)} className={`${inputCls} min-h-[44px] w-40`} />
          </label>
          <label className="block">
            <span className={labelCls}>Last touch before</span>
            <input type="date" value={lastTouchBefore} onChange={(e) => setLastTouchBefore(e.target.value)} className={`${inputCls} min-h-[44px] w-40`} />
          </label>
          <label className="flex min-h-[44px] items-center gap-2 text-sm text-[#0d1f3c] dark:text-white">
            <input type="checkbox" checked={overdueOnly} onChange={(e) => setOverdueOnly(e.target.checked)} className="h-4 w-4 accent-[#b8975a]" />
            Overdue only
          </label>
        </div>

        {showTemplates && (
          <div className="mt-5">
            <DirectoryTemplates
              selectedRecord={selectedItem}
              onClose={() => setShowTemplates(false)}
            />
          </div>
        )}

        {/* Results */}
        <div className="mt-6">
          {loading ? (
            <div
              className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
              aria-busy="true"
            >
              {Array.from({ length: 8 }).map((_, i) => (
                <CardSkeleton key={i} lines={3} />
              ))}
              <span className="sr-only">Loading directory…</span>
            </div>
          ) : error ? (
            <ErrorState
              title="Could not load the directory"
              message="Directory records could not be loaded — the database may be unavailable. Try again in a moment."
              onRetry={refresh}
            />
          ) : investorsView && investorIds === null ? (
            <div
              className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
              aria-busy="true"
            >
              {Array.from({ length: 8 }).map((_, i) => (
                <CardSkeleton key={i} lines={3} />
              ))}
              <span className="sr-only">Loading investors…</span>
            </div>
          ) : visibleItems.length === 0 ? (
            investorsView && investorIds !== null && investorIds.size === 0 ? (
              <EmptyState
                title="No investors yet"
                message="No investors yet — add one from any record's Capital profile tab."
                actionLabel="Add contact"
                onAction={() => setShowAdd(true)}
              />
            ) : investorsView ? (
              <EmptyState
                title="No investors in view"
                message="None of the loaded contacts has a capital profile matching this view yet. Search for the investor by name, load more contacts, or add a capital profile from any record's Capital profile tab."
                actionLabel="Add contact"
                onAction={() => setShowAdd(true)}
              />
            ) : (
              <EmptyState
                title="No records match"
                message={
                  q.trim() || typeFilter !== "all"
                    ? "Nothing here matches that search and filter combination. Try clearing the search, or add the contact yourself."
                    : "No contacts yet. Add the first person, or import a CSV of people."
                }
                actionLabel="Add contact"
                onAction={() => setShowAdd(true)}
              />
            )
          ) : (
            <>
              <p className="mb-3 text-xs text-slate-400 dark:text-white/40">
                {investorsView ? (
                  <>
                    Showing {visibleItems.length} investor
                    {visibleItems.length === 1 ? "" : "s"} with a capital
                    profile
                    {investorIds
                      ? ` (${investorIds.size} total)`
                      : ""}
                    {items.length < total
                      ? ` · from ${items.length} of ${total} loaded contacts`
                      : ""}
                    {q.trim() ? ` for “${q.trim()}”` : ""}
                  </>
                ) : (
                  <>
                    Showing {items.length} of {total} contact{total === 1 ? "" : "s"}
                    {q.trim() ? ` for “${q.trim()}”` : ""}
                  </>
                )}
              </p>
              {view === "table" ? (
                <DirectoryTable
                  items={visibleItems}
                  selectedId={selected ? selected.id : null}
                  onSelect={openRecord}
                  selectedIds={selectedIds}
                  onToggleSelect={toggleSelect}
                  onToggleAll={toggleSelectAll}
                  sortKey={sortKey}
                  sortDir={sortDir}
                  onSort={onSort}
                />
              ) : (
                <DirectoryGrid
                  items={visibleItems}
                  selectedId={selected ? selected.id : null}
                  onSelect={openRecord}
                />
              )}
              {items.length < total && (
                <div className="mt-6 text-center">
                  <button
                    type="button"
                    disabled={loadingMore}
                    onClick={() => void loadMore()}
                    className="btn btn-secondary min-h-[44px]"
                  >
                    {loadingMore
                      ? "Loading…"
                      : `Load more (${total - items.length} remaining)`}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>


      {selectedIds.size > 0 && (
        <div className="mt-4">
          <BulkActionBar count={selectedIds.size}>
            <select aria-label="Bulk action" value={bulkAction} onChange={(e) => setBulkAction(e.target.value)} className="min-h-[44px] rounded-xl bg-white/10 px-2 text-sm text-white">
              <option value="assign_owner">Assign owner</option>
              <option value="add_tag">Add tag</option>
              <option value="set_tier">Set tier</option>
              <option value="add_to_list">Add to list</option>
              <option value="create_task">Create task</option>
            </select>
            {bulkAction === "set_tier" ? (
              <select aria-label="Tier" value={bulkValue} onChange={(e) => setBulkValue(e.target.value)} className="min-h-[44px] rounded-xl bg-white/10 px-2 text-sm text-white">
                <option value="">Tier…</option><option value="A">A</option><option value="B">B</option><option value="C">C</option>
              </select>
            ) : bulkAction === "add_to_list" ? (
              <>
                <select aria-label="List" value={bulkValue} onChange={(e) => setBulkValue(e.target.value)} className="min-h-[44px] rounded-xl bg-white/10 px-2 text-sm text-white">
                  <option value="">Choose list…</option>
                  {lists.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                </select>
                <input value={newListName} onChange={(e) => setNewListName(e.target.value)} placeholder="New list name" className="min-h-[44px] w-36 rounded-xl bg-white/10 px-2 text-sm text-white placeholder:text-white/50" />
                <button type="button" onClick={() => void createListForBulk()} className="btn btn-secondary btn-sm min-h-[44px]">Create list</button>
              </>
            ) : (
              <input value={bulkValue} onChange={(e) => setBulkValue(e.target.value)} placeholder={bulkAction === "create_task" ? "Task title" : bulkAction === "add_tag" ? "Tag" : "Owner"} className="min-h-[44px] w-40 rounded-xl bg-white/10 px-2 text-sm text-white placeholder:text-white/50" />
            )}
            {bulkAction === "create_task" && (
              <input type="date" aria-label="Task due date" value={bulkDue} onChange={(e) => setBulkDue(e.target.value)} className="min-h-[44px] rounded-xl bg-white/10 px-2 text-sm text-white" />
            )}
            <button type="button" disabled={bulkBusy} onClick={() => void runBulk()} className="btn btn-primary btn-sm min-h-[44px]">{bulkBusy ? "Applying…" : "Apply"}</button>
            <button type="button" onClick={() => setSelectedIds(new Set())} className="btn btn-ghost btn-sm min-h-[44px] text-white">Clear</button>
          </BulkActionBar>
          {bulkMsg && <p className="mt-2 text-center text-xs text-red-600 dark:text-red-300">{bulkMsg}</p>}
        </div>
      )}

      {selected && (
        <DirectoryDetail
          kind={selected.kind}
          id={selected.id}
          onClose={() => setSelected(null)}
          onChanged={refresh}
        />
      )}
      {showAdd && (
        <AddRecordModal
          onClose={() => setShowAdd(false)}
          onCreated={(created) => {
            setShowAdd(false);
            refresh();
            if (created) openRecord(created);
          }}
        />
      )}
      {showImport && (
        <DirectoryImport
          defaultKind="person"
          onClose={() => setShowImport(false)}
          onImported={refresh}
        />
      )}
    </div>
  );
}

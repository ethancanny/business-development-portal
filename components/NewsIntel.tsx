"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import SectorChip from "@/components/SectorChip";
import { fmtDate, fmtRelTime, uniqueStrings } from "@/lib/format";
import { sectorColor, sectorIcon } from "@/lib/sector-colors";
import type { MiNewsItem, MiNewsMatch } from "@/lib/types";

/**
 * News & Intelligence (overhaul, Oct 17, 2026). Stories arrive from
 * GET /api/market/news, already gated server-side: hard-excluded
 * categories and link-less stories never return, and the main feed
 * enforces the relevance threshold (lib/news-classify.ts). The layout
 * is horizontal carousels — "Top Market Events" (acquisition/investment
 * signals ranked by the relevance model) and "Latest Articles" (most
 * recent first) — each with scroll-snap, arrow buttons, wheel/drag
 * scrolling, a position indicator, and lazy loading at the end of the
 * row. Clicking any card opens the detail panel: full headline, why it
 * matters, the original-article link, Save, "Wrong sector?" correction
 * (which teaches the classifier), and "Not relevant" (which teaches
 * the scorer). Summaries are agent-written in our own words; publisher
 * preview images are credited inline (licensing rule).
 */

const SECTOR_PILLS: { label: string; value: string }[] = [
  { label: "All sectors", value: "all" },
  { label: "A&D", value: "Aerospace & Defense" },
  { label: "Healthcare", value: "Healthcare" },
  { label: "Adv Mfg", value: "Advanced Manufacturing" },
  { label: "Trades", value: "Specialty Trades & Construction" },
  { label: "Hospitality", value: "Hospitality" },
];

const SECTOR_OPTIONS = [
  "Aerospace & Defense",
  "Healthcare",
  "Advanced Manufacturing",
  "Specialty Trades & Construction",
  "Hospitality",
  "Other",
];

const WINDOWS: { label: string; days: number }[] = [
  { label: "7d", days: 7 },
  { label: "30d", days: 30 },
  { label: "90d", days: 90 },
];

const PAGE = 12;

const MATCH_LABELS: Record<MiNewsMatch["type"], string> = {
  company: "Company",
  deal: "Pipeline",
  operator: "Operator",
  investor: "Investor",
  watchlist: "Watchlist",
  hospitality: "Tracked group",
};

const pillCls = (active: boolean) =>
  `rounded-lg px-3 py-1.5 text-sm font-medium transition ${
    active
      ? "font-semibold text-[#0d1f3c] ring-1 ring-inset ring-[#b8975a] dark:text-[#e8cf9a]"
      : "text-slate-600 hover:bg-[#f0f4fa] dark:text-white/60 dark:hover:bg-white/5"
  }`;

const smallBtn =
  "rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-600 transition hover:border-[#b8975a]/60 hover:text-[#0d1f3c] dark:border-white/15 dark:text-white/70 dark:hover:text-white";

interface RowState {
  items: MiNewsItem[];
  hasMore: boolean;
  loadingMore: boolean;
}

const emptyRow = (): RowState => ({ items: [], hasMore: false, loadingMore: false });

/** One horizontal carousel row: scroll-snap cards (~3 across on
 * desktop, ~1.2 on mobile so the next card peeks), arrow buttons, a
 * "k of n" position indicator, wheel-to-horizontal scrolling, mouse
 * drag with click suppression, and lazy loading near the end.
 * Defined at module level so its scroll state survives parent
 * re-renders. */
function Carousel({
  title,
  row,
  onLoadMore,
  renderItem,
}: {
  title: string;
  row: RowState;
  onLoadMore: () => void;
  renderItem: (item: MiNewsItem) => React.ReactNode;
}) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState(1);
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(false);
  const drag = useRef<{ down: boolean; startX: number; startScroll: number; moved: number }>({
    down: false,
    startX: 0,
    startScroll: 0,
    moved: 0,
  });

  const stepPx = useCallback(() => {
    const el = scrollerRef.current;
    if (!el || !el.firstElementChild) return 320;
    const child = el.firstElementChild as HTMLElement;
    return child.offsetWidth + 12;
  }, []);

  const syncPos = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const step = stepPx();
    const idx = Math.min(row.items.length, Math.max(1, Math.round(el.scrollLeft / step) + 1));
    setPos(idx);
    setCanLeft(el.scrollLeft > 4);
    setCanRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
    if (row.hasMore && !row.loadingMore && el.scrollLeft + el.clientWidth > el.scrollWidth - 500) {
      onLoadMore();
    }
  }, [row.hasMore, row.loadingMore, row.items.length, onLoadMore, stepPx]);

  useEffect(() => {
    syncPos();
  }, [syncPos, row.items.length]);

  // Mouse-wheel / trackpad: vertical wheel scrolls the row sideways
  // until the row's end, then the page takes over again.
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      const max = el.scrollWidth - el.clientWidth;
      if (max <= 0) return;
      const next = el.scrollLeft + e.deltaY;
      if (next < 0 || next > max) return;
      e.preventDefault();
      el.scrollLeft = next;
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const scrollByStep = (dir: 1 | -1) => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollBy({ left: dir * stepPx(), behavior: "smooth" });
  };

  if (row.items.length === 0) return null;
  return (
    <div className="mb-5">
      <div className="mb-2 flex items-center gap-2">
        <h3 className="text-sm font-bold uppercase tracking-wider text-[#0d1f3c] dark:text-white">
          {title}
        </h3>
        <span className="text-xs text-slate-400 dark:text-white/40" aria-live="polite">
          {pos} of {row.items.length}
          {row.hasMore ? "+" : ""}
        </span>
        <span className="ml-auto hidden gap-1.5 sm:inline-flex">
          <button
            onClick={() => scrollByStep(-1)}
            disabled={!canLeft}
            aria-label={`Scroll ${title} left`}
            className="rounded-lg border border-slate-200 px-2.5 py-1 text-sm text-slate-600 transition enabled:hover:border-[#b8975a]/60 disabled:opacity-40 dark:border-white/15 dark:text-white/70"
          >
            ‹
          </button>
          <button
            onClick={() => scrollByStep(1)}
            disabled={!canRight && !row.hasMore}
            aria-label={`Scroll ${title} right`}
            className="rounded-lg border border-slate-200 px-2.5 py-1 text-sm text-slate-600 transition enabled:hover:border-[#b8975a]/60 disabled:opacity-40 dark:border-white/15 dark:text-white/70"
          >
            ›
          </button>
        </span>
      </div>
      <div
        ref={scrollerRef}
        onScroll={syncPos}
        onPointerDown={(e) => {
          if (e.pointerType !== "mouse") return;
          drag.current = {
            down: true,
            startX: e.clientX,
            startScroll: scrollerRef.current?.scrollLeft ?? 0,
            moved: 0,
          };
        }}
        onPointerMove={(e) => {
          if (!drag.current.down || !scrollerRef.current) return;
          const dx = e.clientX - drag.current.startX;
          drag.current.moved = Math.max(drag.current.moved, Math.abs(dx));
          scrollerRef.current.scrollLeft = drag.current.startScroll - dx;
        }}
        onPointerUp={() => {
          drag.current.down = false;
        }}
        onPointerLeave={() => {
          drag.current.down = false;
        }}
        onClickCapture={(e) => {
          // A drag must not turn into a card click on release.
          if (drag.current.moved > 6) {
            e.stopPropagation();
            e.preventDefault();
            drag.current.moved = 0;
          }
        }}
        className="flex snap-x snap-mandatory gap-3 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {row.items.map((item) => (
          <div
            key={item.id}
            className="w-[80%] shrink-0 snap-start sm:w-[calc((100%-0.75rem)/2)] lg:w-[calc((100%-1.5rem)/3)]"
          >
            {renderItem(item)}
          </div>
        ))}
        {row.loadingMore && (
          <div className="flex w-24 shrink-0 snap-start items-center justify-center text-xs text-slate-400">
            Loading…
          </div>
        )}
      </div>
    </div>
  );
}

export default function NewsIntel() {
  const [topRow, setTopRow] = useState<RowState>(emptyRow());
  const [latestRow, setLatestRow] = useState<RowState>(emptyRow());
  const [savedRow, setSavedRow] = useState<RowState>(emptyRow());
  const [lastFetchedAt, setLastFetchedAt] = useState<string | null>(null);
  const [recentCount, setRecentCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [sector, setSector] = useState("all");
  const [days, setDays] = useState(7);
  const [savedOnly, setSavedOnly] = useState(false);
  const [terms, setTerms] = useState<string[]>([]);
  const [newTerm, setNewTerm] = useState("");
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [imgFailed, setImgFailed] = useState<Record<string, boolean>>({});
  const [linkChoice, setLinkChoice] = useState<Record<string, string>>({});
  const [linkError, setLinkError] = useState<Record<string, string>>({});
  const [panelId, setPanelId] = useState<string | null>(null);
  const [sectorPick, setSectorPick] = useState<string>("");
  const [sectorNote, setSectorNote] = useState("");
  const loadingRef = useRef(false);

  const allItems = useCallback((): MiNewsItem[] => {
    const seen = new Map<string, MiNewsItem>();
    for (const it of [...topRow.items, ...latestRow.items, ...savedRow.items]) {
      if (!seen.has(it.id)) seen.set(it.id, it);
    }
    return Array.from(seen.values());
  }, [topRow, latestRow, savedRow]);

  const panelItem = panelId ? allItems().find((i) => i.id === panelId) ?? null : null;

  const patchItem = useCallback((id: string, patch: Partial<MiNewsItem>) => {
    const map = (row: RowState): RowState => ({
      ...row,
      items: row.items.map((i) => (i.id === id ? { ...i, ...patch } : i)),
    });
    setTopRow(map);
    setLatestRow(map);
    setSavedRow(map);
  }, []);

  const dropItem = useCallback((id: string) => {
    const map = (row: RowState): RowState => ({
      ...row,
      items: row.items.filter((i) => i.id !== id),
    });
    setTopRow(map);
    setLatestRow(map);
    setSavedRow(map);
  }, []);

  const baseParams = useCallback(() => {
    const parts = [`days=${days}`];
    if (sector !== "all") parts.push(`sector=${encodeURIComponent(sector)}`);
    return parts;
  }, [sector, days]);

  const fetchPage = useCallback(
    async (extra: string[], offset: number): Promise<MiNewsItem[]> => {
      const parts = [...baseParams(), ...extra, `limit=${PAGE}`, `offset=${offset}`];
      const r = await fetch(`/api/market/news?${parts.join("&")}`);
      if (!r.ok) return [];
      const data = (await r.json()) as { items?: MiNewsItem[]; lastFetchedAt?: string | null };
      if (data.lastFetchedAt !== undefined && data.lastFetchedAt) setLastFetchedAt(data.lastFetchedAt);
      return Array.isArray(data.items) ? data.items : [];
    },
    [baseParams]
  );

  const load = useCallback(async () => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    try {
      if (savedOnly) {
        const items = await fetchPage(["saved=1", "sort=relevance"], 0);
        setSavedRow({ items, hasMore: items.length === PAGE, loadingMore: false });
      } else {
        const [dealItems, latest] = await Promise.all([
          fetchPage(["deal=1", "sort=relevance"], 0),
          fetchPage(["sort=recent"], 0),
        ]);
        let topItems = dealItems;
        let topHasMore = dealItems.length === PAGE;
        if (dealItems.length < 3) {
          // Thin deal window: backfill once from top relevance overall
          // so the row never opens nearly empty (no paging in this mode).
          const fill = await fetchPage(["sort=relevance"], 0);
          const seenIds = new Set(topItems.map((i) => i.id));
          topItems = [...topItems, ...fill.filter((i) => !seenIds.has(i.id))].slice(0, PAGE);
          topHasMore = false;
        }
        setTopRow({ items: topItems, hasMore: topHasMore, loadingMore: false });
        setLatestRow({ items: latest, hasMore: latest.length === PAGE, loadingMore: false });
        const badgeRes = await fetch("/api/market/news?days=1&limit=200");
        if (badgeRes.ok) {
          const badge = (await badgeRes.json()) as { items?: MiNewsItem[] };
          setRecentCount(Array.isArray(badge.items) ? badge.items.length : 0);
        }
      }
    } catch {
      /* keep whatever is on screen — a failed refresh is invisible */
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }, [fetchPage, savedOnly]);

  const loadMore = useCallback(
    async (which: "top" | "latest" | "saved") => {
      const row = which === "top" ? topRow : which === "latest" ? latestRow : savedRow;
      if (!row.hasMore || row.loadingMore) return;
      const setRow = which === "top" ? setTopRow : which === "latest" ? setLatestRow : setSavedRow;
      setRow((r) => ({ ...r, loadingMore: true }));
      try {
        const extra =
          which === "top"
            ? ["deal=1", "sort=relevance"]
            : which === "latest"
              ? ["sort=recent"]
              : ["saved=1", "sort=relevance"];
        const more = await fetchPage(extra, row.items.length);
        setRow((r) => {
          const seenIds = new Set(r.items.map((i) => i.id));
          return {
            items: [...r.items, ...more.filter((i) => !seenIds.has(i.id))],
            hasMore: more.length === PAGE,
            loadingMore: false,
          };
        });
      } catch {
        setRow((r) => ({ ...r, loadingMore: false }));
      }
    },
    [fetchPage, topRow, latestRow, savedRow]
  );

  const loadTerms = useCallback(async () => {
    try {
      const r = await fetch("/api/market/news/watchlist");
      if (!r.ok) return;
      const data = (await r.json()) as { terms?: string[] };
      if (Array.isArray(data.terms)) setTerms(data.terms);
    } catch {
      /* watchlist is an enhancement, never a blocker */
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    loadTerms();
  }, [loadTerms]);
  // Phase 10 transfer audit fix: the 5-minute interval reload + focus
  // reload violated PROJECT_RULES' frontend rule (fetch on open +
  // pull-to-refresh only). News data updates on the twice-daily ingest
  // cadence, so a client poll can never find fresher data anyway.

  // Detail panel: Escape closes.
  useEffect(() => {
    if (!panelId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPanelId(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [panelId]);

  /* ---------------- actions ---------------- */

  const postAction = async (
    id: string,
    action: "save" | "unsave" | "dismiss" | "link" | "sector" | "not-relevant",
    extra?: { companyId?: string; sector?: string }
  ): Promise<{ ok: boolean; error?: string }> => {
    try {
      const r = await fetch("/api/market/news/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action, ...(extra ?? {}) }),
      });
      const data = (await r.json().catch(() => ({}))) as { error?: string };
      return { ok: r.ok, error: data.error };
    } catch {
      return { ok: false, error: "Network error" };
    }
  };

  const setItemBusy = (id: string, on: boolean) =>
    setBusy((b) => ({ ...b, [id]: on }));

  const toggleSave = async (item: MiNewsItem) => {
    if (busy[item.id]) return;
    setItemBusy(item.id, true);
    const next = !item.saved;
    if (savedOnly && !next) dropItem(item.id);
    else patchItem(item.id, { saved: next });
    const res = await postAction(item.id, next ? "save" : "unsave");
    if (!res.ok) load();
    setItemBusy(item.id, false);
  };

  const dismiss = async (item: MiNewsItem) => {
    if (busy[item.id]) return;
    setItemBusy(item.id, true);
    dropItem(item.id);
    if (panelId === item.id) setPanelId(null);
    const res = await postAction(item.id, "dismiss");
    if (!res.ok) load();
    setItemBusy(item.id, false);
  };

  const notRelevant = async (item: MiNewsItem) => {
    if (busy[item.id]) return;
    setItemBusy(item.id, true);
    dropItem(item.id);
    if (panelId === item.id) setPanelId(null);
    const res = await postAction(item.id, "not-relevant");
    if (!res.ok) load();
    setItemBusy(item.id, false);
  };

  const applySectorCorrection = async (item: MiNewsItem) => {
    const target = sectorPick || item.sector || "Other";
    if (busy[item.id] || target === item.sector) return;
    setItemBusy(item.id, true);
    setSectorNote("");
    const res = await postAction(item.id, "sector", { sector: target });
    if (res.ok) {
      patchItem(item.id, { sector: target, sectorConfidence: 1 });
      setSectorNote("Saved. Your corrections teach the classifier — stories with the same names and terms will lean this way.");
    } else {
      setSectorNote("Couldn't save that correction. Try again in a moment.");
    }
    setItemBusy(item.id, false);
  };

  const linkToCompany = async (item: MiNewsItem, companyId: string) => {
    if (busy[item.id] || !companyId) return;
    setItemBusy(item.id, true);
    setLinkError((e) => ({ ...e, [item.id]: "" }));
    const res = await postAction(item.id, "link", { companyId });
    if (res.ok) {
      patchItem(item.id, { linkedCompanyId: companyId });
    } else {
      setLinkError((e) => ({
        ...e,
        [item.id]: /not found/i.test(res.error ?? "")
          ? "That name isn't a company record yet — nothing to link to."
          : "Couldn't link that story. Try again in a moment.",
      }));
    }
    setItemBusy(item.id, false);
  };

  const openPanel = (item: MiNewsItem) => {
    setSectorPick(item.sector ?? "Other");
    setSectorNote("");
    setPanelId(item.id);
  };

  /* ---------------- watchlist ---------------- */

  const addTerm = async () => {
    const term = newTerm.trim();
    if (term.length < 3) return;
    setNewTerm("");
    try {
      const r = await fetch("/api/market/news/watchlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ term }),
      });
      if (r.ok) {
        const data = (await r.json()) as { terms?: string[] };
        if (Array.isArray(data.terms)) setTerms(data.terms);
      } else {
        loadTerms();
      }
    } catch {
      loadTerms();
    }
    load();
  };

  const removeTerm = async (term: string) => {
    setTerms((cur) => cur.filter((t) => t !== term));
    try {
      const r = await fetch("/api/market/news/watchlist", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ term }),
      });
      if (r.ok) {
        const data = (await r.json()) as { terms?: string[] };
        if (Array.isArray(data.terms)) setTerms(data.terms);
      } else {
        loadTerms();
      }
    } catch {
      loadTerms();
    }
    load();
  };

  /* ---------------- card + carousel ---------------- */

  const renderLinkControl = (item: MiNewsItem) => {
    if (item.linkedCompanyId) {
      return (
        <span className="rounded-lg bg-[#b8975a]/15 px-2.5 py-1.5 text-xs font-semibold text-[#8a6f3c] dark:text-[#d4b37a]">
          Linked ✓
        </span>
      );
    }
    const companies: MiNewsMatch[] = [];
    item.matched.forEach((m) => {
      // Tracked hospitality groups carry their mirrored company's id —
      // they are linkable companies too.
      if ((m.type === "company" || m.type === "hospitality") && !companies.some((c) => c.id === m.id)) companies.push(m);
    });
    if (companies.length === 0) return null;
    if (companies.length === 1) {
      return (
        <button
          onClick={() => linkToCompany(item, companies[0].id)}
          disabled={!!busy[item.id]}
          className={`${smallBtn} disabled:opacity-60`}
          title={`Append this story as a signal on ${companies[0].name}`}
        >
          {busy[item.id] ? "Linking…" : `Link to ${companies[0].name}`}
        </button>
      );
    }
    const choice = linkChoice[item.id] || companies[0].id;
    return (
      <span className="inline-flex items-center gap-1.5">
        <select
          value={choice}
          onChange={(e) => setLinkChoice((c) => ({ ...c, [item.id]: e.target.value }))}
          className="max-w-[150px] rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-700 dark:border-white/15 dark:bg-[#12294d] dark:text-white/80"
          aria-label="Choose the company to link this story to"
        >
          {companies.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <button
          onClick={() => linkToCompany(item, choice)}
          disabled={!!busy[item.id]}
          className={`${smallBtn} disabled:opacity-60`}
        >
          {busy[item.id] ? "Linking…" : "Link"}
        </button>
      </span>
    );
  };

  const renderBadges = (item: MiNewsItem) => (
    <div className="flex flex-wrap items-center gap-1.5">
      <SectorChip sector={item.sector ?? "Other"} />
      {item.matched.some((m) => m.type === "watchlist") && (
        <span className="rounded-full bg-[#b8975a]/15 px-2 py-0.5 text-[11px] font-semibold text-[#8a6f3c] ring-1 ring-inset ring-[#b8975a]/50 dark:text-[#d4b37a]">
          Watchlist
        </span>
      )}
      {item.matched.some((m) => m.type === "hospitality") && (
        <span className="rounded-full bg-[#7A4E7E]/10 px-2 py-0.5 text-[11px] font-semibold text-[#7A4E7E] ring-1 ring-inset ring-[#7A4E7E]/40 dark:text-[#c9a3cf]">
          Tracked group
        </span>
      )}
    </div>
  );

  const renderCard = (item: MiNewsItem) => (
    <article
      key={item.id}
      onClick={() => openPanel(item)}
      className="card-surface flex h-full cursor-pointer flex-col p-4 transition hover:ring-1 hover:ring-[#b8975a]/50"
      aria-label={item.headline}
    >
      {renderBadges(item)}
      <h3 className="mt-2 line-clamp-3 text-[15px] font-bold leading-snug text-[#0d1f3c] dark:text-white">
        {item.headline}
      </h3>
      <p className="mt-1 text-xs text-slate-500 dark:text-white/50">
        {item.sourceName}
        {item.publishedAt ? ` · ${fmtRelTime(item.publishedAt)}` : ""}
        {item.url ? " · ↗" : ""}
      </p>
      {item.summary && (
        <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-slate-600 dark:text-white/70">
          {item.summary}
        </p>
      )}
      <div className="mt-auto flex flex-wrap items-center gap-x-2 gap-y-1 pt-3">
        <button
          onClick={(e) => {
            e.stopPropagation();
            toggleSave(item);
          }}
          disabled={!!busy[item.id]}
          aria-pressed={item.saved}
          className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold transition disabled:opacity-60 ${
            item.saved
              ? "bg-[#b8975a] text-white hover:bg-[#a8874f]"
              : "border border-slate-200 text-slate-500 hover:border-[#b8975a]/60 dark:border-white/15 dark:text-white/60"
          }`}
        >
          {item.saved ? "★ Saved" : "☆ Save"}
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            notRelevant(item);
          }}
          disabled={!!busy[item.id]}
          className="px-1.5 py-1.5 text-xs font-medium text-slate-400 transition hover:text-slate-600 disabled:opacity-60 dark:text-white/40 dark:hover:text-white/70"
          title="Hide this story and teach the scorer that stories like it are not relevant"
        >
          Not relevant
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            openPanel(item);
          }}
          className="ml-auto px-1.5 py-1.5 text-xs font-medium text-slate-400 underline-offset-2 transition hover:text-slate-600 hover:underline dark:text-white/40 dark:hover:text-white/70"
          title="Correct this story's sector"
        >
          Wrong sector?
        </button>
      </div>
    </article>
  );

  /* ---------------- detail panel ---------------- */

  const renderPanel = () => {
    if (!panelItem) return null;
    const item = panelItem;
    const color = sectorColor(item.sector ?? "");
    const coveredBy = uniqueStrings(item.alsoCoveredBy).filter((s) => s !== item.sourceName);
    const showImage = !!item.imageUrl && !imgFailed[item.id];
    return (
      <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label={item.headline}>
        <button
          aria-label="Close detail panel"
          onClick={() => setPanelId(null)}
          className="absolute inset-0 h-full w-full cursor-default bg-[#0d1f3c]/50"
        />
        <aside className="absolute inset-y-0 right-0 flex w-full max-w-md flex-col overflow-y-auto bg-white shadow-2xl dark:bg-[#0d1f3c]">
          {showImage ? (
            <div className="img-grade shrink-0">
              {/* Publisher link-preview image; credited on the line below. */}
              <img
                src={item.imageUrl ?? ""}
                alt=""
                loading="lazy"
                className="h-48 w-full object-cover"
                onError={() => setImgFailed((f) => ({ ...f, [item.id]: true }))}
              />
            </div>
          ) : (
            <div
              className="img-grade flex h-28 shrink-0 items-center justify-center"
              style={{ background: `linear-gradient(135deg, ${color} 0%, #0d1f3c 130%)` }}
            >
              <span className="text-5xl text-white/85" aria-hidden>
                {sectorIcon(item.sector ?? "")}
              </span>
            </div>
          )}
          <div className="flex flex-1 flex-col p-5">
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">{renderBadges(item)}</div>
              <button
                onClick={() => setPanelId(null)}
                aria-label="Close"
                className="rounded-lg px-2 py-1 text-lg leading-none text-slate-400 transition hover:text-slate-700 dark:text-white/50 dark:hover:text-white"
              >
                ×
              </button>
            </div>
            {showImage && (
              <p className="mt-1.5 text-[10px] text-slate-400 dark:text-white/35">
                {item.imageCredit || `Preview image · ${item.sourceName}`}
              </p>
            )}
            <h3 className="mt-2 text-lg font-bold leading-snug text-[#0d1f3c] dark:text-white">
              {item.headline}
            </h3>
            <p className="mt-1 text-xs text-slate-500 dark:text-white/50">
              {item.sourceName}
              {item.publishedAt ? ` · ${fmtDate(item.publishedAt)} · ${fmtRelTime(item.publishedAt)}` : ""}
            </p>
            {item.relevanceReason && (
              <div className="mt-3 rounded-lg bg-[#b8975a]/10 px-3 py-2 ring-1 ring-inset ring-[#b8975a]/30">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-[#8a6f3c] dark:text-[#d4b37a]">
                  Why it matters
                </p>
                <p className="mt-0.5 text-sm text-slate-700 dark:text-white/80">
                  {item.relevanceReason}
                  <span className="text-slate-400 dark:text-white/40"> · relevance {item.relevanceScore}</span>
                </p>
              </div>
            )}
            {item.summary && (
              <p className="mt-3 text-sm leading-relaxed text-slate-600 dark:text-white/75">
                {item.summary}
              </p>
            )}
            {coveredBy.length > 0 && (
              <p className="mt-2 text-[11px] text-slate-400 dark:text-white/40">
                Also covered by {coveredBy.join(", ")}
              </p>
            )}
            {item.matched.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {item.matched.map((m, i) => (
                  <span
                    key={`${m.type}-${m.id}-${i}`}
                    className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                      m.type === "watchlist"
                        ? "bg-[#b8975a]/15 text-[#8a6f3c] ring-1 ring-inset ring-[#b8975a]/50 dark:text-[#d4b37a]"
                        : m.type === "hospitality"
                          ? "bg-[#7A4E7E]/10 text-[#7A4E7E] ring-1 ring-inset ring-[#7A4E7E]/40 dark:text-[#c9a3cf]"
                          : "bg-slate-500/10 text-slate-600 ring-1 ring-inset ring-slate-500/20 dark:text-white/60"
                    }`}
                  >
                    {m.name}
                    <span className="opacity-60">{MATCH_LABELS[m.type] ?? m.type}</span>
                  </span>
                ))}
              </div>
            )}
            {item.url && (
              <a
                href={item.url}
                target="_blank"
                rel="noreferrer"
                className="mt-4 block rounded-lg bg-[#b8975a] px-4 py-2.5 text-center text-sm font-semibold text-white transition hover:bg-[#a8874f]"
              >
                Read original article ↗
              </a>
            )}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                onClick={() => toggleSave(item)}
                disabled={!!busy[item.id]}
                aria-pressed={item.saved}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition disabled:opacity-60 ${
                  item.saved
                    ? "bg-[#b8975a] text-white hover:bg-[#a8874f]"
                    : "border border-slate-200 text-slate-500 hover:border-[#b8975a]/60 dark:border-white/15 dark:text-white/60"
                }`}
              >
                {item.saved ? "★ Saved" : "☆ Save"}
              </button>
              {renderLinkControl(item)}
              <button
                onClick={() => notRelevant(item)}
                disabled={!!busy[item.id]}
                className="px-1.5 py-1.5 text-xs font-medium text-slate-400 transition hover:text-slate-600 disabled:opacity-60 dark:text-white/40 dark:hover:text-white/70"
              >
                Not relevant
              </button>
              <button
                onClick={() => dismiss(item)}
                disabled={!!busy[item.id]}
                className="ml-auto px-1.5 py-1.5 text-xs font-medium text-slate-400 transition hover:text-slate-600 disabled:opacity-60 dark:text-white/40 dark:hover:text-white/70"
              >
                Dismiss
              </button>
            </div>
            {linkError[item.id] && (
              <p className="mt-2 text-[11px] text-rose-500 dark:text-rose-400">{linkError[item.id]}</p>
            )}
            <div className="mt-5 border-t border-slate-100 pt-4 dark:border-white/10">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-white/40">
                Wrong sector?
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <select
                  value={sectorPick || item.sector || "Other"}
                  onChange={(e) => setSectorPick(e.target.value)}
                  className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-700 dark:border-white/15 dark:bg-[#12294d] dark:text-white/85"
                  aria-label="Correct sector for this story"
                >
                  {SECTOR_OPTIONS.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
                <button
                  onClick={() => applySectorCorrection(item)}
                  disabled={!!busy[item.id] || (sectorPick || item.sector) === item.sector}
                  className={`${smallBtn} disabled:opacity-50`}
                >
                  {busy[item.id] ? "Saving…" : "Apply correction"}
                </button>
              </div>
              {sectorNote && (
                <p className="mt-2 text-[11px] text-slate-500 dark:text-white/55">{sectorNote}</p>
              )}
            </div>
          </div>
        </aside>
      </div>
    );
  };

  /* ---------------- main render ---------------- */

  const anyRows =
    topRow.items.length + latestRow.items.length + savedRow.items.length > 0;

  return (
    <section className="mb-6" aria-label="News and intelligence">
      <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2">
        <h2 className="text-xl font-bold text-[#0d1f3c] dark:text-white">News &amp; Intelligence</h2>
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 dark:text-white/50">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
          </span>
          Live
          {lastFetchedAt ? ` · Updated ${fmtRelTime(lastFetchedAt)}` : ""}
        </span>
        {recentCount > 0 && (
          <span className="rounded-full bg-[#b8975a]/15 px-2 py-0.5 text-xs font-semibold text-[#8a6f3c] dark:text-[#d4b37a]">
            {recentCount} new in 24h
          </span>
        )}
      </div>

      {/* Filters — default option leftmost and preselected (Ethan's
          control-order rule): All sectors · 7d window. The old second
          filter row (All / Companies / Watchlist / Events / Sector)
          was removed in the Oct 17, 2026 overhaul; watchlist matches
          now surface as a card badge + ranking boost instead. */}
      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        {SECTOR_PILLS.map((p) => (
          <button key={p.value} onClick={() => setSector(p.value)} className={pillCls(sector === p.value)}>
            {p.label}
          </button>
        ))}
        <span className="mx-1 hidden h-5 w-px bg-slate-300/70 sm:block dark:bg-white/15" />
        <span className="inline-flex overflow-hidden rounded-lg ring-1 ring-inset ring-slate-200 dark:ring-white/15">
          {WINDOWS.map((w) => (
            <button
              key={w.days}
              onClick={() => setDays(w.days)}
              className={`px-2.5 py-1.5 text-sm font-medium transition ${
                days === w.days
                  ? "bg-[#0d1f3c] font-semibold text-white dark:bg-white/15"
                  : "text-slate-600 hover:bg-[#f0f4fa] dark:text-white/60 dark:hover:bg-white/5"
              }`}
            >
              {w.label}
            </button>
          ))}
        </span>
        <button
          onClick={() => setSavedOnly((v) => !v)}
          aria-pressed={savedOnly}
          className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
            savedOnly
              ? "font-semibold text-[#8a6f3c] ring-1 ring-inset ring-[#b8975a] dark:text-[#d4b37a]"
              : "text-slate-600 ring-1 ring-inset ring-slate-200 hover:bg-[#f0f4fa] dark:text-white/60 dark:ring-white/15 dark:hover:bg-white/5"
          }`}
        >
          ★ Saved
        </button>
      </div>

      {/* Watchlist — names and keywords that always surface. */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400 dark:text-white/40">
          Watchlist
        </span>
        {terms.map((t) => (
          <span
            key={t}
            className="inline-flex items-center gap-1 rounded-full bg-[#b8975a]/10 py-0.5 pl-2.5 pr-1 text-xs font-medium text-[#8a6f3c] ring-1 ring-inset ring-[#b8975a]/40 dark:text-[#d4b37a]"
          >
            {t}
            <button
              onClick={() => removeTerm(t)}
              aria-label={`Remove ${t} from the watchlist`}
              className="rounded-full px-1 leading-none transition hover:bg-[#b8975a]/25"
            >
              ×
            </button>
          </span>
        ))}
        <span className="inline-flex items-center gap-1.5">
          <input
            value={newTerm}
            onChange={(e) => setNewTerm(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") addTerm();
            }}
            placeholder="Add a name or keyword…"
            className="w-48 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-700 outline-none transition focus:border-[#b8975a]/70 dark:border-white/15 dark:bg-white/5 dark:text-white/85"
          />
          <button
            onClick={addTerm}
            disabled={newTerm.trim().length < 3}
            className="rounded-lg bg-[#b8975a] px-2.5 py-1.5 text-xs font-semibold text-white transition hover:bg-[#a8874f] disabled:opacity-50"
          >
            Add
          </button>
        </span>
      </div>

      {loading ? (
        <div className="flex gap-3 overflow-hidden" aria-hidden>
          {[0, 1, 2].map((i) => (
            <div key={i} className="skel h-44 w-[80%] shrink-0 sm:w-[calc((100%-0.75rem)/2)] lg:w-[calc((100%-1.5rem)/3)]" />
          ))}
        </div>
      ) : !anyRows ? (
        <div className="card-surface overflow-hidden">
          <div
            className="img-grade flex h-20 items-center justify-center"
            style={{
              background:
                "linear-gradient(120deg, #3B5B84 0%, #2F7F79 28%, #B5703A 52%, #8A7A2E 76%, #7A4E7E 100%)",
            }}
          >
            <span className="text-2xl tracking-[0.5em] text-white/80" aria-hidden>
              ✈ ✚ ⚙ 🛠 🍽
            </span>
          </div>
          <div className="px-5 py-6 text-center">
            <p className="text-base font-bold text-[#0d1f3c] dark:text-white">No stories match yet</p>
            <p className="mt-1 text-sm text-slate-500 dark:text-white/50">
              Widen the window or add a watchlist term — new stories land every 30 minutes.
            </p>
          </div>
        </div>
      ) : savedOnly ? (
        <Carousel title="Saved stories" row={savedRow} onLoadMore={() => loadMore("saved")} renderItem={renderCard} />
      ) : (
        <>
          <Carousel title="Top Market Events" row={topRow} onLoadMore={() => loadMore("top")} renderItem={renderCard} />
          <Carousel title="Latest Articles" row={latestRow} onLoadMore={() => loadMore("latest")} renderItem={renderCard} />
        </>
      )}
      {renderPanel()}
    </section>
  );
}

"use client";

/**
 * Global search (Phase 1 platform restructure): Cmd/Ctrl+K opens a
 * modal that searches across the platform via
 * GET /api/platform/search. Recent items (last 8 clicked, stored in
 * localStorage) show when the query is empty. Full keyboard support:
 * up/down to move, Enter to open, Escape to close. Also opens on the
 * `ccp:open-search` window event (the sidebar / drawer search row).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { EmptyState, SkeletonRows } from "@/components/ui";
import CompanyMark from "@/components/identity/CompanyMark";

export interface SearchItem {
  kind: string;
  id: string;
  title: string;
  subtitle?: string;
  href: string;
  updatedAt?: string;
  /** Deal Identity: stored-logo version for company/org results. */
  logoVersion?: number;
}

interface RecentItem {
  kind: string;
  id: string;
  title: string;
  href: string;
}

const RECENTS_KEY = "ccp-search-recents";

const TYPE_FILTERS: { id: string; label: string; type: string }[] = [
  { id: "all", label: "All", type: "" },
  { id: "company", label: "Companies", type: "company" },
  { id: "person", label: "People", type: "person" },
  { id: "document", label: "Documents", type: "document" },
  { id: "task", label: "Tasks", type: "task" },
  { id: "note", label: "Notes", type: "note" },
];

const KIND_LABELS: Record<string, string> = {
  company: "Company",
  person: "Person",
  document: "Document",
  task: "Task",
  note: "Note",
};

function loadRecents(): RecentItem[] {
  try {
    const raw = window.localStorage.getItem(RECENTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as RecentItem[];
    return Array.isArray(parsed) ? parsed.slice(0, 8) : [];
  } catch {
    return [];
  }
}

function saveRecent(item: RecentItem) {
  try {
    const rest = loadRecents().filter(
      (r) => !(r.kind === item.kind && r.id === item.id)
    );
    window.localStorage.setItem(
      RECENTS_KEY,
      JSON.stringify([item, ...rest].slice(0, 8))
    );
  } catch {
    /* non-fatal — recents just won't persist */
  }
}

export default function GlobalSearch() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState(TYPE_FILTERS[0]);
  const [items, setItems] = useState<SearchItem[]>([]);
  const [recents, setRecents] = useState<RecentItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const [retryTick, setRetryTick] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const seqRef = useRef(0);

  const openModal = useCallback(() => {
    setRecents(loadRecents());
    setOpen(true);
  }, []);

  const closeModal = useCallback(() => {
    setOpen(false);
    setQuery("");
    setItems([]);
    setFailed(false);
    setActiveIdx(0);
  }, []);

  /* Open/close shortcuts: Cmd/Ctrl+K toggles; the sidebar search
   * row dispatches `ccp:open-search`. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        if (open) closeModal();
        else openModal();
      }
    };
    const onOpenEvent = () => openModal();
    document.addEventListener("keydown", onKey);
    window.addEventListener("ccp:open-search", onOpenEvent);
    return () => {
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("ccp:open-search", onOpenEvent);
    };
  }, [open, openModal, closeModal]);

  useEffect(() => {
    if (open) {
      const t = window.setTimeout(() => inputRef.current?.focus(), 30);
      return () => window.clearTimeout(t);
    }
  }, [open ]);

  /* Debounced search against the platform API. Any failure (the API
   * or DB being down) lands in a clean error/empty state — the modal
   * never crashes. */
  useEffect(() => {
    if (!open) return;
    const q = query.trim();
    if (!q) {
      setItems([]);
      setLoading(false);
      setFailed(false);
      setActiveIdx(0);
      return;
    }
    setLoading(true);
    const seq = ++seqRef.current;
    const t = window.setTimeout(async () => {
      try {
        const params = new URLSearchParams({ q, limit: "25" });
        if (typeFilter.type) params.set("type", typeFilter.type);
        const r = await fetch(`/api/platform/search?${params.toString()}`);
        if (seqRef.current !== seq) return;
        if (!r.ok) throw new Error("search failed");
        const d = (await r.json()) as { items?: SearchItem[] };
        setItems(Array.isArray(d.items) ? d.items : []);
        setFailed(false);
      } catch {
        if (seqRef.current !== seq) return;
        setItems([]);
        setFailed(true);
      } finally {
        if (seqRef.current === seq) {
          setLoading(false);
          setActiveIdx(0);
        }
      }
    }, 200);
    return () => window.clearTimeout(t);
  }, [open, query, typeFilter, retryTick]);

  const showingRecents = query.trim() === "";
  const visible: { kind: string; id: string; title: string; subtitle?: string; href: string }[] =
    showingRecents ? recents : items;

  const go = useCallback(
    (item: { kind: string; id: string; title: string; href: string }) => {
      if (!item.href) return;
      saveRecent({
        kind: item.kind,
        id: item.id,
        title: item.title,
        href: item.href,
      });
      closeModal();
      router.push(item.href);
    },
    [router, closeModal]
  );

  const onInputKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      closeModal();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, Math.max(0, visible.length - 1)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const item = visible[activeIdx];
      if (item) go(item);
    }
  };

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(
      `[data-idx="${activeIdx}"]`
    );
    el?.scrollIntoView({ block: "nearest" });
  }, [activeIdx]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[80]" role="dialog" aria-modal="true" aria-label="Global search">
      <button
        aria-label="Close search"
        className="absolute inset-0 h-full w-full bg-black/60"
        onClick={closeModal}
      />
      <div className="relative mx-auto mt-[8vh] w-[calc(100vw-2rem)] max-w-xl overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-[#12294d]">
        <div className="flex items-center gap-3 border-b border-slate-100 px-4 dark:border-white/10">
          <svg
            viewBox="0 0 24 24"
            className="h-5 w-5 shrink-0 text-slate-400 dark:text-white/40"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.3-4.3" />
          </svg>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onInputKey}
            placeholder="Search companies, people, documents, tasks, notes…"
            className="min-h-[52px] w-full bg-transparent text-base text-[#0d1f3c] outline-none placeholder:text-slate-400 dark:text-white dark:placeholder:text-white/30"
            aria-label="Search"
          />
          <kbd className="hidden shrink-0 rounded border border-slate-200 px-1.5 py-0.5 text-[10px] font-semibold text-slate-400 dark:border-white/15 dark:text-white/40 sm:block">
            ESC
          </kbd>
        </div>

        <div className="flex flex-wrap gap-1.5 border-b border-slate-100 px-4 py-2.5 dark:border-white/10">
          {TYPE_FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setTypeFilter(f)}
              className={`chip ${typeFilter.id === f.id ? "chip-active" : ""}`}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div ref={listRef} className="max-h-[50vh] overflow-y-auto p-2">
          {loading ? (
            <div className="p-2">
              <SkeletonRows rows={4} />
            </div>
          ) : failed ? (
            <div className="p-2">
              <EmptyState
                title="Search is unavailable"
                message="The search service didn't respond. Try again in a moment."
                actionLabel="Retry"
                onAction={() => {
                  setFailed(false);
                  setRetryTick((n) => n + 1);
                }}
              />
            </div>
          ) : visible.length === 0 ? (
            <div className="p-2">
              <EmptyState
                title={showingRecents ? "No recent items" : "No results"}
                message={
                  showingRecents
                    ? "Start typing to search across the platform. Items you open will appear here."
                    : "Nothing matches that search. Try a different name or fewer words."
                }
              />
            </div>
          ) : (
            <>
              {showingRecents && (
                <p className="micro-label px-2 pb-1 pt-1.5">Recent</p>
              )}
              <ul>
                {visible.map((item, i) => (
                  <li key={`${item.kind}-${item.id}`}>
                    <button
                      type="button"
                      data-idx={i}
                      onMouseEnter={() => setActiveIdx(i)}
                      onClick={() => go(item)}
                      className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition ${
                        i === activeIdx
                          ? "bg-[#0d1f3c]/5 dark:bg-white/10"
                          : ""
                      }`}
                    >
                      {(item.kind === "company" || item.kind === "organization") ? (
                        <CompanyMark
                          companyId={item.id}
                          name={item.title}
                          logoVersion={(item as SearchItem).logoVersion ?? 0}
                          size={26}
                        />
                      ) : (
                        <span className="badge badge-neutral shrink-0">
                          {KIND_LABELS[item.kind] ?? item.kind}
                        </span>
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold text-[#0d1f3c] dark:text-white">
                          {item.title}
                        </span>
                        {"subtitle" in item && item.subtitle && (
                          <span className="block truncate text-xs text-slate-400 dark:text-white/40">
                            {item.subtitle}
                          </span>
                        )}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>

        <div className="flex items-center gap-4 border-t border-slate-100 px-4 py-2 text-[11px] text-slate-400 dark:border-white/10 dark:text-white/40">
          <span>↑↓ to navigate</span>
          <span>↵ to open</span>
          <span className="ml-auto">Canny Capital platform search</span>
        </div>
      </div>
    </div>
  );
}

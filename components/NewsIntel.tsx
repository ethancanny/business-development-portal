"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import SectorChip from "@/components/SectorChip";
import { fmtRelTime, uniqueStrings } from "@/lib/format";
import { sectorColor, sectorIcon } from "@/lib/sector-colors";
import type { MiNewsItem, MiNewsMatch } from "@/lib/types";

/**
 * News & Intelligence (premium redesign Wave 2b, Oct 14, 2026).
 * Reads GET /api/market/news (Wave 2a data layer): stories screened for
 * relevance against the portal's companies, deals, people, and watchlist.
 * Summaries are agent-written in our own words and arrive asynchronously
 * via the 30-minute job — a null summary renders no block, never a
 * copied snippet. Publisher preview images are credited inline
 * (licensing rule); stories without one get the graded sector visual.
 * Every fetch is defensive: a news outage must never break Market Intel.
 */

const SECTOR_PILLS: { label: string; value: string }[] = [
  { label: "All sectors", value: "all" },
  { label: "A&D", value: "Aerospace & Defense" },
  { label: "Healthcare", value: "Healthcare" },
  { label: "Adv Mfg", value: "Advanced Manufacturing" },
  { label: "Trades", value: "Specialty Trades & Construction" },
  { label: "Hospitality", value: "Hospitality" },
];

const TYPE_PILLS: { label: string; value: string }[] = [
  { label: "All", value: "" },
  { label: "Companies", value: "entity" },
  { label: "Watchlist", value: "watchlist" },
  { label: "Events", value: "event" },
  { label: "Sector", value: "sector" },
];

const WINDOWS: { label: string; days: number }[] = [
  { label: "7d", days: 7 },
  { label: "30d", days: 30 },
  { label: "90d", days: 90 },
];

const MATCH_LABELS: Record<MiNewsMatch["type"], string> = {
  company: "Company",
  deal: "Pipeline",
  operator: "Operator",
  investor: "Investor",
  watchlist: "Watchlist",
};

const pillCls = (active: boolean) =>
  `rounded-lg px-3 py-1.5 text-sm font-medium transition ${
    active
      ? "font-semibold text-[#0d1f3c] ring-1 ring-inset ring-[#b8975a] dark:text-[#e8cf9a]"
      : "text-slate-600 hover:bg-[#f0f4fa] dark:text-white/60 dark:hover:bg-white/5"
  }`;

const smallBtn =
  "rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-600 transition hover:border-[#b8975a]/60 hover:text-[#0d1f3c] dark:border-white/15 dark:text-white/70 dark:hover:text-white";

export default function NewsIntel() {
  const [items, setItems] = useState<MiNewsItem[]>([]);
  const [lastFetchedAt, setLastFetchedAt] = useState<string | null>(null);
  const [recentCount, setRecentCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [sector, setSector] = useState("all");
  const [typeFilter, setTypeFilter] = useState("");
  const [days, setDays] = useState(7);
  const [savedOnly, setSavedOnly] = useState(false);
  const [terms, setTerms] = useState<string[]>([]);
  const [newTerm, setNewTerm] = useState("");
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [imgFailed, setImgFailed] = useState<Record<string, boolean>>({});
  const [linkChoice, setLinkChoice] = useState<Record<string, string>>({});
  const [linkError, setLinkError] = useState<Record<string, string>>({});
  const loadingRef = useRef(false);

  const buildUrl = useCallback(() => {
    const parts = ["limit=60", `days=${days}`];
    if (sector !== "all") parts.push(`sector=${encodeURIComponent(sector)}`);
    if (typeFilter) parts.push(`type=${encodeURIComponent(typeFilter)}`);
    if (savedOnly) parts.push("saved=1");
    return `/api/market/news?${parts.join("&")}`;
  }, [sector, typeFilter, days, savedOnly]);

  const load = useCallback(async () => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    try {
      const [feedRes, badgeRes] = await Promise.all([
        fetch(buildUrl()),
        fetch("/api/market/news?days=1&limit=200"),
      ]);
      if (feedRes.ok) {
        const data = (await feedRes.json()) as {
          items?: MiNewsItem[];
          lastFetchedAt?: string | null;
        };
        // In-place replacement: the API orders by relevance then
        // recency, so newly arrived stories surface at the top of
        // their relevance tier without a page reload.
        setItems(Array.isArray(data.items) ? data.items : []);
        if (data.lastFetchedAt !== undefined) setLastFetchedAt(data.lastFetchedAt);
      }
      if (badgeRes.ok) {
        const badge = (await badgeRes.json()) as { items?: MiNewsItem[] };
        setRecentCount(Array.isArray(badge.items) ? badge.items.length : 0);
      }
    } catch {
      /* keep whatever is on screen — a failed refresh is invisible */
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }, [buildUrl]);

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

  // Refetch on filter change, on mount, on window focus, and every
  // 5 minutes while mounted (the ingest itself refreshes every 30).
  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    loadTerms();
  }, [loadTerms]);
  useEffect(() => {
    const onFocus = () => load();
    window.addEventListener("focus", onFocus);
    const t = window.setInterval(load, 5 * 60 * 1000);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.clearInterval(t);
    };
  }, [load]);

  /* ---------------- actions ---------------- */

  const postAction = async (
    id: string,
    action: "save" | "unsave" | "dismiss" | "link",
    companyId?: string
  ): Promise<{ ok: boolean; error?: string }> => {
    try {
      const r = await fetch("/api/market/news/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(companyId ? { id, action, companyId } : { id, action }),
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
    // Optimistic: flip the flag, or drop the card from the Saved view.
    if (savedOnly && !next) {
      setItems((cur) => cur.filter((i) => i.id !== item.id));
    } else {
      setItems((cur) => cur.map((i) => (i.id === item.id ? { ...i, saved: next } : i)));
    }
    const res = await postAction(item.id, next ? "save" : "unsave");
    if (!res.ok) {
      // Roll back to the server's version of the list.
      setItemBusy(item.id, false);
      load();
      return;
    }
    setItemBusy(item.id, false);
  };

  const dismiss = async (item: MiNewsItem) => {
    if (busy[item.id]) return;
    setItemBusy(item.id, true);
    setItems((cur) => cur.filter((i) => i.id !== item.id));
    const res = await postAction(item.id, "dismiss");
    if (!res.ok) load();
    setItemBusy(item.id, false);
  };

  const linkToCompany = async (item: MiNewsItem, companyId: string) => {
    if (busy[item.id] || !companyId) return;
    setItemBusy(item.id, true);
    setLinkError((e) => ({ ...e, [item.id]: "" }));
    const res = await postAction(item.id, "link", companyId);
    if (res.ok) {
      setItems((cur) =>
        cur.map((i) => (i.id === item.id ? { ...i, linkedCompanyId: companyId } : i))
      );
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

  /* ---------------- render helpers ---------------- */

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
      if (m.type === "company" && !companies.some((c) => c.id === m.id)) companies.push(m);
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

  const renderCard = (item: MiNewsItem) => {
    const color = sectorColor(item.sector ?? "");
    const coveredBy = uniqueStrings(item.alsoCoveredBy).filter((s) => s !== item.sourceName);
    const showImage = !!item.imageUrl && !imgFailed[item.id];
    return (
      <article key={item.id} className="card-surface flex flex-col overflow-hidden">
        {showImage ? (
          <div className="img-grade h-40 shrink-0">
            {/* Publisher link-preview image; credited on the line below. */}
            <img
              src={item.imageUrl ?? ""}
              alt=""
              loading="lazy"
              className="h-full w-full object-cover"
              onError={() => setImgFailed((f) => ({ ...f, [item.id]: true }))}
            />
          </div>
        ) : (
          <div
            className="img-grade flex h-40 shrink-0 items-center justify-center"
            style={{
              background: `linear-gradient(135deg, ${color} 0%, #0d1f3c 130%)`,
            }}
          >
            <span className="text-5xl text-white/85" aria-hidden>
              {sectorIcon(item.sector ?? "")}
            </span>
          </div>
        )}
        <div className="flex flex-1 flex-col p-4">
          <p className="text-[10px] leading-tight text-slate-400 dark:text-white/35">
            {showImage ? item.imageCredit || `Preview image · ${item.sourceName}` : "Sector visual"}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {item.sector && <SectorChip sector={item.sector} />}
            {item.kind === "watchlist" && (
              <span className="text-[11px] font-semibold uppercase tracking-wider text-[#8a6f3c] dark:text-[#d4b37a]">
                Watchlist match
              </span>
            )}
          </div>
          <a
            href={item.url || undefined}
            target="_blank"
            rel="noreferrer"
            className="mt-2 text-[15px] font-bold leading-snug text-[#0d1f3c] hover:underline dark:text-white"
          >
            {item.headline}
          </a>
          <p className="mt-1 text-xs text-slate-500 dark:text-white/50">
            {item.sourceName}
            {item.publishedAt ? ` · ${fmtRelTime(item.publishedAt)}` : ""}
          </p>
          {item.summary && (
            <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-white/70">
              {item.summary}
            </p>
          )}
          {coveredBy.length > 0 && (
            <p className="mt-2 text-[11px] text-slate-400 dark:text-white/40">
              Also covered by {coveredBy.join(", ")}
            </p>
          )}
          {item.matched.length > 0 && (
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {item.matched.map((m, i) => (
                <span
                  key={`${m.type}-${m.id}-${i}`}
                  className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                    m.type === "watchlist"
                      ? "bg-[#b8975a]/15 text-[#8a6f3c] ring-1 ring-inset ring-[#b8975a]/50 dark:text-[#d4b37a]"
                      : "bg-slate-500/10 text-slate-600 ring-1 ring-inset ring-slate-500/20 dark:text-white/60"
                  }`}
                >
                  {m.name}
                  <span className="opacity-60">{MATCH_LABELS[m.type] ?? m.type}</span>
                </span>
              ))}
            </div>
          )}
          <div className="mt-auto flex flex-wrap items-center gap-2 pt-3.5">
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
              {item.saved ? "Saved ✓" : "Save"}
            </button>
            {renderLinkControl(item)}
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
        </div>
      </article>
    );
  };

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
          control-order rule): All sectors · All types · 7d window. */}
      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        {SECTOR_PILLS.map((p) => (
          <button key={p.value} onClick={() => setSector(p.value)} className={pillCls(sector === p.value)}>
            {p.label}
          </button>
        ))}
        <span className="mx-1 hidden h-5 w-px bg-slate-300/70 sm:block dark:bg-white/15" />
        {TYPE_PILLS.map((p) => (
          <button
            key={p.label}
            onClick={() => setTypeFilter(p.value)}
            className={pillCls(typeFilter === p.value)}
          >
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
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-hidden>
          {[0, 1, 2].map((i) => (
            <div key={i} className="skel h-64" />
          ))}
        </div>
      ) : items.length === 0 ? (
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
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{items.map(renderCard)}</div>
      )}
    </section>
  );
}

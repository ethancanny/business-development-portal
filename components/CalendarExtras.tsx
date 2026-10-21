"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";

/**
 * Phase 2 — Calendar extras: the generated-events layer (tasks &
 * follow-ups today; milestones / deadlines / reporting / covenants /
 * capital calls / closings / meetings / data-room expirations as
 * later modules register generators) merged with the Outlook mirror.
 *
 * Self-fetching from /api/calendar/platform-events for a
 * -7d … +28d window. Provides layer toggles + a deal filter, an
 * agenda (next 14 days), a timeline-by-deal, a busy-week heat strip,
 * and a "This week" deadlines panel. Generated events are read-only
 * portal views — no notifications are created here.
 */

export interface PlatformEventItem {
  id: string;
  origin: "outlook" | "generated";
  title: string;
  start: string;
  end: string | null;
  allDay: boolean;
  kind: string;
  color: string;
  dealId: string | null;
  href: string;
  status: string;
  meta?: Record<string, unknown>;
}

export interface CalendarLayer {
  kind: string;
  label: string;
  color: string;
}

interface Props {
  /** Optional: lets the host page mirror the extras' filter state. */
  onFilterChange?: (state: { types: string[]; dealId: string }) => void;
}

const TZ = "America/Phoenix";

const dayKey = (iso: string): string =>
  new Date(iso).toLocaleDateString("en-CA", { timeZone: TZ });

const dayLabel = (iso: string): string => {
  const today = new Date().toLocaleDateString("en-CA", { timeZone: TZ });
  const tomorrow = new Date(Date.now() + 86400000).toLocaleDateString("en-CA", {
    timeZone: TZ,
  });
  const k = dayKey(iso);
  if (k === today) return "Today";
  if (k === tomorrow) return "Tomorrow";
  return new Date(iso).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: TZ,
  });
};

const timeLabel = (item: PlatformEventItem): string => {
  if (item.allDay) return "All day";
  return new Date(item.start).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: TZ,
  });
};

const dealNameOf = (item: PlatformEventItem): string => {
  const m = item.meta ?? {};
  const name =
    (typeof m.dealName === "string" && m.dealName) ||
    (typeof m.relatedName === "string" && m.relatedName) ||
    "";
  return name || item.dealId || "Unlinked";
};

function Dot({ color }: { color: string }) {
  return (
    <span
      aria-hidden
      className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full"
      style={{ backgroundColor: color }}
    />
  );
}

function ItemRow({ item }: { item: PlatformEventItem }) {
  const inner = (
    <>
      <Dot color={item.color} />
      <span className="min-w-0 flex-1">
        <span
          className={`block truncate text-sm font-semibold text-[#0d1f3c] dark:text-white ${
            item.status === "done" ? "line-through opacity-60" : ""
          }`}
        >
          {item.title}
        </span>
        <span className="block truncate text-xs text-slate-400 dark:text-white/40">
          {timeLabel(item)}
          {item.status ? ` · ${item.status}` : ""}
        </span>
      </span>
    </>
  );
  const cls =
    "flex items-start gap-2.5 rounded-lg border border-slate-100 bg-slate-50/60 px-2.5 py-2 transition hover:border-[#b8975a]/50 dark:border-white/5 dark:bg-white/[0.03]";
  if (item.href.startsWith("http")) {
    return (
      <a href={item.href} target="_blank" rel="noreferrer" className={cls}>
        {inner}
      </a>
    );
  }
  return (
    <Link href={item.href || "/calendar"} className={cls}>
      {inner}
    </Link>
  );
}

export default function CalendarExtras({ onFilterChange }: Props) {
  const [items, setItems] = useState<PlatformEventItem[]>([]);
  const [layers, setLayers] = useState<CalendarLayer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [disabledKinds, setDisabledKinds] = useState<Set<string>>(new Set());
  const [dealFilter, setDealFilter] = useState("");

  const load = useCallback(async () => {
    try {
      const from = new Date(Date.now() - 7 * 86400000).toISOString();
      const to = new Date(Date.now() + 28 * 86400000).toISOString();
      const r = await fetch(
        `/api/calendar/platform-events?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
      );
      if (!r.ok) throw new Error(`platform-events ${r.status}`);
      const d = await r.json();
      if (Array.isArray(d.items)) setItems(d.items);
      if (Array.isArray(d.layers)) setLayers(d.layers);
      setError("");
    } catch {
      setError("Couldn't load the platform calendar layers.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load().catch(() => null);
  }, [load]);

  const dealsPresent = useMemo(() => {
    const map = new Map<string, string>();
    for (const it of items) {
      if (it.dealId && !map.has(it.dealId)) map.set(it.dealId, dealNameOf(it));
    }
    return Array.from(map.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [items]);

  const visible = useMemo(
    () =>
      items.filter(
        (it) =>
          !disabledKinds.has(it.kind) &&
          (!dealFilter || it.dealId === dealFilter)
      ),
    [items, disabledKinds, dealFilter]
  );

  const toggleKind = (kind: string) => {
    setDisabledKinds((prev) => {
      const next = new Set(prev);
      if (next.has(kind)) next.delete(kind);
      else next.add(kind);
      if (onFilterChange) {
        const active = layers
          .map((l) => l.kind)
          .filter((k) => !next.has(k));
        onFilterChange({ types: active, dealId: dealFilter });
      }
      return next;
    });
  };

  const changeDeal = (id: string) => {
    setDealFilter(id);
    if (onFilterChange) {
      const active = layers
        .map((l) => l.kind)
        .filter((k) => !disabledKinds.has(k));
      onFilterChange({ types: active, dealId: id });
    }
  };

  /* ---- derived views ---- */

  const agenda = useMemo(() => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const endMs = start.getTime() + 14 * 86400000;
    const inWindow = visible.filter((it) => {
      const t = new Date(it.start).getTime();
      return t >= start.getTime() && t < endMs;
    });
    const groups: { key: string; label: string; rows: PlatformEventItem[] }[] =
      [];
    const byKey = new Map<string, PlatformEventItem[]>();
    for (const it of inWindow) {
      const k = dayKey(it.start);
      if (!byKey.has(k)) {
        byKey.set(k, []);
        groups.push({ key: k, label: dayLabel(it.start), rows: byKey.get(k)! });
      }
      byKey.get(k)!.push(it);
    }
    return groups;
  }, [visible]);

  const thisWeek = useMemo(() => {
    const now = Date.now();
    return visible
      .filter((it) => {
        const t = new Date(it.start).getTime();
        return t >= now - 3600000 && t < now + 7 * 86400000;
      })
      .slice(0, 12);
  }, [visible]);

  const byDeal = useMemo(() => {
    const map = new Map<string, { name: string; rows: PlatformEventItem[] }>();
    for (const it of visible) {
      if (!it.dealId) continue;
      const key = it.dealId;
      if (!map.has(key)) map.set(key, { name: dealNameOf(it), rows: [] });
      map.get(key)!.rows.push(it);
    }
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [visible]);

  const heatWeek = useMemo(() => {
    const now = new Date();
    const dow = now.getDay();
    const sunday = new Date(now);
    sunday.setHours(0, 0, 0, 0);
    sunday.setDate(now.getDate() - dow);
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(sunday.getTime() + i * 86400000);
      const key = d.toLocaleDateString("en-CA", { timeZone: TZ });
      const count = visible.filter((it) => dayKey(it.start) === key).length;
      return {
        key,
        label: d.toLocaleDateString("en-US", { weekday: "short", timeZone: TZ }),
        dayNum: d.getDate(),
        count,
        isToday: key === new Date().toLocaleDateString("en-CA", { timeZone: TZ }),
      };
    });
  }, [visible]);

  const heatBg = (count: number): string => {
    if (count === 0) return "bg-slate-50 dark:bg-white/[0.03] text-slate-400";
    if (count <= 2) return "bg-[#b8975a]/20 text-[#0d1f3c] dark:text-white";
    if (count <= 4) return "bg-[#b8975a]/45 text-[#0d1f3c] dark:text-white";
    return "bg-[#b8975a] text-white";
  };

  if (loading) {
    return (
      <p className="text-sm text-slate-400 dark:text-white/40">
        Loading platform layers…
      </p>
    );
  }
  if (error) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-white/10 dark:bg-[#132847]/60">
        <p className="text-sm text-slate-500 dark:text-white/60">{error}</p>
        <button
          onClick={() => load()}
          className="btn btn-primary btn-sm mt-3"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Filters */}
      <div>
        <div className="flex flex-wrap items-center gap-1.5">
          {layers.map((l) => {
            const off = disabledKinds.has(l.kind);
            return (
              <button
                key={l.kind}
                type="button"
                onClick={() => toggleKind(l.kind)}
                aria-pressed={!off}
                className={`chip ${off ? "opacity-40" : "chip-active"}`}
              >
                <span
                  aria-hidden
                  className="mr-1.5 inline-block h-2 w-2 rounded-full align-middle"
                  style={{ backgroundColor: l.color }}
                />
                {l.label}
              </button>
            );
          })}
        </div>
        {dealsPresent.length > 0 && (
          <div className="mt-3 flex items-center gap-2">
            <label
              htmlFor="calextras-deal"
              className="text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-white/35"
            >
              Deal
            </label>
            <select
              id="calextras-deal"
              value={dealFilter}
              onChange={(e) => changeDeal(e.target.value)}
              className="min-w-0 max-w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-[#0d1f3c] outline-none focus:border-[#b8975a] dark:border-white/10 dark:bg-white/[0.04] dark:text-white"
            >
              <option value="">All deals</option>
              {dealsPresent.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Busy-week heat strip */}
      <section aria-label="This week at a glance">
        <h3 className="mb-2 text-sm font-bold uppercase tracking-wider text-[#0d1f3c] dark:text-white">
          This week
        </h3>
        <div className="grid grid-cols-7 gap-1.5">
          {heatWeek.map((d) => (
            <div
              key={d.key}
              className={`rounded-lg px-1 py-2 text-center ${heatBg(d.count)} ${
                d.isToday ? "ring-2 ring-[#0d1f3c] dark:ring-white/60" : ""
              }`}
            >
              <p className="text-[10px] font-bold uppercase tracking-wider">
                {d.label}
              </p>
              <p className="text-base font-bold leading-tight">{d.dayNum}</p>
              <p className="text-[11px]">
                {d.count === 0 ? "—" : `${d.count} item${d.count === 1 ? "" : "s"}`}
              </p>
            </div>
          ))}
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Agenda — next 14 days */}
        <section aria-label="Agenda">
          <h3 className="mb-2 text-sm font-bold uppercase tracking-wider text-[#0d1f3c] dark:text-white">
            Agenda · next 14 days
          </h3>
          {agenda.length === 0 ? (
            <p className="text-sm text-slate-400 dark:text-white/40">
              Nothing scheduled in the next 14 days for the selected layers.
            </p>
          ) : (
            agenda.map((g) => (
              <div key={g.key} className="mb-4">
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-white/40">
                  {g.label}
                </p>
                <div className="space-y-1.5">
                  {g.rows.map((it) => (
                    <ItemRow key={it.id} item={it} />
                  ))}
                </div>
              </div>
            ))
          )}
        </section>

        <div className="space-y-6">
          {/* This week deadlines */}
          <section aria-label="Due this week">
            <h3 className="mb-2 text-sm font-bold uppercase tracking-wider text-[#0d1f3c] dark:text-white">
              Due this week
            </h3>
            {thisWeek.length === 0 ? (
              <p className="text-sm text-slate-400 dark:text-white/40">
                Nothing due in the next 7 days.
              </p>
            ) : (
              <div className="space-y-1.5">
                {thisWeek.map((it) => (
                  <ItemRow key={it.id} item={it} />
                ))}
              </div>
            )}
          </section>

          {/* Timeline by deal */}
          <section aria-label="Timeline by deal">
            <h3 className="mb-2 text-sm font-bold uppercase tracking-wider text-[#0d1f3c] dark:text-white">
              Timeline by deal
            </h3>
            {byDeal.length === 0 ? (
              <p className="text-sm text-slate-400 dark:text-white/40">
                No deal-linked items in this window yet — diligence
                milestones, deadlines and closings will group here as
                those modules come online.
              </p>
            ) : (
              <div className="space-y-4">
                {byDeal.map((g) => (
                  <div key={g.name}>
                    <p className="mb-1.5 text-xs font-semibold text-[#0d1f3c] dark:text-white">
                      {g.name}
                    </p>
                    <div className="flex gap-1.5 overflow-x-auto pb-1">
                      {g.rows.map((it) => (
                        <Link
                          key={it.id}
                          href={it.href || "/calendar"}
                          className="w-44 shrink-0 rounded-lg border border-slate-100 bg-slate-50/60 px-2.5 py-2 dark:border-white/5 dark:bg-white/[0.03]"
                        >
                          <span className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-400 dark:text-white/40">
                            <span
                              aria-hidden
                              className="h-2 w-2 rounded-full"
                              style={{ backgroundColor: it.color }}
                            />
                            {new Date(it.start).toLocaleDateString("en-US", {
                              month: "short",
                              day: "numeric",
                              timeZone: TZ,
                            })}
                            {" · "}
                            {timeLabel(it)}
                          </span>
                          <span className="mt-0.5 block truncate text-sm font-semibold text-[#0d1f3c] dark:text-white">
                            {it.title}
                          </span>
                        </Link>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

"use client";

import { useEffect, useMemo, useState } from "react";
import type { ActivityEvent, Deal, Interaction } from "@/lib/types";
import { fmtDate, dedupeSourceTokens } from "@/lib/format";
import { stageColor } from "@/lib/sector-colors";

/**
 * Record Timeline (Premium redesign Wave 3): one newest-first
 * chronology of what actually exists on a deal record today —
 *   · activity-log entries for this deal (GET /api/activity events
 *     carry dealId; the dossier passes the already-filtered slice)
 *   · logged touches (interactions: call / email / meeting / note)
 *   · record created / last-updated markers
 *   · a stage-age marker (days in the current stage, counted from
 *     updatedAt — the portal's established stage-age convention)
 *   · linked news from GET /api/market/news, when that endpoint
 *     exists and returns rows naming this company (defensive: any
 *     error, non-200, or unexpected shape renders nothing)
 * Deal.notes is a single free-text field, not dated entries, so it
 * contributes NO timeline items — no chronology is fabricated from it.
 */

interface TItem {
  key: string;
  date: string;
  label: string;
  labelCls: string;
  dot: string;
  text: string;
  sub?: string;
  href?: string;
}

const IX_STYLE: Record<string, { label: string; cls: string }> = {
  call: { label: "Call", cls: "bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300" },
  email: { label: "Email", cls: "bg-indigo-100 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300" },
  meeting: { label: "Meeting", cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300" },
  note: { label: "Note", cls: "bg-slate-200 text-slate-600 dark:bg-white/10 dark:text-white/60" },
};

interface NewsRow {
  title?: string;
  headline?: string;
  summary?: string;
  url?: string;
  sourceUrl?: string;
  link?: string;
  publishedAt?: string;
  date?: string;
  announcedDate?: string;
  createdAt?: string;
  company?: string;
  companyName?: string;
  dealId?: string | null;
  publisher?: string;
  source?: string;
}

export default function DealTimeline({
  deal,
  activity,
  interactions,
}: {
  deal: Deal;
  activity: ActivityEvent[];
  interactions: Interaction[];
}) {
  const [news, setNews] = useState<NewsRow[]>([]);

  // Linked news — another wave owns GET /api/market/news. Until it
  // exists (today it 404s), or if it errors / changes shape, this
  // simply contributes nothing.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/market/news");
        if (!res.ok) return;
        const data = await res.json().catch(() => null);
        const rows: unknown = Array.isArray(data)
          ? data
          : (data?.news ?? data?.items ?? data?.results ?? []);
        if (!Array.isArray(rows)) return;
        const target = deal.companyName.trim().toLowerCase();
        const matched = (rows as NewsRow[]).filter((n) => {
          if (!n || typeof n !== "object") return false;
          if (n.dealId && n.dealId === deal.id) return true;
          const co = (n.company ?? n.companyName ?? "").trim().toLowerCase();
          if (co && target && co === target) return true;
          const text = `${n.title ?? n.headline ?? ""} ${n.summary ?? ""}`.toLowerCase();
          return target.length > 2 && text.includes(target);
        });
        if (!cancelled) setNews(matched);
      } catch {
        /* news is additive only — never break the record view */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [deal.id, deal.companyName]);

  const items = useMemo<TItem[]>(() => {
    const list: TItem[] = [];

    news.forEach((n, i) => {
      const title = n.title ?? n.headline ?? "";
      if (!title) return;
      list.push({
        key: `news-${i}`,
        date: n.publishedAt ?? n.date ?? n.announcedDate ?? n.createdAt ?? "",
        label: "News",
        labelCls: "bg-[#b8975a]/20 text-[#8a6f3c] dark:bg-[#b8975a]/25 dark:text-[#e8cf9f]",
        dot: "#b8975a",
        text: title,
        sub: n.publisher ?? n.source ?? undefined,
        href: n.url ?? n.sourceUrl ?? n.link ?? undefined,
      });
    });

    activity.forEach((e) => {
      list.push({
        key: `act-${e.id}`,
        date: e.createdAt,
        label: "Activity",
        labelCls: "bg-[#b8975a]/15 text-[#8a6f3c] dark:text-[#d4b37a]",
        dot: "#b8975a",
        text: e.message,
      });
    });

    interactions.forEach((ix) => {
      const st = IX_STYLE[ix.kind] ?? IX_STYLE.note;
      list.push({
        key: `ix-${ix.id}`,
        date: ix.occurredAt || ix.createdAt,
        label: st.label,
        labelCls: st.cls,
        dot: "#7D90B0",
        text: ix.summary,
      });
    });

    const daysInStage = Math.max(
      0,
      Math.floor((Date.now() - new Date(deal.updatedAt).getTime()) / 86400000)
    );
    list.push({
      key: "stage-age",
      date: deal.updatedAt,
      label: "Stage",
      labelCls: "bg-slate-200 text-slate-600 dark:bg-white/10 dark:text-white/60",
      dot: stageColor(deal.stage),
      text: `In stage “${deal.stage}” — ${daysInStage} ${daysInStage === 1 ? "day" : "days"} in stage`,
      sub: "Age counted from the record's last update.",
    });

    if (deal.updatedAt.slice(0, 10) !== deal.createdAt.slice(0, 10)) {
      list.push({
        key: "updated",
        date: deal.updatedAt,
        label: "Record",
        labelCls: "bg-slate-200 text-slate-600 dark:bg-white/10 dark:text-white/60",
        dot: "#94A3B8",
        text: "Record last updated",
      });
    }
    list.push({
      key: "created",
      date: deal.createdAt,
      label: "Record",
      labelCls: "bg-slate-200 text-slate-600 dark:bg-white/10 dark:text-white/60",
      dot: "#94A3B8",
      text: "Record created",
      sub: deal.source ? `Sourced via ${dedupeSourceTokens(deal.source)}` : undefined,
    });

    return list.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  }, [deal, activity, interactions, news]);

  return (
    <section className="card-surface mt-6 p-5">
      <h2 className="mb-4 text-xl font-semibold text-[#0d1f3c] dark:text-white">
        Timeline
      </h2>
      <ol className="relative space-y-1 border-l-2 border-slate-200 dark:border-white/10">
        {items.map((it) => (
          <li key={it.key} className="relative pb-4 pl-6">
            <span
              className="absolute left-[-5px] top-1.5 h-2 w-2 rounded-full ring-2 ring-white dark:ring-[#12294d]"
              style={{ backgroundColor: it.dot }}
            />
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${it.labelCls}`}
              >
                {it.label}
              </span>
              <span className="tnum text-xs text-slate-400 dark:text-white/40">
                {it.date ? fmtDate(it.date) : "—"}
              </span>
            </div>
            <p className="mt-1 text-sm text-slate-700 dark:text-[#e8dfc8]">
              {it.href ? (
                <a
                  href={it.href}
                  target="_blank"
                  rel="noreferrer"
                  className="font-medium text-[#8a6f3c] hover:underline dark:text-[#d4b37a]"
                >
                  {it.text} ↗
                </a>
              ) : (
                it.text
              )}
            </p>
            {it.sub && (
              <p className="mt-0.5 text-xs text-slate-400 dark:text-white/40">{it.sub}</p>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}

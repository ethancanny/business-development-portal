"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import SectorChip from "@/components/SectorChip";
import { fmtRelTime } from "@/lib/format";
import { sectorColor } from "@/lib/sector-colors";
import type { MiNewsItem } from "@/lib/types";

/**
 * Latest intelligence (premium redesign Wave 2b, Oct 14, 2026): the
 * top 3 stories from the News & Intelligence feed, directly under Top
 * Signals on the Overview. Fully defensive — renders nothing when the
 * feed is empty or the API errors, so it can never break the page.
 */
export default function LatestIntel() {
  const [items, setItems] = useState<MiNewsItem[]>([]);
  const [imgFailed, setImgFailed] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetch("/api/market/news?limit=3&days=7");
        if (!r.ok) return;
        const data = (await r.json()) as { items?: MiNewsItem[] };
        if (alive && Array.isArray(data.items)) setItems(data.items.slice(0, 3));
      } catch {
        /* the strip simply stays hidden */
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  if (items.length === 0) return null;

  return (
    <section className="mb-6">
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h2 className="text-xl font-bold text-[#0d1f3c] dark:text-white">Latest intelligence</h2>
        <Link
          href="/market-intel"
          className="text-xs font-semibold text-[#8a6f3c] hover:underline dark:text-[#d4b37a]"
        >
          View all →
        </Link>
      </div>
      <div className="card-surface divide-y divide-slate-100 overflow-hidden dark:divide-white/5">
        {items.map((item) => (
          <div key={item.id} className="flex items-start gap-3 px-4 py-3">
            {item.imageUrl && !imgFailed[item.id] ? (
              <div className="img-grade mt-0.5 h-12 w-12 shrink-0 rounded-lg">
                <img
                  src={item.imageUrl}
                  alt=""
                  loading="lazy"
                  className="h-full w-full object-cover"
                  onError={() => setImgFailed((f) => ({ ...f, [item.id]: true }))}
                />
              </div>
            ) : (
              <span
                className="mt-2 h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: sectorColor(item.sector ?? "") }}
                aria-hidden
              />
            )}
            <div className="min-w-0">
              <a
                href={item.url || undefined}
                target="_blank"
                rel="noreferrer"
                className="text-[15px] font-semibold leading-snug text-[#0d1f3c] hover:underline dark:text-white"
              >
                {item.headline}
              </a>
              <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="text-xs text-slate-500 dark:text-white/50">
                  {item.sourceName}
                  {item.publishedAt ? ` · ${fmtRelTime(item.publishedAt)}` : ""}
                </span>
                {item.sector && <SectorChip sector={item.sector} />}
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

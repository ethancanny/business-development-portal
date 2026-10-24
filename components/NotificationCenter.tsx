"use client";

/**
 * Notification center (Phase 2, workstream D): ONE bell, ONE list.
 * It merges core.notifications for the signed-in user (mentions and
 * other collaboration notifications, added this phase) with the
 * EXISTING unread concept — unread deal_flow / Activity items, the
 * same set lib/badge.ts counts. Every item can be cleared in place
 * (Ethan, Oct 23, 2026 — no click-through required): the × button and
 * "Mark all read" POST to /api/platform/notifications, which stamps
 * whichever store the item came from; rows still link to their item
 * for anyone who wants to open it. NO interval polling (platform
 * rules): data is fetched on mount and again when the panel opens.
 *
 * Rendered in-flow by the TopBar (Navigation Restructure): the bell
 * trigger + dropdown live inside a relative container — no fixed
 * positioning (the old placement assumed the removed 64px header).
 */

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import ActivityFeed from "@/components/ActivityFeed";
import { fmtRelTime } from "@/lib/format";

interface NotificationItem {
  id: string;
  source: "platform" | "activity";
  kind: string;
  title: string;
  body: string;
  href: string;
  read: boolean;
  createdAt: string;
}

function IconBell({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className ?? "h-6 w-6"}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
    </svg>
  );
}

export default function NotificationCenter() {
  const pathname = usePathname() ?? "";
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"notifications" | "activity">("notifications");
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const load = async () => {
    try {
      const res = await fetch("/api/platform/notifications");
      if (!res.ok) return;
      const data = (await res.json()) as {
        items?: NotificationItem[];
        unreadCount?: number;
      };
      setItems(Array.isArray(data.items) ? data.items : []);
      setUnreadCount(
        typeof data.unreadCount === "number" ? data.unreadCount : 0
      );
      setLoaded(true);
    } catch {
      /* the bell is best-effort chrome — never break the shell */
    }
  };

  // Fetch on mount only; re-fetch when the panel opens. No polling.
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (open) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open ]);

  // Navigation closes the panel.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // Outside click + Escape close the panel.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open ]);

  const markRead = async (item: NotificationItem) => {
    if (item.read) return;
    // Clearing REMOVES the row from the list (the endpoint returns
    // unread items only, so a refetch agrees) — stamping it "read"
    // and leaving it rendered dimmed is what used to make the list
    // impossible to empty.
    setItems((prev) =>
      prev.filter(
        (i) => !(i.id === item.id && i.source === item.source)
      )
    );
    setUnreadCount((n) => Math.max(0, n - 1));
    try {
      await fetch("/api/platform/notifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: item.id, source: item.source }),
      });
    } catch {
      /* optimistic state stands; next open re-fetches the truth */
    }
  };

  const markAllRead = async () => {
    setItems([]);
    setUnreadCount(0);
    try {
      await fetch("/api/platform/notifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ all: true }),
      });
      // Resync from the server so the count matches the stored truth.
      void load();
    } catch {
      /* best-effort */
    }
  };

  // Login has no shell chrome (matches AppShell's own rule).
  if (pathname === "/login" || pathname === "/offline") return null;

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={
          unreadCount > 0
            ? `Notifications, ${unreadCount} unread`
            : "Notifications"
        }
        aria-expanded={open}
        className="relative flex h-11 w-11 items-center justify-center rounded-full bg-[#0d1f3c] text-[#d4b37a] shadow-lg ring-1 ring-[#b8975a]/50 transition hover:bg-[#16305a]"
      >
        <IconBell className="h-5 w-5" />
        {unreadCount > 0 && (
          <span className="absolute -right-1 -top-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold leading-none text-white ring-2 ring-white dark:ring-navy-700">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 flex max-h-[70vh] w-[min(92vw,380px)] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-white/10 dark:bg-[#12294d]">
          <div className="flex items-center gap-1 border-b border-slate-100 px-3 pt-3 dark:border-white/10">
            <button
              type="button"
              onClick={() => setTab("notifications")}
              aria-pressed={tab === "notifications"}
              className={`chip ${tab === "notifications" ? "chip-active" : ""}`}
            >
              Notifications
              {unreadCount > 0 ? ` (${unreadCount})` : ""}
            </button>
            <button
              type="button"
              onClick={() => setTab("activity")}
              aria-pressed={tab === "activity"}
              className={`chip ${tab === "activity" ? "chip-active" : ""}`}
            >
              Activity
            </button>
            {tab === "notifications" && (
              <button
                type="button"
                onClick={markAllRead}
                className="ml-auto shrink-0 rounded px-2 py-1 text-xs font-semibold text-gold-700 transition hover:bg-[#f0f4fa] dark:text-gold-400 dark:hover:bg-white/5"
              >
                Mark all read
              </button>
            )}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            {tab === "activity" ? (
              <ActivityFeed limit={25} />
            ) : !loaded ? (
              <div className="space-y-3" aria-busy="true">
                <div className="skel h-12" />
                <div className="skel h-12" />
                <span className="sr-only">Loading notifications…</span>
              </div>
            ) : items.length === 0 ? (
              <p className="px-1 py-4 text-sm text-caption">
                You&apos;re all caught up — no notifications.
              </p>
            ) : (
              <ul className="divide-y divide-slate-100 dark:divide-white/5">
                {items.map((item) => (
                  <li key={`${item.source}-${item.id}`} className="relative">
                    <Link
                      href={item.href || "/overview"}
                      onClick={() => {
                        void markRead(item);
                        setOpen(false);
                      }}
                      className={`block px-1 py-2.5 pr-7 transition hover:bg-[#f0f4fa] dark:hover:bg-white/5 ${
                        item.read ? "opacity-70" : ""
                      }`}
                    >
                      <span className="flex items-baseline gap-2">
                        {!item.read && (
                          <span
                            aria-hidden
                            className="h-2 w-2 shrink-0 translate-y-[-1px] rounded-full bg-red-600"
                          />
                        )}
                        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-[#0d1f3c] dark:text-white">
                          {item.title}
                        </span>
                        <span className="shrink-0 text-[11px] text-caption">
                          {item.createdAt ? fmtRelTime(item.createdAt) : ""}
                        </span>
                      </span>
                      {item.body && (
                        <span className="mt-0.5 line-clamp-2 block pl-4 text-xs leading-snug text-caption">
                          {item.body}
                        </span>
                      )}
                    </Link>
                    {!item.read && (
                      <button
                        type="button"
                        onClick={() => void markRead(item)}
                        aria-label={`Clear notification: ${item.title}`}
                        title="Clear without opening"
                        className="absolute right-0.5 top-2 flex h-6 w-6 items-center justify-center rounded-full text-base leading-none text-slate-300 transition hover:bg-slate-100 hover:text-slate-600 dark:text-white/25 dark:hover:bg-white/10 dark:hover:text-white"
                      >
                        ×
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Lightweight touch pull-to-refresh (CRM Phase 2). Engages only when
 * the page is scrolled to the very top and the user drags down; at a
 * 70px pull it fires onRefresh — or reloads the page when no refetch
 * callback is provided. Pages render the indicator from the returned
 * { pull, refreshing } state:
 *
 *   const { pull, refreshing } = usePullToRefresh(load);
 *   {(pull > 8 || refreshing) && <div className="…pill…">…</div>}
 */
export function usePullToRefresh(
  onRefresh?: () => void | Promise<void>
): { pull: number; refreshing: boolean } {
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const startY = useRef<number | null>(null);
  const pullRef = useRef(0);
  const busyRef = useRef(false);
  const cbRef = useRef(onRefresh);
  cbRef.current = onRefresh;

  useEffect(() => {
    const THRESHOLD = 70;

    const onTouchStart = (e: TouchEvent) => {
      if (busyRef.current) return;
      if (window.scrollY <= 0 && e.touches.length === 1) {
        startY.current = e.touches[0].clientY;
      } else {
        startY.current = null;
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      if (startY.current === null || busyRef.current) return;
      if (window.scrollY > 0) {
        startY.current = null;
        pullRef.current = 0;
        setPull(0);
        return;
      }
      const dy = e.touches[0].clientY - startY.current;
      if (dy <= 0) {
        pullRef.current = 0;
        setPull(0);
        return;
      }
      // Resist: the indicator trails the finger.
      const p = Math.min(90, dy * 0.5);
      pullRef.current = p;
      setPull(p);
      if (dy > 12) e.preventDefault(); // stop the native overscroll bounce
    };

    const onTouchEnd = async () => {
      const p = pullRef.current;
      startY.current = null;
      pullRef.current = 0;
      setPull(0);
      if (p < THRESHOLD || busyRef.current) return;
      busyRef.current = true;
      setRefreshing(true);
      try {
        if (cbRef.current) await cbRef.current();
        else window.location.reload();
      } catch {
        /* a failed refresh leaves the page as-is */
      } finally {
        busyRef.current = false;
        setRefreshing(false);
      }
    };

    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchmove", onTouchMove, { passive: false });
    window.addEventListener("touchend", onTouchEnd);
    window.addEventListener("touchcancel", onTouchEnd);
    return () => {
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onTouchEnd);
      window.removeEventListener("touchcancel", onTouchEnd);
    };
  }, []);

  return { pull, refreshing };
}

/** Shared "Release to refresh" pill markup for pages using the hook. */
export function pullPillLabel(pull: number, refreshing: boolean): string {
  if (refreshing) return "Refreshing…";
  return pull >= 70 ? "Release to refresh" : "Pull to refresh";
}

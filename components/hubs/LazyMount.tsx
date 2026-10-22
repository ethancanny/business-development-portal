"use client";

/**
 * LazyMount (BD hub): defers mounting its children — and therefore
 * their fetch — until the wrapper scrolls near the viewport
 * (IntersectionObserver, rootMargin 200px). Once mounted it stays
 * mounted. `immediate` renders children right away (first section).
 */

import { useEffect, useRef, useState, type ReactNode } from "react";

export default function LazyMount({
  children,
  immediate = false,
  minHeight = 180,
  id,
}: {
  children: ReactNode;
  immediate?: boolean;
  minHeight?: number;
  /** Anchor id carried by the placeholder until the children (which
   * carry the same id on their section) mount and replace it. */
  id?: string;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState(immediate);

  useEffect(() => {
    if (visible) return;
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            setVisible(true);
            obs.disconnect();
          }
        }
      },
      { rootMargin: "200px" }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [visible]);

  if (visible) return <>{children}</>;
  return (
    <div ref={ref} id={id} style={{ minHeight }} aria-hidden>
      <div className="space-y-3">
        <div className="skel h-6 w-40" />
        <div className="skel h-24" />
        <div className="skel h-24" />
      </div>
    </div>
  );
}

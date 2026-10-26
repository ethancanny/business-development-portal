"use client";

import { useEffect, useState } from "react";
import { BANNER_DARK, BANNER_LIGHT } from "@/lib/sector-colors";
import {
  ContrailArc,
  StarField,
  TopoContours,
} from "@/components/theme/DesertMotifs";

interface PageHeroProps {
  eyebrow?: string;
  title: string;
  subtitle?: string;
}

/**
 * Page banner. Desktop height/layout are fixed (h-36 sm:h-44) — Ethan,
 * Oct 14, 2026: do not change them. On phones only (CRM Phase 2), the
 * hero collapses to a slim title strip once the user scrolls past ~80px
 * so content gets the screen. Theme-aware imagery via the app's `.dark`
 * class: the desert photo in light mode, the uploaded night-sky photo
 * in dark mode, with a deeper dark gradient (left + bottom) so titles
 * stay readable over the stars. Both images lazy-load.
 */
export default function PageHero({ eyebrow, title, subtitle }: PageHeroProps) {
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const onScroll = () => setCollapsed(mq.matches && window.scrollY > 80);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);

  return (
    <div
      className={`relative overflow-hidden transition-[height] duration-300 ${
        collapsed ? "h-12" : "h-36 sm:h-44"
      }`}
    >
      <img
        src={BANNER_LIGHT}
        alt=""
        loading="lazy"
        className="absolute inset-0 h-full w-full object-cover dark:hidden"
      />
      <img
        src={BANNER_DARK}
        alt=""
        loading="lazy"
        className="absolute inset-0 hidden h-full w-full object-cover dark:block"
      />
      <div className="absolute inset-0 bg-gradient-to-r from-[#0d1f3c] via-[#0d1f3c]/55 to-[#0d1f3c]/10" />
      <div className="absolute inset-0 bg-gradient-to-t from-[#0d1f3c]/60 via-transparent to-transparent" />
      {/* Dark mode only: extra depth over the night sky (~40–60%). */}
      <div className="absolute inset-0 hidden bg-gradient-to-r from-[#040b1a]/60 via-[#040b1a]/25 to-transparent dark:block" />
      <div className="absolute inset-0 hidden bg-gradient-to-t from-[#040b1a]/50 via-transparent to-transparent dark:block" />
      <span className="text-white">
        <TopoContours />
        <ContrailArc />
        <StarField />
      </span>
      <div className="relative mx-auto flex h-full max-w-[1400px] flex-col justify-center px-4 sm:px-6">
        {eyebrow && !collapsed && (
          <p className="hidden text-[11px] font-semibold uppercase tracking-label text-[#d4b37a] sm:block">
            {eyebrow}
          </p>
        )}
        <h2
          className={`mt-1 font-sans font-bold text-white ${
            collapsed ? "text-xl" : "text-2xl sm:text-3xl"
          }`}
        >
          {title}
        </h2>
        {subtitle && !collapsed && (
          <p className="mt-1 text-sm text-[#e8dfc8]">{subtitle}</p>
        )}
      </div>
      <div className="absolute inset-x-0 bottom-0 h-0.5 bg-[#b8975a]" />
    </div>
  );
}

"use client";

import { useState } from "react";
import {
  initialsFor,
  logoRenditionUrl,
  monogramColor,
  renditionFor,
} from "@/lib/identity/shared";

/**
 * The one company mark, used everywhere (Deal Identity System,
 * Oct 24, 2026). Renders the stored logo rendition when the company
 * has one (version > 0), else a monogram badge whose color is
 * derived deterministically from the company ID. An image error
 * (missing object, provider hiccup) falls back to the monogram —
 * a broken-image icon never reaches the UI.
 *
 * External/codename contexts: callers resolve identity first via
 * resolveDisplayIdentity and simply do not render this component
 * when showLogo is false — there is deliberately no "hidden" mode
 * here, so a hidden logo can never leak through a prop default.
 */
export default function CompanyMark({
  companyId,
  name,
  logoVersion = 0,
  size = 22,
  className = "",
  rounded = "rounded",
}: {
  companyId?: string;
  name: string;
  logoVersion?: number;
  size?: number;
  className?: string;
  rounded?: string;
}) {
  const [err, setErr] = useState(false);
  const id = companyId ?? "";
  if (id && logoVersion > 0 && !err) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={logoRenditionUrl(id, renditionFor(size), logoVersion)}
        alt=""
        loading="lazy"
        onError={() => setErr(true)}
        className={`inline-block shrink-0 bg-white object-contain ring-1 ring-slate-200 dark:ring-white/10 ${rounded} ${className}`}
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <span
      aria-hidden
      className={`inline-flex shrink-0 items-center justify-center font-bold text-white ${rounded} ${className}`}
      style={{
        width: size,
        height: size,
        backgroundColor: monogramColor(id || name),
        fontSize: Math.max(9, Math.round(size * 0.42)),
      }}
    >
      {initialsFor(name)}
    </span>
  );
}

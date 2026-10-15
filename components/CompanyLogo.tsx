"use client";

import { useState } from "react";
import { sectorColor } from "@/lib/sector-colors";

/**
 * Company logo (Ethan, Oct 14, 2026): the favicon served from the
 * company's own website domain, with a sector-colored initials tile as
 * the fallback when the site has no favicon or no website is known.
 */
export default function CompanyLogo({
  name,
  website,
  sector,
  size = 22,
}: {
  name: string;
  website?: string;
  sector?: string;
  size?: number;
}) {
  const [err, setErr] = useState(false);
  let domain = "";
  if (website) {
    try {
      domain = new URL(website.startsWith("http") ? website : `https://${website}`).hostname.replace(/^www\./, "");
    } catch {
      domain = "";
    }
  }
  const initials =
    (name || "")
      .replace(/[^A-Za-z0-9 ]/g, "")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0])
      .join("")
      .toUpperCase() || "•";
  if (domain && !err) {
    return (
      <img
        src={`https://${domain}/favicon.ico`}
        alt=""
        loading="lazy"
        onError={() => setErr(true)}
        className="inline-block shrink-0 rounded bg-white object-contain"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <span
      aria-hidden
      className="inline-flex shrink-0 items-center justify-center rounded font-bold text-white"
      style={{ width: size, height: size, backgroundColor: sectorColor(sector ?? ""), fontSize: Math.max(9, size * 0.42) }}
    >
      {initials}
    </span>
  );
}

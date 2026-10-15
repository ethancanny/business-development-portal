"use client";

import { useState } from "react";

/**
 * Person avatar (Ethan, Oct 14, 2026): initials tile in a muted,
 * name-hashed tone from the navy/gold family (never the aging hues,
 * which are reserved for staleness/decay). A photo renders when a URL
 * is supplied and loads; there is no photo field on operator/investor
 * records yet, so today this is initials-only in practice — the photo
 * branch lights up if a URL is ever stored on the profile.
 */
const PALETTE = ["#3B5B84", "#5B7BA6", "#8A6F3C", "#4A6741", "#6B5B7B", "#2C4A73", "#7D90B0", "#946B4A"];

function toneFor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

export function personInitials(name: string): string {
  return (
    (name || "")
      .replace(/[^A-Za-z0-9 ]/g, "")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0])
      .join("")
      .toUpperCase() || "•"
  );
}

export default function PersonAvatar({
  name,
  size = 24,
  photoUrl,
}: {
  name: string;
  size?: number;
  photoUrl?: string;
}) {
  const [err, setErr] = useState(false);
  if (photoUrl && !err) {
    return (
      <img
        src={photoUrl}
        alt=""
        loading="lazy"
        onError={() => setErr(true)}
        className="inline-block shrink-0 rounded-full object-cover"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <span
      aria-hidden
      className="inline-flex shrink-0 items-center justify-center rounded-full font-bold text-white"
      style={{
        width: size,
        height: size,
        backgroundColor: toneFor(name || ""),
        fontSize: Math.max(9, size * 0.4),
      }}
    >
      {personInitials(name)}
    </span>
  );
}

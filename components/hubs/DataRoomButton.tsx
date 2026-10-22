"use client";

/**
 * Data Room button (nav restructure, WS-C) — the one shared
 * implementation for the company profile, diligence workspace, and
 * value-creation workspace headers. Resolves the scope's most recent
 * room through the dataroom resolution endpoints:
 * - {companyId} → GET /api/platform/datarooms/by-company/[companyId]
 * - {dealId}    → GET /api/platform/datarooms/by-deal/[dealId]
 * While resolving (and when no room exists) it links to /data-rooms,
 * the rooms list where a room can be created — never a dead button.
 */

import { useEffect, useState } from "react";
import Link from "next/link";

export default function DataRoomButton({
  companyId,
  dealId,
  className = "",
}: {
  companyId?: string;
  dealId?: string;
  className?: string;
}) {
  const [href, setHref] = useState("/data-rooms");

  useEffect(() => {
    let cancelled = false;
    const url = companyId
      ? `/api/platform/datarooms/by-company/${encodeURIComponent(companyId)}`
      : dealId
        ? `/api/platform/datarooms/by-deal/${encodeURIComponent(dealId)}`
        : null;
    if (!url) return;
    (async () => {
      try {
        const res = await fetch(url, { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as { roomId?: string | null };
        if (!cancelled && data.roomId) {
          setHref(`/data-rooms/${encodeURIComponent(data.roomId)}`);
        }
      } catch {
        /* keep the /data-rooms fallback */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [companyId, dealId]);

  return (
    <Link
      href={href}
      className={`btn btn-secondary btn-sm min-h-[44px] ${className}`}
    >
      <svg
        viewBox="0 0 24 24"
        aria-hidden
        className="h-4 w-4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      </svg>
      Data Room
    </Link>
  );
}

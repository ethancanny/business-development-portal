"use client";

import { useEffect } from "react";

/**
 * Records a company/deal open for the Recent deals dropdown. Fires
 * once per mount; the server upserts (user, company) → opened_at.
 * Renders nothing; failures are silent by design (a missed recent
 * entry must never break the page it rides on).
 */
export default function RecordRecent({
  companyId,
  dealId,
}: {
  companyId?: string;
  dealId?: string;
}) {
  useEffect(() => {
    if (!companyId && !dealId) return;
    fetch("/api/platform/identity/recent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ companyId: companyId ?? "", dealId: dealId ?? "" }),
      keepalive: true,
    }).catch(() => undefined);
  }, [companyId, dealId]);
  return null;
}

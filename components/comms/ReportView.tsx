"use client";

/**
 * ReportView — the INTERNAL full view of a report render (Report
 * redesign, Oct 24, 2026). Thin wrapper over ReportDocument in
 * internal mode: every block renders (internal-only, missing and
 * not-applicable included, badged), and the render's stored warnings
 * show above the document. Recipient surfaces never use this — they
 * render ReportDocument in guest/preview mode from the
 * audience-filtered render.
 */

import ReportDocument from "@/components/comms/ReportDocument";
import type { ReportRender } from "@/components/comms/types";

export default function ReportView({ render }: { render: ReportRender }) {
  return (
    <div>
      {(render.warnings ?? []).length > 0 && (
        <div className="mb-4 space-y-1.5">
          {render.warnings.map((w, i) => (
            <p
              key={i}
              className="rounded-xl bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-200"
            >
              {w}
            </p>
          ))}
        </div>
      )}
      <ReportDocument render={render} mode="internal" />
    </div>
  );
}

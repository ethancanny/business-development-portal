import { sql, str } from "../platform/db";
import { ensureComms } from "./schema";
import type {
  AppendixFigure,
  Audience,
  CheckIssue,
  ReportRender,
} from "./types";

/**
 * Communications & Reports (Part 12) — audience filtering + the
 * pre-send check.
 *
 * filterRenderForAudience is PURE and is the single filter used by
 * both the internal preview endpoint and the guest recipient GET —
 * the same inputs must produce byte-identical output on both paths,
 * so nothing here reads the DB, the clock, or any ambient state.
 *
 * runPreSendCheck is the send gate used by delivery: it separates
 * hard blocks (must be overridden, with a reason, to send) from
 * flags (sendable, but the sender must see them) and exclusions
 * (internal-only blocks the audience filter will drop — listed so
 * the sender knows exactly what recipients will NOT see).
 */

export function filterRenderForAudience(
  render: ReportRender,
  audience: Audience | string
): ReportRender {
  if (audience === "internal") return render;
  return {
    ...render,
    blocks: render.blocks.filter((b) => b.visibility !== "internal_only"),
  };
}

/* --------------------------- pre-send check -------------------------- */

/** The report fields the check reads — accepts the service layer's
 * camelCase report shape and the raw snake_case row alike. */
export interface PreSendReport {
  id?: string;
  audience?: string;
  companyId?: string | null;
  company_id?: string | null;
  dealId?: string | null;
  deal_id?: string | null;
  personId?: string | null;
  person_id?: string | null;
  hasUnreviewed?: boolean;
  has_unreviewed?: boolean;
  narrativeStatus?: string | null;
  narrative_status?: string | null;
  isSample?: boolean;
  is_sample?: boolean;
  appendix?: AppendixFigure[] | string | null;
  render?: ReportRender | string | null;
}

export interface PreSendRecipient {
  personId?: string | null;
  name?: string;
  email?: string;
  audience?: string;
}

export interface PreSendCheckResult {
  blocked: CheckIssue[];
  flagged: CheckIssue[];
  excluded: CheckIssue[];
}

function parseJson<T>(v: T | string | null | undefined): T | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "string") {
    try {
      return JSON.parse(v) as T;
    } catch {
      return null;
    }
  }
  return v as T;
}

export async function runPreSendCheck(
  report: PreSendReport,
  recipients: PreSendRecipient[]
): Promise<PreSendCheckResult> {
  const blocked: CheckIssue[] = [];
  const flagged: CheckIssue[] = [];
  const excluded: CheckIssue[] = [];

  const audience = report.audience ?? "internal";
  const companyId = report.companyId ?? report.company_id ?? null;
  const dealId = report.dealId ?? report.deal_id ?? null;
  const personId = report.personId ?? report.person_id ?? null;
  const isSample = report.isSample ?? report.is_sample ?? false;
  const narrativeStatus =
    report.narrativeStatus ?? report.narrative_status ?? null;
  const appendix =
    parseJson<AppendixFigure[]>(report.appendix) ?? [];
  const render = parseJson<ReportRender>(report.render);

  const recipientAudiences = (recipients ?? []).map(
    (r) => r.audience ?? audience
  );
  const effectiveAudiences = recipientAudiences.length
    ? recipientAudiences
    : [audience];
  const hasExternalRecipient = effectiveAudiences.some(
    (a) => a !== "internal"
  );

  /* excluded — internal-only blocks the audience filter will drop
   * for any non-internal recipient (informational, not an error). */
  if (hasExternalRecipient && render) {
    for (const b of render.blocks) {
      if (b.visibility === "internal_only") {
        excluded.push({
          code: "internal_block_excluded",
          message: `Internal-only block "${b.heading}" will not be shown to non-internal recipients.`,
          blockKey: b.key,
        });
      }
    }
  }

  /* blocked — NDA-restricted deal going to a non-internal
   * recipient. deal_settings is comms' own schema (allowed SQL). */
  if (dealId && hasExternalRecipient) {
    let restricted: boolean | null = null;
    try {
      await ensureComms();
      const db = sql();
      const rows = await db`
        SELECT nda_restricted FROM comms.deal_settings
        WHERE deal_id = ${dealId} LIMIT 1`;
      restricted = rows.length
        ? Boolean((rows[0] as Record<string, unknown>).nda_restricted)
        : false;
    } catch {
      restricted = null;
    }
    if (restricted === true) {
      blocked.push({
        code: "nda_restricted",
        message:
          "This deal is marked NDA-restricted; the report cannot be sent to non-internal recipients without an override.",
      });
    } else if (restricted === null) {
      flagged.push({
        code: "nda_check_unavailable",
        message:
          "The deal's NDA restriction setting could not be verified for this check.",
      });
    }
  }

  /* blocked — foreign figures. Structural assertion: assembly
   * stamps every real figure's sourceId with the owning entity id,
   * so a figure whose sourceId is none of the report's subject ids
   * (and not the sample stamp) does not belong in this report. */
  const subjectIds = new Set(
    [companyId, dealId, personId].filter(
      (v): v is string => typeof v === "string" && v !== ""
    )
  );
  if (subjectIds.size) {
    for (const f of appendix) {
      const sid = str(f.sourceId);
      if (!sid || sid === "sample") continue;
      if (!subjectIds.has(sid)) {
        blocked.push({
          code: "foreign_figure",
          message: `Figure "${f.label}" (${f.key}) comes from a different subject than this report and must be removed before sending.`,
        });
      }
    }
  }

  /* flagged — unreviewed figures (NOT blocking, per contract). */
  const unreviewedCount = appendix.filter(
    (f) => f.verification === "unreviewed"
  ).length;
  const hasUnreviewed =
    (report.hasUnreviewed ?? report.has_unreviewed ?? false) ||
    unreviewedCount > 0;
  if (hasUnreviewed) {
    flagged.push({
      code: "unreviewed_figures",
      message:
        unreviewedCount > 0
          ? `${unreviewedCount} figure${unreviewedCount === 1 ? " is" : "s are"} unreviewed (draft analysis, manual entry, or sample data).`
          : "This report contains unreviewed figures.",
    });
  }

  /* flagged — narrative could not be produced. */
  if (narrativeStatus === "setup_required" || narrativeStatus === "error") {
    flagged.push({
      code: "narrative_unavailable",
      message:
        narrativeStatus === "setup_required"
          ? "Narrative generation is not set up (AI provider not configured); narrative blocks are empty or manual."
          : "The last narrative generation run failed; narrative blocks may be incomplete.",
    });
  }

  /* flagged — a sample report going to a real recipient. */
  if (isSample && (recipients ?? []).length > 0) {
    flagged.push({
      code: "sample_report",
      message:
        "This is a SAMPLE report built from canned data — it must not be relied on by recipients.",
    });
  }

  return { blocked, flagged, excluded };
}

import { getDealContext, type DealContext } from "../diligence/service";
import {
  getPublishedAnalysis,
  getWorkingCapital,
  getCurrentAnalysis,
} from "../finanalysis/service";
import type {
  AnalysisPayload,
  DealScreenData,
  WorkingCapitalData,
} from "../finanalysis/types";
import { getValuationParams, type ValuationParams } from "./economics";

/**
 * Deal screen summary (Phase 7, WS-B) — a READ-ONLY assembly.
 *
 * NO number is recomputed or re-entered here: adjusted/reported
 * EBITDA, the deal-screen grid and the working-capital peg all come
 * verbatim from the finanalysis payload / services
 * (getPublishedAnalysis — approved analyses only — and
 * getWorkingCapital, whose approved-only gate is authoritative and is
 * surfaced verbatim as {available, data|reason}). Deal/company
 * identity resolves through lib/diligence/service.getDealContext.
 */

export interface ScreenAnalysisMeta {
  id: string | null;
  status: string;
  generatedAt: string;
  approvedBy: string | null;
  approvedAt: string | null;
}

export interface DealScreenSummary {
  deal: DealContext;
  companyId: string | null;
  analysis: ScreenAnalysisMeta | null;
  adjustedEbitda: number | null;
  reportedEbitda: number | null;
  workingCapital:
    | { available: true; data: WorkingCapitalData }
    | { available: false; reason: string };
  dealScreen: DealScreenData | null;
  valuationParams: ValuationParams;
}

/**
 * Analysis metadata for a published payload. The published service
 * returns the payload only; the record id / approver stamps live on
 * the analysis record, reachable via getCurrentAnalysis. Those stamps
 * are used ONLY when the current analysis is the approved one that
 * produced this exact payload (same generatedAt) — otherwise the
 * honest fallback is status 'approved' (publication implies it) with
 * null stamps. No figure ever comes from this path.
 */
async function analysisMeta(
  companyId: string,
  published: AnalysisPayload
): Promise<ScreenAnalysisMeta> {
  try {
    const cur = await getCurrentAnalysis(companyId);
    if (
      cur &&
      cur.analysis.status === "approved" &&
      cur.payload.generatedAt === published.generatedAt
    ) {
      return {
        id: cur.analysis.id,
        status: cur.analysis.status,
        generatedAt: published.generatedAt,
        approvedBy: cur.analysis.approvedBy,
        approvedAt: cur.analysis.approvedAt,
      };
    }
  } catch {
    /* fall through to the honest fallback below */
  }
  return {
    id: null,
    status: "approved",
    generatedAt: published.generatedAt,
    approvedBy: null,
    approvedAt: null,
  };
}

export async function getDealScreenSummary(
  dealId: string
): Promise<DealScreenSummary> {
  const deal = await getDealContext(dealId);
  if (!deal) throw new Error("deal_not_found");
  const companyId = deal.companyId;
  const valuationParams = await getValuationParams();

  if (!companyId) {
    return {
      deal,
      companyId: null,
      analysis: null,
      adjustedEbitda: null,
      reportedEbitda: null,
      workingCapital: { available: false, reason: "no_company_linked" },
      dealScreen: null,
      valuationParams,
    };
  }

  const published = await getPublishedAnalysis(companyId);
  const workingCapital = await getWorkingCapital(companyId);

  if (!published) {
    return {
      deal,
      companyId,
      analysis: null,
      adjustedEbitda: null,
      reportedEbitda: null,
      workingCapital,
      dealScreen: null,
      valuationParams,
    };
  }

  return {
    deal,
    companyId,
    analysis: await analysisMeta(companyId, published),
    adjustedEbitda: published.marginBridge?.adjustedEbitda ?? null,
    reportedEbitda: published.marginBridge?.reportedEbitda ?? null,
    workingCapital,
    // The payload's stored DealScreenData, verbatim.
    dealScreen: published.dealScreen ?? null,
    valuationParams,
  };
}

/**
 * Shared types for the platform data layer (Phase 1 restructure).
 * The company is the central entity; every module links to it by ID.
 */

export type CompanyStage = "pipeline" | "diligence" | "portfolio";

export type RagStatus = "green" | "amber" | "red";

export interface CompanyCard {
  id: string;
  name: string;
  vertical: string;
  stage: CompanyStage;
  dealStage: string;
  city: string;
  state: string;
  lat: number | null;
  lng: number | null;
  thesisFit: string;
  ownerContext: string;
  nextAction: string;
  lastActivityAt: string | null;
  rag: RagStatus | null;
  logoUrl: string;
  heroUrl: string;
  /** Deal Identity (Oct 24, 2026): stored-logo version (0 = none —
   *  surfaces render the monogram), accent color, website domain. */
  logoVersion: number;
  logoSource: string;
  accentColor: string;
  accentSuggested: string;
  website: string;
}

export interface CapitalStack {
  dealId: string;
  companyId: string | null;
  companyName: string;
  /** Deal Identity: stored-logo version (0 = monogram). */
  logoVersion?: number;
  debt: number;
  equity: number;
  sellerNote: number;
  rollover: number;
  total: number;
}

export interface NeedsAttentionItem {
  kind: string;
  label: string;
  detail: string;
  href: string;
  at: string;
}

export interface OverviewSummary {
  dealsByStage: Record<string, number>;
  totalDeals: number;
  openTasks: number;
  upcomingFollowUps: number;
  capitalCommitted: number;
  capitalNeeded: number;
  portfolioCount: number;
  ragCounts: { green: number; amber: number; red: number };
  heatmap: {
    verticals: string[];
    stages: string[];
    cells: Record<string, number>; // key: `${vertical}|${stage}`
  };
  capitalStacks: CapitalStack[];
  needsAttention: NeedsAttentionItem[];
  updatedAt: string | null;
}

export type SearchItemKind =
  | "company"
  | "person"
  | "organization"
  | "document"
  | "task"
  | "note";

export interface SearchItem {
  kind: SearchItemKind;
  id: string;
  title: string;
  subtitle: string;
  href: string;
  updatedAt: string | null;
  /** Deal Identity: stored-logo version for company/organization
   *  results, so the palette renders the mark (0/absent = monogram). */
  logoVersion?: number;
}

export interface JobRow {
  id: string;
  kind: string;
  payload: Record<string, unknown>;
  status: string;
  attempts: number;
  lastError: string;
  runAfter: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface IntegrationStatus {
  key: string;
  name: string;
  /**
   * ok — healthy; error — a real failure; check — a cross-reference
   * verdict that needs attention (amber, not red); skipped — the run
   * deliberately did not execute (e.g. staleness guard); unknown —
   * not configured / never verified.
   */
  status: "ok" | "error" | "unknown" | "check" | "skipped";
  lastSuccessAt: string | null;
  lastError: string | null;
  detail: string;
  /** Nested rows (Market Intel per-dataset detail under its rollup). */
  children?: IntegrationStatus[];
}

export interface DuplicatePair {
  kind: string;
  aId: string;
  aName: string;
  bId: string;
  bName: string;
  reason: string;
  score: number;
}

export interface Participant {
  id: string;
  dealId: string;
  entityKind: string;
  entityId: string;
  entityName: string;
  /** Alias of entityName for UI consumers. */
  name: string;
  role: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface TimelineItem {
  id: string;
  kind: string;
  actor: string;
  message: string;
  source: string;
  createdAt: string;
  /** Alias of createdAt for UI consumers. */
  at: string;
}

export interface CompanyDetail {
  company: CompanyCard & {
    source: string;
    gallery: string[];
    notes: string;
    logoMime: string;
    logoUpdatedAt: string | null;
    legacyDealId: string | null;
    legacyMiId: string | null;
    createdAt: string;
    updatedAt: string;
  };
  participants: Participant[];
  timeline: TimelineItem[];
  linked: {
    deals: {
      id: string;
      /** Company name from the legacy deal record (display label). */
      name: string;
      companyId: string | null;
      stage: string;
      updatedAt: string;
    }[];
    tasks: { id: string; title: string; dueDate: string; done: boolean; owner: string }[];
    documents: {
      id: string;
      name: string;
      mime: string;
      sizeBytes: number;
      storageUrl: string;
      companyId: string | null;
      dealId: string | null;
      createdAt: string;
      /** Alias of createdAt for UI consumers. */
      at: string;
    }[];
  };
}

export function emptyOverviewSummary(): OverviewSummary {
  return {
    dealsByStage: {},
    totalDeals: 0,
    openTasks: 0,
    upcomingFollowUps: 0,
    capitalCommitted: 0,
    capitalNeeded: 0,
    portfolioCount: 0,
    ragCounts: { green: 0, amber: 0, red: 0 },
    heatmap: { verticals: [], stages: [], cells: {} },
    capitalStacks: [],
    needsAttention: [],
    updatedAt: null,
  };
}

export const DEAL_STAGES = [
  "Sourcing",
  "Initial Contact",
  "Diligence",
  "Negotiation",
  "Closing",
  "Closed Won",
  "Passed",
] as const;

export type DealStage = (typeof DEAL_STAGES)[number];

export interface DealLink {
  label: string;
  url: string;
}

export interface Deal {
  id: string;
  companyName: string;
  industry: string;
  stage: DealStage;
  dealValue: number;
  /** Annual revenue, if known. */
  revenue: number | null;
  /** Annual EBITDA, if known. */
  ebitda: number | null;
  /** Asking price, if known. */
  askingPrice: number | null;
  /** Broker / intermediary name, if any. */
  broker: string;
  /** How this target was sourced. */
  source: string;
  contactName: string;
  contactEmail: string;
  notes: string;
  owner: string;
  city: string;
  lat: number | null;
  lng: number | null;
  links: DealLink[];
  /** IDs of executives (operators) paired with this deal. */
  operatorIds: string[];
  createdAt: string;
  updatedAt: string;
}

export const EXEC_STAGES = [
  "Sourcing",
  "Screening",
  "Interview",
  "Reference Check",
  "Offer",
  "Placed",
  "Passed",
] as const;

export type ExecStage = (typeof EXEC_STAGES)[number];

export interface Executive {
  id: string;
  name: string;
  currentTitle: string;
  targetRole: string;
  stage: ExecStage;
  background: string;
  notes: string;
  owner: string;
  /** Industry / sector expertise, e.g. ["Industrial Services", "Healthcare"]. */
  industries: string[];
  createdAt: string;
  updatedAt: string;
}

export interface Partner {
  id: string;
  name: string;
  email: string;
}

export const PARTNER_NAMES = [
  "Ethan Canny",
  "Ronan Canny",
  "Ian Canny",
] as const;

// --- Tasks & follow-ups ---

export type TaskRelatedKind = "deal" | "executive";

export interface Task {
  id: string;
  title: string;
  dueDate: string; // yyyy-mm-dd or ""
  done: boolean;
  owner: string; // partner name or ""
  relatedKind: TaskRelatedKind | null;
  relatedId: string | null;
  relatedName: string; // denormalized for display
  createdAt: string;
  updatedAt: string;
}

// --- Activity feed ---

export interface Contact {
  id: string;
  name: string;
  role: string;
  email: string;
  phone: string;
  linkedin: string;
  notes: string;
  dealId: string | null;
  execId: string | null;
  owner: string;
  createdAt: string;
  updatedAt: string;
}

export type InteractionKind = "call" | "email" | "meeting" | "note";

export interface Interaction {
  id: string;
  dealId: string | null;
  execId: string | null;
  kind: InteractionKind;
  occurredAt: string;
  summary: string;
  createdAt: string;
}

export interface Attachment {
  id: string;
  dealId: string;
  filename: string;
  mimeType: string;
  size: number;
  /** base64-encoded file bytes */
  data: string;
  createdAt: string;
}

export type DealFlowKind =
  | "business_for_sale"
  | "operator_available"
  | "market_note";

export type DealFlowStatus = "new" | "reviewed" | "added" | "dismissed";

export interface DealFlowItem {
  id: string;
  kind: DealFlowKind;
  title: string;
  source: string;
  sourceDetail: string;
  spottedAt: string;
  why: string;
  industry: string;
  location: string;
  status: DealFlowStatus;
  relatedDealId: string | null;
  relatedExecId: string | null;
  createdAt: string;
  updatedAt: string;
}

export type ActivityType =
  | "deal.created"
  | "deal.updated"
  | "deal.stage"
  | "deal.claim"
  | "deal.operators"
  | "deal.deleted"
  | "deal.contact"
  | "deal.interaction"
  | "deal.attachment"
  | "flow.created"
  | "flow.converted"
  | "exec.created"
  | "exec.updated"
  | "exec.stage"
  | "exec.claim"
  | "exec.deleted"
  | "task.created"
  | "task.completed"
  | "task.reopened"
  | "task.deleted";

export interface ActivityEvent {
  id: string;
  type: ActivityType;
  actor: string;
  message: string;
  dealId: string | null;
  execId: string | null;
  dealName: string | null;
  execName: string | null;
  createdAt: string;
}

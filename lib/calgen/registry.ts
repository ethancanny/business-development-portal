/**
 * Phase 2 — Generated-event source registry.
 *
 * The plug-in point for later modules: each source kind declares its
 * display label + color once, here. A kind only produces rows when a
 * generator is registered for it in GENERATED_EVENT_GENERATORS
 * (service.ts) — kinds without a generator are listed so the UI can
 * show the full layer taxonomy, but they contribute no events yet.
 *
 * Colors are drawn from the portal palette: brand gold/navy plus the
 * five sector colors in lib/sector-colors.ts, kept distinct per kind.
 */

export type GeneratedEventKind =
  | "task"
  | "milestone"
  | "deadline"
  | "reporting"
  | "covenant"
  | "capital_call"
  | "closing"
  | "meeting"
  | "report"
  | "dataroom";

export interface GeneratedEventSource {
  kind: GeneratedEventKind;
  label: string;
  color: string;
}

export const GENERATED_EVENT_SOURCES: GeneratedEventSource[] = [
  // Brand gold — the only kind with a generator today (legacy follow-ups).
  { kind: "task", label: "Tasks & follow-ups", color: "#b8975a" },
  // A&D sector blue.
  { kind: "milestone", label: "Diligence milestones", color: "#3B5B84" },
  // Deadline red-adjacent but kept muted / distinct from aging red.
  { kind: "deadline", label: "Deadlines", color: "#B03A2E" },
  // Healthcare teal.
  { kind: "reporting", label: "Reporting due", color: "#2F7F79" },
  // Trades olive.
  { kind: "covenant", label: "Covenant tests", color: "#8A7A2E" },
  // Advanced Manufacturing copper.
  { kind: "capital_call", label: "Capital calls", color: "#B5703A" },
  // Deep navy — closings are the terminal deal event.
  { kind: "closing", label: "Closings", color: "#0d1f3c" },
  // Slate blue (stage progression family).
  { kind: "meeting", label: "Investor/board meetings", color: "#5B7BA6" },
  // Warm bronze — Communications report drafts + scheduled report runs (Part 12).
  { kind: "report", label: "Report drafts", color: "#946B2D" },
  // Hospitality plum.
  { kind: "dataroom", label: "Data room expirations", color: "#7A4E7E" },
];

export const GENERATED_KIND_SET = new Set<string>(
  GENERATED_EVENT_SOURCES.map((s) => s.kind)
);

export function sourceForKind(
  kind: string
): GeneratedEventSource | undefined {
  return GENERATED_EVENT_SOURCES.find((s) => s.kind === kind);
}

export function colorForKind(kind: string): string {
  return sourceForKind(kind)?.color ?? "#64748B";
}

export function labelForKind(kind: string): string {
  return sourceForKind(kind)?.label ?? kind;
}

/** A row a generator produces — service.ts upserts these by
 * (source_kind, source_id) and deletes stale rows of that kind. */
export interface GeneratedEventInput {
  sourceId: string;
  title: string;
  startsAt: string; // ISO instant
  endsAt?: string | null;
  allDay?: boolean;
  dealId?: string | null;
  companyId?: string | null;
  href: string;
  status?: string;
  meta?: Record<string, unknown>;
}

export type GeneratedEventGenerator = () => Promise<GeneratedEventInput[]>;

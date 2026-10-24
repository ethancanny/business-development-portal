import { ensurePlatformSchema, sql } from "../platform/db";

/**
 * Workflow module schema (Phase 10) — stage-gate rules + overrides in
 * the `workflow` Postgres schema (PROJECT_RULES.md module boundaries).
 * Pattern mirrors lib/financials/schema.ts: module-level cached
 * promise, reset on error, idempotent CREATEs + seed, safe on every
 * request.
 *
 * Stage gates are data, not code: gate_rules rows say which condition
 * must hold before a deal may ENTER a target stage. Admins toggle
 * `enabled` from Settings (StageGatesCard). gate_overrides is the
 * append-only record of every partner-approved bypass — who moved the
 * deal, from/to which stage, why, and which conditions were bypassed.
 * No financial figures are stored here (condition keys/labels only).
 */

export interface GateConditionDef {
  key: string;
  defaultLabel: string;
  description: string;
}

/** The condition catalog — every evaluator lib/workflow/gates.ts knows. */
export const CONDITION_CATALOG: GateConditionDef[] = [
  {
    key: "contact_recorded",
    defaultLabel: "A contact name or email is recorded on the deal",
    description:
      "The legacy deal record carries a non-empty contact name or contact email.",
  },
  {
    key: "financials_posted",
    defaultLabel: "Financial statements are posted for the company",
    description:
      "At least one current, posted statement set exists for the deal's company (financials service).",
  },
  {
    key: "data_room_created",
    defaultLabel: "A data room exists for the deal",
    description:
      "A data room of any status is resolved for the deal (dataroom service).",
  },
  {
    key: "diligence_workspace_created",
    defaultLabel: "A diligence workspace exists for the deal",
    description:
      "A due-diligence workspace exists for the deal (diligence service).",
  },
  {
    key: "ic_memo_approved",
    defaultLabel: "The IC memo is approved",
    description:
      "The deal's current IC memo has status 'approved' (diligence memo service).",
  },
  {
    key: "closing_checklist_complete",
    defaultLabel:
      "The closing checklist is complete (all items done/waived/N/A, at least one item)",
    description:
      "The diligence workspace's closing checklist has at least one item and every item is in a terminal status (done / waived / na).",
  },
];

export interface DefaultGateRule {
  id: string;
  targetStage: string;
  conditionKey: string;
  label: string;
  sort: number;
}

/**
 * Default rules seeded on first ensure (ON CONFLICT DO NOTHING).
 *
 * Stage names follow the Investment Types Step 1 model (Oct 24,
 * 2026): the bd migration remapped the LIVE gate_rules rows with
 * Ethan's approved map (Negotiation → LOI, Closing → Financing,
 * Closed Won → Closed) and retired the Initial Contact rules
 * (Sourced is the ungated entry stage). The seeds must carry the
 * same names: a seed whose id already exists under a remapped stage
 * misses the (target_stage, condition_key) conflict arbiter and the
 * insert dies on the primary key — which made ensureWorkflow throw
 * on every call and took down ALL gate evaluation (every
 * stage-changing deal PUT except to Passed/Sourced) from the Step 1
 * deploy until this fix. Ids are unchanged — they are the live
 * rows' identities.
 */
export const DEFAULT_GATE_RULES: DefaultGateRule[] = [
  {
    id: "gate_diligence_financials_posted",
    targetStage: "Diligence",
    conditionKey: "financials_posted",
    label: "Financial statements are posted for the company",
    sort: 10,
  },
  {
    id: "gate_diligence_data_room_created",
    targetStage: "Diligence",
    conditionKey: "data_room_created",
    label: "A data room exists for the deal",
    sort: 20,
  },
  {
    id: "gate_negotiation_diligence_workspace_created",
    targetStage: "LOI",
    conditionKey: "diligence_workspace_created",
    label: "A diligence workspace exists for the deal",
    sort: 10,
  },
  {
    id: "gate_closing_ic_memo_approved",
    targetStage: "Financing",
    conditionKey: "ic_memo_approved",
    label: "The IC memo is approved",
    sort: 10,
  },
  {
    id: "gate_closed_won_closing_checklist_complete",
    targetStage: "Closed",
    conditionKey: "closing_checklist_complete",
    label:
      "The closing checklist is complete (all items done/waived/N/A, at least one item)",
    sort: 10,
  },
];

let schemaReady: Promise<void> | null = null;

export function ensureWorkflow(): Promise<void> {
  if (!schemaReady) {
    schemaReady = (async () => {
      await ensurePlatformSchema();
      const db = sql();
      await db`CREATE SCHEMA IF NOT EXISTS workflow`;

      await db`
        CREATE TABLE IF NOT EXISTS workflow.gate_rules (
          id TEXT PRIMARY KEY,
          target_stage TEXT NOT NULL DEFAULT '',
          condition_key TEXT NOT NULL DEFAULT '',
          label TEXT NOT NULL DEFAULT '',
          enabled BOOLEAN NOT NULL DEFAULT true,
          sort INT NOT NULL DEFAULT 0,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          UNIQUE (target_stage, condition_key)
        )`;
      await db`
        CREATE INDEX IF NOT EXISTS workflow_gate_rules_stage_idx
        ON workflow.gate_rules (target_stage, sort)`;

      await db`
        CREATE TABLE IF NOT EXISTS workflow.gate_overrides (
          id TEXT PRIMARY KEY,
          deal_id TEXT NOT NULL DEFAULT '',
          deal_name TEXT NOT NULL DEFAULT '',
          from_stage TEXT NOT NULL DEFAULT '',
          to_stage TEXT NOT NULL DEFAULT '',
          actor TEXT NOT NULL DEFAULT '',
          reason TEXT NOT NULL DEFAULT '',
          bypassed JSONB NOT NULL DEFAULT '[]',
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )`;
      await db`
        CREATE INDEX IF NOT EXISTS workflow_gate_overrides_deal_idx
        ON workflow.gate_overrides (deal_id, created_at DESC)`;

      for (const rule of DEFAULT_GATE_RULES) {
        // Bare ON CONFLICT DO NOTHING (any arbiter): a future stage
        // remap of the live rows must never turn this seed loop into
        // a throw again — see the DEFAULT_GATE_RULES note above.
        await db`
          INSERT INTO workflow.gate_rules
            (id, target_stage, condition_key, label, enabled, sort)
          VALUES (${rule.id}, ${rule.targetStage}, ${rule.conditionKey},
            ${rule.label}, true, ${rule.sort})
          ON CONFLICT DO NOTHING`;
      }
    })().catch((err) => {
      schemaReady = null;
      throw err;
    });
  }
  return schemaReady;
}

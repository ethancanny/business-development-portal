import { ensurePlatformSchema, sql } from "../platform/db";

/**
 * Diligence module schema (Phase 5) — owns its tables in the
 * `diligence` Postgres schema (PROJECT_RULES.md module boundaries).
 * Pattern mirrors lib/finanalysis/schema.ts: module-level cached
 * promise, reset on error, idempotent CREATEs, safe on every request.
 *
 * Boundary rules honored here:
 * - Data room data is consumed ONLY through lib/dataroom/service.ts
 *   (getRoomIndex / getRoomChecklist / listFolders / listRooms).
 * - Financial statement writes go ONLY through lib/financials/service.ts
 *   and adjustment decisions through lib/finanalysis/service.ts.
 * - File bytes NEVER enter Postgres: site-visit photos and similar are
 *   core.documents ids (data room / documents storage) only.
 * - BPMN XML is stored gzip-compressed in ONE bytea column per version
 *   row and is NEVER selected by list/card queries.
 * - Client financial figures NEVER appear in logs.
 */

export const WORKSTREAMS = [
  "financial",
  "tax",
  "legal",
  "operations",
  "commercial",
  "hr",
  "insurance",
  "environmental",
  "it",
] as const;
export type Workstream = (typeof WORKSTREAMS)[number];

export const WORKSTREAM_LABELS: Record<string, string> = {
  financial: "Financial",
  tax: "Tax",
  legal: "Legal",
  operations: "Operations",
  commercial: "Commercial",
  hr: "HR / People",
  insurance: "Insurance",
  environmental: "Environmental",
  it: "IT / Systems",
};

/**
 * Checklist statuses — workspace redesign (Oct 24, 2026). The 7-value
 * set Ethan specified. Legacy values are remapped by the marker-guarded
 * migration `dd-checklist-status-v2` in ensureDiligenceSchema():
 *   in_progress → in_review · reviewed → in_review · approved → complete
 *   waived → na · not_started / received / na unchanged.
 * "Done" for completion % = terminal statuses only (complete, na).
 */
export const CHECKLIST_STATUSES = [
  "not_started",
  "requested",
  "received",
  "in_review",
  "issue",
  "complete",
  "na",
] as const;
export type ChecklistStatus = (typeof CHECKLIST_STATUSES)[number];

export const CHECKLIST_PRIORITIES = ["high", "normal", "low"] as const;
export type ChecklistPriority = (typeof CHECKLIST_PRIORITIES)[number];

export const REQUEST_ITEM_STATUSES = [
  "requested",
  "received",
  "waived",
] as const;

export const RED_FLAG_SEVERITIES = ["high", "medium", "low"] as const;
export const RED_FLAG_STATUSES = [
  "candidate",
  "open",
  "mitigating",
  "resolved",
  "dismissed",
] as const;

export const FINDING_TERM_TYPES = [
  "working_capital_peg",
  "holdback",
  "earnout",
  "price_adjustment",
  "escrow",
  "representation",
  // Added Oct 24, 2026 (workspace redesign): outcome options Ethan
  // named for new findings. Existing rows keep their original values.
  "indemnity",
  "closing_condition",
  "walk_away",
  "other",
] as const;
export const FINDING_STATUSES = ["proposed", "accepted", "rejected"] as const;

export const CLOSING_CATEGORIES = [
  "funds_flow",
  "signature_pages",
  "third_party_consents",
  "payoff_letters",
  "escrow_instructions",
  "post_closing",
  "other",
] as const;
export const CLOSING_STATUSES = ["open", "done", "waived"] as const;

export const LICENSE_TRANSFERABILITY = [
  "transferable",
  "consent_required",
  "non_transferable",
  "unknown",
] as const;

export const ADJUSTMENT_KIND_LABELS: Record<string, string> = {
  owner_comp: "Owner compensation",
  related_party_rent: "Related-party rent",
  one_time_fees: "One-time fees",
  nonrecurring: "Non-recurring items",
  anomaly_addback: "Anomaly add-back",
  other: "Other",
};

/** The five as-is process maps every workspace carries (spec §12). */
export const PROCESS_DEFS = [
  { key: "order_to_cash", name: "Order to Cash" },
  { key: "procure_to_pay", name: "Procure to Pay" },
  { key: "hire_to_retire", name: "Hire to Retire" },
  { key: "record_to_report", name: "Record to Report" },
  { key: "service_delivery", name: "Production / Service Delivery" },
] as const;
export type ProcessKey = (typeof PROCESS_DEFS)[number]["key"];

/** Default diligence checklist seeded on workspace creation. */
export const CHECKLIST_TEMPLATE: Array<{
  workstream: Workstream;
  title: string;
}> = [
  // Financial
  { workstream: "financial", title: "Financial statements — last 3 fiscal years" },
  { workstream: "financial", title: "Interim financial statements (YTD + prior-year period)" },
  { workstream: "financial", title: "Monthly financials — trailing 24 months" },
  { workstream: "financial", title: "Accounts receivable aging (current + 2 prior year-ends)" },
  { workstream: "financial", title: "Accounts payable aging" },
  { workstream: "financial", title: "Debt schedule & all loan / credit agreements" },
  { workstream: "financial", title: "CapEx history (3 years) & maintenance CapEx estimate" },
  { workstream: "financial", title: "Revenue by customer — last 3 years" },
  { workstream: "financial", title: "Backlog / contracted revenue detail" },
  { workstream: "financial", title: "Working capital detail by month (TTM)" },
  // Tax
  { workstream: "tax", title: "Federal income tax returns — last 3 years" },
  { workstream: "tax", title: "State income / franchise tax returns — last 3 years" },
  { workstream: "tax", title: "Sales & use tax filings / exposure analysis" },
  { workstream: "tax", title: "Payroll tax filings (941 / 940 / state)" },
  { workstream: "tax", title: "Entity formation & election documents (2553 / 8832 / 1065)" },
  { workstream: "tax", title: "Open audits, notices & correspondence (IRS / state)" },
  { workstream: "tax", title: "NOL / credit carryforward schedules" },
  // Legal
  { workstream: "legal", title: "Formation documents, bylaws / operating agreement & good standing" },
  { workstream: "legal", title: "Cap table & all equity records / issuances" },
  { workstream: "legal", title: "Material contracts (see contract register)" },
  { workstream: "legal", title: "Litigation, claims & contingent liabilities" },
  { workstream: "legal", title: "IP registrations, licenses & assignments" },
  { workstream: "legal", title: "Real estate leases & owned property documents" },
  { workstream: "legal", title: "Corporate minutes & consents" },
  // Operations
  { workstream: "operations", title: "Org chart & key personnel summary" },
  { workstream: "operations", title: "Standard operating procedures / process documentation" },
  { workstream: "operations", title: "Supplier list, terms & concentration" },
  { workstream: "operations", title: "Equipment list, age & condition" },
  { workstream: "operations", title: "Facility list, capacity & utilization" },
  // Commercial
  { workstream: "commercial", title: "Customer list & revenue concentration (top 20)" },
  { workstream: "commercial", title: "Pricing, discount & rebate policies" },
  { workstream: "commercial", title: "Sales pipeline, win / loss history" },
  { workstream: "commercial", title: "Marketing spend by channel & lead sources" },
  // HR
  { workstream: "hr", title: "Employee census (role, comp, tenure, location)" },
  { workstream: "hr", title: "Employment agreements, offer letters & non-competes" },
  { workstream: "hr", title: "Employee handbook & HR policies" },
  { workstream: "hr", title: "Benefits plans, costs & 401(k) documents" },
  { workstream: "hr", title: "Workers' comp claims & OSHA history" },
  { workstream: "hr", title: "Independent contractor list & classification" },
  // Insurance
  { workstream: "insurance", title: "All insurance policies (GL, property, WC, cyber, D&O)" },
  { workstream: "insurance", title: "Loss runs / claims history — 3 years" },
  { workstream: "insurance", title: "Certificates of insurance & broker contact" },
  // Environmental
  { workstream: "environmental", title: "Phase I / II environmental reports (if any)" },
  { workstream: "environmental", title: "Environmental permits & compliance history" },
  { workstream: "environmental", title: "Hazardous materials inventory & handling" },
  // IT
  { workstream: "it", title: "Systems & software inventory (incl. accounting system)" },
  { workstream: "it", title: "IT contracts, licenses & renewal dates" },
  { workstream: "it", title: "Cybersecurity policies, incidents & access controls" },
  { workstream: "it", title: "Backup, recovery & business continuity procedures" },
];

/**
 * Template packs (workspace redesign, Oct 24, 2026). Applied ONLY at
 * workspace creation (selected from the deal's investment type /
 * industry) or via the explicit apply-template action, which inserts
 * only titles not already present. A pack change NEVER mutates an
 * existing workspace's items.
 */
export const TEMPLATE_PACKS: Record<
  string,
  {
    label: string;
    appliesTo: string;
    items: Array<{ workstream: Workstream; title: string }>;
  }
> = {
  base: {
    label: "Standard diligence checklist",
    appliesTo: "Every workspace (seeded at creation)",
    items: CHECKLIST_TEMPLATE,
  },
  ad: {
    label: "Aerospace & Defense pack",
    appliesTo: "Deals in Aerospace & Defense",
    items: [
      { workstream: "legal", title: "ITAR / EAR export compliance review & registrations" },
      { workstream: "legal", title: "Government contracts inventory, novation & change-of-control consents" },
      { workstream: "operations", title: "Quality certifications (AS9100 / ISO 9001) & audit history" },
      { workstream: "operations", title: "DCAA-compliant accounting system adequacy & incurred-cost submissions" },
      { workstream: "hr", title: "Facility / personnel security clearances & FOCI review" },
      { workstream: "it", title: "CMMC / NIST 800-171 cybersecurity posture & CUI handling" },
      { workstream: "financial", title: "Government receivables, progress payments & contract backlog by program" },
    ],
  },
  addon: {
    label: "Add-on integration pack",
    appliesTo: "Add-on acquisitions",
    items: [
      { workstream: "operations", title: "Integration plan & Day-1 readiness checklist" },
      { workstream: "commercial", title: "Customer / product overlap & cross-sell analysis" },
      { workstream: "it", title: "Systems migration & data conversion plan" },
      { workstream: "hr", title: "Key employee retention & platform reporting lines" },
      { workstream: "financial", title: "Synergy case (revenue / cost) with owners & timing" },
    ],
  },
  early_stage: {
    label: "Early stage pack",
    appliesTo: "Early stage investments",
    items: [
      { workstream: "legal", title: "Founder documents, IP assignments & invention agreements" },
      { workstream: "legal", title: "Cap table cleanup, SAFEs / notes & prior financings" },
      { workstream: "commercial", title: "Customer references & pipeline verification calls" },
      { workstream: "financial", title: "Runway, burn & use-of-proceeds model" },
    ],
  },
};

/** Pack keys a new workspace receives, from its deal context. */
export function templatePacksForDeal(input: {
  investmentType?: string | null;
  industry?: string | null;
}): string[] {
  const packs: string[] = [];
  const industry = (input.industry ?? "").toLowerCase();
  if (/aerospace|defense|defence/.test(industry)) packs.push("ad");
  if (input.investmentType === "addon") packs.push("addon");
  if (input.investmentType === "early_stage") packs.push("early_stage");
  return packs;
}

/** Controls & systems scorecard areas (spec §8), scored 1–5. */
export const SCORECARD_AREAS = [
  { key: "accounting_system", label: "Accounting system" },
  { key: "close_process", label: "Close process" },
  { key: "segregation_of_duties", label: "Segregation of duties" },
  { key: "soc_reports", label: "SOC reports" },
  { key: "it_security", label: "IT security basics" },
] as const;

/** 338(h)(10) eligibility checklist (spec §7). */
export const SECTION_338_ITEMS = [
  { key: "target_is_corp", label: "Target is a corporation (C or S corp)" },
  { key: "buyer_is_corp", label: "Purchasing party is a corporation" },
  { key: "qsp", label: "Qualified stock purchase (≥80% vote & value) within 12 months" },
  { key: "election_deadline", label: "Election filed by the 15th day of the 9th month after the acquisition month" },
  { key: "s_corp_consent", label: "For an S corp: all shareholders consent to the election" },
  { key: "form_8023", label: "Form 8023 prepared / reviewed by tax counsel" },
] as const;

let schemaReady: Promise<void> | null = null;

export function ensureDiligenceSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = (async () => {
      await ensurePlatformSchema();
      const db = sql();
      await db`CREATE SCHEMA IF NOT EXISTS diligence`;

      await db`
        CREATE TABLE IF NOT EXISTS diligence.workspaces (
          id TEXT PRIMARY KEY,
          deal_id TEXT NOT NULL,
          company_id TEXT,
          status TEXT NOT NULL DEFAULT 'active',
          notes TEXT NOT NULL DEFAULT '',
          created_by TEXT NOT NULL DEFAULT '',
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          deleted_at TIMESTAMPTZ
        )`;
      await db`
        CREATE UNIQUE INDEX IF NOT EXISTS diligence_workspaces_deal_live_uidx
        ON diligence.workspaces (deal_id) WHERE deleted_at IS NULL`;

      await db`
        CREATE TABLE IF NOT EXISTS diligence.checklist_items (
          id TEXT PRIMARY KEY,
          workspace_id TEXT NOT NULL,
          workstream TEXT NOT NULL DEFAULT 'financial',
          title TEXT NOT NULL,
          owner TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT 'not_started',
          due_date DATE,
          notes TEXT NOT NULL DEFAULT '',
          dataroom_checklist_item_id TEXT,
          dataroom_document_id TEXT,
          sort INT NOT NULL DEFAULT 0,
          created_by TEXT NOT NULL DEFAULT '',
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          deleted_at TIMESTAMPTZ
        )`;
      await db`
        CREATE INDEX IF NOT EXISTS diligence_checklist_ws_idx
        ON diligence.checklist_items (workspace_id) WHERE deleted_at IS NULL`;

      await db`
        CREATE TABLE IF NOT EXISTS diligence.request_items (
          id TEXT PRIMARY KEY,
          workspace_id TEXT NOT NULL,
          checklist_item_id TEXT,
          dataroom_checklist_item_id TEXT,
          label TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'requested',
          last_requested_at TIMESTAMPTZ,
          responded_at TIMESTAMPTZ,
          response_notes TEXT NOT NULL DEFAULT '',
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          deleted_at TIMESTAMPTZ
        )`;
      await db`
        CREATE UNIQUE INDEX IF NOT EXISTS diligence_request_items_room_uidx
        ON diligence.request_items (workspace_id, dataroom_checklist_item_id)
        WHERE deleted_at IS NULL AND dataroom_checklist_item_id IS NOT NULL`;

      await db`
        CREATE TABLE IF NOT EXISTS diligence.request_sends (
          id TEXT PRIMARY KEY,
          workspace_id TEXT NOT NULL,
          recipient TEXT NOT NULL DEFAULT '',
          subject TEXT NOT NULL DEFAULT '',
          body TEXT NOT NULL DEFAULT '',
          channel TEXT NOT NULL DEFAULT 'mailto',
          item_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
          sent_by TEXT NOT NULL DEFAULT '',
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )`;

      await db`
        CREATE TABLE IF NOT EXISTS diligence.findings (
          id TEXT PRIMARY KEY,
          workspace_id TEXT NOT NULL,
          title TEXT NOT NULL,
          detail TEXT NOT NULL DEFAULT '',
          category TEXT NOT NULL DEFAULT '',
          severity TEXT NOT NULL DEFAULT 'medium',
          proposed_term_type TEXT NOT NULL DEFAULT 'other',
          proposed_term_detail TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT 'proposed',
          red_flag_id TEXT,
          decided_by TEXT,
          decided_at TIMESTAMPTZ,
          created_by TEXT NOT NULL DEFAULT '',
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          deleted_at TIMESTAMPTZ
        )`;

      await db`
        CREATE TABLE IF NOT EXISTS diligence.contracts (
          id TEXT PRIMARY KEY,
          workspace_id TEXT NOT NULL,
          counterparty TEXT NOT NULL DEFAULT '',
          contract_type TEXT NOT NULL DEFAULT '',
          title TEXT NOT NULL,
          effective_date DATE,
          expiry_date DATE,
          renewal_date DATE,
          auto_renew BOOLEAN NOT NULL DEFAULT false,
          change_of_control TEXT NOT NULL DEFAULT '',
          termination_terms TEXT NOT NULL DEFAULT '',
          key_terms TEXT NOT NULL DEFAULT '',
          annual_value NUMERIC,
          document_id TEXT,
          notes TEXT NOT NULL DEFAULT '',
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          deleted_at TIMESTAMPTZ
        )`;

      await db`
        CREATE TABLE IF NOT EXISTS diligence.licenses (
          id TEXT PRIMARY KEY,
          workspace_id TEXT NOT NULL,
          license_type TEXT NOT NULL,
          issuing_body TEXT NOT NULL DEFAULT '',
          license_number TEXT NOT NULL DEFAULT '',
          issued_date DATE,
          expiry_date DATE,
          transferability TEXT NOT NULL DEFAULT 'unknown',
          status TEXT NOT NULL DEFAULT 'active',
          notes TEXT NOT NULL DEFAULT '',
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          deleted_at TIMESTAMPTZ
        )`;

      await db`
        CREATE TABLE IF NOT EXISTS diligence.tax_profiles (
          id TEXT PRIMARY KEY,
          workspace_id TEXT NOT NULL,
          entity_type TEXT NOT NULL DEFAULT '',
          elections JSONB NOT NULL DEFAULT '[]'::jsonb,
          nexus_states JSONB NOT NULL DEFAULT '[]'::jsonb,
          sales_tax_exposure TEXT NOT NULL DEFAULT '',
          nol_amount NUMERIC,
          nol_notes TEXT NOT NULL DEFAULT '',
          credits TEXT NOT NULL DEFAULT '',
          rd_credits TEXT NOT NULL DEFAULT '',
          section_338 JSONB NOT NULL DEFAULT '{}'::jsonb,
          missing_return_years JSONB NOT NULL DEFAULT '[]'::jsonb,
          notes TEXT NOT NULL DEFAULT '',
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          deleted_at TIMESTAMPTZ
        )`;
      await db`
        CREATE UNIQUE INDEX IF NOT EXISTS diligence_tax_ws_uidx
        ON diligence.tax_profiles (workspace_id) WHERE deleted_at IS NULL`;

      await db`
        CREATE TABLE IF NOT EXISTS diligence.scorecards (
          id TEXT PRIMARY KEY,
          workspace_id TEXT NOT NULL,
          areas JSONB NOT NULL DEFAULT '{}'::jsonb,
          notes TEXT NOT NULL DEFAULT '',
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          deleted_at TIMESTAMPTZ
        )`;
      await db`
        CREATE UNIQUE INDEX IF NOT EXISTS diligence_scorecard_ws_uidx
        ON diligence.scorecards (workspace_id) WHERE deleted_at IS NULL`;

      await db`
        CREATE TABLE IF NOT EXISTS diligence.site_visits (
          id TEXT PRIMARY KEY,
          workspace_id TEXT NOT NULL,
          visit_date DATE,
          attendees JSONB NOT NULL DEFAULT '[]'::jsonb,
          observations TEXT NOT NULL DEFAULT '',
          photo_document_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
          facility_condition_score INT,
          capacity_notes TEXT NOT NULL DEFAULT '',
          utilization_estimate TEXT NOT NULL DEFAULT '',
          created_by TEXT NOT NULL DEFAULT '',
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          deleted_at TIMESTAMPTZ
        )`;

      await db`
        CREATE TABLE IF NOT EXISTS diligence.red_flags (
          id TEXT PRIMARY KEY,
          workspace_id TEXT NOT NULL,
          title TEXT NOT NULL,
          detail TEXT NOT NULL DEFAULT '',
          severity TEXT NOT NULL DEFAULT 'medium',
          owner TEXT NOT NULL DEFAULT '',
          mitigation TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT 'open',
          source TEXT NOT NULL DEFAULT 'manual',
          analysis_id TEXT,
          anomaly_key TEXT,
          anomaly_rule TEXT,
          source_set_id TEXT,
          period_end DATE,
          confirmed_by TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          deleted_at TIMESTAMPTZ
        )`;
      await db`
        CREATE UNIQUE INDEX IF NOT EXISTS diligence_red_flags_anomaly_uidx
        ON diligence.red_flags (workspace_id, anomaly_key)
        WHERE deleted_at IS NULL AND anomaly_key IS NOT NULL`;

      await db`
        CREATE TABLE IF NOT EXISTS diligence.closing_items (
          id TEXT PRIMARY KEY,
          workspace_id TEXT NOT NULL,
          category TEXT NOT NULL DEFAULT 'other',
          title TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'open',
          due_date DATE,
          completed_at TIMESTAMPTZ,
          notes TEXT NOT NULL DEFAULT '',
          sort INT NOT NULL DEFAULT 0,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          deleted_at TIMESTAMPTZ
        )`;

      await db`
        CREATE TABLE IF NOT EXISTS diligence.qoe_manual_adjustments (
          id TEXT PRIMARY KEY,
          workspace_id TEXT NOT NULL,
          company_id TEXT NOT NULL,
          reported_set_id TEXT NOT NULL,
          adjusted_set_id TEXT,
          kind TEXT NOT NULL DEFAULT 'other',
          label TEXT NOT NULL,
          amount NUMERIC,
          direction TEXT NOT NULL DEFAULT 'add',
          rationale TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT 'proposed',
          decided_by TEXT,
          decided_at TIMESTAMPTZ,
          decided_amount NUMERIC,
          created_by TEXT NOT NULL DEFAULT '',
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          deleted_at TIMESTAMPTZ
        )`;

      await db`
        CREATE TABLE IF NOT EXISTS diligence.bpmn_diagrams (
          id TEXT PRIMARY KEY,
          workspace_id TEXT NOT NULL,
          process_key TEXT NOT NULL,
          name TEXT NOT NULL,
          current_version INT NOT NULL DEFAULT 0,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          deleted_at TIMESTAMPTZ
        )`;
      await db`
        CREATE UNIQUE INDEX IF NOT EXISTS diligence_bpmn_ws_process_uidx
        ON diligence.bpmn_diagrams (workspace_id, process_key)
        WHERE deleted_at IS NULL`;

      // XML lives ONLY here, gzip-compressed in one bytea field per
      // version. List endpoints never select xml_gzip.
      await db`
        CREATE TABLE IF NOT EXISTS diligence.bpmn_versions (
          id TEXT PRIMARY KEY,
          diagram_id TEXT NOT NULL,
          version INT NOT NULL,
          xml_gzip BYTEA NOT NULL,
          saved_by TEXT NOT NULL DEFAULT '',
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )`;
      await db`
        CREATE INDEX IF NOT EXISTS diligence_bpmn_versions_diagram_idx
        ON diligence.bpmn_versions (diagram_id, version DESC)`;

      /* ---- Workspace redesign (Oct 24, 2026): additive columns ---- */
      await db`
        ALTER TABLE diligence.checklist_items
          ADD COLUMN IF NOT EXISTS priority TEXT NOT NULL DEFAULT 'normal'`;
      await db`
        ALTER TABLE diligence.checklist_items
          ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT ''`;
      await db`
        ALTER TABLE diligence.findings
          ADD COLUMN IF NOT EXISTS impact_amount NUMERIC`;
      await db`
        ALTER TABLE diligence.findings
          ADD COLUMN IF NOT EXISTS owner TEXT NOT NULL DEFAULT ''`;
      await db`
        ALTER TABLE diligence.findings
          ADD COLUMN IF NOT EXISTS checklist_item_id TEXT`;
      await db`
        ALTER TABLE diligence.workspaces
          ADD COLUMN IF NOT EXISTS loi_date DATE`;
      await db`
        ALTER TABLE diligence.workspaces
          ADD COLUMN IF NOT EXISTS exclusivity_expiry DATE`;
      await db`
        ALTER TABLE diligence.workspaces
          ADD COLUMN IF NOT EXISTS target_close_date DATE`;

      /* ---- Marker-guarded status remap: dd-checklist-status-v2 ----
       * Maps the legacy 7-value checklist status set onto the redesign
       * set (see CHECKLIST_STATUSES). Idempotent by construction (the
       * legacy values cease to exist), but marker-guarded so it runs
       * exactly once and is auditable. */
      await db`
        CREATE TABLE IF NOT EXISTS diligence.schema_migrations (
          key TEXT PRIMARY KEY,
          applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )`;
      const marker = await db`
        SELECT key FROM diligence.schema_migrations
        WHERE key = 'dd-checklist-status-v2' LIMIT 1`;
      if (!marker.length) {
        await db`
          UPDATE diligence.checklist_items SET status = 'in_review'
          WHERE status IN ('in_progress', 'reviewed')`;
        await db`
          UPDATE diligence.checklist_items SET status = 'complete'
          WHERE status = 'approved'`;
        await db`
          UPDATE diligence.checklist_items SET status = 'na'
          WHERE status = 'waived'`;
        await db`
          INSERT INTO diligence.schema_migrations (key)
          VALUES ('dd-checklist-status-v2')
          ON CONFLICT (key) DO NOTHING`;
      }
    })().catch((err) => {
      schemaReady = null;
      throw err;
    });
  }
  return schemaReady;
}

export const ensureDiligence = ensureDiligenceSchema;

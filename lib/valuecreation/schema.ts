import { ensurePlatformSchema, sql } from "../platform/db";

/**
 * Value Creation module schema (Phase 6) — owns its tables in the
 * `valuecreation` Postgres schema (PROJECT_RULES.md module boundaries).
 * Pattern mirrors lib/diligence/schema.ts: module-level cached promise,
 * reset on error, idempotent CREATEs, safe on every request.
 *
 * Boundary rules honored here:
 * - Financial data is consumed ONLY through lib/financials/service.ts
 *   (getCompanyFinancials).
 * - Diligence data is consumed ONLY through lib/diligence/service.ts
 *   and lib/diligence/bpmn.ts.
 * - File bytes NEVER enter Postgres; BPMN XML is stored gzip-compressed
 *   in ONE bytea field per version row (valuecreation.bpmn_versions)
 *   and is NEVER selected by list/card queries.
 * - Every record carries created_at / updated_at / deleted_at (soft
 *   delete) and a source column where sensible.
 */

export const INITIATIVE_STATUSES = [
  "planned",
  "in_progress",
  "on_track",
  "at_risk",
  "done",
  "deferred",
] as const;
export type InitiativeStatus = (typeof INITIATIVE_STATUSES)[number];

export const PLAYBOOK_CATEGORIES = [
  { key: "pricing", label: "Pricing" },
  { key: "procurement", label: "Procurement" },
  { key: "sales_comp", label: "Sales compensation" },
  { key: "working_capital", label: "Working capital" },
  { key: "org_design", label: "Org design" },
  { key: "systems", label: "Systems" },
] as const;

export const EXIT_AREAS = [
  { key: "financial_readiness", label: "Financial readiness" },
  { key: "management_depth", label: "Management depth" },
  { key: "customer_concentration", label: "Customer concentration" },
  { key: "systems", label: "Systems & reporting" },
  { key: "legal_compliance", label: "Legal / compliance cleanliness" },
] as const;

export const TARGET_METRICS = [
  "revenue",
  "ebitda",
  "gross_margin_pct",
  "ebitda_margin_pct",
] as const;
export type TargetMetric = (typeof TARGET_METRICS)[number];

/** System playbooks seeded idempotently by ensureValueCreation(). */
export const SYSTEM_PLAYBOOKS: Array<{
  slug: string;
  name: string;
  category: string;
  description: string;
  steps: Array<{
    title: string;
    description: string;
    typicalImpact: number;
    effort: number;
    durationDays: number;
    confidence: number;
  }>;
}> = [
  {
    slug: "pricing-optimization",
    name: "Pricing Optimization",
    category: "pricing",
    description:
      "Systematic price review, discount discipline, and value-based pricing to lift gross margin without volume loss.",
    steps: [
      {
        title: "Audit current pricing and discounting",
        description:
          "Pull realized pricing by customer, product, and rep; quantify discount leakage and below-floor deals.",
        typicalImpact: 45000,
        effort: 2,
        durationDays: 21,
        confidence: 0.9,
      },
      {
        title: "Implement price increase on renewals",
        description:
          "Apply a targeted 3–5% increase on renewal and new contracts, sequenced by customer sensitivity.",
        typicalImpact: 120000,
        effort: 3,
        durationDays: 45,
        confidence: 0.8,
      },
      {
        title: "Install discount approval matrix",
        description:
          "Set floor prices and an approval ladder for exceptions; track discount rate weekly.",
        typicalImpact: 35000,
        effort: 2,
        durationDays: 14,
        confidence: 0.85,
      },
      {
        title: "Reprice low-margin SKUs / services",
        description:
          "Reprice, bundle, or exit the bottom decile of SKUs/services by contribution margin.",
        typicalImpact: 60000,
        effort: 3,
        durationDays: 30,
        confidence: 0.7,
      },
    ],
  },
  {
    slug: "procurement-savings",
    name: "Procurement Savings",
    category: "procurement",
    description:
      "Vendor consolidation, renegotiation, and competitive sourcing across direct and indirect spend.",
    steps: [
      {
        title: "Spend analysis and vendor rationalization",
        description:
          "Categorize 12 months of AP spend; identify duplicate vendors and off-contract buying.",
        typicalImpact: 25000,
        effort: 2,
        durationDays: 21,
        confidence: 0.9,
      },
      {
        title: "Renegotiate top-10 vendor contracts",
        description:
          "Renegotiate pricing, terms, and rebates with the ten largest vendors using volume leverage.",
        typicalImpact: 90000,
        effort: 3,
        durationDays: 60,
        confidence: 0.75,
      },
      {
        title: "Competitive bid for indirect categories",
        description:
          "Run RFQs for insurance, freight, supplies, and facilities services; award on total cost.",
        typicalImpact: 55000,
        effort: 3,
        durationDays: 45,
        confidence: 0.7,
      },
      {
        title: "Implement purchase-order discipline",
        description:
          "Require POs above a threshold, block maverick spend, and review vendor scorecards quarterly.",
        typicalImpact: 20000,
        effort: 2,
        durationDays: 30,
        confidence: 0.8,
      },
    ],
  },
  {
    slug: "sales-comp-redesign",
    name: "Sales Compensation Redesign",
    category: "sales_comp",
    description:
      "Realign sales incentives to profitable growth: margin-weighted accelerators, clawbacks, and territory discipline.",
    steps: [
      {
        title: "Diagnose current comp plans and payouts",
        description:
          "Model payouts vs. margin by rep and deal; flag plans paying for unprofitable revenue.",
        typicalImpact: 15000,
        effort: 2,
        durationDays: 21,
        confidence: 0.9,
      },
      {
        title: "Redesign plans around gross margin",
        description:
          "Shift commission basis to gross margin with accelerators for strategic products and new logos.",
        typicalImpact: 70000,
        effort: 4,
        durationDays: 45,
        confidence: 0.65,
      },
      {
        title: "Add clawbacks and deal-desk review",
        description:
          "Claw back comp on churned or written-off accounts; deal desk reviews large discounts.",
        typicalImpact: 30000,
        effort: 2,
        durationDays: 21,
        confidence: 0.8,
      },
      {
        title: "Territory and quota reset",
        description:
          "Rebalance territories on potential, set quotas from market data, and publish attainment monthly.",
        typicalImpact: 40000,
        effort: 3,
        durationDays: 30,
        confidence: 0.7,
      },
    ],
  },
  {
    slug: "working-capital-release",
    name: "Working Capital Release",
    category: "working_capital",
    description:
      "Free trapped cash: tighten receivables, rationalize inventory, and extend payables responsibly.",
    steps: [
      {
        title: "AR collections sprint",
        description:
          "Dunning cadence, dispute fast-track, and early-pay discounts to cut DSO by 5–10 days.",
        typicalImpact: 35000,
        effort: 2,
        durationDays: 30,
        confidence: 0.85,
      },
      {
        title: "Inventory rationalization",
        description:
          "ABC analysis, obsolete-stock disposition, and reorder-point reset to cut DIO.",
        typicalImpact: 40000,
        effort: 3,
        durationDays: 45,
        confidence: 0.7,
      },
      {
        title: "Payables terms harmonization",
        description:
          "Standardize vendor terms toward net-45 where relationship-safe; capture early-pay discounts selectively.",
        typicalImpact: 20000,
        effort: 2,
        durationDays: 30,
        confidence: 0.75,
      },
      {
        title: "13-week cash-flow discipline",
        description:
          "Weekly 13-week rolling cash forecast with variance review; tie capex approvals to the forecast.",
        typicalImpact: 15000,
        effort: 2,
        durationDays: 14,
        confidence: 0.9,
      },
    ],
  },
  {
    slug: "org-design-optimization",
    name: "Org Design Optimization",
    category: "org_design",
    description:
      "Clarify spans and layers, remove duplicated roles, and build the management bench an exit buyer will underwrite.",
    steps: [
      {
        title: "Org and span-of-control audit",
        description:
          "Map reporting lines, spans, and layers; identify duplicated and orphaned roles.",
        typicalImpact: 30000,
        effort: 2,
        durationDays: 21,
        confidence: 0.85,
      },
      {
        title: "Delayer and consolidate duplicated roles",
        description:
          "Remove redundant management layers and consolidate overlapping functions with clear RACI.",
        typicalImpact: 110000,
        effort: 4,
        durationDays: 60,
        confidence: 0.65,
      },
      {
        title: "Key-person risk mitigation",
        description:
          "Document critical knowledge, cross-train backups, and put retention incentives on key people.",
        typicalImpact: 25000,
        effort: 3,
        durationDays: 45,
        confidence: 0.8,
      },
      {
        title: "Management incentive alignment",
        description:
          "Tie leadership incentives to EBITDA and plan milestones; document the plan for buyer diligence.",
        typicalImpact: 20000,
        effort: 3,
        durationDays: 30,
        confidence: 0.75,
      },
    ],
  },
  {
    slug: "systems-modernization",
    name: "Systems Modernization",
    category: "systems",
    description:
      "Replace spreadsheet-driven operations with integrated systems: accounting close, CRM discipline, and reporting automation.",
    steps: [
      {
        title: "Systems inventory and gap assessment",
        description:
          "Inventory applications, integrations, and manual workarounds; prioritize by close/reporting pain.",
        typicalImpact: 15000,
        effort: 2,
        durationDays: 21,
        confidence: 0.9,
      },
      {
        title: "Accounting close automation",
        description:
          "Standardize the chart of accounts, close checklist, and reconciliations to reach a 5-day close.",
        typicalImpact: 45000,
        effort: 4,
        durationDays: 60,
        confidence: 0.7,
      },
      {
        title: "CRM and pipeline discipline",
        description:
          "Enforce CRM hygiene, stage definitions, and a weekly pipeline review cadence.",
        typicalImpact: 50000,
        effort: 3,
        durationDays: 45,
        confidence: 0.65,
      },
      {
        title: "Management reporting pack",
        description:
          "Automated monthly reporting pack (financials + KPIs) from system data — no manual assembly.",
        typicalImpact: 25000,
        effort: 3,
        durationDays: 30,
        confidence: 0.8,
      },
    ],
  },
];

let schemaReady: Promise<void> | null = null;

export function ensureValueCreation(): Promise<void> {
  if (!schemaReady) {
    schemaReady = (async () => {
      await ensurePlatformSchema();
      const db = sql();
      await db`CREATE SCHEMA IF NOT EXISTS valuecreation`;

      await db`
        CREATE TABLE IF NOT EXISTS valuecreation.plans (
          id TEXT PRIMARY KEY,
          company_id TEXT NOT NULL,
          name TEXT NOT NULL DEFAULT '',
          plan_start_date DATE,
          status TEXT NOT NULL DEFAULT 'active',
          thesis TEXT NOT NULL DEFAULT '',
          incentive_notes TEXT NOT NULL DEFAULT '',
          source TEXT NOT NULL DEFAULT 'manual',
          created_by TEXT NOT NULL DEFAULT '',
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          deleted_at TIMESTAMPTZ
        )`;
      await db`
        CREATE UNIQUE INDEX IF NOT EXISTS vc_plans_company_live_uidx
        ON valuecreation.plans (company_id) WHERE deleted_at IS NULL`;

      await db`
        CREATE TABLE IF NOT EXISTS valuecreation.initiatives (
          id TEXT PRIMARY KEY,
          plan_id TEXT NOT NULL,
          title TEXT NOT NULL,
          description TEXT NOT NULL DEFAULT '',
          category TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT 'planned',
          owner_name TEXT NOT NULL DEFAULT '',
          owner_person_id TEXT,
          start_date DATE,
          end_date DATE,
          one_time_cost NUMERIC,
          recurring_cost NUMERIC,
          ebitda_impact NUMERIC,
          confidence NUMERIC NOT NULL DEFAULT 1,
          effort INT,
          playbook_id TEXT,
          source_kind TEXT NOT NULL DEFAULT 'manual',
          source_ref JSONB NOT NULL DEFAULT '{}'::jsonb,
          sort INT NOT NULL DEFAULT 0,
          source TEXT NOT NULL DEFAULT 'manual',
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          deleted_at TIMESTAMPTZ
        )`;
      await db`
        CREATE INDEX IF NOT EXISTS vc_initiatives_plan_idx
        ON valuecreation.initiatives (plan_id) WHERE deleted_at IS NULL`;

      await db`
        CREATE TABLE IF NOT EXISTS valuecreation.initiative_dependencies (
          initiative_id TEXT NOT NULL,
          depends_on_id TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          PRIMARY KEY (initiative_id, depends_on_id)
        )`;

      await db`
        CREATE TABLE IF NOT EXISTS valuecreation.playbooks (
          id TEXT PRIMARY KEY,
          slug TEXT NOT NULL UNIQUE,
          name TEXT NOT NULL,
          category TEXT NOT NULL DEFAULT '',
          description TEXT NOT NULL DEFAULT '',
          steps JSONB NOT NULL DEFAULT '[]'::jsonb,
          is_system BOOLEAN NOT NULL DEFAULT false,
          created_by TEXT NOT NULL DEFAULT '',
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          deleted_at TIMESTAMPTZ
        )`;

      await db`
        CREATE TABLE IF NOT EXISTS valuecreation.targets (
          id TEXT PRIMARY KEY,
          plan_id TEXT NOT NULL,
          period_label TEXT NOT NULL DEFAULT '',
          period_end DATE NOT NULL,
          metric TEXT NOT NULL,
          target_value NUMERIC NOT NULL,
          source TEXT NOT NULL DEFAULT 'manual',
          notes TEXT NOT NULL DEFAULT '',
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          deleted_at TIMESTAMPTZ
        )`;
      await db`
        CREATE UNIQUE INDEX IF NOT EXISTS vc_targets_plan_period_metric_uidx
        ON valuecreation.targets (plan_id, period_end, metric)
        WHERE deleted_at IS NULL`;

      await db`
        CREATE TABLE IF NOT EXISTS valuecreation.addons (
          id TEXT PRIMARY KEY,
          plan_id TEXT NOT NULL,
          target_company_id TEXT,
          target_deal_id TEXT,
          name TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT 'identified',
          synergy_estimate NUMERIC,
          revenue_estimate NUMERIC,
          ebitda_estimate NUMERIC,
          notes TEXT NOT NULL DEFAULT '',
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          deleted_at TIMESTAMPTZ
        )`;
      await db`
        CREATE INDEX IF NOT EXISTS vc_addons_plan_idx
        ON valuecreation.addons (plan_id) WHERE deleted_at IS NULL`;

      await db`
        CREATE TABLE IF NOT EXISTS valuecreation.org_nodes (
          id TEXT PRIMARY KEY,
          plan_id TEXT NOT NULL,
          person_id TEXT,
          name TEXT NOT NULL DEFAULT '',
          title TEXT NOT NULL DEFAULT '',
          reports_to_id TEXT,
          is_key_person BOOLEAN NOT NULL DEFAULT false,
          risk_level TEXT NOT NULL DEFAULT '',
          risk_notes TEXT NOT NULL DEFAULT '',
          incentive_notes TEXT NOT NULL DEFAULT '',
          vacancy BOOLEAN NOT NULL DEFAULT false,
          target_date DATE,
          sort INT NOT NULL DEFAULT 0,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          deleted_at TIMESTAMPTZ
        )`;
      await db`
        CREATE INDEX IF NOT EXISTS vc_org_nodes_plan_idx
        ON valuecreation.org_nodes (plan_id) WHERE deleted_at IS NULL`;

      await db`
        CREATE TABLE IF NOT EXISTS valuecreation.hiring_roles (
          id TEXT PRIMARY KEY,
          plan_id TEXT NOT NULL,
          role TEXT NOT NULL DEFAULT '',
          department TEXT NOT NULL DEFAULT '',
          priority TEXT NOT NULL DEFAULT 'medium',
          target_date DATE,
          status TEXT NOT NULL DEFAULT 'open',
          comp_range TEXT NOT NULL DEFAULT '',
          notes TEXT NOT NULL DEFAULT '',
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          deleted_at TIMESTAMPTZ
        )`;
      await db`
        CREATE INDEX IF NOT EXISTS vc_hiring_plan_idx
        ON valuecreation.hiring_roles (plan_id) WHERE deleted_at IS NULL`;

      await db`
        CREATE TABLE IF NOT EXISTS valuecreation.exit_readiness (
          id TEXT PRIMARY KEY,
          plan_id TEXT NOT NULL,
          scores JSONB NOT NULL DEFAULT '{}'::jsonb,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          deleted_at TIMESTAMPTZ
        )`;
      await db`
        CREATE UNIQUE INDEX IF NOT EXISTS vc_exit_plan_live_uidx
        ON valuecreation.exit_readiness (plan_id) WHERE deleted_at IS NULL`;

      await db`
        CREATE TABLE IF NOT EXISTS valuecreation.bpmn_diagrams (
          id TEXT PRIMARY KEY,
          plan_id TEXT NOT NULL,
          process_key TEXT NOT NULL,
          name TEXT NOT NULL DEFAULT '',
          as_is_diagram_id TEXT,
          as_is_label TEXT NOT NULL DEFAULT '',
          current_version INT NOT NULL DEFAULT 0,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          deleted_at TIMESTAMPTZ
        )`;
      await db`
        CREATE INDEX IF NOT EXISTS vc_bpmn_plan_idx
        ON valuecreation.bpmn_diagrams (plan_id) WHERE deleted_at IS NULL`;

      // XML lives ONLY here, gzip-compressed in one bytea field per
      // version. List endpoints never select xml_gzip.
      await db`
        CREATE TABLE IF NOT EXISTS valuecreation.bpmn_versions (
          id TEXT PRIMARY KEY,
          diagram_id TEXT NOT NULL,
          version INT NOT NULL,
          xml_gzip BYTEA NOT NULL,
          saved_by TEXT NOT NULL DEFAULT '',
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          UNIQUE (diagram_id, version)
        )`;

      await db`
        CREATE TABLE IF NOT EXISTS valuecreation.plan_summary (
          plan_id TEXT PRIMARY KEY,
          company_id TEXT NOT NULL DEFAULT '',
          initiative_counts JSONB NOT NULL DEFAULT '{}'::jsonb,
          open_initiatives INT NOT NULL DEFAULT 0,
          total_one_time_cost NUMERIC NOT NULL DEFAULT 0,
          total_recurring_cost NUMERIC NOT NULL DEFAULT 0,
          impact_unweighted NUMERIC NOT NULL DEFAULT 0,
          impact_weighted NUMERIC NOT NULL DEFAULT 0,
          addons_count INT NOT NULL DEFAULT 0,
          targets_count INT NOT NULL DEFAULT 0,
          exit_overall NUMERIC,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )`;

      // WS-B tables (scenarios / driver trees) — created here because
      // ensureValueCreation() is the module's single schema entry
      // point; WS-B's scenarios.ts / trees.ts document these shapes
      // as WS-A-owned.
      await db`
        CREATE TABLE IF NOT EXISTS valuecreation.scenarios (
          id TEXT PRIMARY KEY,
          plan_id TEXT NOT NULL,
          name TEXT NOT NULL DEFAULT '',
          is_default BOOLEAN NOT NULL DEFAULT false,
          base_set_id TEXT,
          base_period_end DATE,
          base_revenue NUMERIC,
          base_ebitda NUMERIC,
          assumptions JSONB NOT NULL DEFAULT '{}'::jsonb,
          bridge JSONB,
          computed_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          deleted_at TIMESTAMPTZ
        )`;
      await db`
        CREATE INDEX IF NOT EXISTS vc_scenarios_plan_idx
        ON valuecreation.scenarios (plan_id) WHERE deleted_at IS NULL`;

      await db`
        CREATE TABLE IF NOT EXISTS valuecreation.driver_trees (
          id TEXT PRIMARY KEY,
          plan_id TEXT NOT NULL,
          name TEXT NOT NULL DEFAULT '',
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          deleted_at TIMESTAMPTZ
        )`;
      await db`
        CREATE INDEX IF NOT EXISTS vc_driver_trees_plan_idx
        ON valuecreation.driver_trees (plan_id) WHERE deleted_at IS NULL`;

      await db`
        CREATE TABLE IF NOT EXISTS valuecreation.driver_nodes (
          id TEXT PRIMARY KEY,
          tree_id TEXT NOT NULL,
          parent_id TEXT,
          label TEXT NOT NULL DEFAULT '',
          node_kind TEXT NOT NULL DEFAULT 'driver',
          line_key TEXT,
          target_value NUMERIC,
          unit TEXT NOT NULL DEFAULT '',
          notes TEXT NOT NULL DEFAULT '',
          sort INT NOT NULL DEFAULT 0,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          deleted_at TIMESTAMPTZ
        )`;
      await db`
        CREATE INDEX IF NOT EXISTS vc_driver_nodes_tree_idx
        ON valuecreation.driver_nodes (tree_id) WHERE deleted_at IS NULL`;

      // Seed the six system playbooks idempotently.
      for (const pb of SYSTEM_PLAYBOOKS) {
        const id = `pbk_${pb.slug}`;
        await db`
          INSERT INTO valuecreation.playbooks
            (id, slug, name, category, description, steps, is_system, created_by)
          VALUES (${id}, ${pb.slug}, ${pb.name}, ${pb.category},
            ${pb.description}, ${JSON.stringify(pb.steps)}::jsonb, true, 'system')
          ON CONFLICT (slug) DO NOTHING`;
      }
    })().catch((err) => {
      schemaReady = null;
      throw err;
    });
  }
  return schemaReady;
}

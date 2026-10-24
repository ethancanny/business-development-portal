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
  { key: "operations", label: "Operations" },
  { key: "quality", label: "Quality & certifications" },
  { key: "workforce", label: "Workforce" },
] as const;

/** Industry tag gating the A&D playbook set (company vertical match). */
export const AD_INDUSTRY = "Aerospace & Defense";

/** Default 100-day phase structure (plans.phases; editable per plan). */
export const DEFAULT_PLAN_PHASES = [
  { key: "stabilize", name: "Stabilize", fromDay: 0, toDay: 30 },
  { key: "build", name: "Build", fromDay: 31, toDay: 60 },
  { key: "execute", name: "Execute", fromDay: 61, toDay: 100 },
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

/**
 * Aerospace & Defense system playbooks (VCP redesign §6) — seeded
 * with industry = AD_INDUSTRY so the library surfaces them only for
 * companies whose vertical matches. Templates only: seeding never
 * creates initiatives.
 */
export const AD_SYSTEM_PLAYBOOKS: typeof SYSTEM_PLAYBOOKS = [
  {
    slug: "ad-quoting-pricing",
    name: "Quoting & Pricing (A&D)",
    category: "pricing",
    description:
      "Discipline for A&D quoting: accurate cost models, faster quote turnaround, and escalation protection on long-cycle programs.",
    steps: [
      {
        title: "Audit quote win rate and turnaround",
        description:
          "Measure quote cycle time and win/loss by customer and part family; find where slow or mispriced quotes lose programs.",
        typicalImpact: 30000,
        effort: 2,
        durationDays: 21,
        confidence: 0.85,
      },
      {
        title: "Rebuild machine and labor rate model",
        description:
          "Recompute burdened machine-hour and labor rates from actual utilization and overhead; reprice the rate card.",
        typicalImpact: 95000,
        effort: 3,
        durationDays: 45,
        confidence: 0.75,
      },
      {
        title: "Add material escalation clauses",
        description:
          "Put index-linked escalation language into new quotes and LTAs so alloy and casting volatility stops coming out of margin.",
        typicalImpact: 55000,
        effort: 2,
        durationDays: 30,
        confidence: 0.8,
      },
      {
        title: "Install quote review threshold",
        description:
          "Require margin review and sign-off for quotes above a set value or below a floor margin; track quote margin at award.",
        typicalImpact: 40000,
        effort: 2,
        durationDays: 14,
        confidence: 0.85,
      },
    ],
  },
  {
    slug: "ad-machine-utilization-oee",
    name: "Machine Utilization & OEE (A&D)",
    category: "operations",
    description:
      "Raise effective capacity on bottleneck machines: OEE baseline, setup reduction, and maintenance discipline.",
    steps: [
      {
        title: "Baseline OEE on bottleneck cells",
        description:
          "Instrument the constraint machines for availability, performance, and quality losses over four weeks.",
        typicalImpact: 25000,
        effort: 3,
        durationDays: 30,
        confidence: 0.85,
      },
      {
        title: "Setup and changeover reduction (SMED)",
        description:
          "Externalize setup tasks and standardize tooling/fixturing on the highest-changeover part families.",
        typicalImpact: 80000,
        effort: 3,
        durationDays: 45,
        confidence: 0.75,
      },
      {
        title: "Preventive maintenance cadence",
        description:
          "Move from breakdown response to scheduled PM with spares kits for critical components.",
        typicalImpact: 45000,
        effort: 3,
        durationDays: 60,
        confidence: 0.7,
      },
      {
        title: "Capacity model and shift pattern review",
        description:
          "Model true capacity by cell against the backlog; adjust shift patterns before adding machines or headcount.",
        typicalImpact: 60000,
        effort: 2,
        durationDays: 30,
        confidence: 0.8,
      },
    ],
  },
  {
    slug: "ad-scrap-rework-reduction",
    name: "Scrap & Rework Reduction (A&D)",
    category: "quality",
    description:
      "Attack the cost of poor quality: scrap Pareto, root cause on top defects, and first-article discipline.",
    steps: [
      {
        title: "Scrap Pareto by part and defect",
        description:
          "Cost scrap and rework labor by part number and defect code for 90 days; rank the true cost of poor quality.",
        typicalImpact: 20000,
        effort: 2,
        durationDays: 21,
        confidence: 0.9,
      },
      {
        title: "Root-cause and SPC on top defects",
        description:
          "Run structured root-cause on the top three defect modes and put SPC on the driving process characteristics.",
        typicalImpact: 85000,
        effort: 3,
        durationDays: 60,
        confidence: 0.75,
      },
      {
        title: "First-article and in-process inspection discipline",
        description:
          "Tighten FAI and in-process checks so defects are caught at the operation, not at final inspection.",
        typicalImpact: 50000,
        effort: 3,
        durationDays: 45,
        confidence: 0.8,
      },
      {
        title: "Rework containment and feedback loop",
        description:
          "Track rework hours by cause, review weekly with production and quality, and close the loop into work instructions.",
        typicalImpact: 35000,
        effort: 2,
        durationDays: 30,
        confidence: 0.85,
      },
    ],
  },
  {
    slug: "ad-quality-systems-certifications",
    name: "Quality Systems & Certifications (A&D)",
    category: "quality",
    description:
      "Close AS9100 / customer quality gaps so certifications stop limiting which programs the company can win.",
    steps: [
      {
        title: "AS9100 gap assessment",
        description:
          "Clause-by-clause gap assessment against AS9100 and top customer quality requirements (flow-downs, PPAP/FAI).",
        typicalImpact: 15000,
        effort: 3,
        durationDays: 30,
        confidence: 0.9,
      },
      {
        title: "Documentation and internal audit cadence",
        description:
          "Bring procedures and records current; stand up a rolling internal audit schedule with findings tracked to closure.",
        typicalImpact: 30000,
        effort: 3,
        durationDays: 60,
        confidence: 0.8,
      },
      {
        title: "Supplier quality flow-downs",
        description:
          "Push quality clauses, source inspection, and scorecards to critical suppliers; qualify alternates for weak links.",
        typicalImpact: 40000,
        effort: 3,
        durationDays: 45,
        confidence: 0.75,
      },
      {
        title: "Certification audit and corrective actions",
        description:
          "Run the registrar/customer audit, close findings with verified corrective actions, and publish the certificate to sales.",
        typicalImpact: 70000,
        effort: 4,
        durationDays: 60,
        confidence: 0.7,
      },
    ],
  },
  {
    slug: "ad-supplier-consolidation",
    name: "Supplier Consolidation (A&D)",
    category: "procurement",
    description:
      "Consolidate the A&D supply base without creating single-point risk on long-lead castings, forgings, and special processes.",
    steps: [
      {
        title: "Spend and criticality map",
        description:
          "Map spend by supplier against part criticality and lead time; flag sole-source exposure on long-lead items.",
        typicalImpact: 25000,
        effort: 2,
        durationDays: 21,
        confidence: 0.9,
      },
      {
        title: "Dual-source long-lead castings and forgings",
        description:
          "Qualify second sources for the highest-risk castings/forgings before consolidating anywhere else.",
        typicalImpact: 45000,
        effort: 4,
        durationDays: 90,
        confidence: 0.65,
      },
      {
        title: "Renegotiate LTAs with top suppliers",
        description:
          "Use consolidated volume to renegotiate long-term agreements with pricing, capacity, and OTIF commitments.",
        typicalImpact: 90000,
        effort: 3,
        durationDays: 60,
        confidence: 0.75,
      },
      {
        title: "Supplier scorecards and OTIF reviews",
        description:
          "Quarterly scorecards on quality and on-time delivery with corrective-action triggers for bottom performers.",
        typicalImpact: 30000,
        effort: 2,
        durationDays: 30,
        confidence: 0.85,
      },
    ],
  },
  {
    slug: "ad-workforce-apprenticeship",
    name: "Skilled Workforce & Apprenticeship (A&D)",
    category: "workforce",
    description:
      "Build the machinist and inspector pipeline: skills mapping, apprenticeship partnerships, and cross-training for single-point roles.",
    steps: [
      {
        title: "Skills matrix and critical-role map",
        description:
          "Map skills by employee and machine; identify single-point-of-failure roles and retirement exposure.",
        typicalImpact: 20000,
        effort: 2,
        durationDays: 21,
        confidence: 0.9,
      },
      {
        title: "Launch apprenticeship pipeline",
        description:
          "Partner with local technical programs on a registered apprenticeship for machinists and quality inspectors.",
        typicalImpact: 55000,
        effort: 3,
        durationDays: 90,
        confidence: 0.7,
      },
      {
        title: "Cross-train single-point roles",
        description:
          "Structured cross-training and documented work instructions so every critical operation has a qualified backup.",
        typicalImpact: 40000,
        effort: 3,
        durationDays: 60,
        confidence: 0.8,
      },
      {
        title: "Retention and shift premium review",
        description:
          "Benchmark machinist pay against the local market; fix the gaps losing trained people to competitors.",
        typicalImpact: 35000,
        effort: 2,
        durationDays: 30,
        confidence: 0.8,
      },
    ],
  },
  {
    slug: "ad-working-capital-progress-billing",
    name: "Working Capital & Progress Billing (A&D)",
    category: "working_capital",
    description:
      "Fix A&D cash conversion on long-cycle programs: progress billing alignment, WIP reduction, and long-lead material funding.",
    steps: [
      {
        title: "Align billing milestones to cost curve",
        description:
          "Remap progress/milestone billings so cash comes in ahead of the cost curve on long-cycle jobs.",
        typicalImpact: 60000,
        effort: 2,
        durationDays: 30,
        confidence: 0.8,
      },
      {
        title: "Long-lead material funding terms",
        description:
          "Negotiate customer funding or deposits for long-lead castings and material instead of carrying them on the revolver.",
        typicalImpact: 50000,
        effort: 3,
        durationDays: 45,
        confidence: 0.7,
      },
      {
        title: "WIP and inventory reduction on long-cycle jobs",
        description:
          "Kit and release discipline to cut work-in-process dwell; review slow-moving program inventory monthly.",
        typicalImpact: 45000,
        effort: 3,
        durationDays: 60,
        confidence: 0.75,
      },
      {
        title: "Program AR discipline",
        description:
          "Weekly review of program receivables, acceptance paperwork, and DD250/WAWF submission errors that delay payment.",
        typicalImpact: 30000,
        effort: 2,
        durationDays: 21,
        confidence: 0.85,
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

      /* ---- VCP redesign (Oct 2026): plan baseline/actuals, 100-day
         phases, initiative depth (KPI, milestones, comments, links),
         and locked baseline snapshots. All idempotent. ---- */
      await db`
        ALTER TABLE valuecreation.plans
          ADD COLUMN IF NOT EXISTS baseline_ebitda NUMERIC,
          ADD COLUMN IF NOT EXISTS target_ebitda NUMERIC,
          ADD COLUMN IF NOT EXISTS phases JSONB NOT NULL
            DEFAULT '[{"key":"stabilize","name":"Stabilize","fromDay":0,"toDay":30},{"key":"build","name":"Build","fromDay":31,"toDay":60},{"key":"execute","name":"Execute","fromDay":61,"toDay":100}]'::jsonb`;
      await db`
        ALTER TABLE valuecreation.initiatives
          ADD COLUMN IF NOT EXISTS kpi_name TEXT NOT NULL DEFAULT '',
          ADD COLUMN IF NOT EXISTS kpi_baseline NUMERIC,
          ADD COLUMN IF NOT EXISTS kpi_target NUMERIC,
          ADD COLUMN IF NOT EXISTS kpi_unit TEXT NOT NULL DEFAULT '',
          ADD COLUMN IF NOT EXISTS actual_spend NUMERIC,
          ADD COLUMN IF NOT EXISTS risks TEXT NOT NULL DEFAULT ''`;
      await db`
        ALTER TABLE valuecreation.playbooks
          ADD COLUMN IF NOT EXISTS industry TEXT NOT NULL DEFAULT ''`;

      await db`
        CREATE TABLE IF NOT EXISTS valuecreation.initiative_milestones (
          id TEXT PRIMARY KEY,
          initiative_id TEXT NOT NULL,
          title TEXT NOT NULL,
          due_date DATE,
          done BOOLEAN NOT NULL DEFAULT false,
          sort INT NOT NULL DEFAULT 0,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          deleted_at TIMESTAMPTZ
        )`;
      await db`
        CREATE INDEX IF NOT EXISTS vc_milestones_initiative_idx
        ON valuecreation.initiative_milestones (initiative_id)
        WHERE deleted_at IS NULL`;

      await db`
        CREATE TABLE IF NOT EXISTS valuecreation.initiative_comments (
          id TEXT PRIMARY KEY,
          initiative_id TEXT NOT NULL,
          author TEXT NOT NULL DEFAULT '',
          body TEXT NOT NULL DEFAULT '',
          mentions JSONB NOT NULL DEFAULT '[]'::jsonb,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          deleted_at TIMESTAMPTZ
        )`;
      await db`
        CREATE INDEX IF NOT EXISTS vc_comments_initiative_idx
        ON valuecreation.initiative_comments (initiative_id)
        WHERE deleted_at IS NULL`;

      await db`
        CREATE TABLE IF NOT EXISTS valuecreation.initiative_links (
          id TEXT PRIMARY KEY,
          initiative_id TEXT NOT NULL,
          kind TEXT NOT NULL DEFAULT 'url',
          ref_id TEXT,
          label TEXT NOT NULL DEFAULT '',
          url TEXT NOT NULL DEFAULT '',
          created_by TEXT NOT NULL DEFAULT '',
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          deleted_at TIMESTAMPTZ
        )`;
      await db`
        CREATE INDEX IF NOT EXISTS vc_links_initiative_idx
        ON valuecreation.initiative_links (initiative_id)
        WHERE deleted_at IS NULL`;

      // Locked baseline snapshots (§8): append-only. Locking inserts a
      // new version and supersedes the prior one; rows never mutate.
      await db`
        CREATE TABLE IF NOT EXISTS valuecreation.plan_baselines (
          id TEXT PRIMARY KEY,
          plan_id TEXT NOT NULL,
          version INT NOT NULL,
          locked_by TEXT NOT NULL DEFAULT '',
          locked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          note TEXT NOT NULL DEFAULT '',
          baseline_ebitda NUMERIC,
          target_ebitda NUMERIC,
          totals JSONB NOT NULL DEFAULT '{}'::jsonb,
          initiatives JSONB NOT NULL DEFAULT '[]'::jsonb,
          superseded_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )`;
      await db`
        CREATE INDEX IF NOT EXISTS vc_baselines_plan_idx
        ON valuecreation.plan_baselines (plan_id, version DESC)`;

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

      // Seed the system playbooks idempotently (general set + the
      // industry-tagged A&D set).
      for (const pb of SYSTEM_PLAYBOOKS) {
        const id = `pbk_${pb.slug}`;
        await db`
          INSERT INTO valuecreation.playbooks
            (id, slug, name, category, description, steps, is_system, created_by, industry)
          VALUES (${id}, ${pb.slug}, ${pb.name}, ${pb.category},
            ${pb.description}, ${JSON.stringify(pb.steps)}::jsonb, true, 'system', '')
          ON CONFLICT (slug) DO NOTHING`;
      }
      for (const pb of AD_SYSTEM_PLAYBOOKS) {
        const id = `pbk_${pb.slug}`;
        await db`
          INSERT INTO valuecreation.playbooks
            (id, slug, name, category, description, steps, is_system, created_by, industry)
          VALUES (${id}, ${pb.slug}, ${pb.name}, ${pb.category},
            ${pb.description}, ${JSON.stringify(pb.steps)}::jsonb, true, 'system',
            ${AD_INDUSTRY})
          ON CONFLICT (slug) DO NOTHING`;
      }
    })().catch((err) => {
      schemaReady = null;
      throw err;
    });
  }
  return schemaReady;
}

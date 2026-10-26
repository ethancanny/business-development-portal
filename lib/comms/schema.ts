import { ensurePlatformSchema, sql } from "../platform/db";
import type { CommsTemplate } from "./types";
import { routineAllowed } from "./types";

/**
 * Communications & Reports module schema (Part 12) — owns its tables
 * in the `comms` Postgres schema (PROJECT_RULES.md module
 * boundaries). Pattern mirrors lib/capital/schema.ts: module-level
 * cached promise, reset on error, idempotent CREATEs, safe on every
 * request.
 *
 * Boundary rules honored here:
 * - This module stores ONLY comms-owned records: templates, reports
 *   (+ versions / audit / deliveries / access log), schedules,
 *   per-deal comms settings, stored-PDF metadata and module
 *   settings. Company / deal / person identity and every financial
 *   figure live in their owning modules and are read ONLY through
 *   service functions (see lib/comms/assemble.ts).
 * - File bytes NEVER live in Postgres — report_files stores only the
 *   storage key + byte count + sha256 of the PDF held by
 *   lib/storage.
 * - The seed below inserts the 8 system templates with stable ids
 *   (ON CONFLICT (id) DO NOTHING) so user edits to a system template
 *   are never overwritten by a later ensure run.
 */

/* --------------------------- system seed ----------------------------- */

interface SystemTemplateSeed {
  id: string;
  name: string;
  purpose: string;
  audience: string;
  subjectKinds: string[];
  blocks: Array<{
    key: string;
    type: string;
    heading: string;
    config?: { text?: string };
  }>;
  tone: string;
  disclaimers: string[];
}

const CONFIDENTIAL =
  "Confidential — prepared for the named recipients only. Do not forward or distribute without the written consent of Canny Capital Partners.";
const FIGURES_BASIS =
  "Figures are drawn from company-reported financial statements and internal records as of the report date; they have not been audited unless expressly stated.";

export const SYSTEM_TEMPLATES: SystemTemplateSeed[] = [
  {
    id: "tpl_investor_update",
    name: "Investor update",
    purpose: "investor_update",
    audience: "investor",
    subjectKinds: ["company", "deal", "investor", "portfolio_company"],
    blocks: [
      { key: "highlights", type: "narrative", heading: "Highlights" },
      { key: "financial_summary", type: "financial_summary", heading: "Performance summary" },
      { key: "variance_table", type: "variance_table", heading: "Performance vs plan" },
      { key: "plan_status", type: "plan_status", heading: "Value creation progress" },
      { key: "covenant_status", type: "covenant_status", heading: "Cash and covenants" },
      { key: "capital_status", type: "capital_status", heading: "Capital status" },
      { key: "outlook", type: "narrative", heading: "Outlook and asks" },
    ],
    tone: "Clear, factual and concise. Lead with performance against plan, then capital activity; no promotional language.",
    disclaimers: [CONFIDENTIAL, FIGURES_BASIS],
  },
  {
    id: "tpl_investment_memo",
    name: "Investment memo",
    purpose: "investment_memo",
    audience: "investor",
    subjectKinds: ["deal", "company"],
    blocks: [
      { key: "thesis", type: "narrative", heading: "Investment thesis" },
      { key: "memo", type: "memo", heading: "Business overview and market" },
      { key: "financial_summary", type: "financial_summary", heading: "Financials" },
      { key: "findings", type: "findings", heading: "Risks and diligence findings" },
      { key: "recommendation", type: "narrative", heading: "Valuation, terms and recommendation" },
    ],
    tone: "Analytical and balanced. State the thesis, the evidence for it, and the principal risks with equal weight.",
    disclaimers: [
      CONFIDENTIAL,
      "This memo is not an offer to sell or a solicitation of an offer to buy any security. Any investment decision should be based on the definitive transaction documents.",
    ],
  },
  {
    id: "tpl_ic_memo",
    name: "IC memo",
    purpose: "ic_memo",
    audience: "internal",
    subjectKinds: ["deal", "company"],
    blocks: [
      { key: "financial_summary", type: "financial_summary", heading: "Financial summary" },
      { key: "findings", type: "findings", heading: "Diligence findings" },
      { key: "memo", type: "memo", heading: "Deal memo" },
      { key: "narrative", type: "narrative", heading: "Recommendation" },
    ],
    tone: "Direct and decision-oriented. Surface disagreements and open questions explicitly; do not soften risks.",
    disclaimers: [
      "Internal only — investment committee working document. Not for distribution outside Canny Capital Partners.",
      FIGURES_BASIS,
    ],
  },
  {
    id: "tpl_lender_package",
    name: "Lender package",
    purpose: "lender_package",
    audience: "lender",
    subjectKinds: ["company", "portfolio_company", "deal"],
    blocks: [
      { key: "financial_summary", type: "financial_summary", heading: "Financial summary" },
      { key: "kpi_table", type: "kpi_table", heading: "Key performance indicators" },
      { key: "covenant_status", type: "covenant_status", heading: "Covenant compliance" },
      { key: "variance_table", type: "variance_table", heading: "Variance to budget" },
    ],
    tone: "Formal and precise. Present covenant calculations exactly as defined in the credit agreement; flag any exception in plain terms.",
    disclaimers: [
      CONFIDENTIAL,
      "Covenant figures are computed from company records in accordance with the definitions in the applicable credit agreement.",
    ],
  },
  {
    id: "tpl_seller_feedback",
    name: "Seller feedback",
    purpose: "seller_feedback",
    audience: "seller",
    subjectKinds: ["company", "deal"],
    blocks: [
      {
        key: "analyzed",
        type: "text",
        heading: "What we analyzed",
        config: {
          text: "We reviewed the financial information and operating records made available to us — every figure in this report is listed with its source in the appendix — and assessed the business against the criteria a buyer will apply.",
        },
      },
      { key: "financial_summary", type: "financial_summary", heading: "Financial review" },
      { key: "findings", type: "findings", heading: "Key findings" },
      { key: "recommendations", type: "narrative", heading: "Recommendations and next steps" },
    ],
    tone: "Respectful and constructive. Be specific about strengths and about the questions a buyer will ask; avoid valuation commitments.",
    disclaimers: [
      CONFIDENTIAL,
      "Feedback is preliminary, is based on information provided to date, and does not constitute an offer or a valuation opinion.",
    ],
  },
  {
    id: "tpl_board_packet",
    name: "Board packet",
    purpose: "board_packet",
    audience: "board",
    subjectKinds: ["company", "portfolio_company"],
    blocks: [
      { key: "kpi_table", type: "kpi_table", heading: "Key performance indicators" },
      { key: "variance_table", type: "variance_table", heading: "Variance to budget" },
      { key: "covenant_status", type: "covenant_status", heading: "Covenant compliance" },
      { key: "plan_status", type: "plan_status", heading: "Value creation plan" },
      { key: "capital_status", type: "capital_status", heading: "Capital status" },
    ],
    tone: "Structured and complete. Organize around decisions the board is being asked to make; keep commentary brief and factual.",
    disclaimers: [CONFIDENTIAL, FIGURES_BASIS],
  },
  {
    id: "tpl_portfolio_monthly",
    name: "Portfolio monthly",
    purpose: "portfolio_monthly",
    audience: "portfolio_manager",
    subjectKinds: ["portfolio_company", "company"],
    blocks: [
      { key: "kpi_table", type: "kpi_table", heading: "Key performance indicators" },
      { key: "variance_table", type: "variance_table", heading: "Variance to budget" },
      { key: "covenant_status", type: "covenant_status", heading: "Covenant compliance" },
      { key: "plan_status", type: "plan_status", heading: "Value creation plan" },
    ],
    tone: "Operational and exception-focused. Highlight what moved, what missed, and what needs attention this month.",
    disclaimers: [
      "Internal portfolio reporting — prepared for Canny Capital Partners portfolio management use.",
      FIGURES_BASIS,
    ],
  },
  {
    id: "tpl_diligence_summary",
    name: "Diligence summary",
    purpose: "diligence_summary",
    audience: "internal",
    subjectKinds: ["deal", "company"],
    blocks: [
      {
        key: "scope",
        type: "text",
        heading: "Scope and status",
        config: {
          text: "This summary covers the diligence workstreams completed to date for the subject company, the findings they produced, and the items that remain open. Sources for every figure are listed in the appendix.",
        },
      },
      { key: "findings", type: "findings", heading: "Findings by severity" },
      { key: "financial_summary", type: "financial_summary", heading: "Financial summary" },
      { key: "memo", type: "memo", heading: "Deal memo" },
      { key: "next_steps", type: "narrative", heading: "Risks, open items and next steps" },
    ],
    tone: "Evidence-led and neutral. Report what was verified, what could not be verified, and what remains open.",
    disclaimers: [
      "Internal only — diligence working document. Not for distribution outside Canny Capital Partners.",
    ],
  },
];

/* ------------------------------ ensure ------------------------------- */

let schemaReady: Promise<void> | null = null;

export function ensureComms(): Promise<void> {
  if (!schemaReady) {
    schemaReady = (async () => {
      await ensurePlatformSchema();
      const db = sql();
      await db`CREATE SCHEMA IF NOT EXISTS comms`;

      await db`
        CREATE TABLE IF NOT EXISTS comms.templates (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL DEFAULT '',
          purpose TEXT NOT NULL DEFAULT '',
          audience TEXT NOT NULL DEFAULT 'internal',
          subject_kinds JSONB NOT NULL DEFAULT '[]'::jsonb,
          blocks JSONB NOT NULL DEFAULT '[]'::jsonb,
          tone TEXT NOT NULL DEFAULT '',
          disclaimers JSONB NOT NULL DEFAULT '[]'::jsonb,
          routine BOOLEAN NOT NULL DEFAULT false,
          is_system BOOLEAN NOT NULL DEFAULT false,
          created_by TEXT NOT NULL DEFAULT '',
          updated_by TEXT NOT NULL DEFAULT '',
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          deleted_at TIMESTAMPTZ,
          CONSTRAINT comms_templates_routine_check
            CHECK (NOT routine OR purpose NOT IN ('investment_memo', 'ic_memo'))
        )`;

      await db`
        CREATE TABLE IF NOT EXISTS comms.reports (
          id TEXT PRIMARY KEY,
          template_id TEXT,
          template_name TEXT NOT NULL DEFAULT '',
          purpose TEXT NOT NULL DEFAULT '',
          audience TEXT NOT NULL DEFAULT 'internal',
          subject_kind TEXT NOT NULL DEFAULT '',
          company_id TEXT,
          deal_id TEXT,
          person_id TEXT,
          title TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT 'generating',
          is_sample BOOLEAN NOT NULL DEFAULT false,
          current_version INT NOT NULL DEFAULT 0,
          render JSONB,
          appendix JSONB,
          has_unreviewed BOOLEAN NOT NULL DEFAULT false,
          stale BOOLEAN NOT NULL DEFAULT false,
          stale_reason TEXT,
          source_fingerprint TEXT,
          narrative_status TEXT NOT NULL DEFAULT 'none',
          schedule_id TEXT,
          created_by TEXT NOT NULL DEFAULT '',
          updated_by TEXT NOT NULL DEFAULT '',
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          deleted_at TIMESTAMPTZ,
          CONSTRAINT comms_reports_status_check CHECK (status IN
            ('generating', 'draft', 'in_review', 'approved', 'sent',
             'discarded', 'failed')),
          CONSTRAINT comms_reports_narrative_status_check
            CHECK (narrative_status IN
              ('none', 'pending', 'ready', 'manual', 'setup_required',
               'blocked_disabled', 'error'))
        )`;
      await db`
        CREATE INDEX IF NOT EXISTS comms_reports_company_idx
        ON comms.reports (company_id) WHERE deleted_at IS NULL`;
      await db`
        CREATE INDEX IF NOT EXISTS comms_reports_deal_idx
        ON comms.reports (deal_id) WHERE deleted_at IS NULL`;
      await db`
        CREATE INDEX IF NOT EXISTS comms_reports_status_idx
        ON comms.reports (status, created_at DESC) WHERE deleted_at IS NULL`;

      await db`
        CREATE TABLE IF NOT EXISTS comms.report_versions (
          id TEXT PRIMARY KEY,
          report_id TEXT NOT NULL,
          version INT NOT NULL,
          render JSONB,
          appendix JSONB,
          note TEXT NOT NULL DEFAULT '',
          created_by TEXT NOT NULL DEFAULT '',
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          UNIQUE (report_id, version)
        )`;
      await db`
        CREATE INDEX IF NOT EXISTS comms_report_versions_report_idx
        ON comms.report_versions (report_id, version DESC)`;

      await db`
        CREATE TABLE IF NOT EXISTS comms.report_audit (
          id TEXT PRIMARY KEY,
          report_id TEXT NOT NULL,
          actor TEXT NOT NULL DEFAULT '',
          action TEXT NOT NULL DEFAULT '',
          detail JSONB NOT NULL DEFAULT '{}'::jsonb,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )`;
      await db`
        CREATE INDEX IF NOT EXISTS comms_report_audit_report_idx
        ON comms.report_audit (report_id, created_at DESC)`;

      await db`
        CREATE TABLE IF NOT EXISTS comms.deliveries (
          id TEXT PRIMARY KEY,
          report_id TEXT NOT NULL,
          version INT NOT NULL DEFAULT 0,
          recipient_person_id TEXT,
          recipient_name TEXT NOT NULL DEFAULT '',
          recipient_email TEXT NOT NULL DEFAULT '',
          audience TEXT NOT NULL DEFAULT 'internal',
          allow_pdf BOOLEAN NOT NULL DEFAULT false,
          token_hash TEXT NOT NULL,
          token_last4 TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT 'delivered',
          email_status TEXT NOT NULL DEFAULT 'pending',
          email_detail TEXT NOT NULL DEFAULT '',
          delivered_by TEXT NOT NULL DEFAULT '',
          delivered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          opened_at TIMESTAMPTZ,
          viewed_at TIMESTAMPTZ,
          downloaded_at TIMESTAMPTZ,
          revoked_at TIMESTAMPTZ,
          revoked_by TEXT,
          expires_at TIMESTAMPTZ,
          CONSTRAINT comms_deliveries_token_hash_uidx UNIQUE (token_hash),
          CONSTRAINT comms_deliveries_status_check
            CHECK (status IN ('delivered', 'revoked')),
          CONSTRAINT comms_deliveries_email_status_check
            CHECK (email_status IN ('sent', 'setup_required', 'pending', 'failed'))
        )`;
      await db`
        CREATE INDEX IF NOT EXISTS comms_deliveries_report_idx
        ON comms.deliveries (report_id, delivered_at DESC)`;
      // Open pixel (Send anywhere, Oct 25, 2026): the moment the
      // delivery email's 1×1 tracking image was fetched. Deliberately
      // separate from opened_at/viewed_at, which record the recipient
      // opening the portal link itself.
      await db`
        ALTER TABLE comms.deliveries
        ADD COLUMN IF NOT EXISTS email_opened_at TIMESTAMPTZ`;

      await db`
        CREATE TABLE IF NOT EXISTS comms.access_log (
          id TEXT PRIMARY KEY,
          delivery_id TEXT NOT NULL,
          report_id TEXT NOT NULL,
          action TEXT NOT NULL DEFAULT '',
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )`;
      await db`
        CREATE INDEX IF NOT EXISTS comms_access_log_delivery_idx
        ON comms.access_log (delivery_id, created_at DESC)`;

      await db`
        CREATE TABLE IF NOT EXISTS comms.schedules (
          id TEXT PRIMARY KEY,
          template_id TEXT NOT NULL,
          subject_kind TEXT NOT NULL DEFAULT '',
          company_id TEXT,
          deal_id TEXT,
          person_id TEXT,
          cadence TEXT NOT NULL DEFAULT 'monthly',
          day_of_month INT NOT NULL DEFAULT 1,
          recipients JSONB NOT NULL DEFAULT '[]'::jsonb,
          routine_approved BOOLEAN NOT NULL DEFAULT false,
          approved_by TEXT,
          approved_at TIMESTAMPTZ,
          status TEXT NOT NULL DEFAULT 'active',
          pause_reason TEXT,
          next_run_at TIMESTAMPTZ,
          last_run_at TIMESTAMPTZ,
          last_report_id TEXT,
          created_by TEXT NOT NULL DEFAULT '',
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          deleted_at TIMESTAMPTZ,
          CONSTRAINT comms_schedules_cadence_check
            CHECK (cadence IN ('monthly', 'quarterly')),
          CONSTRAINT comms_schedules_status_check
            CHECK (status IN ('active', 'paused'))
        )`;
      await db`
        CREATE INDEX IF NOT EXISTS comms_schedules_next_run_idx
        ON comms.schedules (next_run_at) WHERE deleted_at IS NULL`;

      await db`
        CREATE TABLE IF NOT EXISTS comms.deal_settings (
          deal_id TEXT PRIMARY KEY,
          nda_restricted BOOLEAN NOT NULL DEFAULT false,
          nda_note TEXT,
          updated_by TEXT NOT NULL DEFAULT '',
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )`;

      await db`
        CREATE TABLE IF NOT EXISTS comms.report_files (
          report_id TEXT NOT NULL,
          version INT NOT NULL,
          storage_key TEXT NOT NULL DEFAULT '',
          bytes INT NOT NULL DEFAULT 0,
          sha256 TEXT NOT NULL DEFAULT '',
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          PRIMARY KEY (report_id, version)
        )`;

      await db`
        CREATE TABLE IF NOT EXISTS comms.settings (
          key TEXT PRIMARY KEY,
          value JSONB NOT NULL DEFAULT '{}'::jsonb,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )`;

      // Seed the 8 system templates. ON CONFLICT DO NOTHING: a system
      // template the partners have edited keeps their edits.
      for (const tpl of SYSTEM_TEMPLATES) {
        const blocks = tpl.blocks.map((b) => ({
          key: b.key,
          type: b.type,
          heading: b.heading,
          visibility: "all" as const,
          ...(b.config ? { config: b.config } : {}),
        }));
        const asTemplate: CommsTemplate = {
          id: tpl.id,
          name: tpl.name,
          purpose: tpl.purpose,
          audience: tpl.audience,
          subjectKinds: tpl.subjectKinds,
          blocks,
          tone: tpl.tone,
          disclaimers: tpl.disclaimers,
          routine: false,
          isSystem: true,
        };
        const routine = routineAllowed(asTemplate);
        await db`
          INSERT INTO comms.templates
            (id, name, purpose, audience, subject_kinds, blocks, tone,
             disclaimers, routine, is_system, created_by, updated_by)
          VALUES (${tpl.id}, ${tpl.name}, ${tpl.purpose}, ${tpl.audience},
            ${JSON.stringify(tpl.subjectKinds)}::jsonb,
            ${JSON.stringify(blocks)}::jsonb,
            ${tpl.tone},
            ${JSON.stringify(tpl.disclaimers)}::jsonb,
            ${routine}, true, 'system', 'system')
          ON CONFLICT (id) DO NOTHING`;
      }

      // Report redesign (Oct 24, 2026): upgrade the four named
      // system templates to the spec section maps — ONLY when the
      // stored blocks still exactly match the pre-redesign seed
      // (key|type|heading fingerprint). Any partner edit to a
      // template makes the fingerprint differ and the template is
      // left untouched. Marker-guarded, runs once.
      const redesignMarker = await db`
        SELECT value FROM comms.settings WHERE key = 'report_redesign_v1' LIMIT 1`;
      if (!redesignMarker.length) {
        const LEGACY_BLOCKS: Record<string, string> = {
          tpl_investor_update:
            "financial_summary|financial_summary|Financial summary;capital_status|capital_status|Capital status;narrative|narrative|Update",
          tpl_investment_memo:
            "financial_summary|financial_summary|Financial summary;findings|findings|Diligence findings;plan_status|plan_status|Value creation plan;narrative|narrative|Investment narrative",
          tpl_seller_feedback:
            "financial_summary|financial_summary|Financial summary;narrative|narrative|Feedback",
          tpl_diligence_summary:
            "findings|findings|Diligence findings;financial_summary|financial_summary|Financial summary;memo|memo|Deal memo",
        };
        for (const tpl of SYSTEM_TEMPLATES) {
          const legacy = LEGACY_BLOCKS[tpl.id];
          if (!legacy) continue;
          const rows = await db`
            SELECT blocks FROM comms.templates WHERE id = ${tpl.id} LIMIT 1`;
          if (!rows.length) continue;
          const stored = (rows[0] as Record<string, unknown>).blocks;
          const storedList = Array.isArray(stored)
            ? stored
            : typeof stored === "string"
              ? (JSON.parse(stored) as unknown[])
              : [];
          const fingerprint = (storedList as Array<Record<string, unknown>>)
            .map((b) => `${b.key}|${b.type}|${b.heading}`)
            .join(";");
          if (fingerprint !== legacy) continue;
          const blocks = tpl.blocks.map((b) => ({
            key: b.key,
            type: b.type,
            heading: b.heading,
            visibility: "all" as const,
            ...(b.config ? { config: b.config } : {}),
          }));
          const asTemplate: CommsTemplate = {
            id: tpl.id,
            name: tpl.name,
            purpose: tpl.purpose,
            audience: tpl.audience as CommsTemplate["audience"],
            subjectKinds: tpl.subjectKinds,
            blocks,
            tone: tpl.tone,
            disclaimers: tpl.disclaimers,
            routine: false,
            isSystem: true,
          };
          await db`
            UPDATE comms.templates
            SET blocks = ${JSON.stringify(blocks)}::jsonb,
                routine = ${routineAllowed(asTemplate)},
                updated_at = now()
            WHERE id = ${tpl.id}`;
        }
        await db`
          INSERT INTO comms.settings (key, value, updated_at)
          VALUES ('report_redesign_v1', ${JSON.stringify({ appliedAt: new Date().toISOString() })}::jsonb, now())
          ON CONFLICT (key) DO NOTHING`;
      }

      kickStaleHandlerRegistration();
    })().catch((err) => {
      // Reset on error so the next request retries (house pattern).
      schemaReady = null;
      throw err;
    });
  }
  return schemaReady;
}

/**
 * Best-effort stale-handler registration (contract: the reports
 * service's registerStaleHandlers() is "called from ensureComms()").
 * The service module statically imports this schema, so a static
 * import back would be circular — a fire-and-forget dynamic import
 * with a LITERAL specifier (production lesson 2) is used instead,
 * and any failure (sibling not built yet, handler already
 * registered) is ignored: staleness marking is additive, never a
 * reason to fail schema setup.
 */
let staleRegistrationAttempted = false;
export function kickStaleHandlerRegistration(): void {
  if (staleRegistrationAttempted) return;
  staleRegistrationAttempted = true;
  void import("./service")
    .then((m) => {
      const fn = (m as { registerStaleHandlers?: unknown })
        .registerStaleHandlers;
      if (typeof fn === "function") {
        (fn as () => void)();
      }
    })
    .catch(() => {
      // Service workstream not present yet — registration will
      // happen from the service module's own ensure path instead.
    });
}

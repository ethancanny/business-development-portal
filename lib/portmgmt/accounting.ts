import { sql, newId, str, num, isoOrNull } from "../platform/db";
import { ensurePortmgmt } from "./schema";
import { mapLabelToLine } from "../financials/template";
import { PortmgmtError } from "./service";

/**
 * Accounting integrations (Phase 9, WS-B) — the FRAMEWORK only.
 *
 * HONESTY IS THE DELIVERABLE: no live accounting connection exists in
 * this phase. No provider credentials are configured, no OAuth flow
 * has been run, and nothing here pretends otherwise:
 * - A connection's status is DERIVED: 'setup_required' while any of
 *   the provider's env vars are absent, else 'not_connected' until a
 *   sync actually succeeds. 'connected' is never claimed without
 *   credentials + a successful sync — and this phase has no code path
 *   that produces one.
 * - runSync(mode 'live') with missing config finishes the run as
 *   'setup_required' naming the missing env vars; WITH config present
 *   it finishes 'error' / 'live_pull_not_implemented' — the pull is
 *   deliberately not faked.
 * - runSync(mode 'dry_run') maps the provider's deterministic SAMPLE
 *   payload through the financials template mapper so the mapping
 *   quality is visible without any connection.
 * - Sync NEVER creates financial statement sets in this phase.
 */

export interface AccountingProvider {
  key: string;
  name: string;
  envVars: string[];
  redirectUri: string | null;
  setupSteps: string[];
}

const PORTAL_BASE = "https://portal.cannycapitalpartners.com";

export const PROVIDERS: Record<string, AccountingProvider> = {
  quickbooks: {
    key: "quickbooks",
    name: "QuickBooks Online",
    envVars: ["INTUIT_CLIENT_ID", "INTUIT_CLIENT_SECRET"],
    redirectUri: `${PORTAL_BASE}/api/portmgmt/accounting/quickbooks/callback`,
    setupSteps: [
      "Create an app at developer.intuit.com (QuickBooks Online API, production keys).",
      `Register the redirect URI ${PORTAL_BASE}/api/portmgmt/accounting/quickbooks/callback on the app.`,
      "Set INTUIT_CLIENT_ID and INTUIT_CLIENT_SECRET in the Vercel environment (never in chat or code).",
      "Connect each portfolio company from its Accounting tab (OAuth consent per QuickBooks realm).",
    ],
  },
  xero: {
    key: "xero",
    name: "Xero",
    envVars: ["XERO_CLIENT_ID", "XERO_CLIENT_SECRET"],
    redirectUri: `${PORTAL_BASE}/api/portmgmt/accounting/xero/callback`,
    setupSteps: [
      "Create an app at developer.xero.com (Web app, Xero API).",
      `Register the redirect URI ${PORTAL_BASE}/api/portmgmt/accounting/xero/callback on the app.`,
      "Set XERO_CLIENT_ID and XERO_CLIENT_SECRET in the Vercel environment (never in chat or code).",
      "Connect each portfolio company from its Accounting tab (OAuth consent per Xero tenant).",
    ],
  },
  netsuite: {
    key: "netsuite",
    name: "NetSuite",
    envVars: [
      "NETSUITE_ACCOUNT_ID",
      "NETSUITE_CONSUMER_KEY",
      "NETSUITE_CONSUMER_SECRET",
      "NETSUITE_TOKEN_ID",
      "NETSUITE_TOKEN_SECRET",
    ],
    redirectUri: null,
    setupSteps: [
      "In the NetSuite account: Setup → Integration → Manage Integrations — create an integration record with Token-Based Authentication (TBA) enabled.",
      "Create an integration role with the needed permissions and assign it to the integration user.",
      "Issue a TBA token for that user/role (Setup → Users/Roles → Access Tokens).",
      "Set NETSUITE_ACCOUNT_ID, NETSUITE_CONSUMER_KEY, NETSUITE_CONSUMER_SECRET, NETSUITE_TOKEN_ID and NETSUITE_TOKEN_SECRET in the Vercel environment (never in chat or code).",
    ],
  },
};

export function getProvider(providerKey: string): AccountingProvider {
  const p = PROVIDERS[(providerKey ?? "").trim().toLowerCase()];
  if (!p) throw new PortmgmtError("invalid_provider");
  return p;
}

/** Env var names the provider still needs (absent from process.env). */
export function missingConfig(providerKey: string): string[] {
  const p = getProvider(providerKey);
  return p.envVars.filter((name) => !(process.env[name] ?? "").trim());
}

/* ------------------------- sample payloads --------------------------- */

export interface ProviderLine {
  label: string;
  amount: number;
}

/**
 * Deterministic fixture lines shaped like a provider P&L export
 * (label + amount). Used ONLY by dry-run syncs to exercise the
 * template mapping — never presented as real company data.
 */
export function samplePayload(providerKey: string): ProviderLine[] {
  getProvider(providerKey);
  return [
    { label: "Total Revenue", amount: 1250000 },
    { label: "Cost of Goods Sold", amount: 640000 },
    { label: "Gross Profit", amount: 610000 },
    { label: "Rent Expense", amount: 38000 },
    { label: "Salaries and Wages", amount: 295000 },
    { label: "Insurance", amount: 21000 },
    { label: "Total Operating Expenses", amount: 354000 },
    { label: "EBITDA", amount: 256000 },
    { label: "Depreciation and Amortization", amount: 24000 },
    { label: "Interest Expense", amount: 11500 },
    { label: "Net Income", amount: 220500 },
    { label: "Owner Discretionary Adjustment (sample)", amount: 5000 },
  ];
}

/** Map provider lines onto the Phase 4 statement template via
 * lib/financials/template.ts mapLabelToLine (its actual home).
 * Duplicate line keys are summed, matching statement semantics. */
export function mapLines(lines: ProviderLine[]): {
  mapped: Array<{ lineKey: string; value: number }>;
  unmapped: string[];
} {
  const byKey = new Map<string, number>();
  const unmapped: string[] = [];
  for (const line of lines ?? []) {
    const hit = mapLabelToLine(line.label);
    if (!hit) {
      unmapped.push(line.label);
      continue;
    }
    byKey.set(hit.lineKey, (byKey.get(hit.lineKey) ?? 0) + line.amount);
  }
  return {
    mapped: Array.from(byKey.entries()).map(([lineKey, value]) => ({
      lineKey,
      value,
    })),
    unmapped,
  };
}

/* ----------------------------- connections --------------------------- */

export interface AcctConnectionRow {
  id: string;
  companyId: string;
  provider: string;
  label: string;
  /** Stored status hint only — the API surface derives the honest
   * status via connectionStatus() below. */
  status: string;
  externalId: string;
  notes: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

function rowToConnection(r: Record<string, unknown>): AcctConnectionRow {
  return {
    id: str(r.id),
    companyId: str(r.company_id),
    provider: str(r.provider),
    label: str(r.label),
    status: str(r.status) || "not_connected",
    externalId: str(r.external_id),
    notes: str(r.notes),
    createdBy: str(r.created_by),
    createdAt: isoOrNull(r.created_at) ?? "",
    updatedAt: isoOrNull(r.updated_at) ?? "",
  };
}

/**
 * Derived connection status — the honesty rule: 'setup_required'
 * while provider config is missing; otherwise the stored status,
 * which only a successful sync may set to 'connected' (no sync in
 * this phase can succeed live, so stored rows stay 'not_connected').
 */
export function connectionStatus(conn: AcctConnectionRow): string {
  if (missingConfig(conn.provider).length) return "setup_required";
  return conn.status === "connected" ? "connected" : "not_connected";
}

export async function listConnections(
  companyId: string
): Promise<AcctConnectionRow[]> {
  await ensurePortmgmt();
  const db = sql();
  const rows = await db`
    SELECT * FROM portmgmt.acct_connections
    WHERE company_id = ${companyId} AND deleted_at IS NULL
    ORDER BY created_at ASC
    LIMIT 50`;
  return rows.map((r) => rowToConnection(r as Record<string, unknown>));
}

export async function getConnection(
  connectionId: string
): Promise<AcctConnectionRow | null> {
  await ensurePortmgmt();
  const db = sql();
  const rows = await db`
    SELECT * FROM portmgmt.acct_connections
    WHERE id = ${connectionId} AND deleted_at IS NULL LIMIT 1`;
  return rows.length
    ? rowToConnection(rows[0] as Record<string, unknown>)
    : null;
}

export async function createConnection(
  companyId: string,
  input: { provider: string; label?: string; externalId?: string; notes?: string },
  actor: string
): Promise<AcctConnectionRow> {
  await ensurePortmgmt();
  const provider = getProvider(input.provider);
  const db = sql();
  const id = `pmacct_${newId()}`;
  await db`
    INSERT INTO portmgmt.acct_connections
      (id, company_id, provider, label, status, external_id, notes,
       created_by)
    VALUES (${id}, ${companyId}, ${provider.key},
      ${(input.label ?? "").trim() || provider.name}, 'not_connected',
      ${(input.externalId ?? "").trim()}, ${input.notes ?? ""}, ${actor})`;
  const created = await getConnection(id);
  if (!created) throw new PortmgmtError("connection_not_found");
  return created;
}

export async function updateConnection(
  connectionId: string,
  patch: { label?: string; externalId?: string; notes?: string },
  actor: string
): Promise<AcctConnectionRow> {
  void actor;
  await ensurePortmgmt();
  const cur = await getConnection(connectionId);
  if (!cur) throw new PortmgmtError("connection_not_found");
  const db = sql();
  await db`
    UPDATE portmgmt.acct_connections
    SET label = ${patch.label !== undefined ? patch.label.trim() : cur.label},
        external_id = ${patch.externalId !== undefined ? patch.externalId.trim() : cur.externalId},
        notes = ${patch.notes !== undefined ? patch.notes : cur.notes},
        updated_at = now()
    WHERE id = ${connectionId}`;
  const updated = await getConnection(connectionId);
  if (!updated) throw new PortmgmtError("connection_not_found");
  return updated;
}

/* ------------------------------- sync -------------------------------- */

export interface AcctSyncRunRow {
  id: string;
  connectionId: string;
  companyId: string;
  mode: string;
  status: string;
  message: string;
  recordsRead: number;
  mappedCount: number;
  unmappedCount: number;
  detail: Record<string, unknown>;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

function rowToRun(r: Record<string, unknown>): AcctSyncRunRow {
  let detail: Record<string, unknown> = {};
  const raw = r.detail;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    detail = raw as Record<string, unknown>;
  } else if (typeof raw === "string" && raw.trim()) {
    try {
      const p = JSON.parse(raw);
      if (p && typeof p === "object") detail = p as Record<string, unknown>;
    } catch {
      detail = {};
    }
  }
  return {
    id: str(r.id),
    connectionId: str(r.connection_id),
    companyId: str(r.company_id),
    mode: str(r.mode) || "dry_run",
    status: str(r.status) || "running",
    message: str(r.message),
    recordsRead: num(r.records_read),
    mappedCount: num(r.mapped_count),
    unmappedCount: num(r.unmapped_count),
    detail,
    createdBy: str(r.created_by),
    createdAt: isoOrNull(r.created_at) ?? "",
    updatedAt: isoOrNull(r.updated_at) ?? "",
  };
}

export async function listSyncRuns(
  connectionId: string
): Promise<AcctSyncRunRow[]> {
  await ensurePortmgmt();
  const db = sql();
  const rows = await db`
    SELECT * FROM portmgmt.acct_sync_runs
    WHERE connection_id = ${connectionId} AND deleted_at IS NULL
    ORDER BY created_at DESC
    LIMIT 50`;
  return rows.map((r) => rowToRun(r as Record<string, unknown>));
}

/**
 * Run a sync. See the module header for the honesty contract: nothing
 * here ever fabricates a live pull or a financial statement set.
 */
export async function runSync(
  connectionId: string,
  input: { mode?: string },
  actor: string
): Promise<AcctSyncRunRow> {
  await ensurePortmgmt();
  const conn = await getConnection(connectionId);
  if (!conn) throw new PortmgmtError("connection_not_found");
  const mode = (input.mode ?? "dry_run").trim() || "dry_run";
  if (mode !== "live" && mode !== "dry_run") {
    throw new PortmgmtError("invalid_sync_mode");
  }
  const db = sql();
  const id = `pmrun_${newId()}`;
  await db`
    INSERT INTO portmgmt.acct_sync_runs
      (id, connection_id, company_id, mode, status, created_by)
    VALUES (${id}, ${connectionId}, ${conn.companyId}, ${mode},
      'running', ${actor})`;

  const finish = async (patch: {
    status: string;
    message: string;
    recordsRead?: number;
    mappedCount?: number;
    unmappedCount?: number;
    detail?: Record<string, unknown>;
  }): Promise<AcctSyncRunRow> => {
    await db`
      UPDATE portmgmt.acct_sync_runs
      SET status = ${patch.status}, message = ${patch.message},
          records_read = ${patch.recordsRead ?? 0},
          mapped_count = ${patch.mappedCount ?? 0},
          unmapped_count = ${patch.unmappedCount ?? 0},
          detail = ${JSON.stringify(patch.detail ?? {})}::jsonb,
          updated_at = now()
      WHERE id = ${id}`;
    const rows = await db`
      SELECT * FROM portmgmt.acct_sync_runs WHERE id = ${id} LIMIT 1`;
    return rowToRun(rows[0] as Record<string, unknown>);
  };

  if (mode === "live") {
    const missing = missingConfig(conn.provider);
    if (missing.length) {
      return finish({
        status: "setup_required",
        message:
          `Provider setup required — missing environment variables: ` +
          missing.join(", "),
        detail: { missingEnvVars: missing },
      });
    }
    // Config present (a future state): the live pull itself is not
    // implemented in this phase and is reported as such — honestly,
    // never as a success.
    return finish({
      status: "error",
      message: "live_pull_not_implemented",
      detail: { provider: conn.provider },
    });
  }

  // dry_run: map the deterministic sample payload; creates NO
  // financial statement sets and touches no provider.
  const sample = samplePayload(conn.provider);
  const { mapped, unmapped } = mapLines(sample);
  return finish({
    status: "done",
    message:
      "Dry run over the provider sample payload — no live connection " +
      "was used and no financial statements were created.",
    recordsRead: sample.length,
    mappedCount: mapped.length,
    unmappedCount: unmapped.length,
    detail: { mapped, unmappedLabels: unmapped, sample: true },
  });
}

/** Provider catalog for the Accounting tab: every provider with its
 * setup steps and which env vars are still missing. */
export function providerCatalog(): Array<
  AccountingProvider & { missingEnvVars: string[] }
> {
  return Object.values(PROVIDERS).map((p) => ({
    ...p,
    missingEnvVars: missingConfig(p.key),
  }));
}

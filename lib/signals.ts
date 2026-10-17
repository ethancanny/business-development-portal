/**
 * Phase 4 — owner-transition signals: computation pass (Oct 17, 2026).
 *
 * Diffs the diffable sources the portal already holds and stamps
 * review-flag signals (lib/signals-core.ts shape: {type, date, label,
 * source}) onto mi_companies.details.signals — fit and non-fit
 * companies alike. Signals NEVER touch fit stamps, status, or ranking:
 * the only details key this pass writes is `signals`.
 *
 * Sources:
 *  - ADHS register (mi_adhs_licenses): license_first_seen (only for
 *    months after the register's baseline month — Oct 2026 is the
 *    baseline, so first_seen/lapse can only fire from the Nov snapshot
 *    on), license_lapsed (register row behind the latest snapshot
 *    month), license_unit_change (material licensed-capacity moves,
 *    diffed against the pass's own state).
 *  - SBA 7(a) stamps: sba7aOwnershipLoan=true → sba_ownership_loan,
 *    dated by the stamp's most-recent loan date.
 *  - USASpending contract enrichment stamps: fedExpiring12moCount > 0
 *    → contract_expiring, dated by the latest contract end.
 *  - Hospitality spine: group snapshot diff (state-held) →
 *    hospitality_new_location / hospitality_permit_lapsed /
 *    license_first_seen / license_lapsed on the mirrored company, plus
 *    hospitality_inspection_trend from member permits' inspections.
 *    DLLC license table is empty (source retired) — the arm says so.
 *
 * Documented gaps (no diffable source exists — never invented):
 * UCC filings and ACC officer/agent changes (ACC is human-check
 * gated; eCorp browser access is blocked).
 *
 * State: mi_signal_state holds the previous-pass snapshots the diffs
 * need (ADHS license→company attribution + units, hospitality group
 * snapshots), so re-runs over unchanged data stamp ZERO new signals
 * and spine rebuilds that wipe details get the same signals re-derived
 * with their original dates (dates come from the source data, not the
 * run date, wherever the source carries one).
 *
 * Refresh coverage: wired into runMarketIngest (daily 06:00 source=all)
 * as the last job, after the ADHS and hospitality steps it diffs, and
 * runnable alone via POST /api/market/ingest?source=signals. Every run
 * logs a `signals-xcheck` verdict with per-source results (Ethan's
 * rule: a silent check is a failed check).
 */
import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import { logSync } from "./market-db";
import { locationKeyFor } from "./hospitality-ingest";
import {
  diffAdhsLicenses,
  diffGroupSnapshots,
  inspectionTrend,
  isDateStr,
  isMaterialUnitChange,
  mergeSignals,
  monthFirstDay,
  type AdhsLicenseRow,
  type GroupSnapshot,
  type TransitionSignal,
} from "./signals-core";

type Sql = NeonQueryFunction<false, false>;
let cached: Sql | null = null;
function sql(): Sql {
  if (!cached) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set (signals pass requires Postgres)");
    cached = neon(url);
  }
  return cached;
}

let ensured = false;
async function ensureState(): Promise<void> {
  if (ensured) return;
  const db = sql();
  await db`CREATE TABLE IF NOT EXISTS mi_signal_state (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL DEFAULT '',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`;
  ensured = true;
}

async function getStateJson<T>(key: string): Promise<T | null> {
  await ensureState();
  const db = sql();
  const rows = await db`SELECT value FROM mi_signal_state WHERE key = ${key}`;
  if (!rows.length) return null;
  try {
    return JSON.parse(String(rows[0].value)) as T;
  } catch {
    return null;
  }
}

async function setStateJson(key: string, value: unknown): Promise<void> {
  await ensureState();
  const db = sql();
  const text = JSON.stringify(value);
  await db`INSERT INTO mi_signal_state (key, value) VALUES (${key}, ${text})
           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`;
}

/* ---------------- helpers ---------------- */

const str = (v: unknown): string => (v === null || v === undefined ? "" : String(v));
const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};

function phoenixDateOf(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Phoenix",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}
const phoenixToday = (): string => phoenixDateOf(new Date());

function parseDetails(raw: unknown): Record<string, unknown> | null {
  const t = str(raw);
  if (!t.startsWith("{")) return null;
  try {
    const d = JSON.parse(t) as Record<string, unknown>;
    return d && typeof d === "object" ? d : null;
  } catch {
    return null;
  }
}

const humanize = (k: string): string =>
  k
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());

const money = (n: number): string => `$${Math.round(n).toLocaleString("en-US")}`;

interface CompanyRow {
  id: string;
  key: string; // source|dedup_key|sector — stable across reset re-imports
  details: Record<string, unknown>;
}

interface ArmResult {
  verdict: string;
  error?: boolean;
}

/** Accumulates signal additions per company row; flush() writes only
 * rows where at least one addition was genuinely new. */
class SignalWriter {
  private pending = new Map<string, { row: CompanyRow; additions: TransitionSignal[] }>();
  constructor(private rowsById: Map<string, CompanyRow>) {}
  add(rowId: string, sig: TransitionSignal): void {
    const row = this.rowsById.get(rowId);
    if (!row) return;
    let p = this.pending.get(rowId);
    if (!p) {
      p = { row, additions: [] };
      this.pending.set(rowId, p);
    }
    p.additions.push(sig);
  }
  async flush(): Promise<{ rows: number; added: number }> {
    const db = sql();
    let added = 0;
    let rows = 0;
    for (const { row, additions } of Array.from(this.pending.values())) {
      const merged = mergeSignals(row.details.signals, additions);
      if (merged.added === 0) continue;
      row.details.signals = merged.signals;
      await db`UPDATE mi_companies SET details = ${JSON.stringify(row.details)} WHERE id = ${row.id}`;
      added += merged.added;
      rows++;
    }
    return { rows, added };
  }
}

const mk = (type: string, date: string, label: string, source: string): TransitionSignal => ({
  type,
  date,
  label,
  source,
  text: label,
});

/* ---------------- ADHS arm ---------------- */

async function armAdhs(writer: SignalWriter, rowsById: Map<string, CompanyRow>): Promise<ArmResult> {
  const db = sql();
  let reg: Record<string, unknown>[];
  try {
    reg = (await db`SELECT license_number, name, category, first_seen_month, last_seen_month
                     FROM mi_adhs_licenses`) as unknown as Record<string, unknown>[];
  } catch {
    return { verdict: "ADHS: register table unavailable — arm skipped", error: true };
  }
  if (!reg.length) return { verdict: "ADHS: register empty — nothing to diff" };

  const rows: AdhsLicenseRow[] = reg.map((r) => ({
    licenseNumber: str(r.license_number),
    name: str(r.name),
    category: str(r.category),
    firstSeenMonth: str(r.first_seen_month),
    lastSeenMonth: str(r.last_seen_month),
  }));
  const months = rows.map((r) => r.lastSeenMonth).filter(Boolean).sort();
  const latest = months[months.length - 1] ?? "";
  const firsts = rows.map((r) => r.firstSeenMonth).filter(Boolean).sort();
  const baseline = firsts[0] ?? "";
  const stale = rows.filter((r) => r.lastSeenMonth && latest && r.lastSeenMonth < latest);

  // Companies carrying ADHS stamps (license numbers are the join key)
  // were loaded centrally into rowsById before the arms ran.
  const attribution = new Map<string, string>(); // licenseNumber -> rowId
  const stamped: { rowId: string; key: string; units: number | null; facilities: number | null }[] = [];
  const rowIdByKey = new Map<string, string>();
  rowsById.forEach((row) => {
    const d = row.details;
    if (!Array.isArray(d.adhsLicenseNumbers)) return;
    rowIdByKey.set(row.key, row.id);
    const nums = (d.adhsLicenseNumbers as unknown[]).map(str);
    for (const n of nums) if (n) attribution.set(n, row.id);
    stamped.push({
      rowId: row.id,
      key: row.key,
      units: num(d.adhsUnits),
      facilities: num(d.adhsFacilities),
    });
  });
  // Attribution survives a stamp rewrite only via state: union the
  // stored map with the current stamps and never shrink it.
  const prevAttr = (await getStateJson<Record<string, string>>("adhs_license_company")) ?? {};
  const prevUnits = (await getStateJson<Record<string, number>>("adhs_company_units")) ?? {};
  const unitsBaselineDone = (await getStateJson<boolean>("adhs_units_baseline")) === true;

  const events = diffAdhsLicenses(stale, rows, baseline, latest);
  let firstSeen = 0;
  let lapsed = 0;
  let unattributed = 0;
  for (const ev of events) {
    const rowId = attribution.get(ev.licenseNumber) ?? rowIdByKey.get(prevAttr[ev.licenseNumber] ?? "");
    if (!rowId) {
      unattributed++;
      continue;
    }
    if (ev.kind === "license_first_seen") {
      writer.add(rowId, mk("license_first_seen", ev.date, `New ADHS license ${ev.licenseNumber} — ${ev.name}${ev.category ? ` (${humanize(ev.category)})` : ""} ${ev.detail}`, "ADHS"));
      firstSeen++;
    } else {
      writer.add(rowId, mk("license_lapsed", ev.date, `ADHS license ${ev.licenseNumber} — ${ev.name} ${ev.detail}`, "ADHS"));
      lapsed++;
    }
  }

  // Unit changes (state-diffed; first pass only records the baseline).
  let unitChanges = 0;
  const nextUnits: Record<string, number> = { ...prevUnits };
  for (const c of stamped) {
    if (c.units === null) continue;
    const prev = prevUnits[c.key];
    if (unitsBaselineDone && prev !== undefined && isMaterialUnitChange(prev, c.units)) {
      writer.add(
        c.rowId,
        mk(
          "license_unit_change",
          monthFirstDay(latest) || phoenixToday(),
          `ADHS licensed capacity changed ${prev} → ${c.units} units${c.facilities ? ` across ${c.facilities} facilities` : ""} (${latest} register snapshot)`,
          "ADHS"
        )
      );
      unitChanges++;
    }
    nextUnits[c.key] = c.units;
  }

  const keyByRowId = new Map(stamped.map((c) => [c.rowId, c.key]));
  const mergedAttr: Record<string, string> = { ...prevAttr };
  attribution.forEach((rowId, lic) => {
    // store by company KEY (row ids churn on reset re-imports)
    const key = keyByRowId.get(rowId);
    if (key) mergedAttr[lic] = key;
  });
  await setStateJson("adhs_license_company", mergedAttr);
  await setStateJson("adhs_company_units", nextUnits);
  await setStateJson("adhs_units_baseline", true);

  return {
    verdict:
      `ADHS: register ${rows.length} licenses, baseline ${baseline}, latest ${latest} — ` +
      `${firstSeen} first-seen, ${lapsed} lapsed, ${unitChanges} unit changes` +
      (unitsBaselineDone ? "" : " (units baseline recorded this pass)") +
      (unattributed ? `, ${unattributed} events unattributed to a stamped company` : ""),
  };
}

/* ---------------- SBA 7(a) arm ---------------- */

async function armSba(writer: SignalWriter, rowsById: Map<string, CompanyRow>): Promise<ArmResult> {
  const db = sql();
  const rows = (await db`SELECT id, details FROM mi_companies
    WHERE details LIKE '{%' AND (details::jsonb ->> 'sba7aOwnershipLoan') = 'true'`) as unknown as Record<string, unknown>[];
  let n = 0;
  for (const r of rows) {
    const row = rowsById.get(str(r.id));
    if (!row) continue;
    const d = row.details;
    const date = isDateStr(d.sba7aRecentDate) ? (d.sba7aRecentDate as string) : phoenixToday();
    const lender = str(d.sba7aLender);
    writer.add(
      row.id,
      mk(
        "sba_ownership_loan",
        date,
        `SBA 7(a) loan coded to an ownership change — most recent ${date}${lender ? ` via ${lender}` : ""}`,
        "SBA 7(a)"
      )
    );
    n++;
  }
  return { verdict: `SBA 7(a): ${n} companies carry an ownership-change loan stamp` };
}

/* ---------------- USASpending contracts arm ---------------- */

async function armContracts(writer: SignalWriter, rowsById: Map<string, CompanyRow>): Promise<ArmResult> {
  const db = sql();
  const rows = (await db`SELECT id FROM mi_companies
    WHERE details LIKE '{%' AND (details::jsonb ->> 'fedExpiring12moCount') ~ '^[0-9]+$'
      AND (details::jsonb ->> 'fedExpiring12moCount')::int > 0`) as unknown as Record<string, unknown>[];
  let n = 0;
  let totalAmt = 0;
  for (const r of rows) {
    const row = rowsById.get(str(r.id));
    if (!row) continue;
    const d = row.details;
    const count = num(d.fedExpiring12moCount) ?? 0;
    const amount = num(d.fedExpiring12moAmount) ?? 0;
    totalAmt += amount;
    const latestEnd = isDateStr(d.fedLatestEnd) ? (d.fedLatestEnd as string) : "";
    const date = latestEnd || (isDateStr(d.fedAsOf) ? (d.fedAsOf as string) : phoenixToday());
    writer.add(
      row.id,
      mk(
        "contract_expiring",
        date,
        `${count} federal contract${count === 1 ? "" : "s"} totaling ${money(amount)} expiring within 12 months${latestEnd ? ` — latest end ${latestEnd}` : ""}`,
        "USASpending"
      )
    );
    n++;
  }
  return { verdict: `Contracts: ${n} companies with contracts expiring ≤12 months (${money(totalAmt)} at stake)` };
}

/* ---------------- Hospitality arm ---------------- */

async function armHospitality(writer: SignalWriter, rowsById: Map<string, CompanyRow>): Promise<ArmResult> {
  const db = sql();
  const groupRows = (await db`SELECT group_key, permit_ids, license_numbers FROM mi_hospitality_groups`) as unknown as Record<string, unknown>[];
  const permitRows = (await db`SELECT permit_id, address, city, zip, first_seen, inspections FROM mi_hospitality_permits`) as unknown as Record<string, unknown>[];
  const licCountRows = (await db`SELECT count(*)::int AS n FROM mi_hospitality_licenses`) as unknown as Record<string, unknown>[];
  const dllcCount = Number(licCountRows[0]?.n ?? 0);

  const permitInfo = new Map<string, { addrKey: string; label: string; firstSeen: string; inspections: unknown }>();
  for (const p of permitRows) {
    const pid = str(p.permit_id);
    const addr = str(p.address);
    const city = str(p.city);
    permitInfo.set(pid, {
      addrKey: locationKeyFor(addr, str(p.zip), pid),
      label: `${addr}${city ? `, ${city}` : ""}`,
      firstSeen: p.first_seen ? phoenixDateOf(new Date(String(p.first_seen))) : "",
      inspections: p.inspections,
    });
  }

  const curr = new Map<string, GroupSnapshot>();
  for (const g of groupRows) {
    const key = str(g.group_key);
    const permitIds = Array.isArray(g.permit_ids) ? (g.permit_ids as unknown[]).map(str) : [];
    const snap: GroupSnapshot = {
      groupKey: key,
      permitIds,
      addrKeys: [],
      licenseNumbers: Array.isArray(g.license_numbers) ? (g.license_numbers as unknown[]).map(str) : [],
      permitAddr: {},
      permitAddrKey: {},
      permitFirstSeen: {},
    };
    const addrSet = new Set<string>();
    for (const pid of permitIds) {
      const info = permitInfo.get(pid);
      if (!info) continue;
      snap.permitAddr[pid] = info.label;
      snap.permitAddrKey[pid] = info.addrKey;
      snap.permitFirstSeen[pid] = info.firstSeen;
      addrSet.add(info.addrKey);
    }
    snap.addrKeys = Array.from(addrSet);
    curr.set(key, snap);
  }

  // Mirrored company per group (source 'Hospitality Spine', dedup = group key).
  const compRows = (await db`SELECT id, dedup_key FROM mi_companies WHERE source = 'Hospitality Spine'`) as unknown as Record<string, unknown>[];
  const rowIdByGroup = new Map<string, string>();
  for (const r of compRows) rowIdByGroup.set(str(r.dedup_key), str(r.id));

  const runDate = phoenixToday();
  const prevRaw = await getStateJson<Record<string, GroupSnapshot>>("hosp_group_snapshot");
  let diffVerdict = "";
  let newLoc = 0;
  let lapsedP = 0;
  if (!prevRaw) {
    diffVerdict = `group baseline recorded (${curr.size} groups) — diff arms from the next pass`;
  } else {
    const prev = new Map<string, GroupSnapshot>(Object.entries(prevRaw));
    const events = diffGroupSnapshots(prev, curr, runDate);
    for (const ev of events) {
      const rowId = rowIdByGroup.get(ev.groupKey);
      if (!rowId) continue;
      writer.add(rowId, mk(ev.kind, ev.date, ev.label, ev.source));
      if (ev.kind === "hospitality_new_location") newLoc++;
      if (ev.kind === "hospitality_permit_lapsed") lapsedP++;
    }
    diffVerdict = `${events.length} group changes (${newLoc} new locations, ${lapsedP} permit lapses)`;
  }
  const snapshotObj: Record<string, GroupSnapshot> = {};
  curr.forEach((v, k) => {
    snapshotObj[k] = v;
  });
  await setStateJson("hosp_group_snapshot", snapshotObj);

  // Inspection trends per group.
  let trends = 0;
  curr.forEach((snap, key) => {
    const pts: { date: string; priorityViolations: number }[] = [];
    for (const pid of snap.permitIds) {
      const insp = permitInfo.get(pid)?.inspections;
      if (!Array.isArray(insp)) continue;
      for (const i of insp as Record<string, unknown>[]) {
        pts.push({ date: str(i?.date), priorityViolations: num(i?.priorityViolations) ?? 0 });
      }
    }
    const t = inspectionTrend(pts);
    if (!t) return;
    const rowId = rowIdByGroup.get(key);
    if (!rowId) return;
    writer.add(
      rowId,
      mk(
        "hospitality_inspection_trend",
        t.date,
        `Inspection trend worsening — priority violations average ${t.lateAvg} per inspection in the recent half vs ${t.earlyAvg} earlier (${t.count} inspections)`,
        "Maricopa ESD"
      )
    );
    trends++;
  });

  return {
    verdict:
      `Hospitality: ${curr.size} groups — ${diffVerdict}; ${trends} inspection-trend flags; ` +
      `DLLC licenses: ${dllcCount} rows${dllcCount === 0 ? " (source retired — license diff cannot run)" : ""}`,
  };
}

/* ---------------- the pass ---------------- */

export interface SignalsPassResult {
  added: number;
  rowsStamped: number;
  verdicts: string[];
}

export async function runTransitionSignalsPass(): Promise<SignalsPassResult> {
  const db = sql();
  // Load every company the stamp-arms might touch into the writer's row
  // map (id -> parsed details). Targeted loads keep this off the full
  // 68k-row table: ADHS-stamped healthcare, SBA/contract-stamped rows,
  // and all Hospitality Spine mirrors.
  const rowsById = new Map<string, CompanyRow>();
  const load = async (where: string, params: unknown[] = []) => {
    const rows = (await db.query(
      `SELECT id, source, dedup_key, sector, details FROM mi_companies WHERE ${where}`,
      params
    )) as Record<string, unknown>[];
    for (const r of rows) {
      const id = str(r.id);
      if (rowsById.has(id)) continue;
      const d = parseDetails(r.details);
      if (!d) continue;
      rowsById.set(id, {
        id,
        key: `${str(r.source)}|${str(r.dedup_key)}|${str(r.sector)}`,
        details: d,
      });
    }
  };
  await load(`sector = 'Healthcare' AND details LIKE '{%' AND (details::jsonb -> 'adhsLicenseNumbers') IS NOT NULL`);
  await load(`details LIKE '{%' AND ((details::jsonb ->> 'sba7aOwnershipLoan') = 'true' OR ((details::jsonb ->> 'fedExpiring12moCount') ~ '^[0-9]+$' AND (details::jsonb ->> 'fedExpiring12moCount')::int > 0))`);
  await load(`source = 'Hospitality Spine'`);

  const writer = new SignalWriter(rowsById);
  const arms: { name: string; run: () => Promise<ArmResult> }[] = [
    { name: "ADHS", run: () => armAdhs(writer, rowsById) },
    { name: "SBA", run: () => armSba(writer, rowsById) },
    { name: "Contracts", run: () => armContracts(writer, rowsById) },
    { name: "Hospitality", run: () => armHospitality(writer, rowsById) },
  ];
  const verdicts: string[] = [];
  let anyError = false;
  for (const arm of arms) {
    try {
      const r = await arm.run();
      verdicts.push(r.verdict);
      if (r.error) anyError = true;
    } catch (err) {
      anyError = true;
      verdicts.push(`${arm.name}: arm failed — ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const flushed = await writer.flush();

  verdicts.push("UCC filings + ACC officer/agent changes: no diffable source (ACC human-check-gated) — not checked, by design");
  await logSync(
    "signals-xcheck",
    anyError ? "error" : "ok",
    flushed.added,
    verdicts.join(" · ").slice(0, 1500)
  );
  await logSync(
    "signals",
    anyError ? "error" : "ok",
    flushed.added,
    `Transition signals pass: ${flushed.added} new signal${flushed.added === 1 ? "" : "s"} stamped on ${flushed.rows} companies (review flags only — fit untouched).`
  );
  return { added: flushed.added, rowsStamped: flushed.rows, verdicts };
}

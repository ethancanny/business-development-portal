/**
 * Phase 4 — owner-transition signals: pure core (Oct 17, 2026).
 *
 * The normalized signal shape stored in mi_companies.details.signals is
 *   { type, date (YYYY-MM-DD), label, source }
 * Signals are REVIEW FLAGS ONLY (Ethan, repeated across specs): they
 * carry a type, a date, and a source, and they never change fit, score,
 * or ranking. Legacy entries written before this normalization —
 * filings ({date, kind:"filing", tag, text, url, accession}) and news
 * links ({date, source:"News", text, url}) — are preserved verbatim and
 * mapped onto the shape at read time by normalizeSignalForDisplay.
 *
 * This module is deliberately import-free so the diff/merge logic can
 * be compiled and exercised standalone (synthetic snapshot proofs).
 */

export interface TransitionSignal {
  type: string;
  date: string; // YYYY-MM-DD
  label: string;
  source: string;
  /** Mirror of label: legacy renderers (Overview "why it matters")
   * read .text, so new signals carry both keys with the same value. */
  text: string;
}

export const SIGNAL_CAP = 20;
/** Signals JSON budget inside a details blob: when merging would push
 * the serialized signals past this, oldest entries drop first (never
 * below 5) so a signal-rich company can't crowd out its other stamps. */
export const SIGNAL_JSON_BUDGET = 1800;

type Raw = Record<string, unknown>;

const s = (v: unknown): string => (v === null || v === undefined ? "" : String(v));
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const isDateStr = (v: unknown): v is string => typeof v === "string" && DATE_RE.test(v);

/** Stable identity for dedupe. New-shape signals key on
 * type+date+source+label; legacy filing entries on their accession
 * (falling back to date+text); legacy news on date+text+url. */
export function signalIdentity(raw: unknown): string {
  const o = (raw ?? {}) as Raw;
  if (s(o.accession)) return `a:${s(o.accession)}`;
  if (s(o.type)) return `t:${s(o.type)}|${s(o.date)}|${s(o.source)}|${s(o.label)}`;
  return `x:${s(o.date)}|${s(o.text)}|${s(o.url)}`;
}

/** Map any stored signal (new shape or legacy filing/news) onto the
 * display shape {type, date, label, source}. */
export function normalizeSignalForDisplay(raw: unknown): { type: string; date: string; label: string; source: string } {
  const o = (raw ?? {}) as Raw;
  const type = s(o.type) || (s(o.kind) === "filing" ? "filing" : s(o.source) === "News" ? "news" : "note");
  const label = s(o.label) || s(o.text) || (s(o.tag) ? String(o.tag) : "");
  const source = s(o.source) || (s(o.kind) === "filing" ? "SEC Filings" : "");
  return { type, date: s(o.date), label, source };
}

/**
 * Merge additions into an existing signals array: existing entries are
 * preserved verbatim, additions are appended only when their identity
 * is new, the result is sorted by date (stable) and capped at the
 * newest SIGNAL_CAP entries (and within SIGNAL_JSON_BUDGET). Returns
 * the merged array and how many additions were actually new — a second
 * run over unchanged data must report added === 0 (idempotence).
 */
export function mergeSignals(
  existing: unknown,
  additions: TransitionSignal[]
): { signals: unknown[]; added: number } {
  const cur: unknown[] = Array.isArray(existing) ? [...existing] : [];
  const seen = new Set(cur.map(signalIdentity));
  let added = 0;
  for (const a of additions) {
    const id = signalIdentity(a);
    if (seen.has(id)) continue;
    seen.add(id);
    cur.push(a);
    added++;
  }
  const dated = cur.map((sig, i) => ({ sig, i, d: s((sig as Raw)?.date) }));
  dated.sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : a.i - b.i));
  let out: unknown[] = dated.map((x) => x.sig);
  if (out.length > SIGNAL_CAP) out = out.slice(out.length - SIGNAL_CAP);
  while (out.length > 5 && JSON.stringify(out).length > SIGNAL_JSON_BUDGET) out = out.slice(1);
  return { signals: out, added };
}

/* ---------------- month helpers (YYYY-MM snapshot months) ---------------- */

export function monthFirstDay(ym: string): string {
  return /^\d{4}-\d{2}$/.test(ym) ? `${ym}-01` : "";
}

/** The YYYY-MM following a YYYY-MM, and its first day. */
export function monthAfter(ym: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(ym);
  if (!m) return "";
  let y = Number(m[1]);
  let mo = Number(m[2]) + 1;
  if (mo > 12) {
    mo = 1;
    y++;
  }
  return `${y}-${String(mo).padStart(2, "0")}`;
}

/* ---------------- ADHS register diff ---------------- */

export interface AdhsLicenseRow {
  licenseNumber: string;
  name: string;
  category: string;
  firstSeenMonth: string; // YYYY-MM
  lastSeenMonth: string; // YYYY-MM
}

export interface AdhsDiffEvent {
  kind: "license_first_seen" | "license_lapsed";
  licenseNumber: string;
  name: string;
  category: string;
  date: string; // YYYY-MM-DD
  detail: string;
}

/**
 * Diff two ADHS register views. `curr` is the register as it stands;
 * `stale` is the subset of rows whose lastSeenMonth is behind the
 * register's latest month (in production the register never deletes
 * rows, so a lapsed license is exactly a stale row; in a synthetic
 * two-snapshot harness, pass the earlier snapshot as `stale` and rows
 * missing from `curr` lapse the same way). `baselineMonth` is the
 * register's first-ever snapshot month: licenses first seen IN the
 * baseline month are the pre-existing population, not news, so
 * first_seen only fires for later months.
 */
export function diffAdhsLicenses(
  stale: AdhsLicenseRow[],
  curr: AdhsLicenseRow[],
  baselineMonth: string,
  latestMonth: string
): AdhsDiffEvent[] {
  const out: AdhsDiffEvent[] = [];
  const currByNum = new Map(curr.map((r) => [r.licenseNumber, r]));
  for (const r of curr) {
    if (baselineMonth && r.firstSeenMonth > baselineMonth) {
      out.push({
        kind: "license_first_seen",
        licenseNumber: r.licenseNumber,
        name: r.name,
        category: r.category,
        date: monthFirstDay(r.firstSeenMonth),
        detail: `first appears in the ${r.firstSeenMonth} register snapshot`,
      });
    }
  }
  const lapsedDone = new Set<string>();
  const lapse = (r: AdhsLicenseRow) => {
    if (!r.licenseNumber || lapsedDone.has(r.licenseNumber)) return;
    lapsedDone.add(r.licenseNumber);
    const absent = monthAfter(r.lastSeenMonth);
    out.push({
      kind: "license_lapsed",
      licenseNumber: r.licenseNumber,
      name: r.name,
      category: r.category,
      date: monthFirstDay(absent),
      detail: `last seen in the ${r.lastSeenMonth} snapshot; absent from ${latestMonth}`,
    });
  };
  for (const r of stale) {
    const now = currByNum.get(r.licenseNumber);
    if (!now || now.lastSeenMonth < latestMonth) lapse(r);
  }
  return out;
}

/** Material licensed-capacity change (ADHS units): at least 5 units
 * AND at least 20% in either direction. */
export function isMaterialUnitChange(prev: number, next: number): boolean {
  if (!(prev > 0) || !(next >= 0) || prev === next) return false;
  const d = Math.abs(next - prev);
  return d >= 5 && d / prev >= 0.2;
}

/* ---------------- Hospitality group snapshot diff ---------------- */

export interface GroupSnapshot {
  groupKey: string;
  permitIds: string[];
  addrKeys: string[]; // distinct location keys across member permits/licenses
  licenseNumbers: string[];
  permitAddr: Record<string, string>; // permitId -> human address label
  permitAddrKey: Record<string, string>; // permitId -> normalized location key
  permitFirstSeen: Record<string, string>; // permitId -> YYYY-MM-DD first seen
}

export interface GroupDiffEvent {
  kind: "hospitality_new_location" | "hospitality_permit_lapsed" | "license_first_seen" | "license_lapsed";
  groupKey: string;
  date: string;
  label: string;
  source: string;
}

/** Diff two group snapshots (previous pass vs current). A permit that
 * is new AND sits at an address the group didn't have is a new
 * location; a new permit at an existing address is not. Vanished
 * permits/licenses lapse. */
export function diffGroupSnapshots(
  prev: Map<string, GroupSnapshot>,
  curr: Map<string, GroupSnapshot>,
  runDate: string
): GroupDiffEvent[] {
  const out: GroupDiffEvent[] = [];
  curr.forEach((g, key) => {
    const p = prev.get(key);
    if (!p) return; // brand-new group: baseline, not news
    const prevPermits = new Set(p.permitIds);
    const prevAddrs = new Set(p.addrKeys);
    const prevLicenses = new Set(p.licenseNumbers);
    for (const pid of g.permitIds) {
      if (prevPermits.has(pid)) continue;
      const label = g.permitAddr[pid] ?? pid;
      const isNewAddr = !prevAddrs.has(g.permitAddrKey[pid] ?? "");
      if (isNewAddr) {
        out.push({
          kind: "hospitality_new_location",
          groupKey: key,
          date: g.permitFirstSeen[pid] || runDate,
          label: `New location permitted: ${label} (permit ${pid})`,
          source: "Maricopa ESD",
        });
      }
    }
    const currPermits = new Set(g.permitIds);
    for (const pid of p.permitIds) {
      if (!currPermits.has(pid)) {
        out.push({
          kind: "hospitality_permit_lapsed",
          groupKey: key,
          date: runDate,
          label: `Permit ${pid}${p.permitAddr[pid] ? ` (${p.permitAddr[pid]})` : ""} no longer in the group's permit set`,
          source: "Maricopa ESD",
        });
      }
    }
    const currLicenses = new Set(g.licenseNumbers);
    for (const ln of g.licenseNumbers) {
      if (!prevLicenses.has(ln)) {
        out.push({
          kind: "license_first_seen",
          groupKey: key,
          date: runDate,
          label: `New liquor license ${ln} in the group's license set`,
          source: "DLLC",
        });
      }
    }
    for (const ln of p.licenseNumbers) {
      if (!currLicenses.has(ln)) {
        out.push({
          kind: "license_lapsed",
          groupKey: key,
          date: runDate,
          label: `Liquor license ${ln} no longer in the group's license set`,
          source: "DLLC",
        });
      }
    }
  });
  return out;
}

/* ---------------- Inspection trend ---------------- */

export interface InspectionPoint {
  date: string; // YYYY-MM-DD
  priorityViolations: number;
}

/**
 * Deterioration trend over a group's inspections: needs at least 6
 * dated inspections spanning at least 45 days; compares mean priority
 * violations in the earlier half vs the later half (split by count).
 * Fires when the later mean is at least 1.0 higher AND at least 2.
 */
export function inspectionTrend(
  points: InspectionPoint[]
): { date: string; earlyAvg: number; lateAvg: number; count: number } | null {
  const pts = points
    .filter((p) => isDateStr(p.date))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  if (pts.length < 6) return null;
  const spanDays = (Date.parse(pts[pts.length - 1].date) - Date.parse(pts[0].date)) / 86400000;
  if (!(spanDays >= 45)) return null;
  const mid = Math.floor(pts.length / 2);
  const early = pts.slice(0, mid);
  const late = pts.slice(mid);
  const avg = (xs: InspectionPoint[]) => xs.reduce((a, x) => a + (x.priorityViolations || 0), 0) / xs.length;
  const earlyAvg = avg(early);
  const lateAvg = avg(late);
  if (lateAvg - earlyAvg >= 1.0 && lateAvg >= 2) {
    return {
      date: pts[pts.length - 1].date,
      earlyAvg: Math.round(earlyAvg * 10) / 10,
      lateAvg: Math.round(lateAvg * 10) / 10,
      count: pts.length,
    };
  }
  return null;
}

/**
 * Hospitality company-spine ingest (Phase 3, step 1 — data layer only).
 *
 * Sources verified live 2026-10-15 (see
 * goals/business-development-portal/hidden_files/
 * hospitality-sources-probe-2026-10-15.md and
 * hospitality-spine-build1-2026-10-15.md):
 *
 *  - AZ DLLC liquor licenses: NO working automated route exists today.
 *    The legacy ColdFusion query app (azliquor.gov/query/*.cfm, the
 *    series x city/county list generator) now 302-redirects to the new
 *    Drupal homepage — the CF server itself is alive (DSPortal.cfm
 *    still serves 200) but /query/ is retired. The new Drupal
 *    "License Lookup" page ships an empty body, licensee functions
 *    moved behind the dllc.azliquor.gov login portal, and
 *    elicense.az.gov does not connect from this network. Per Ethan's
 *    rules we do NOT bypass bot walls/CAPTCHAs, so the DLLC half
 *    probes the route each run, ingests nothing while it is dead,
 *    and says so in dllc-xcheck (a silent check is a failed check).
 *    ACC bulk extraction is also skipped per Ethan (Oct 15, 2026).
 *
 *  - Maricopa County Environmental Services (envapp.maricopa.gov):
 *    server-rendered ASP.NET app. Permit search is a JSON endpoint
 *    (POST /Search/Results with the page's antiforgery token +
 *    session cookie; it returns the FULL matching set — DataTables
 *    runs client-side). Enumeration key = ZIP code. Inspection
 *    history is a server-rendered table at
 *    /Permit/PermitResults/<permitId> (date, purpose, grade, status,
 *    priority-violation count). No browser session required.
 *
 * The route's 60s budget means a full pass never fits one call: the
 * Maricopa ZIP worklist is walked by a cursor persisted in
 * mi_hospitality_state, inspections are backfilled oldest-first, and
 * the daily source=all run keeps advancing both (snapshot semantics:
 * first_seen / last_seen per permit support later signal diffing).
 *
 * Cross-reference (Ethan's standing rule): maricopa-permits-xcheck
 * re-runs the first ZIP pulled in a run as an independent second
 * aggregation of the identical filter and reconciles counts;
 * dllc-xcheck reports the route verdict every run. Both log even
 * when the check itself cannot run.
 */
import { neon } from "@neondatabase/serverless";
import { logSync } from "./market-db";

function sql() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set (hospitality ingest requires Postgres)");
  return neon(url);
}

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36";
const ENVAPP = "https://envapp.maricopa.gov";

/* ---------------- Schema ---------------- */

let ensured = false;
async function ensureHospitalityTables(): Promise<void> {
  if (ensured) return;
  const db = sql();
  await db`
    CREATE TABLE IF NOT EXISTS mi_hospitality_licenses (
      license_number TEXT PRIMARY KEY,
      series TEXT NOT NULL DEFAULT '',
      licensee TEXT NOT NULL DEFAULT '',
      agent TEXT NOT NULL DEFAULT '',
      premises_name TEXT NOT NULL DEFAULT '',
      address TEXT NOT NULL DEFAULT '',
      city TEXT NOT NULL DEFAULT '',
      county TEXT NOT NULL DEFAULT '',
      zip TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL DEFAULT 'DLLC',
      first_seen TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_seen TIMESTAMPTZ NOT NULL DEFAULT now(),
      fetched_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`;
  await db`
    CREATE TABLE IF NOT EXISTS mi_hospitality_permits (
      permit_id TEXT PRIMARY KEY,
      permit_type TEXT NOT NULL DEFAULT '',
      business_name TEXT NOT NULL DEFAULT '',
      address TEXT NOT NULL DEFAULT '',
      city TEXT NOT NULL DEFAULT '',
      zip TEXT NOT NULL DEFAULT '',
      cutting_edge BOOLEAN NOT NULL DEFAULT false,
      inspections JSONB NOT NULL DEFAULT '[]'::jsonb,
      inspections_count INTEGER NOT NULL DEFAULT 0,
      latest_inspection DATE,
      inspections_fetched_at TIMESTAMPTZ,
      source TEXT NOT NULL DEFAULT 'Maricopa ESD',
      first_seen TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_seen TIMESTAMPTZ NOT NULL DEFAULT now(),
      fetched_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`;
  await db`
    CREATE TABLE IF NOT EXISTS mi_hospitality_groups (
      group_key TEXT PRIMARY KEY,
      name TEXT NOT NULL DEFAULT '',
      location_count INTEGER NOT NULL DEFAULT 0,
      permit_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
      license_numbers JSONB NOT NULL DEFAULT '[]'::jsonb,
      cities JSONB NOT NULL DEFAULT '[]'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`;
  await db`
    CREATE TABLE IF NOT EXISTS mi_hospitality_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL DEFAULT '',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`;
  ensured = true;
}

async function getState(key: string): Promise<string | null> {
  const db = sql();
  const rows = await db`SELECT value FROM mi_hospitality_state WHERE key = ${key}`;
  return rows.length ? String(rows[0].value) : null;
}

async function setState(key: string, value: string): Promise<void> {
  const db = sql();
  await db`INSERT INTO mi_hospitality_state (key, value) VALUES (${key}, ${value})
           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`;
}

/* ---------------- Maricopa ZIP worklist ----------------
 * Phoenix-metro ZIPs (Maricopa County). A ZIP that returns zero rows
 * is harmless; the cursor wraps, so the list is a re-enumeration
 * cycle for snapshot diffing, not a one-shot import. */
const MARICOPA_ZIPS = [
  "85003", "85004", "85005", "85006", "85007", "85008", "85009", "85012",
  "85013", "85014", "85015", "85016", "85017", "85018", "85019", "85020",
  "85021", "85022", "85023", "85024", "85027", "85028", "85029", "85031",
  "85032", "85033", "85034", "85035", "85037", "85040", "85041", "85042",
  "85043", "85044", "85045", "85048", "85050", "85051", "85053", "85054",
  "85055", "85083", "85085", "85086", "85087",
  "85142",
  "85201", "85202", "85203", "85204", "85205", "85206", "85207", "85208",
  "85209", "85210", "85212", "85213", "85215",
  "85224", "85225", "85226", "85233", "85234", "85244", "85246", "85248",
  "85249", "85250", "85251", "85252", "85253", "85254", "85255", "85256",
  "85257", "85258", "85259", "85260", "85262", "85263", "85266", "85268",
  "85281", "85282", "85283", "85284", "85285", "85286", "85287", "85295",
  "85296", "85297", "85298",
  "85301", "85302", "85303", "85304", "85305", "85306", "85307", "85308",
  "85310", "85311", "85318", "85320", "85322", "85323", "85326", "85327",
  "85331", "85335", "85337", "85338", "85339", "85340", "85342", "85343",
  "85345", "85351", "85353", "85354", "85355", "85358", "85361", "85363",
  "85373", "85374", "85375", "85377", "85378", "85379", "85381", "85382",
  "85383", "85387", "85388", "85390", "85392", "85395", "85396",
];

/* ---------------- envapp session + search ---------------- */

interface EnvSession {
  cookie: string;
  token: string;
}

async function envSession(): Promise<EnvSession> {
  const res = await fetch(`${ENVAPP}/EnvironmentalHealth/FoodInspections`, {
    headers: { "User-Agent": UA },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`envapp search page HTTP ${res.status}`);
  const html = await res.text();
  const m = html.match(/name="__RequestVerificationToken"[^>]*value="([^"]+)"/);
  if (!m) throw new Error("envapp antiforgery token not found on search page");
  const raw =
    typeof (res.headers as { getSetCookie?: () => string[] }).getSetCookie === "function"
      ? (res.headers as { getSetCookie: () => string[] }).getSetCookie()
      : [res.headers.get("set-cookie") ?? ""];
  const cookie = raw
    .filter(Boolean)
    .map((c) => c.split(";")[0])
    .join("; ");
  return { cookie, token: m[1] };
}

interface EnvPermitRow {
  permitId: string;
  permitType: string;
  businessName: string;
  businessAddressConcat: string;
  isCuttingEdgeParticipant: boolean | null;
}

async function envSearchByZip(sess: EnvSession, zip: string): Promise<EnvPermitRow[]> {
  const body = new URLSearchParams();
  body.set("draw", "1");
  body.set("start", "0");
  body.set("length", "10");
  for (const f of ["BusinessName", "AddressNum", "StreetName", "PreDirection", "StreetType", "City"]) {
    body.set(`licenseSearchParams[${f}]`, "");
  }
  body.set("licenseSearchParams[Zip]", zip);
  const res = await fetch(`${ENVAPP}/Search/Results`, {
    method: "POST",
    headers: {
      "User-Agent": UA,
      "Content-Type": "application/x-www-form-urlencoded",
      "X-Requested-With": "XMLHttpRequest",
      RequestVerificationToken: sess.token,
      Cookie: sess.cookie,
    },
    body: body.toString(),
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`envapp search HTTP ${res.status} for ZIP ${zip}`);
  const json = (await res.json()) as { data?: EnvPermitRow[] };
  return Array.isArray(json.data) ? json.data : [];
}

/* ---------------- parsing helpers ---------------- */

function parseAddress(concat: string, fallbackZip: string): { address: string; city: string; zip: string } {
  const m = /^(.*)\s+([A-Za-z][A-Za-z .]*?)\s+AZ\s+(\d{5})(?:-\d{4})?$/.exec(concat.trim());
  if (m) return { address: m[1].trim(), city: m[2].trim().toUpperCase(), zip: m[3] };
  return { address: concat.trim(), city: "", zip: fallbackZip };
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function cellText(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

export interface Inspection {
  id: string;
  date: string; // ISO yyyy-mm-dd ('' if unparseable)
  purpose: string;
  grade: string;
  status: string;
  priorityViolations: number;
}

function parseInspections(html: string): Inspection[] {
  const tbody = html.match(/<tbody>([\s\S]*?)<\/tbody>/);
  if (!tbody) return [];
  const out: Inspection[] = [];
  const rowRe = /<tr>([\s\S]*?)<\/tr>/g;
  let rowM: RegExpExecArray | null;
  while ((rowM = rowRe.exec(tbody[1])) !== null) {
    const row = rowM[1];
    const cells: string[] = [];
    const tdRe = /<td[^>]*>([\s\S]*?)<\/td>/g;
    let tdM: RegExpExecArray | null;
    while ((tdM = tdRe.exec(row)) !== null) cells.push(cellText(tdM[1]));
    if (cells.length < 5) continue;
    const idM = row.match(/\/Inspection\/[^/]+\/(INSP-[\w-]+)/);
    const dM = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(cells[0]);
    const iso = dM
      ? `${dM[3]}-${dM[1].padStart(2, "0")}-${dM[2].padStart(2, "0")}`
      : "";
    out.push({
      id: idM ? idM[1] : "",
      date: iso,
      purpose: cells[1],
      grade: cells[2],
      status: cells[3],
      priorityViolations: Number.parseInt(cells[4], 10) || 0,
    });
  }
  return out;
}

async function fetchInspections(sess: EnvSession, permitId: string): Promise<Inspection[]> {
  const res = await fetch(`${ENVAPP}/Permit/PermitResults/${encodeURIComponent(permitId)}`, {
    headers: { "User-Agent": UA, Cookie: sess.cookie },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`envapp PermitResults HTTP ${res.status} for ${permitId}`);
  return parseInspections(await res.text());
}

/* ---------------- DLLC route probe ----------------
 * The enumeration surface is checked, never forced: a 302 to the
 * Drupal homepage (or a body with no license data) means the route
 * is still retired. Verdict is logged either way. */
async function probeDllc(): Promise<{ routeAlive: boolean; detail: string }> {
  try {
    const res = await fetch("https://azliquor.gov/query/search_series_city.cfm", {
      headers: { "User-Agent": UA },
      redirect: "manual",
      signal: AbortSignal.timeout(15000),
    });
    const loc = res.headers.get("location") ?? "";
    if (res.status >= 300 && res.status < 400) {
      return {
        routeAlive: false,
        detail: `legacy enumeration app azliquor.gov/query/search_series_city.cfm returns HTTP ${res.status} -> ${loc} (retired in the Drupal migration; verified 2026-10-15)`,
      };
    }
    if (res.status === 200) {
      const body = await res.text();
      if (/license/i.test(body) && /(series|licensee)/i.test(body)) {
        return { routeAlive: true, detail: "legacy query app answered 200 with license content — enumeration route appears restored; parser not yet built" };
      }
      return { routeAlive: false, detail: "query app returned 200 without license-list content (likely the Drupal site)" };
    }
    return { routeAlive: false, detail: `query app returned HTTP ${res.status}` };
  } catch (err) {
    return { routeAlive: false, detail: `query app probe failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}

/* ---------------- operator-group resolution (v1) ---------------- */

export function normalizeGroupName(name: string): string {
  return name
    .toUpperCase()
    .replace(/['’]/g, "'")
    .replace(/\s+#\S+.*$/, "") // store numbers: "NAME #1234 ..."
    .replace(/[^A-Z0-9' ]/g, " ")
    .replace(/\b(LLC|L L C|INC|CORP|CORPORATION|CO|COMPANY|LTD|LP|LLP)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function rebuildGroups(): Promise<number> {
  const db = sql();
  interface Loc {
    id: string;
    city: string;
    display: string;
  }
  const groups = new Map<string, { name: string; permits: Loc[]; licenses: Loc[] }>();
  const add = (kind: "permits" | "licenses", rawName: string, id: string, city: string) => {
    const key = normalizeGroupName(rawName);
    if (!key) return;
    let g = groups.get(key);
    if (!g) {
      g = { name: rawName.trim(), permits: [], licenses: [] };
      groups.set(key, g);
    }
    g[kind].push({ id, city, display: rawName.trim() });
  };
  const permitRows = await db`SELECT permit_id, business_name, city FROM mi_hospitality_permits`;
  for (const r of permitRows) add("permits", String(r.business_name), String(r.permit_id), String(r.city));
  const licenseRows = await db`SELECT license_number, licensee, city FROM mi_hospitality_licenses`;
  for (const r of licenseRows) add("licenses", String(r.licensee), String(r.license_number), String(r.city));

  const entries: { key: string; g: { name: string; permits: Loc[]; licenses: Loc[] } }[] = [];
  groups.forEach((g, key) => entries.push({ key, g }));
  const keys: string[] = [];
  const CHUNK = 200;
  for (let i = 0; i < entries.length; i += CHUNK) {
    const chunk = entries.slice(i, i + CHUNK);
    const values: string[] = [];
    const params: unknown[] = [];
    chunk.forEach(({ key, g }, j) => {
      keys.push(key);
      const cities = Array.from(new Set([...g.permits, ...g.licenses].map((l: Loc) => l.city).filter(Boolean))).sort();
      const b = j * 6;
      values.push(`($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}::jsonb, $${b + 5}::jsonb, $${b + 6}::jsonb)`);
      params.push(
        key,
        g.name,
        g.permits.length + g.licenses.length,
        JSON.stringify(g.permits.map((l: Loc) => l.id)),
        JSON.stringify(g.licenses.map((l: Loc) => l.id)),
        JSON.stringify(cities)
      );
    });
    await db.query(
      `INSERT INTO mi_hospitality_groups (group_key, name, location_count, permit_ids, license_numbers, cities)
       VALUES ${values.join(", ")}
       ON CONFLICT (group_key) DO UPDATE SET
         name = EXCLUDED.name, location_count = EXCLUDED.location_count,
         permit_ids = EXCLUDED.permit_ids, license_numbers = EXCLUDED.license_numbers,
         cities = EXCLUDED.cities, updated_at = now()`,
      params
    );
  }
  if (keys.length) {
    await db.query(`DELETE FROM mi_hospitality_groups WHERE group_key <> ALL($1)`, [keys]);
  } else {
    await db`DELETE FROM mi_hospitality_groups`;
  }
  return groups.size;
}

/* ---------------- main ingest ---------------- */

export async function ingestHospitality(): Promise<number> {
  await ensureHospitalityTables();
  const db = sql();
  const t0 = Date.now();
  const zipDeadline = t0 + 24000; // leave room for inspections + groups inside the 60s route budget
  const inspDeadline = t0 + 44000;
  let touched = 0;

  /* --- DLLC: probe + verdict (ingests 0 while the route is dead) --- */
  const dllc = await probeDllc();
  await logSync(
    "dllc-xcheck",
    dllc.routeAlive ? "ok" : "error",
    0,
    dllc.routeAlive
      ? `DLLC enumeration route ALIVE again — ${dllc.detail}. No licenses ingested yet (parser pending).`
      : `DLLC: 0 licenses ingested — no working automated route. ${dllc.detail}. Drupal License Lookup page ships an empty body; licensee functions sit behind the dllc.azliquor.gov login; elicense.az.gov unreachable. ACC bulk extraction skipped per Ethan (Oct 15).`
  );

  /* --- Maricopa permits: walk the ZIP cursor --- */
  const sess = await envSession();
  let cursor = Number.parseInt((await getState("maricopa_zip_cursor")) ?? "0", 10) || 0;
  if (cursor < 0 || cursor >= MARICOPA_ZIPS.length) cursor = 0;
  const pulled: { zip: string; rows: number; ids: string[] }[] = [];
  let permitsUpserted = 0;
  while (Date.now() < zipDeadline && pulled.length < MARICOPA_ZIPS.length) {
    const zip = MARICOPA_ZIPS[cursor];
    let rows: EnvPermitRow[] = [];
    try {
      const raw = await envSearchByZip(sess, zip);
      // The county result set can list a permit twice (observed in ZIP
      // 85008: FD2405645 / FD2405647) — dedupe on permit_id so counts
      // reconcile against unique permits, which is what the DB holds.
      const byId = new Map<string, EnvPermitRow>();
      for (const r of raw) if (!byId.has(r.permitId)) byId.set(r.permitId, r);
      rows = Array.from(byId.values());
    } catch {
      pulled.push({ zip, rows: -1, ids: [] });
      cursor = (cursor + 1) % MARICOPA_ZIPS.length;
      continue;
    }
    pulled.push({ zip, rows: rows.length, ids: rows.map((r) => r.permitId) });
    for (const r of rows) {
      const a = parseAddress(r.businessAddressConcat ?? "", zip);
      await db`
        INSERT INTO mi_hospitality_permits (permit_id, permit_type, business_name, address, city, zip, cutting_edge)
        VALUES (${r.permitId}, ${r.permitType ?? ""}, ${r.businessName ?? ""}, ${a.address}, ${a.city}, ${a.zip || zip}, ${!!r.isCuttingEdgeParticipant})
        ON CONFLICT (permit_id) DO UPDATE SET
          permit_type = EXCLUDED.permit_type, business_name = EXCLUDED.business_name,
          address = EXCLUDED.address, city = EXCLUDED.city, zip = EXCLUDED.zip,
          cutting_edge = EXCLUDED.cutting_edge, last_seen = now(), fetched_at = now()`;
      permitsUpserted++;
    }
    cursor = (cursor + 1) % MARICOPA_ZIPS.length;
    if (cursor === 0) {
      const cycles = Number.parseInt((await getState("maricopa_cycles")) ?? "0", 10) || 0;
      await setState("maricopa_cycles", String(cycles + 1));
    }
  }
  await setState("maricopa_zip_cursor", String(cursor));
  touched += permitsUpserted;

  /* --- Maricopa xcheck: independent recount of the first ZIP pulled.
   * All three legs count UNIQUE permit ids: the county can list a
   * permit twice in one result set, and the DB leg counts how many of
   * the pulled ids are actually stored (not a by-ZIP tally, since a
   * permit's address ZIP can differ from the enumeration ZIP). --- */
  const firstOk = pulled.find((p) => p.rows >= 0);
  if (firstOk) {
    try {
      const recountRaw = await envSearchByZip(sess, firstOk.zip);
      const recountIds = new Set(recountRaw.map((r) => r.permitId));
      const inDb = await db.query(
        `SELECT COUNT(*)::int AS n FROM mi_hospitality_permits WHERE permit_id = ANY($1)`,
        [firstOk.ids]
      );
      const dbN = Number(inDb[0].n);
      const agree = recountIds.size === firstOk.rows && dbN === firstOk.rows;
      await logSync(
        "maricopa-permits-xcheck",
        agree ? "ok" : "error",
        recountIds.size,
        `ZIP ${firstOk.zip}: ${firstOk.rows} unique permits pulled, independent recount ${recountIds.size} unique, ${dbN} of the pulled ids stored` +
          (agree ? " — counts reconcile" : " — MISMATCH, investigate")
      );
    } catch (err) {
      await logSync("maricopa-permits-xcheck", "error", 0, `recount for ZIP ${firstOk.zip} could not run: ${err instanceof Error ? err.message : String(err)}`);
    }
  } else {
    await logSync("maricopa-permits-xcheck", "error", 0, "no ZIP completed this run — cross-check could not run");
  }

  /* --- Inspections backfill (never-fetched / stalest first) --- */
  let inspUpdated = 0;
  const stale = await db`
    SELECT permit_id FROM mi_hospitality_permits
    WHERE inspections_fetched_at IS NULL OR inspections_fetched_at < now() - interval '30 days'
    ORDER BY inspections_fetched_at NULLS FIRST, permit_id
    LIMIT 120`;
  for (const r of stale) {
    if (Date.now() >= inspDeadline) break;
    const pid = String(r.permit_id);
    try {
      const insp = await fetchInspections(sess, pid);
      const latest = insp.map((i) => i.date).filter(Boolean).sort().pop() ?? null;
      await db`
        UPDATE mi_hospitality_permits SET
          inspections = ${JSON.stringify(insp)}::jsonb,
          inspections_count = ${insp.length},
          latest_inspection = ${latest},
          inspections_fetched_at = now(), fetched_at = now()
        WHERE permit_id = ${pid}`;
      inspUpdated++;
    } catch {
      // leave inspections_fetched_at untouched so it retries next run
    }
  }
  touched += inspUpdated;

  /* --- Operator groups v1 --- */
  const groupCount = await rebuildGroups();

  const zipsDone = pulled.filter((p) => p.rows >= 0).length;
  await logSync(
    "hospitality",
    "ok",
    touched,
    `Maricopa: ${permitsUpserted} permits upserted across ${zipsDone} ZIPs (cursor now ${cursor}/${MARICOPA_ZIPS.length}), ${inspUpdated} inspection histories backfilled, ${groupCount} operator groups resolved. DLLC: 0 (route retired — see dllc-xcheck).`
  );
  return touched;
}

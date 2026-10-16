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
import { logSync, importCompanies, countFits, type CompanyInput } from "./market-db";

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

/* ---------------- §2: fit settings (portal-editable) ----------------
 * Thresholds live in mi_hospitality_state (same kv the ingest cursor
 * uses) so the Settings UI can edit them without a deploy. Defaults
 * per Ethan's Oct 15, 2026 spec: 3+ active locations, or a
 * liquor-licensed hotel/venue at >= $3M modeled revenue. */

export interface HospitalityFitSettings {
  minLocations: number;
  hotelMinRevenue: number;
}

export async function getHospitalityFitSettings(): Promise<HospitalityFitSettings> {
  await ensureHospitalityTables();
  const minL = Number.parseInt((await getState("fit_min_locations")) ?? "", 10);
  const hotel = Number.parseInt((await getState("fit_hotel_min_revenue")) ?? "", 10);
  return {
    minLocations: Number.isFinite(minL) && minL >= 1 ? minL : 3,
    hotelMinRevenue: Number.isFinite(hotel) && hotel > 0 ? hotel : 3_000_000,
  };
}

export async function setHospitalityFitSettings(s: HospitalityFitSettings): Promise<HospitalityFitSettings> {
  await ensureHospitalityTables();
  await setState("fit_min_locations", String(Math.round(s.minLocations)));
  await setState("fit_hotel_min_revenue", String(Math.round(s.hotelMinRevenue)));
  return getHospitalityFitSettings();
}

/* ---------------- §2: concept + revenue model ----------------
 * Revenue is MODELED, never reported: locations × a per-location
 * annual range for the group's concept. Ranges are deliberately wide
 * (Arizona lower-middle-market restaurant economics) and every
 * surface that shows the number labels it low confidence with the
 * inputs. revPerEmp feeds the CBP size-band cross-check. */

interface Concept {
  key: string;
  label: string;
  subsector: string;
  naics: string;
  revLow: number;
  revHigh: number;
  revPerEmp: number;
}

const CONCEPTS: Record<string, Concept> = {
  fullService: { key: "fullService", label: "Full-service restaurant", subsector: "Restaurants & Bars", naics: "7225", revLow: 800_000, revHigh: 2_400_000, revPerEmp: 70_000 },
  limitedService: { key: "limitedService", label: "Limited-service / QSR", subsector: "Restaurants & Bars", naics: "7225", revLow: 700_000, revHigh: 1_900_000, revPerEmp: 85_000 },
  bar: { key: "bar", label: "Bar / drinking place", subsector: "Restaurants & Bars", naics: "7224", revLow: 350_000, revHigh: 1_100_000, revPerEmp: 90_000 },
  coffeeBakery: { key: "coffeeBakery", label: "Coffee shop / bakery", subsector: "Restaurants & Bars", naics: "7225", revLow: 300_000, revHigh: 900_000, revPerEmp: 65_000 },
  grocery: { key: "grocery", label: "Grocery / food market", subsector: "Restaurants & Bars", naics: "7225", revLow: 1_200_000, revHigh: 4_500_000, revPerEmp: 110_000 },
  catering: { key: "catering", label: "Catering / food-service contractor", subsector: "Restaurants & Bars", naics: "7225", revLow: 250_000, revHigh: 900_000, revPerEmp: 70_000 },
  mobile: { key: "mobile", label: "Mobile food / food truck", subsector: "Restaurants & Bars", naics: "7225", revLow: 120_000, revHigh: 400_000, revPerEmp: 60_000 },
  hotel: { key: "hotel", label: "Hotel / lodging", subsector: "Hotels & Lodging", naics: "7211", revLow: 1_500_000, revHigh: 6_000_000, revPerEmp: 95_000 },
  leisure: { key: "leisure", label: "Fitness / recreation", subsector: "Hospitality & Leisure", naics: "7139", revLow: 500_000, revHigh: 2_500_000, revPerEmp: 80_000 },
  other: { key: "other", label: "Food establishment", subsector: "Restaurants & Bars", naics: "7225", revLow: 500_000, revHigh: 1_600_000, revPerEmp: 75_000 },
};

function deriveConcept(permitType: string, businessName: string): string {
  const t = `${permitType} ${businessName}`.toUpperCase();
  if (/\b(HOTEL|MOTEL|LODGE|RESORT)\b/.test(t) || /\bINN\b/.test(t)) return "hotel";
  if (/\b(FITNESS|GYM|YOGA|PILATES|CROSSFIT|ATHLETIC CLUB|RECREATION CENTER)\b/.test(t)) return "leisure";
  if (/CATERING/.test(permitType.toUpperCase()) || /\bCATERING\b/.test(t)) return "catering";
  if (/\b(MOBILE|FOOD TRUCK|FOOD CART|CONCESSION)\b/.test(t)) return "mobile";
  if (/\b(MARKET|GROCERY|DELI|MEAT|FOOD STORE)\b/.test(t)) return "grocery";
  if (/\b(COFFEE|ESPRESSO|BAKERY|DONUT|DOUGHNUT|BAGEL)\b/.test(t)) return "coffeeBakery";
  if (/\b(BARBECUE|BBQ|SMOKEHOUSE)\b/.test(t)) return "fullService";
  if (/\b(BAR|TAVERN|LOUNGE|SALOON|CANTINA|BREWING|BREWPUB|WINERY|TAPROOM)\b/.test(t)) return "bar";
  if (/\b(BURGER|TACO|PIZZA|SANDWICH|SUBS|WINGS|FRIED CHICKEN|DRIVE THRU|DRIVE-THRU)\b/.test(t)) return "limitedService";
  return "fullService";
}

/* ---------------- §2: ownership detection ----------------
 * Conservative by design (Ethan's spec): only a maintained list of
 * known NATIONAL brands / franchise systems and institutional
 * foodservice operators stamps an exclusion. Everything else stays
 * "unknown" and is NOT excluded — local multi-unit groups are the
 * target profile, not an exclusion. Subsidiary status is not
 * name-detectable; it stays unstamped until ACC/officer data exists. */

const NATIONAL_BRANDS = [
  "MCDONALD", "BURGER KING", "WENDY", "TACO BELL", "KFC", "PIZZA HUT", "DOMINO", "SUBWAY",
  "STARBUCKS", "DUNKIN", "CHIPOTLE", "DAIRY QUEEN", "SONIC DRIVE", "ARBY", "JACK IN THE BOX",
  "CARLS JR", "HARDEE", "LITTLE CAESARS", "PAPA JOHN", "JIMMY JOHN", "JERSEY MIKE",
  "FIREHOUSE SUBS", "FIVE GUYS", "CHICK FIL A", "RAISING CANE", "IN N OUT", "WHATABURGER",
  "DUTCH BROS", "DENNY", "IHOP", "APPLEBEE", "CHILI", "OLIVE GARDEN", "BUFFALO WILD WINGS",
  "HOOTERS", "RED ROBIN", "TEXAS ROADHOUSE", "OUTBACK STEAKHOUSE", "LONGHORN STEAKHOUSE",
  "CHEESECAKE FACTORY", "PF CHANG", "P F CHANG", "PANERA", "WINGSTOP", "POPEYES",
  "CHURCHS CHICKEN", "DEL TACO", "EL POLLO LOCO", "WIENERSCHNITZEL", "BASKIN ROBBINS",
  "COLD STONE", "SMOOTHIE KING", "JAMBA", "TROPICAL SMOOTHIE", "QDOBA", "BLAZE PIZZA",
  "MOD PIZZA", "CAVA", "SHAKE SHACK", "CULVER", "FREDDY", "PORTILLO", "EINSTEIN BROS",
  "KRISPY KREME", "MARRIOTT", "HILTON", "HYATT", "HOLIDAY INN", "HAMPTON INN", "LA QUINTA",
  "MOTEL 6", "SUPER 8", "BEST WESTERN", "COMFORT INN", "DAYS INN", "WYNDHAM", "CHOICE HOTELS",
  "PLANET FITNESS", "LA FITNESS", "ORANGETHEORY", "ANYTIME FITNESS", "GOLDS GYM",
  "24 HOUR FITNESS", "CRUNCH FITNESS", "CLUB PILATES", "MASSAGE ENVY", "LIFE TIME FITNESS",
];

const INSTITUTIONAL_OPERATORS = [
  "ARAMARK", "SODEXO", "CHARTWELLS", "COMPASS GROUP", "LEVY RESTAURANTS", "DELAWARE NORTH",
  "LEGENDS HOSPITALITY", "BON APPETIT MANAGEMENT", "METZ CULINARY", "CREATIVE DINING",
];

function detectOwnership(groupKey: string): { ownership: string; basis: string } {
  for (const b of INSTITUTIONAL_OPERATORS) {
    if (groupKey.includes(b)) {
      return { ownership: "institutional", basis: `Operator name matches institutional foodservice operator "${b}" (contract dining — not an independent acquisition target)` };
    }
  }
  for (const b of NATIONAL_BRANDS) {
    if (groupKey.includes(b)) {
      return { ownership: "franchise", basis: `Operator name matches national brand / franchise system "${b}" — locations are chain/franchise units` };
    }
  }
  return { ownership: "unknown", basis: "No national brand or institutional operator match — ownership not verified" };
}

/* ---------------- §2: fit sync (groups -> mi_companies) ---------------- */

const moneyFmt = (v: number) =>
  v >= 1e9 ? `$${(v / 1e9).toFixed(2)}B` : v >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : `$${Math.round(v / 1e3)}K`;

function asStringArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x));
  if (typeof v === "string" && v.trim().startsWith("[")) {
    try {
      const p = JSON.parse(v) as unknown;
      return Array.isArray(p) ? p.map((x) => String(x)) : [];
    } catch {
      return [];
    }
  }
  return [];
}

export interface HospitalityFitSyncResult {
  evaluated: number;
  mirrored: number;
  fits: number;
  fitsBySubsector: Record<string, number>;
  excluded: Record<string, number>;
}

async function syncHospitalityCompanies(): Promise<HospitalityFitSyncResult> {
  const db = sql();
  const settings = await getHospitalityFitSettings();

  const groupRows = await db`SELECT group_key, name, location_count, permit_ids, license_numbers, cities FROM mi_hospitality_groups`;
  const permitRows = await db`SELECT permit_id, permit_type, business_name, city, fetched_at FROM mi_hospitality_permits`;
  const permitById = new Map<string, { type: string; name: string; city: string; fetchedAt: string }>();
  for (const p of permitRows) {
    permitById.set(String(p.permit_id), {
      type: String(p.permit_type), name: String(p.business_name),
      city: String(p.city), fetchedAt: String(p.fetched_at ?? ""),
    });
  }
  const licenseRows = await db`SELECT license_number, series, licensee FROM mi_hospitality_licenses`;
  const seriesByLicense = new Map<string, string>();
  const licenseeByNumber = new Map<string, string>();
  for (const l of licenseRows) {
    seriesByLicense.set(String(l.license_number), String(l.series));
    licenseeByNumber.set(String(l.license_number), String(l.licensee));
  }

  /* Cross-check #1 — CBP size band for NAICS 72 (Accommodation & Food
   * Services): average employees per AZ establishment. The concept
   * model's implied employees per location is compared against it. */
  let cbpAvgEmp: number | null = null;
  try {
    const ind = await db`SELECT series_id, value FROM mi_indicators
      WHERE series_id IN ('CBP_AZ_SEC_72_ESTAB', 'CBP_AZ_SEC_72_EMP')
      ORDER BY obs_date DESC`;
    let estab: number | null = null;
    let emp: number | null = null;
    for (const r of ind) {
      const v = r.value === null || r.value === undefined ? null : Number(r.value);
      if (String(r.series_id).endsWith("_ESTAB") && estab === null) estab = v;
      if (String(r.series_id).endsWith("_EMP") && emp === null) emp = v;
    }
    if (estab && emp) cbpAvgEmp = emp / estab;
  } catch {
    cbpAvgEmp = null;
  }

  /* Cross-check #2 — SBA loan stamps (PPP sbaJobs / 7(a)) already on
   * mi_companies rows, matched by normalized operator name. */
  const sbaByName = new Map<string, { jobs: number; loanTotal: number; loans: number }>();
  try {
    const sbaRows = await db`SELECT name, details FROM mi_companies
      WHERE details LIKE '%"sba7aLoanCount"%' OR details LIKE '%"sbaJobs"%'`;
    for (const r of sbaRows) {
      let d: Record<string, unknown> = {};
      try {
        d = JSON.parse(String(r.details)) as Record<string, unknown>;
      } catch {
        continue;
      }
      const key = normalizeGroupName(String(r.name));
      if (!key) continue;
      const agg = sbaByName.get(key) ?? { jobs: 0, loanTotal: 0, loans: 0 };
      if (typeof d.sbaJobs === "number") agg.jobs += d.sbaJobs;
      if (typeof d.sba7aRecentJobs === "number") agg.jobs += d.sba7aRecentJobs;
      if (typeof d.sbaLoanTotal === "number") agg.loanTotal += d.sbaLoanTotal;
      if (typeof d.sba7aLoanTotal === "number") agg.loanTotal += d.sba7aLoanTotal;
      if (typeof d.sba7aLoanCount === "number") agg.loans += d.sba7aLoanCount;
      sbaByName.set(key, agg);
    }
  } catch {
    // Stamps unreadable — the per-group note simply omits the SBA leg.
  }

  // Normalized-name tallies over the raw tables, computed once — the
  // spot reconciliation below reads them instead of re-scanning.
  const rawNameCounts = new Map<string, number>();
  permitById.forEach((p) => {
    const k = normalizeGroupName(p.name);
    if (k) rawNameCounts.set(k, (rawNameCounts.get(k) ?? 0) + 1);
  });
  licenseeByNumber.forEach((licensee) => {
    const k = normalizeGroupName(licensee);
    if (k) rawNameCounts.set(k, (rawNameCounts.get(k) ?? 0) + 1);
  });

  const inputs: CompanyInput[] = [];
  const excluded: Record<string, number> = { franchise: 0, chain: 0, institutional: 0, subsidiary: 0 };
  const fitsBySubsector: Record<string, number> = {};
  let predictedFits = 0;
  // Spot-reconciliation target: the largest group's raw recount.
  let spot: { name: string; stored: number; recounted: number } | null = null;

  for (const g of groupRows) {
    const groupKey = String(g.group_key);
    const permitIds = asStringArray(g.permit_ids);
    const licenseNums = asStringArray(g.license_numbers);
    const groupCities = asStringArray(g.cities);
    const locs = Number(g.location_count) || permitIds.length + licenseNums.length;

    if (spot === null || locs > spot.stored) {
      spot = { name: String(g.name), stored: locs, recounted: rawNameCounts.get(groupKey) ?? 0 };
    }

    // Concept: majority vote across member permits; a DLLC series-11
    // (hotel/motel) license or a hotel name cue wins outright.
    const votes = new Map<string, number>();
    const cityCounts = new Map<string, number>();
    let maxFetched = "";
    for (const pid of permitIds) {
      const p = permitById.get(pid);
      if (!p) continue;
      const c = deriveConcept(p.type, p.name);
      votes.set(c, (votes.get(c) ?? 0) + 1);
      if (p.city) cityCounts.set(p.city, (cityCounts.get(p.city) ?? 0) + 1);
      if (p.fetchedAt > maxFetched) maxFetched = p.fetchedAt;
    }
    let bestVotes = -1;
    let conceptKey = "";
    votes.forEach((n, k) => {
      if (n > bestVotes) {
        bestVotes = n;
        conceptKey = k;
      }
    });
    if (!conceptKey) conceptKey = deriveConcept("", String(g.name));
    const hasHotelLicense = licenseNums.some((n) => seriesByLicense.get(n) === "11");
    if (hasHotelLicense || deriveConcept("", String(g.name)) === "hotel") conceptKey = "hotel";
    const concept = CONCEPTS[conceptKey] ?? CONCEPTS.other;

    const perLocMid = (concept.revLow + concept.revHigh) / 2;
    const revLow = Math.round(locs * concept.revLow);
    const revHigh = Math.round(locs * concept.revHigh);
    const revMid = Math.round(locs * perLocMid);

    const own = detectOwnership(groupKey);
    if (excluded[own.ownership] !== undefined) excluded[own.ownership]++;

    // CBP size-band cross-check (modeled vs the sector's actual
    // average establishment size — a sanity band, not a measurement).
    const impliedEmpPerLoc = perLocMid / concept.revPerEmp;
    let crossCheck: string;
    if (cbpAvgEmp !== null) {
      const ratio = impliedEmpPerLoc / cbpAvgEmp;
      crossCheck =
        ratio >= 0.35 && ratio <= 2.8
          ? `CBP NAICS 72 size band: AZ accommodation & food establishments average ~${cbpAvgEmp.toFixed(0)} employees; this concept implies ~${impliedEmpPerLoc.toFixed(0)} employees per location — in line with the sector band`
          : `CBP NAICS 72 size band: sector average is ~${cbpAvgEmp.toFixed(0)} employees per establishment; this concept implies ~${impliedEmpPerLoc.toFixed(0)} per location — ${ratio > 2.8 ? "larger" : "smaller"} than the typical establishment, treat the estimate with extra caution`;
    } else {
      crossCheck = "CBP NAICS 72 series unavailable — estimate is locations × per-location range only (index-only, no independent size-band check)";
    }
    const sba = sbaByName.get(groupKey);
    const sbaNote = sba
      ? `SBA loan records matched by operator name: ${sba.loans > 0 ? `${sba.loans} 7(a) loan(s), ` : ""}${sba.loanTotal > 0 ? `${moneyFmt(sba.loanTotal)} total borrowing` : "PPP borrowing on file"}${sba.jobs > 0 ? `, ${sba.jobs} jobs reported` : ""} — corroborates an established, banked operator`
      : "";

    const liquorVenue =
      licenseNums.length > 0 &&
      (conceptKey === "hotel" || /\b(HOTEL|MOTEL|RESORT|ARENA|STADIUM|THEATRE|THEATER|CASINO|RACETRACK)\b/.test(groupKey));

    // Local fit prediction (mirrors computeFit's hospitality branch +
    // the generic whale caps) purely for the xcheck tallies; the
    // stored verdict comes from computeFit at import.
    const isFit =
      excluded[own.ownership] === undefined &&
      revMid <= 150_000_000 &&
      (locs >= settings.minLocations || (liquorVenue && revMid >= settings.hotelMinRevenue));
    if (isFit) {
      predictedFits++;
      fitsBySubsector[concept.subsector] = (fitsBySubsector[concept.subsector] ?? 0) + 1;
    }

    let primaryCity = groupCities[0] ?? "";
    let bestCityN = -1;
    cityCounts.forEach((n, c) => {
      if (n > bestCityN) {
        bestCityN = n;
        primaryCity = c;
      }
    });

    const details: Record<string, unknown> = {
      locationCount: locs,
      permitCount: permitIds.length,
      ...(licenseNums.length ? { licenseCount: licenseNums.length } : {}),
      cities: groupCities,
      concept: concept.label,
      ownership: own.ownership,
      ownershipBasis: own.basis,
      revenueEstimate: revMid,
      estRevenueLow: revLow,
      estRevenueHigh: revHigh,
      estRevenueInputs: `${locs} location${locs === 1 ? "" : "s"} × ${moneyFmt(concept.revLow)}–${moneyFmt(concept.revHigh)} per-location range (${concept.label.toLowerCase()}, AZ) — revenue is modeled from permit counts, not reported`,
      estConfidence: "low",
      crossCheck,
      ...(sbaNote ? { sbaCrossCheck: sbaNote } : {}),
      ...(licenseNums.length ? { liquorLicensedVenue: liquorVenue } : {}),
      dataAsOf: maxFetched ? maxFetched.slice(0, 10) : new Date().toISOString().slice(0, 10),
      note: "Operator group resolved from public permit/license records, grouped by operator name. Locations are permitted establishments seen so far (Maricopa coverage is still filling in). Revenue is a modeled estimate — not reported financials.",
    };

    inputs.push({
      dedupKey: groupKey,
      name: String(g.name),
      sector: "Hospitality",
      subsector: concept.subsector,
      naics: concept.naics,
      city: primaryCity,
      state: "AZ",
      employees: null,
      signalValue: revMid,
      signalLabel: "Est. revenue",
      source: "Hospitality Spine",
      sourceUrl: "https://envapp.maricopa.gov/EnvironmentalHealth/FoodInspections",
      details: JSON.stringify(details),
    });
  }

  const { total } = await importCompanies("Hospitality Spine", inputs, true);
  const fits = await countFits("Hospitality");

  const spotOk = spot !== null && spot.stored === spot.recounted;
  await logSync(
    "hospitality-fit-xcheck",
    spotOk ? "ok" : "error",
    fits,
    `Hospitality fit: ${groupRows.length} operator groups evaluated → ${fits} fits (${Object.entries(fitsBySubsector).map(([k, v]) => `${k} ${v}`).join(" · ") || "none"}) · local prediction ${predictedFits} (stored count is ground truth) · excluded by ownership: ${Object.entries(excluded).map(([k, v]) => `${k} ${v}`).join(", ")} · thresholds: ≥${settings.minLocations} locations or liquor-licensed hotel/venue ≥${moneyFmt(settings.hotelMinRevenue)} (portal settings) · DLLC licenses in table: ${licenseRows.length} (hotel/venue arm ${licenseRows.length ? "active" : "inactive — no license data yet"}) · spot reconciliation: ${spot ? `${spot.name} stored ${spot.stored} locations vs ${spot.recounted} recounted from raw permits/licenses — ${spotOk ? "reconcile" : "MISMATCH"}` : "no groups to check"}`
  );

  return { evaluated: groupRows.length, mirrored: total, fits, fitsBySubsector, excluded };
}

/* ---------------- §2: meta for UI surfaces ---------------- */

export interface HospitalityMeta {
  settings: HospitalityFitSettings;
  permits: number;
  licenses: number;
  groups: number;
  fits: number;
  lastIngestAt: string | null;
  dllcStatus: string | null;
  sources: { name: string; status: string }[];
}

export async function getHospitalityMeta(): Promise<HospitalityMeta> {
  await ensureHospitalityTables();
  const db = sql();
  const settings = await getHospitalityFitSettings();
  const cnt = async (table: string): Promise<number> => {
    const rows = await db.query(`SELECT count(*)::int AS n FROM ${table}`);
    return Number((rows as unknown as { n: number }[])[0]?.n ?? 0);
  };
  const [permits, licenses, groups, fits] = await Promise.all([
    cnt("mi_hospitality_permits"),
    cnt("mi_hospitality_licenses"),
    cnt("mi_hospitality_groups"),
    countFits("Hospitality"),
  ]);
  let lastIngestAt: string | null = null;
  let dllcStatus: string | null = null;
  try {
    const latest = await db`SELECT job, ran_at, status FROM mi_sync_log WHERE job IN ('hospitality', 'dllc-xcheck') ORDER BY ran_at DESC`;
    for (const r of latest) {
      if (String(r.job) === "hospitality" && lastIngestAt === null) lastIngestAt = String(r.ran_at);
      if (String(r.job) === "dllc-xcheck" && dllcStatus === null) dllcStatus = String(r.status);
    }
  } catch {
    // sync log unreadable — meta still returns counts + settings
  }
  return {
    settings,
    permits,
    licenses,
    groups,
    fits,
    lastIngestAt,
    dllcStatus,
    sources: [
      {
        name: "Maricopa County ESD — food establishment permits & inspections",
        status: permits > 0 ? "connected" : "connected (no rows yet)",
      },
      {
        name: "AZ DLLC — liquor licenses",
        status: licenses > 0 ? "connected" : "not connected — legacy search retired, no automated route (see dllc-xcheck)",
      },
      {
        name: "AZ Corporation Commission — entity records",
        status: "deferred — bulk extraction skipped per Ethan (Oct 15, 2026); public search is robot-check gated",
      },
    ],
  };
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

  /* --- §2 fit sync: mirror groups into mi_companies as Hospitality
   * rows with fit judged by computeFit (settings thresholds, ownership
   * exclusions, modeled revenue). Budget-guarded: if the permit walk
   * ate the route budget, the sync defers to the next run and the
   * xcheck says so — never silent. --- */
  let fitNote = "fit sync not run";
  if (Date.now() < t0 + 50000) {
    try {
      const fit = await syncHospitalityCompanies();
      touched += fit.mirrored;
      fitNote = `fit sync: ${fit.evaluated} groups evaluated, ${fit.fits} fits`;
    } catch (err) {
      fitNote = `fit sync FAILED: ${err instanceof Error ? err.message : String(err)}`;
      await logSync("hospitality-fit-xcheck", "error", 0, `Hospitality fit sync could not run: ${fitNote}`);
    }
  } else {
    await logSync(
      "hospitality-fit-xcheck",
      "skipped",
      0,
      "Hospitality fit sync deferred — ingest route budget reached after permits/groups; it runs on the next hospitality pass."
    );
    fitNote = "fit sync deferred (route budget)";
  }

  const zipsDone = pulled.filter((p) => p.rows >= 0).length;
  await logSync(
    "hospitality",
    "ok",
    touched,
    `Maricopa: ${permitsUpserted} permits upserted across ${zipsDone} ZIPs (cursor now ${cursor}/${MARICOPA_ZIPS.length}), ${inspUpdated} inspection histories backfilled, ${groupCount} operator groups resolved, ${fitNote}. DLLC: 0 (route retired — see dllc-xcheck).`
  );
  return touched;
}

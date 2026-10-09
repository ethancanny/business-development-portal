import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

/**
 * Investors (Ethan, Oct 9, 2026): investor contacts for the Directory's
 * Investors tab, seeded from Ethan's "Investment Database" Google Sheet —
 * only the investors marked Contacted = Yes became contacts. Stored in Neon
 * like the calendar mirror; server-side only.
 */

export interface Investor {
  id: string;
  name: string;
  firm: string;
  title: string;
  email: string;
  phone: string;
  website: string;
  investmentType: string;
  industry: string;
  ebitdaSize: string;
  checkSize: string;
  status: string;
  notes: string;
  source: string;
  createdAt: string;
  updatedAt: string;
}

type Sql = NeonQueryFunction<false, false>;

let cached: Sql | null = null;
function sql(): Sql {
  if (!cached) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    cached = neon(url);
  }
  return cached;
}

let ensured = false;
async function ensure(): Promise<void> {
  if (ensured) return;
  const q = sql();
  await q`CREATE TABLE IF NOT EXISTS investors (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL DEFAULT '',
    firm TEXT NOT NULL DEFAULT '',
    title TEXT NOT NULL DEFAULT '',
    email TEXT NOT NULL DEFAULT '',
    phone TEXT NOT NULL DEFAULT '',
    website TEXT NOT NULL DEFAULT '',
    investment_type TEXT NOT NULL DEFAULT '',
    industry TEXT NOT NULL DEFAULT '',
    ebitda_size TEXT NOT NULL DEFAULT '',
    check_size TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    source TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`;
  ensured = true;
}

const str = (v: unknown): string => (v === null || v === undefined ? "" : String(v));

function rowToInvestor(r: Record<string, unknown>): Investor {
  return {
    id: str(r.id),
    name: str(r.name),
    firm: str(r.firm),
    title: str(r.title),
    email: str(r.email),
    phone: str(r.phone),
    website: str(r.website),
    investmentType: str(r.investment_type),
    industry: str(r.industry),
    ebitdaSize: str(r.ebitda_size),
    checkSize: str(r.check_size),
    status: str(r.status),
    notes: str(r.notes),
    source: str(r.source),
    createdAt: str(r.created_at),
    updatedAt: str(r.updated_at),
  };
}

export async function getInvestors(): Promise<Investor[]> {
  await ensure();
  const q = sql();
  const rows = await q`SELECT * FROM investors ORDER BY name ASC`;
  return rows.map((r) => rowToInvestor(r as Record<string, unknown>));
}

export async function upsertInvestor(inv: Omit<Investor, "createdAt" | "updatedAt">): Promise<void> {
  await ensure();
  const q = sql();
  await q`INSERT INTO investors (id, name, firm, title, email, phone, website, investment_type, industry, ebitda_size, check_size, status, notes, source, updated_at)
    VALUES (${inv.id}, ${inv.name}, ${inv.firm}, ${inv.title}, ${inv.email}, ${inv.phone}, ${inv.website}, ${inv.investmentType}, ${inv.industry}, ${inv.ebitdaSize}, ${inv.checkSize}, ${inv.status}, ${inv.notes}, ${inv.source}, now())
    ON CONFLICT (id) DO UPDATE SET
      name = EXCLUDED.name,
      firm = EXCLUDED.firm,
      title = EXCLUDED.title,
      email = EXCLUDED.email,
      phone = EXCLUDED.phone,
      website = EXCLUDED.website,
      investment_type = EXCLUDED.investment_type,
      industry = EXCLUDED.industry,
      ebitda_size = EXCLUDED.ebitda_size,
      check_size = EXCLUDED.check_size,
      status = EXCLUDED.status,
      notes = EXCLUDED.notes,
      source = EXCLUDED.source,
      updated_at = now()`;
}

export async function deleteInvestor(id: string): Promise<void> {
  await ensure();
  const q = sql();
  await q`DELETE FROM investors WHERE id = ${id}`;
}

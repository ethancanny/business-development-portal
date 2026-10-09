import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import {
  deleteInvestor,
  getInvestors,
  upsertInvestor,
  type Investor,
} from "@/lib/investors-db";

/**
 * Investor contacts (Directory → Investors tab).
 * GET  — session; list all investors.
 * POST — session; upsert one investor ({investor}) or a batch ({investors}),
 *        or delete with {action: "delete", id}.
 */

type InvestorInput = Omit<Investor, "createdAt" | "updatedAt">;

function clean(body: Record<string, unknown>): InvestorInput {
  const s = (k: string) => String(body[k] ?? "").trim();
  return {
    id: s("id"),
    name: s("name"),
    firm: s("firm"),
    title: s("title"),
    email: s("email"),
    phone: s("phone"),
    website: s("website"),
    investmentType: s("investmentType"),
    industry: s("industry"),
    ebitdaSize: s("ebitdaSize"),
    checkSize: s("checkSize"),
    status: s("status"),
    notes: s("notes"),
    source: s("source"),
  };
}

export async function GET() {
  if (!getSessionUser()) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    return NextResponse.json({ investors: await getInvestors() });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  if (!getSessionUser()) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  try {
    if (body.action === "delete") {
      await deleteInvestor(String(body.id ?? ""));
      return NextResponse.json({ ok: true });
    }
    const batch: InvestorInput[] = Array.isArray(body.investors)
      ? body.investors.map((x: Record<string, unknown>) => clean(x))
      : body.investor
        ? [clean(body.investor as Record<string, unknown>)]
        : [];
    if (batch.length === 0 || batch.some((i) => !i.id || !i.name)) {
      return NextResponse.json(
        { error: "each investor needs at least an id and a name" },
        { status: 400 }
      );
    }
    for (const inv of batch) await upsertInvestor(inv);
    return NextResponse.json({ ok: true, count: batch.length });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import {
  authed,
  companyGate,
  ok,
  readBody,
  serviceError,
  sStr,
  sNum,
} from "@/lib/monitoring/http";
import {
  getBudgets,
  upsertBudgets,
  type BudgetLineInput,
} from "@/lib/monitoring/analytics";

/** GET budgets for the company (?fiscalYear=YYYY optional). */
export async function GET(
  req: NextRequest,
  { params }: { params: { companyId: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  const forbidden = companyGate(gate.ctx, params.companyId);
  if (forbidden) return forbidden;
  try {
    const raw = req.nextUrl.searchParams.get("fiscalYear");
    const year = raw !== null && raw !== "" ? Number(raw) : undefined;
    const versionId =
      req.nextUrl.searchParams.get("versionId") ?? undefined;
    return ok(
      await getBudgets(
        params.companyId,
        year !== undefined && isFinite(year) ? year : undefined,
        versionId
      )
    );
  } catch (err) {
    return serviceError(err, "budgets-get");
  }
}

/** PUT bulk-upsert budget lines for one fiscal year.
 * Body: { fiscalYear, lines: [{ lineKey, amount, notes }], versionId? }
 * — `lines` may also be an object map { lineKey: amount }. Phase 9:
 * writes land in a DRAFT budget version only (explicit versionId or
 * the year's latest draft); none → 400 budget_version_required. */
export async function PUT(
  req: NextRequest,
  { params }: { params: { companyId: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  const forbidden = companyGate(gate.ctx, params.companyId);
  if (forbidden) return forbidden;
  try {
    const body = await readBody(req);
    const fiscalYear = sNum(body.fiscalYear);
    let lines: BudgetLineInput[] = [];
    if (Array.isArray(body.lines)) {
      lines = body.lines.map((raw) => {
        const rec =
          raw && typeof raw === "object"
            ? (raw as Record<string, unknown>)
            : {};
        const amount = sNum(rec.amount);
        return {
          lineKey: sStr(rec.lineKey) ?? sStr(rec.line_key) ?? "",
          amount: amount === undefined ? null : amount,
          notes: sStr(rec.notes),
        };
      });
    } else if (body.lines && typeof body.lines === "object") {
      lines = Object.entries(
        body.lines as Record<string, unknown>
      ).map(([lineKey, amount]) => ({
        lineKey,
        amount: typeof amount === "number" ? amount : null,
      }));
    }
    const result = await upsertBudgets(
      params.companyId,
      typeof fiscalYear === "number" ? fiscalYear : NaN,
      lines,
      gate.user.name || gate.user.email,
      sStr(body.versionId) ?? sStr(body.version_id)
    );
    return ok(result);
  } catch (err) {
    return serviceError(err, "budgets-put");
  }
}

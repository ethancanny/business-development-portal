import { NextRequest, NextResponse } from "next/server";
import {
  authed,
  ok,
  readBody,
  serviceError,
  sStr,
  sNum,
  sDate,
} from "@/lib/monitoring/http";
import {
  getCash,
  upsertCashPosition,
  upsertCashflowWeeks,
  type CashflowWeekInput,
} from "@/lib/monitoring/analytics";

/** GET cash & liquidity: latest position + revolver availability +
 * last 13 cashflow weeks (ascending) + 13-week totals. */
export async function GET(
  _req: NextRequest,
  { params }: { params: { companyId: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    return ok(await getCash(params.companyId));
  } catch (err) {
    return serviceError(err, "cash-get");
  }
}

/** PUT cash data. Body shapes (any one):
 * - { weeks: [{ weekStart, inflows, outflows, endingBalance }] } (≤13)
 * - { position: { asOf, cashBalance, revolverLimit, revolverDrawn,
 *     source, notes } }
 * - flat position fields { asOf, cashBalance, ... } */
export async function PUT(
  req: NextRequest,
  { params }: { params: { companyId: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  const actor = gate.user.name || gate.user.email;
  try {
    const body = await readBody(req);
    if (Array.isArray(body.weeks)) {
      const weeks: CashflowWeekInput[] = body.weeks.map((raw) => {
        const rec =
          raw && typeof raw === "object"
            ? (raw as Record<string, unknown>)
            : {};
        const inflows = sNum(rec.inflows);
        const outflows = sNum(rec.outflows);
        const ending = sNum(rec.endingBalance);
        return {
          weekStart: sStr(rec.weekStart) ?? sStr(rec.week_start) ?? "",
          inflows: inflows === undefined ? null : inflows,
          outflows: outflows === undefined ? null : outflows,
          endingBalance: ending === undefined ? null : ending,
        };
      });
      return ok(
        await upsertCashflowWeeks(params.companyId, weeks, actor)
      );
    }
    const pos =
      body.position && typeof body.position === "object"
        ? (body.position as Record<string, unknown>)
        : body;
    const balance = sNum(pos.cashBalance);
    const limit = sNum(pos.revolverLimit);
    const drawn = sNum(pos.revolverDrawn);
    await upsertCashPosition(
      params.companyId,
      {
        asOf: sDate(pos.asOf) ?? sStr(pos.asOf) ?? "",
        cashBalance: typeof balance === "number" ? balance : NaN,
        revolverLimit: limit === undefined ? null : limit,
        revolverDrawn: drawn === undefined ? null : drawn,
        source: sStr(pos.source),
        notes: sStr(pos.notes),
      },
      actor
    );
    return ok(await getCash(params.companyId));
  } catch (err) {
    return serviceError(err, "cash-put");
  }
}

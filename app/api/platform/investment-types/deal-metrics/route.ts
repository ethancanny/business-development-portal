import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { ensurePlatform } from "@/lib/platform/service";
import { getDealMetrics, setDealMetrics } from "@/lib/bd/service";

/** Per-deal structured metrics (bd.deal_metrics). GET ?dealId= reads
 * one deal's values; PUT { dealId, values } upserts (null/"" clears).
 * Values validate against bd.metric_definitions server-side. */
export async function GET(req: NextRequest) {
  if (!getSessionUser()) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await ensurePlatform();
  const dealId = req.nextUrl.searchParams.get("dealId") ?? "";
  if (!dealId) {
    return NextResponse.json({ error: "dealId is required" }, { status: 400 });
  }
  return NextResponse.json({ dealId, metrics: await getDealMetrics(dealId) });
}

export async function PUT(req: NextRequest) {
  const user = getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await ensurePlatform();
  const body = (await req.json().catch(() => ({}))) as {
    dealId?: string;
    values?: Record<string, unknown>;
  };
  if (!body.dealId || !body.values || typeof body.values !== "object") {
    return NextResponse.json(
      { error: "dealId and values are required" },
      { status: 400 }
    );
  }
  const result = await setDealMetrics(
    body.dealId,
    body.values,
    user.name || user.email
  );
  const metrics = await getDealMetrics(body.dealId);
  return NextResponse.json({ dealId: body.dealId, metrics, ...result });
}

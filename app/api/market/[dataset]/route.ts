import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import {
  getAcquisitions,
  getEntities,
  getFilings,
  getIndicatorSeries,
  getLatestIndicators,
  getListings,
  getMultiples,
  getSyncLog,
  getWarn,
  setAcquisitionStatus,
  updateAcquisitionSummary,
  updateAcquisitionHeadline,
  setFilingStatus,
  setWarnStatus,
  setListingStatus,
  addMultiple,
} from "@/lib/market-db";

const DATASETS = [
  "indicators",
  "latest",
  "listings",
  "multiples",
  "acquisitions",
  "filings",
  "warn",
  "entities",
  "sync-log",
] as const;

export async function GET(
  req: NextRequest,
  { params }: { params: { dataset: string } }
) {
  if (!getSessionUser()) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const dataset = params.dataset;
  if (!(DATASETS as readonly string[]).includes(dataset)) {
    return NextResponse.json({ error: "Unknown dataset" }, { status: 404 });
  }
  const sp = req.nextUrl.searchParams;
  try {
    switch (dataset) {
      case "indicators": {
        const series = (sp.get("series") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
        return NextResponse.json(await getIndicatorSeries(series));
      }
      case "latest":
        return NextResponse.json(await getLatestIndicators());
      case "listings":
        return NextResponse.json(await getListings(sp.get("status") ?? undefined));
      case "multiples":
        return NextResponse.json(await getMultiples());
      case "acquisitions":
        return NextResponse.json(await getAcquisitions(sp.get("status") ?? undefined));
      case "filings":
        return NextResponse.json(
          await getFilings(sp.get("category") ?? undefined, sp.get("status") ?? undefined)
        );
      case "warn":
        return NextResponse.json(await getWarn(Number(sp.get("limit") ?? 100)));
      case "entities":
        return NextResponse.json(await getEntities(sp.get("status") ?? undefined));
      case "sync-log":
        return NextResponse.json(await getSyncLog());
      default:
        return NextResponse.json({ error: "Unknown dataset" }, { status: 404 });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: { dataset: string } }
) {
  const user = getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  try {
    switch (params.dataset) {
      case "listings":
        if (body.id && body.status) {
          await setListingStatus(String(body.id), body.status);
          return NextResponse.json({ ok: true });
        }
        break;
      case "acquisitions":
        if (body.id && typeof body.summary === "string" && body.summary.trim()) {
          await updateAcquisitionSummary(
            String(body.id),
            body.summary.trim().slice(0, 700),
            typeof body.dealValue === "number" ? body.dealValue : undefined,
            typeof body.headline === "string" ? body.headline.trim().slice(0, 300) : undefined
          );
          return NextResponse.json({ ok: true });
        }
        if (body.id && typeof body.headline === "string" && body.headline.trim()) {
          await updateAcquisitionHeadline(String(body.id), body.headline.trim().slice(0, 300));
          return NextResponse.json({ ok: true });
        }
        if (body.id && body.status) {
          await setAcquisitionStatus(String(body.id), body.status);
          return NextResponse.json({ ok: true });
        }
        break;
      case "filings":
        if (body.id && body.status) {
          await setFilingStatus(String(body.id), body.status);
          return NextResponse.json({ ok: true });
        }
        break;
      case "warn":
        if (body.id && body.status) {
          await setWarnStatus(String(body.id), body.status);
          return NextResponse.json({ ok: true });
        }
        break;
      case "multiples":
        if (body.sourceReport && body.period) {
          await addMultiple({
            sourceReport: String(body.sourceReport),
            period: String(body.period),
            industry: String(body.industry ?? ""),
            sizeBand: String(body.sizeBand ?? ""),
            evEbitdaLow: body.evEbitdaLow ?? null,
            evEbitdaHigh: body.evEbitdaHigh ?? null,
            evEbitdaMedian: body.evEbitdaMedian ?? null,
            evRevenueMedian: body.evRevenueMedian ?? null,
            notes: String(body.notes ?? ""),
          });
          return NextResponse.json({ ok: true });
        }
        break;
    }
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

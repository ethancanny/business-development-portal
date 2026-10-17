import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getExecutives } from "@/lib/db";
import { getTailwindReport } from "@/lib/tailwind";
import {
  getAcquisitions,
  getEntities,
  getFilings,
  getIndicatorSeries,
  getLatestIndicators,
  getListings,
  getCompanies,
  getFitCompanies,
  getFilteredCompanies,
  markNotChain,
  FITS_DISPLAY_LIMIT,
  countCompanies,
  countFits,
  countUnscored,
  getUpdates,
  setCompanyStatus,
  dismissCompany,
  restoreCompany,
  keepCompany,
  getMultiples,
  getSyncLog,
  getSyncLogLatestByJob,
  getCompetingBuyers,
  getWarn,
  setAcquisitionStatus,
  updateAcquisitionSummary,
  updateAcquisitionHeadline,
  updateAcquisitionIndustry,
  setFilingStatus,
  setWarnStatus,
  setListingStatus,
  addMultiple,
} from "@/lib/market-db";
import { markNotInstitutional } from "@/lib/institutional-db";

const DATASETS = [
  "indicators",
  "latest",
  "listings",
  "companies",
  "updates",
  "multiples",
  "rates",
  "acquisitions",
  "filings",
  "warn",
  "entities",
  "sync-log",
  "sync-status",
  "competing-buyers",
  "tailwind",
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
      case "companies": {
        // Fit-stage feed (Ethan, Oct 16, 2026): active fits only,
        // newest date_added first, capped at FITS_DISPLAY_LIMIT, with
        // the uncapped active-fit total for the "Showing N of X fits"
        // counter. sectors is a comma-separated scope (the Fit
        // Targets industry tabs); absent = all sectors.
        if (sp.get("mode") === "fits") {
          const sectors = (sp.get("sectors") ?? "")
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean);
          const { companies, fitTotal } = await getFitCompanies(sectors.length ? sectors : undefined);
          return NextResponse.json({ companies, fitTotal, limit: FITS_DISPLAY_LIMIT, mode: "fits" });
        }
        // Filtered Out feed (chain/franchise filter, Oct 16, 2026;
        // institutional filter, Oct 17, 2026): chain-flagged AND
        // institutional-flagged/suspect companies with their reasons
        // — never deleted, never in the fits feed; the view carries
        // the "Not a chain" and "Not institutional" overrides.
        if (sp.get("mode") === "filtered") {
          const sectors = (sp.get("sectors") ?? "")
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean);
          const { companies, chainTotal, institutionalTotal, filteredTotal } = await getFilteredCompanies(sectors.length ? sectors : undefined);
          return NextResponse.json({ companies, chainTotal, institutionalTotal, filteredTotal, mode: "filtered" });
        }
        const sector = sp.get("sector") ?? undefined;
        const off = Number(sp.get("offset") ?? 0);
        const [companies, total, fitTotal, unscoredTotal] = await Promise.all([
          getCompanies(sector, Number(sp.get("limit") ?? 600), off),
          countCompanies(sector),
          countFits(sector),
          countUnscored(sector),
        ]);
        return NextResponse.json({ companies, total, fitTotal, unscoredTotal, offset: off });
      }
      case "updates": {
        return NextResponse.json(await getUpdates());
      }
      case "multiples":
        return NextResponse.json(await getMultiples());
      case "rates": {
        const rows = await getIndicatorSeries(["DPRIME", "SOFR", "DGS10", "DGS2", "DFF"]);
        const latest = (id: string) => {
          const r = rows
            .filter((o) => o.seriesId === id && o.value !== null)
            .sort((a, b) => a.obsDate.localeCompare(b.obsDate));
          const l = r[r.length - 1];
          return l ? { value: l.value, date: l.obsDate } : null;
        };
        const primeLatest = latest("DPRIME");
        const primeVal = primeLatest?.value ?? null;
        return NextResponse.json({
          prime: primeLatest,
          sba: primeLatest && primeVal !== null
            ? {
                value: Math.round((primeVal + 3) * 100) / 100,
                date: primeLatest.date,
                spread: 3,
                basis: "Prime + 3.00% — SBA 7(a) max, loans over $350K",
              }
            : null,
          sofr: latest("SOFR"),
          treasury10y: latest("DGS10"),
          treasury2y: latest("DGS2"),
          fedFunds: latest("DFF"),
        });
      }
      case "acquisitions":
        return NextResponse.json(await getAcquisitions(sp.get("status") ?? undefined));
      case "filings":
        return NextResponse.json(
          await getFilings(
            sp.get("category") ?? undefined,
            sp.get("status") ?? undefined,
            sp.get("days") ? Number(sp.get("days")) : undefined
          )
        );
      case "warn":
        return NextResponse.json(await getWarn(Number(sp.get("limit") ?? 100)));
      case "entities":
        return NextResponse.json(await getEntities(sp.get("status") ?? undefined));
      case "sync-log":
        return NextResponse.json(await getSyncLog());
      case "sync-status":
        return NextResponse.json(await getSyncLogLatestByJob());
      case "competing-buyers":
        return NextResponse.json(await getCompetingBuyers());
      case "tailwind":
        return NextResponse.json(await getTailwindReport());
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
      case "companies":
        if (body.id && body.action === "not-a-chain") {
          await markNotChain(String(body.id));
          return NextResponse.json({ ok: true });
        }
        if (body.id && body.action === "not-an-institution") {
          await markNotInstitutional(String(body.id));
          return NextResponse.json({ ok: true });
        }
        if (body.id && body.action === "restore") {
          const status = await restoreCompany(String(body.id));
          return NextResponse.json({ ok: true, status });
        }
        if (body.id && body.status === "dismissed") {
          await dismissCompany(
            String(body.id),
            typeof body.reason === "string" ? body.reason : ""
          );
          return NextResponse.json({ ok: true, status: "dismissed" });
        }
        if (body.id && body.status === "keep") {
          const status = await keepCompany(String(body.id));
          return NextResponse.json({ ok: true, status });
        }
        if (body.id && body.status) {
          await setCompanyStatus(String(body.id), body.status);
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
        if (body.id && typeof body.industry === "string") {
          await updateAcquisitionIndustry(String(body.id), body.industry.trim().slice(0, 80));
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

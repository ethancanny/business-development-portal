import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getAccessContext } from "@/lib/platform/permissions";
import { getDeals, saveDeals, newId, logActivity } from "@/lib/db";
import { DEAL_STAGES, type Deal, type DealStage } from "@/lib/types";
import { DEAL_COLUMNS, parseTabular } from "@/lib/platform/tabular";

/**
 * Deals import (Phase 10). Body: { csv?: string, xlsxBase64?: string }
 * — exactly one is required. Rows are matched to existing deals by id
 * (when present and found), else by normalized companyName (lowercase
 * trim). Updates apply only the fields the row actually provides
 * (non-empty); creates mirror POST /api/deals' defaults with geocoding
 * SKIPPED (lat/lng null) and stage defaulting to "Sourcing". Stage
 * values are accepted only when they are a valid DEAL_STAGES entry.
 * Response: { created, updated, skipped, errors: [{row, message}] }
 * where `row` is the 1-based data-row number (header excluded) and
 * unknown file headers are surfaced in the first error entry when any.
 */

const CAP = 1000;

const STRING_FIELDS = [
  "companyName",
  "industry",
  "city",
  "owner",
  "contactName",
  "contactEmail",
  "broker",
  "source",
] as const;

const NUMBER_FIELDS = ["dealValue"] as const;
const NULLABLE_NUMBER_FIELDS = [
  "askingPrice",
  "revenue",
  "ebitda",
  "growthPct",
] as const;

export async function POST(req: NextRequest) {
  const user = getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const ctx = await getAccessContext(user);
  if (ctx.companyIds !== null) {
    return NextResponse.json({ error: "internal_only" }, { status: 403 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    csv?: unknown;
    xlsxBase64?: unknown;
  };
  const hasCsv = typeof body.csv === "string" && body.csv.length > 0;
  const hasXlsx =
    typeof body.xlsxBase64 === "string" && body.xlsxBase64.length > 0;
  if (hasCsv === hasXlsx) {
    return NextResponse.json(
      { error: "Provide exactly one of { csv } or { xlsxBase64 }" },
      { status: 400 }
    );
  }

  let parsed;
  try {
    parsed = parseTabular(
      hasCsv
        ? (body.csv as string)
        : Buffer.from(body.xlsxBase64 as string, "base64"),
      DEAL_COLUMNS
    );
  } catch (err) {
    return NextResponse.json(
      {
        error: `Could not parse the file: ${err instanceof Error ? err.message : String(err)}`,
      },
      { status: 400 }
    );
  }
  if (parsed.rows.length > CAP) {
    return NextResponse.json(
      { error: `Import is capped at ${CAP} rows per request` },
      { status: 400 }
    );
  }

  const deals = await getDeals();
  const byId = new Map(deals.map((d) => [d.id, d]));
  const normName = (s: string) => s.trim().toLowerCase();
  const byName = new Map<string, Deal>();
  for (const d of deals) {
    const k = normName(d.companyName);
    if (k && !byName.has(k)) byName.set(k, d);
  }

  let created = 0;
  let updated = 0;
  let skipped = 0;
  const errors: { row: number; message: string }[] = [];
  if (parsed.unknownHeaders.length) {
    errors.push({
      row: 0,
      message: `Ignored unrecognized columns: ${parsed.unknownHeaders.join(", ")}`,
    });
  }
  const now = new Date().toISOString();

  parsed.rows.forEach((row, i) => {
    const rowNo = i + 1;
    const companyName = (row.companyName ?? "").trim();
    const id = (row.id ?? "").trim();
    const existing =
      (id ? byId.get(id) : undefined) ??
      (companyName ? byName.get(normName(companyName)) : undefined);

    if (!existing && !companyName) {
      skipped++;
      errors.push({ row: rowNo, message: "companyName is required" });
      return;
    }

    const stageRaw = (row.stage ?? "").trim();
    const stageValid =
      stageRaw !== "" &&
      (DEAL_STAGES as readonly string[]).includes(stageRaw);
    if (stageRaw !== "" && !stageValid) {
      skipped++;
      errors.push({
        row: rowNo,
        message: `Invalid stage "${stageRaw}" (must be one of: ${DEAL_STAGES.join(", ")})`,
      });
      return;
    }

    if (existing) {
      for (const f of STRING_FIELDS) {
        const v = (row[f] ?? "").trim();
        if (v !== "") existing[f] = v;
      }
      if (stageValid) existing.stage = stageRaw as DealStage;
      for (const f of NUMBER_FIELDS) {
        const v = (row[f] ?? "").trim();
        if (v !== "") {
          const n = Number(v.replace(/[$,]/g, ""));
          if (Number.isFinite(n)) existing[f] = n;
        }
      }
      for (const f of NULLABLE_NUMBER_FIELDS) {
        const v = (row[f] ?? "").trim();
        if (v !== "") {
          const n = Number(v.replace(/[$,]/g, ""));
          if (Number.isFinite(n)) existing[f] = n;
        }
      }
      existing.updatedAt = now;
      updated++;
      return;
    }

    const num = (v: string, fallback: number | null): number | null => {
      const n = Number((v ?? "").replace(/[$,]/g, ""));
      return v.trim() !== "" && Number.isFinite(n) ? n : fallback;
    };
    const deal: Deal = {
      id: newId(),
      companyName,
      industry: (row.industry ?? "").trim(),
      stage: stageValid ? (stageRaw as DealStage) : "Sourcing",
      dealValue: num(row.dealValue ?? "", 0) ?? 0,
      revenue: num(row.revenue ?? "", null),
      ebitda: num(row.ebitda ?? "", null),
      askingPrice: num(row.askingPrice ?? "", null),
      growthPct: num(row.growthPct ?? "", null),
      broker: (row.broker ?? "").trim(),
      source: (row.source ?? "").trim(),
      contactName: (row.contactName ?? "").trim(),
      contactEmail: (row.contactEmail ?? "").trim(),
      notes: "",
      owner: (row.owner ?? "").trim() || user.name,
      city: (row.city ?? "").trim(),
      lat: null,
      lng: null,
      links: [],
      operatorIds: [],
      createdAt: now,
      updatedAt: now,
    };
    deals.push(deal);
    byId.set(deal.id, deal);
    byName.set(normName(deal.companyName), deal);
    created++;
  });

  if (created > 0 || updated > 0) {
    await saveDeals(deals);
    await logActivity({
      type: "deal.created",
      actor: user.name,
      message: `${user.name} imported deals (${created} created, ${updated} updated, ${skipped} skipped)`,
      dealId: null,
      execId: null,
      dealName: null,
      execName: null,
    }).catch(() => undefined);
  }

  return NextResponse.json({ created, updated, skipped, errors });
}

import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getAccessContext } from "@/lib/platform/permissions";
import { getDeals, saveDeals, newId, logActivity } from "@/lib/db";
import {
  stageForTypeChange,
  type Deal,
  type InvestmentTypeKey,
} from "@/lib/types";
import { parseTabular } from "@/lib/platform/tabular";
import {
  dealImportColumns,
  getBdConfig,
  parseInvestmentType,
  parseSourcedFromType,
  setDealMetrics,
} from "@/lib/bd/service";
import { INVESTMENT_TYPE_LABELS } from "@/lib/types";

/**
 * Deals import (Phase 10; Investment Types Step 1, Oct 23, 2026).
 * Body: { csv?: string, xlsxBase64?: string } — exactly one required.
 * Rows match existing deals by id, else normalized companyName.
 *
 * Step 1 additions: the accepted column set is the Phase 10 grid +
 * Investment Type / Parent Company / Sourced From columns + one
 * column per bd.metric_definitions entry (header = its label), which
 * is exactly what the per-type exports and templates produce. The
 * type cell accepts the key (platform_lbo) or the label
 * (Platform LBO). Stage validates against the ROW's type stage list
 * (bd.type_config) — an invalid stage rejects the row with an error
 * entry, as before. An add-on row must name a Parent Company that
 * resolves to an existing (or earlier-imported) deal. Metric cells
 * land in bd.deal_metrics with source 'import'.
 * Response: { created, updated, skipped, errors: [{row, message}] }.
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

function typeFromCell(v: string): InvestmentTypeKey | null {
  const t = (v ?? "").trim();
  if (!t) return null;
  const byKey = parseInvestmentType(t);
  if (byKey) return byKey;
  for (const [key, label] of Object.entries(INVESTMENT_TYPE_LABELS)) {
    if (label.toLowerCase() === t.toLowerCase()) {
      return key as InvestmentTypeKey;
    }
  }
  return null;
}

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

  const cfg = await getBdConfig();
  const columns = await dealImportColumns();
  const stagesByType = new Map(
    cfg.types.map((t) => [t.key, t.stages] as const)
  );
  const defKeys = new Set(cfg.definitions.map((d) => d.key));

  let parsed;
  try {
    parsed = parseTabular(
      hasCsv
        ? (body.csv as string)
        : Buffer.from(body.xlsxBase64 as string, "base64"),
      columns
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
  const metricWrites: Array<{ dealId: string; values: Record<string, unknown> }> = [];
  /** Deals this import created or updated — the BD → DD handoff runs
   * for exactly these after the save (Oct 24, 2026). */
  const touchedIds: string[] = [];

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

    /* Type: cell wins; else the existing deal's type; else LBO. */
    const typeCell = (row.investmentType ?? "").trim();
    let typeKey: InvestmentTypeKey | null = typeFromCell(typeCell);
    if (typeCell !== "" && !typeKey) {
      skipped++;
      errors.push({
        row: rowNo,
        message: `Invalid investment type "${typeCell}" (use Platform LBO, Add-on, Early Stage, or Minority Growth)`,
      });
      return;
    }
    if (!typeKey) {
      typeKey = existing?.investmentType ?? "platform_lbo";
    }
    const typeStages = stagesByType.get(typeKey) ?? [];

    /* Parent (required for add-ons): name resolves against the live
     * pipeline, including rows imported earlier in this file. */
    const parentName = (row.parentCompany ?? "").trim();
    let parentDealId: string | null | undefined; // undefined = not provided
    if (parentName !== "") {
      const parent = byName.get(normName(parentName));
      if (!parent) {
        skipped++;
        errors.push({
          row: rowNo,
          message: `Parent Company "${parentName}" does not match a pipeline deal`,
        });
        return;
      }
      parentDealId = parent.id;
    }
    const effectiveParent =
      parentDealId !== undefined
        ? parentDealId
        : (existing?.parentDealId ?? null);
    if (typeKey === "add_on" && !effectiveParent) {
      skipped++;
      errors.push({
        row: rowNo,
        message: "Add-on rows require a Parent Company",
      });
      return;
    }

    /* Stage: validated against the row's type list. */
    const stageRaw = (row.stage ?? "").trim();
    const stageValid = stageRaw !== "" && typeStages.includes(stageRaw);
    if (stageRaw !== "" && !stageValid) {
      skipped++;
      errors.push({
        row: rowNo,
        message: `Invalid stage "${stageRaw}" for ${INVESTMENT_TYPE_LABELS[typeKey]} (must be one of: ${typeStages.join(", ")})`,
      });
      return;
    }

    /* Metric cells ride along and are written after the deal save. */
    const metricValues: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(row)) {
      if (!k.startsWith("metric:")) continue;
      const defKey = k.slice("metric:".length);
      if (!defKeys.has(defKey)) continue;
      const cell = (v ?? "").trim();
      if (cell !== "") metricValues[defKey] = cell;
    }

    if (existing) {
      for (const f of STRING_FIELDS) {
        const v = (row[f] ?? "").trim();
        if (v !== "") existing[f] = v;
      }
      const typeChanged =
        (existing.investmentType ?? "platform_lbo") !== typeKey;
      existing.investmentType = typeKey;
      if (parentDealId !== undefined) existing.parentDealId = parentDealId;
      const sfType = parseSourcedFromType((row.sourcedFromType ?? "").trim());
      if ((row.sourcedFromType ?? "").trim() !== "") {
        existing.sourcedFromType = sfType;
      }
      if ((row.sourcedFromId ?? "").trim() !== "") {
        existing.sourcedFromId = (row.sourcedFromId ?? "").trim();
      }
      if (stageValid) {
        existing.stage = stageRaw;
      } else if (typeChanged && !typeStages.includes(existing.stage)) {
        existing.stage = stageForTypeChange(existing.stage, typeStages);
      }
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
      if (Object.keys(metricValues).length) {
        metricWrites.push({ dealId: existing.id, values: metricValues });
      }
      touchedIds.push(existing.id);
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
      stage: stageValid ? stageRaw : (typeStages[0] ?? "Sourced"),
      investmentType: typeKey,
      parentDealId: effectiveParent,
      sourcedFromType: parseSourcedFromType((row.sourcedFromType ?? "").trim()),
      sourcedFromId: (row.sourcedFromId ?? "").trim() || null,
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
    if (Object.keys(metricValues).length) {
      metricWrites.push({ dealId: deal.id, values: metricValues });
    }
    touchedIds.push(deal.id);
    created++;
  });

  if (created > 0 || updated > 0) {
    await saveDeals(deals);
    for (const w of metricWrites) {
      const res = await setDealMetrics(w.dealId, w.values, user.name, "import");
      if (res.rejected.length) {
        errors.push({
          row: 0,
          message: `Some metric values were rejected (unknown or non-numeric): ${res.rejected.join(", ")}`,
        });
      }
    }
    await logActivity({
      type: "deal.created",
      actor: user.name,
      message: `${user.name} imported deals (${created} created, ${updated} updated, ${skipped} skipped)`,
      dealId: null,
      execId: null,
      dealName: null,
      execName: null,
    }).catch(() => undefined);
    // BD → Due Diligence handoff (Oct 24, 2026): any imported deal
    // landing in (or past) a diligence stage gets its workspace.
    // Best-effort and idempotent per deal — the import stands
    // regardless of any single handoff outcome.
    try {
      const { ensureWorkspaceForDeal } = await import(
        "@/lib/diligence/service"
      );
      for (const dealId of touchedIds) {
        await ensureWorkspaceForDeal(dealId, user.name);
      }
    } catch {
      /* handoff wiring is best-effort — the import stands */
    }
  }

  return NextResponse.json({ created, updated, skipped, errors });
}

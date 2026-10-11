import { NextRequest, NextResponse } from "next/server";
import {
  getDeals,
  saveDeals,
  getAttachments,
  saveAttachments,
  newId,
  logActivity,
} from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { geocodeCity } from "@/lib/geo";
import type { Attachment, Deal, DealMetrics } from "@/lib/types";

/** CIM / broker-document intake (Oct 11, 2026). The email sweep posts
 * what it extracted from a CIM, teaser, or broker report here:
 *  - matches an existing pipeline business by normalized name, or
 *    creates it at Sourcing (claimed by Ethan under the shared login);
 *  - fills ONLY fields that are empty on the record — human-entered
 *    data is never overwritten; metrics/drivers merge key-by-key the
 *    same way;
 *  - attaches the source document to the business (5 MB cap, same as
 *    the attachments API) and reports back what it did.
 * Auth: a partner session, or the CRON_SECRET bearer. */

const MAX_BYTES = 5 * 1024 * 1024;

function authorized(req: NextRequest): boolean {
  if (getSessionUser()) return true;
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") === `Bearer ${secret}`) return true;
  return false;
}

function normName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[.,'"]/g, " ")
    .replace(/\b(llc|inc|corp|corporation|company|co|ltd|the)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return isFinite(n) ? n : null;
}

function parseMetrics(body: unknown): DealMetrics {
  if (!body || typeof body !== "object") return {};
  const out: DealMetrics = {};
  const pctKeys = ["topCustomerPct", "top3Pct", "recurringPct"] as const;
  for (const k of pctKeys) {
    const n = num((body as Record<string, unknown>)[k]);
    if (n !== null) out[k] = Math.max(0, Math.min(100, n));
  }
  const h = num((body as Record<string, unknown>)["ownerHoursPerWeek"]);
  if (h !== null) out.ownerHoursPerWeek = Math.max(0, Math.min(80, h));
  return out;
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const companyName = String(body.companyName ?? "").trim();
  if (!companyName) {
    return NextResponse.json({ error: "companyName is required" }, { status: 400 });
  }
  const user = getSessionUser();
  const actor = user?.name ?? "CIM intake";
  const fieldsSet: string[] = [];
  const warnings: string[] = [];

  const deals = await getDeals();
  const target = normName(companyName);
  let idx = deals.findIndex((d) => normName(d.companyName) === target);
  if (idx === -1) {
    idx = deals.findIndex((d) => {
      const n = normName(d.companyName);
      return n.length >= 4 && (target.includes(n) || n.includes(target));
    });
  }

  const inMetrics = parseMetrics(body.metrics);
  const inDrivers =
    body.drivers && typeof body.drivers === "object"
      ? (body.drivers as Record<string, unknown>)
      : {};
  const noteAppend = String(body.noteAppend ?? "").trim();

  let deal: Deal;
  let action: "created" | "updated";
  const now = new Date().toISOString();

  if (idx === -1) {
    const city = String(body.city ?? "").trim();
    const geo = city ? await geocodeCity(city) : null;
    deal = {
      id: newId(),
      companyName,
      industry: String(body.industry ?? "").trim(),
      stage: "Sourcing",
      dealValue: num(body.dealValue) ?? 0,
      contactName: String(body.contactName ?? "").trim(),
      contactEmail: String(body.contactEmail ?? "").trim(),
      notes: noteAppend,
      owner: String(body.owner ?? "").trim() || user?.name || "Ethan Canny",
      city,
      lat: geo?.lat ?? null,
      lng: geo?.lng ?? null,
      links: [],
      operatorIds: [],
      revenue: num(body.revenue),
      ebitda: num(body.ebitda),
      growthPct: num(body.growthPct),
      askingPrice: num(body.askingPrice),
      broker: String(body.broker ?? "").trim(),
      source: String(body.source ?? "Broker CIM (email)").trim(),
      drivers: {},
      structure: {},
      metrics: inMetrics,
      synthesis: null,
      createdAt: now,
      updatedAt: now,
    };
    for (const k of ["concentration", "recurring", "ownerDependence", "growth", "margins", "management", "financials"] as const) {
      const v = inDrivers[k];
      if (v === "neg" || v === "neu" || v === "pos") deal.drivers = { ...deal.drivers, [k]: v };
    }
    deals.push(deal);
    action = "created";
    fieldsSet.push("record");
  } else {
    deal = { ...deals[idx] };
    const fillNum = (key: "revenue" | "ebitda" | "askingPrice" | "growthPct" | "dealValue") => {
      const v = num(body[key]);
      if (v !== null && (deal[key] === null || deal[key] === undefined || deal[key] === 0)) {
        (deal as unknown as Record<string, unknown>)[key] = v;
        fieldsSet.push(key);
      }
    };
    fillNum("revenue");
    fillNum("ebitda");
    fillNum("askingPrice");
    fillNum("growthPct");
    fillNum("dealValue");
    const fillStr = (key: "industry" | "city" | "broker" | "contactName" | "contactEmail") => {
      const v = String(body[key] ?? "").trim();
      if (v && !String(deal[key] ?? "").trim()) {
        (deal as unknown as Record<string, unknown>)[key] = v;
        fieldsSet.push(key);
      }
    };
    fillStr("industry");
    fillStr("city");
    fillStr("broker");
    fillStr("contactName");
    fillStr("contactEmail");
    if (deal.city && (deal.lat === null || deal.lat === undefined)) {
      const geo = await geocodeCity(deal.city);
      if (geo) {
        deal.lat = geo.lat;
        deal.lng = geo.lng;
      }
    }
    const mergedMetrics: DealMetrics = { ...(deal.metrics ?? {}) };
    for (const k of Object.keys(inMetrics) as (keyof DealMetrics)[]) {
      if (mergedMetrics[k] === null || mergedMetrics[k] === undefined) {
        (mergedMetrics as Record<string, unknown>)[k] = inMetrics[k];
        fieldsSet.push(`metrics.${k}`);
      }
    }
    deal.metrics = mergedMetrics;
    const mergedDrivers = { ...(deal.drivers ?? {}) } as Record<string, unknown>;
    for (const k of Object.keys(inDrivers)) {
      const v = inDrivers[k];
      if ((v === "neg" || v === "neu" || v === "pos") && !mergedDrivers[k]) {
        mergedDrivers[k] = v;
        fieldsSet.push(`drivers.${k}`);
      }
    }
    deal.drivers = mergedDrivers as Deal["drivers"];
    if (noteAppend) {
      deal.notes = deal.notes ? `${deal.notes}\n\n${noteAppend}` : noteAppend;
      fieldsSet.push("notes");
    }
    deal.updatedAt = now;
    deals[idx] = deal;
    action = "updated";
  }

  // Attach the source document, if one came with the intake.
  let attachmentStored = false;
  const att = body.attachment;
  if (att && att.filename && att.data) {
    const data = String(att.data);
    const size = Math.floor((data.length * 3) / 4);
    if (size > MAX_BYTES) {
      warnings.push(`Attachment ${String(att.filename)} is over the 5 MB portal cap — not stored.`);
    } else {
      const items = await getAttachments();
      const record: Attachment = {
        id: newId(),
        dealId: deal.id,
        filename: String(att.filename).slice(0, 200),
        mimeType: String(att.mimeType ?? "application/octet-stream"),
        size,
        data,
        createdAt: now,
      };
      items.push(record);
      await saveAttachments(items);
      attachmentStored = true;
    }
  }

  await saveDeals(deals);
  await logActivity({
    type: "deal.intake",
    actor,
    message: `${actor}: CIM intake ${action} ${deal.companyName}${fieldsSet.length ? ` (set ${fieldsSet.join(", ")})` : ""}${attachmentStored ? " + document attached" : ""}`,
    dealId: deal.id,
    execId: null,
    dealName: deal.companyName,
    execName: null,
  });

  return NextResponse.json({
    ok: true,
    action,
    dealId: deal.id,
    companyName: deal.companyName,
    fieldsSet,
    attachmentStored,
    warnings,
  });
}

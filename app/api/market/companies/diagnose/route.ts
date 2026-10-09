import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getCompanies } from "@/lib/market-db";

/**
 * TEMPORARY diagnostic (Oct 9, 2026 rebuild): list company rows in a
 * sector whose stored details claim to be a JSON object but fail to
 * parse (such rows break details::jsonb casts in countFits/getUpdates).
 * Read-only; remove after the rebuild verification completes.
 */
export async function POST(req: NextRequest) {
  const authed =
    !!getSessionUser() ||
    (() => {
      const secret = process.env.CRON_SECRET;
      return !secret || req.headers.get("authorization") === `Bearer ${secret}`;
    })();
  if (!authed) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const wantKey = String(body.dedupKey ?? "");
  const wantSource = String(body.source ?? "");
  if (body.mode === "ent") {
    const ents: { sector: string; source: string; dedupKey: string; name: string; signalValue: number | null; detLen: number; valid: boolean }[] = [];
    for (const sec of ["Aerospace & Defense", "Healthcare", "Advanced Manufacturing", "Specialty Trades & Construction"]) {
      for (let off = 0; ; off += 5000) {
        const rows = await getCompanies(sec, 5000, off);
        if (!rows.length) break;
        for (const r of rows) {
          if (!r.dedupKey.startsWith("ENT-")) continue;
          let valid = true;
          try { JSON.parse(r.details ?? ""); } catch { valid = false; }
          ents.push({ sector: sec, source: r.source, dedupKey: r.dedupKey, name: r.name, signalValue: r.signalValue, detLen: (r.details ?? "").length, valid });
        }
        if (rows.length < 5000) break;
      }
    }
    return NextResponse.json({ ok: true, ents });
  }
  if (wantKey) {
    for (const sec of ["Aerospace & Defense", "Healthcare", "Advanced Manufacturing", "Specialty Trades & Construction"]) {
      for (let off = 0; ; off += 5000) {
        const rows = await getCompanies(sec, 5000, off);
        if (!rows.length) break;
        for (const r of rows) {
          if (r.dedupKey === wantKey && (!wantSource || r.source === wantSource)) return NextResponse.json({ ok: true, row: r });
        }
        if (rows.length < 5000) break;
      }
    }
    return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  }
  const sector = String(body.sector ?? "");
  const bad: { source: string; dedupKey: string; name: string; len: number; tail: string }[] = [];
  let total = 0;
  for (let off = 0; ; off += 5000) {
    const rows = await getCompanies(sector || undefined, 5000, off);
    if (!rows.length) break;
    total += rows.length;
    for (const r of rows) {
      const d = r.details ?? "";
      if (d.trim().startsWith("{")) {
        try {
          JSON.parse(d);
        } catch {
          bad.push({ source: r.source, dedupKey: r.dedupKey, name: r.name, len: d.length, tail: d.slice(-60) });
        }
      }
    }
    if (rows.length < 5000) break;
  }
  return NextResponse.json({ ok: true, sector, total, bad });
}

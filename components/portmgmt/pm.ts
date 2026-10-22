"use client";

/**
 * Phase 9 Portfolio Management — shared client helpers for the
 * /api/portmgmt/* surface (WS-A/WS-B contracts). Reuses the monitoring
 * fetch/format primitives so conventions (money, fraction margins,
 * badge classes) stay identical across the workspace and the scoped
 * /my-company portal. Rows are loosely typed (Rec) and read through
 * pick()/num() — a missing figure renders "—", never an invented $0.
 */

import { api, listFrom, num, pick, str, type Rec } from "@/components/monitoring/types";

export { api, listFrom, num, pick, str };
export type { Rec };

export const PM = "/api/portmgmt";

/** Company-scoped portmgmt base path. */
export function pmCompany(companyId: string): string {
  return `${PM}/companies/${encodeURIComponent(companyId)}`;
}

/** First array found on the record under any of the keys (alias). */
export function rowsFrom(data: unknown, ...keys: string[]): Rec[] {
  return listFrom(data, ...keys);
}

/** Scalar display rows for a record (label/value) — used for
 * lender / borrowing-base / exit payloads whose exact field set is
 * owned by the backend workstreams. Money-ish keys format as money. */
export function scalarEntries(
  rec: Rec | null | undefined,
  fmtMoney: (n: number | null) => string
): Array<{ label: string; value: string }> {
  if (!rec) return [];
  const moneyKey = /amount|value|balance|base|eligible|advance|total|capital|ebitda|revenue|cash|debt|price/i;
  const out: Array<{ label: string; value: string }> = [];
  for (const [k, v] of Object.entries(rec)) {
    if (v === null || v === undefined || v === "" || typeof v === "object") continue;
    const label = k
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .replace(/_/g, " ")
      .replace(/^\w/, (c) => c.toUpperCase());
    const n = num(v);
    out.push({
      label,
      value: n !== null && moneyKey.test(k) && Math.abs(n) >= 100 ? fmtMoney(n) : String(v),
    });
  }
  return out;
}

/* ---------------- Chunked upload (portmgmt protocol) ----------------
 * Mirrors components/DocumentUploader.tsx's chunk protocol, pointed
 * at the portmgmt uploads routes:
 *   POST /api/portmgmt/uploads {filename, mime, totalSize, companyId}
 *     → {uploadId|id, chunkSize?}
 *   PUT  /api/portmgmt/uploads/[id]?offset=N  (raw chunk bytes;
 *     409 {expectedOffset} resumes, {receivedBytes} advances)
 *   POST /api/portmgmt/uploads/[id] {action:'complete'} → {document}
 */
export interface PortmgmtDocument {
  id: string;
  name?: string;
  [key: string]: unknown;
}

export async function uploadFilePortmgmt(
  file: File,
  companyId: string,
  onProgress?: (pct: number) => void
): Promise<PortmgmtDocument> {
  const beginRes = await fetch(`${PM}/uploads`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      filename: file.name,
      mime: file.type || "application/octet-stream",
      totalSize: file.size,
      companyId,
    }),
  });
  if (!beginRes.ok) throw new Error(`Could not start upload (${beginRes.status})`);
  const begin = (await beginRes.json().catch(() => ({}))) as Rec;
  const uploadId = str(pick(begin, "uploadId", "id"));
  if (!uploadId) throw new Error("Upload session was not created.");
  const chunkSizeRaw = num(pick(begin, "chunkSize"));
  const chunkSize = chunkSizeRaw && chunkSizeRaw > 0 ? chunkSizeRaw : 2 * 1024 * 1024;

  let offset = 0;
  const total = file.size;
  if (total === 0) onProgress?.(100);
  while (offset < total) {
    const slice = file.slice(offset, Math.min(offset + chunkSize, total));
    const putRes = await fetch(
      `${PM}/uploads/${encodeURIComponent(uploadId)}?offset=${offset}`,
      { method: "PUT", body: slice }
    );
    if (putRes.status === 409) {
      const j = (await putRes.json().catch(() => null)) as Rec | null;
      const expected = j ? num(pick(j, "expectedOffset")) : null;
      if (expected !== null) {
        offset = expected;
        onProgress?.(total ? Math.round((offset / total) * 100) : 0);
        continue;
      }
      throw new Error("Upload conflict (409)");
    }
    if (!putRes.ok) throw new Error(`Chunk upload failed (${putRes.status})`);
    const j = (await putRes.json().catch(() => null)) as Rec | null;
    const received = j ? num(pick(j, "receivedBytes")) : null;
    offset = received !== null ? received : offset + slice.size;
    onProgress?.(total ? Math.min(100, Math.round((offset / total) * 100)) : 100);
  }

  const compRes = await fetch(`${PM}/uploads/${encodeURIComponent(uploadId)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "complete" }),
  });
  if (!compRes.ok) throw new Error(`Could not complete upload (${compRes.status})`);
  const result = (await compRes.json().catch(() => ({}))) as Rec;
  const doc = (pick(result, "document") ?? result) as PortmgmtDocument;
  return doc;
}

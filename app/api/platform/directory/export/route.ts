import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { getSessionUser } from "@/lib/auth";
import { ensurePlatform } from "@/lib/platform/service";
import { ensureDirectory } from "@/lib/directory/schema";
import { listDirectory, type DirectoryListItem } from "@/lib/directory/service";

const EXPORT_CAP = 1000;
const PAGE = 50;

function toRow(item: DirectoryListItem): Record<string, string | number> {
  return {
    id: item.id,
    kind: item.kind,
    name: item.name,
    title: item.title,
    types: item.types.join("; "),
    email: item.email,
    phone: item.phone,
    organizationName: item.organizationName,
    website: item.website,
    linkedDealCount: item.linkedDealCount,
    updatedAt: item.updatedAt ?? "",
  };
}

function csvEscape(v: string | number): string {
  const s = String(v ?? "");
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function GET(req: NextRequest) {
  if (!getSessionUser()) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await ensurePlatform();
  await ensureDirectory();
  const sp = req.nextUrl.searchParams;
  const format = (sp.get("format") ?? "csv").toLowerCase() === "xlsx" ? "xlsx" : "csv";
  const filters = {
    kind: sp.get("kind") ?? undefined,
    type: sp.get("type") ?? undefined,
    q: sp.get("q") ?? undefined,
  };

  // listDirectory paginates at ≤50 per the API rules; page through it
  // up to the export cap.
  const all: DirectoryListItem[] = [];
  let total = 0;
  for (let offset = 0; offset < EXPORT_CAP; offset += PAGE) {
    const { items, total: t } = await listDirectory({
      ...filters,
      limit: PAGE,
      offset,
    });
    total = t;
    all.push(...items);
    if (!items.length || all.length >= Math.min(total, EXPORT_CAP)) break;
  }
  const rows = all.slice(0, EXPORT_CAP).map(toRow);

  if (format === "xlsx") {
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Directory");
    const buf = XLSX.write(wb, { bookType: "xlsx", type: "buffer" }) as Buffer;
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": 'attachment; filename="directory-export.xlsx"',
        "Cache-Control": "private, no-store",
      },
    });
  }

  const headers = rows.length
    ? Object.keys(rows[0])
    : ["id", "kind", "name", "title", "types", "email", "phone", "organizationName", "website", "linkedDealCount", "updatedAt"];
  const csv = [
    headers.join(","),
    ...rows.map((r) => headers.map((h) => csvEscape(r[h] ?? "")).join(",")),
  ].join("\r\n");
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="directory-export.csv"',
      "Cache-Control": "private, no-store",
    },
  });
}

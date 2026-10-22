import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { ensurePlatform } from "@/lib/platform/service";
import { ensureFinancials } from "@/lib/financials/schema";
import { exportSet } from "@/lib/financials/service";

const NO_STORE_HEADERS = { "Cache-Control": "private, no-store" };

/** Detail keys a coded service error may carry (e.g. variance fields
 * on 'ebitda_override_required'). Copied into the error response
 * verbatim; the error's message/stack are never copied. */
const ERROR_DETAIL_KEYS = [
  "ebitdaStated",
  "ebitdaComputed",
  "ebitdaVariance",
  "statedEbitda",
  "computedEbitda",
  "variance",
  "tolerance",
  "checks",
] as const;

/**
 * Map a thrown service error to a response. Errors carrying a
 * snake_case code (as `error`/`code`, or as an Error whose message is
 * exactly the code) are coded client errors; 'posted_immutable' is a
 * 409 and '*_not_found' a 404. Anything else is unknown: log the
 * message only (never request bodies or financial figures) and
 * answer a generic 500 so nothing internal leaks.
 */
function serviceErrorResponse(err: unknown, scope: string): NextResponse {
  const rec =
    err && typeof err === "object" ? (err as Record<string, unknown>) : null;
  const extra: Record<string, unknown> = {};
  if (rec) {
    for (const [key, value] of Object.entries(rec)) {
      if (
        key === "error" ||
        key === "code" ||
        key === "message" ||
        key === "stack" ||
        key === "name" ||
        key === "cause"
      ) {
        continue;
      }
      extra[key] = value;
    }
    for (const key of ERROR_DETAIL_KEYS) {
      if (extra[key] === undefined && rec[key] !== undefined) {
        extra[key] = rec[key];
      }
    }
  }
  const code =
    rec && typeof rec.error === "string"
      ? rec.error
      : rec && typeof rec.code === "string"
        ? rec.code
        : err instanceof Error && /^[a-z][a-z0-9_]*$/.test(err.message)
          ? err.message
          : "";
  if (code === "posted_immutable") {
    return NextResponse.json(
      { error: code, ...extra },
      { status: 409, headers: NO_STORE_HEADERS }
    );
  }
  if (code === "ebitda_override_required") {
    return NextResponse.json(
      { error: code, ...extra },
      { status: 400, headers: NO_STORE_HEADERS }
    );
  }
  if (code === "not_found" || code.endsWith("_not_found")) {
    return NextResponse.json(
      { error: code, ...extra },
      { status: 404, headers: NO_STORE_HEADERS }
    );
  }
  if (code) {
    return NextResponse.json(
      { error: code, ...extra },
      { status: 400, headers: NO_STORE_HEADERS }
    );
  }
  console.error(
    `[financials] ${scope} failed: ${err instanceof Error ? err.message : "unknown error"}`
  );
  return NextResponse.json(
    { error: "internal" },
    { status: 500, headers: NO_STORE_HEADERS }
  );
}

/**
 * GET /api/platform/financials/company/[companyId]/export?format=xlsx|pdf&setId=
 * Downloads one statement set as a spreadsheet or PDF (statement
 * lines only — never raw document bytes). setId is required; format
 * defaults to xlsx and anything other than xlsx|pdf is a 400. The
 * filename, mime and bytes all come from the service's exportSet.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { companyId: string } }
) {
  if (!getSessionUser()) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    await ensurePlatform();
    await ensureFinancials();
    const sp = req.nextUrl.searchParams;
    const setId = sp.get("setId") ?? "";
    if (!setId) {
      return NextResponse.json(
        { error: "setId is required" },
        { status: 400, headers: NO_STORE_HEADERS }
      );
    }
    const formatRaw = (sp.get("format") ?? "xlsx").toLowerCase();
    if (formatRaw !== "xlsx" && formatRaw !== "pdf") {
      return NextResponse.json(
        { error: "format must be xlsx or pdf" },
        { status: 400, headers: NO_STORE_HEADERS }
      );
    }
    const format = formatRaw as "xlsx" | "pdf";
    const result = await exportSet(params.companyId, setId, format);
    if (!result) {
      return NextResponse.json(
        { error: "Set not found" },
        { status: 404, headers: NO_STORE_HEADERS }
      );
    }
    const body = new Uint8Array(result.buffer as unknown as Uint8Array);
    const fallbackMime =
      format === "pdf"
        ? "application/pdf"
        : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    const filename = result.filename || `financials.${format}`;
    return new NextResponse(body, {
      status: 200,
      headers: {
        "Content-Type": result.mime || fallbackMime,
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
        "Content-Length": String(body.length),
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    return serviceErrorResponse(err, "exportSet");
  }
}

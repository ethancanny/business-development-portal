import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import {
  createOrMergeCandidate,
  isCandidateStatus,
  validateSource,
  type CandidateInput,
} from "@/lib/candidates-db";
import { CANDIDATE_COLUMNS, parseTabular } from "@/lib/platform/tabular";

/**
 * Operator candidates import (Phase 10). Body: { csv?: string,
 * xlsxBase64?: string } — exactly one is required.
 *
 * Standing rule (Ethan, Oct 16, 2026): every candidate MUST carry the
 * source URL it was found at. A row without a name or without a
 * sourceUrl is an error entry and is NEVER created. Creates go
 * through createOrMergeCandidate, whose dedupe key is normalized
 * name+company+title: a row that merges into an existing candidate
 * is reported as skipped with reason "duplicate_merged".
 * The file's `sector` column is display-only (the sector is derived
 * server-side from industry/company) and is not stored; `industry`
 * and `sourceType` columns are accepted when present.
 */

const CAP = 1000;

export async function POST(req: NextRequest) {
  const user = getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const actor = user.name || user.email;

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
      CANDIDATE_COLUMNS
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

  let created = 0;
  let skipped = 0;
  const errors: { row: number; message: string }[] = [];
  if (parsed.unknownHeaders.length) {
    errors.push({
      row: 0,
      message: `Ignored unrecognized columns: ${parsed.unknownHeaders.join(", ")}`,
    });
  }

  for (let i = 0; i < parsed.rows.length; i++) {
    const row = parsed.rows[i];
    const rowNo = i + 1;
    const name = (row.name ?? "").trim();
    const sourceUrl = (row.sourceUrl ?? "").trim();
    if (!name) {
      skipped++;
      errors.push({ row: rowNo, message: "name is required" });
      continue;
    }
    if (!sourceUrl) {
      skipped++;
      errors.push({
        row: rowNo,
        message:
          "sourceUrl is required — every candidate record must carry the URL it was found at.",
      });
      continue;
    }
    const sourceType = (row.sourceType ?? "").trim() || "Import";
    const sourceError = validateSource(sourceType, sourceUrl);
    if (sourceError) {
      skipped++;
      errors.push({ row: rowNo, message: sourceError });
      continue;
    }
    const status = (row.status ?? "").trim();
    if (status !== "" && !isCandidateStatus(status)) {
      skipped++;
      errors.push({ row: rowNo, message: `Invalid status "${status}"` });
      continue;
    }
    const location = (row.location ?? "").trim();
    const input: CandidateInput = {
      name,
      currentTitle: (row.title ?? "").trim(),
      company: (row.company ?? "").trim(),
      industry: (row.industry ?? "").trim(),
      city: location,
      locationVerified: location !== "",
      sourceType,
      sourceUrl,
      status: status || undefined,
    };
    try {
      const result = await createOrMergeCandidate(
        { ...input, name, sourceType, sourceUrl },
        actor
      );
      if (result.merged) {
        skipped++;
        errors.push({ row: rowNo, message: "duplicate_merged" });
      } else {
        created++;
      }
    } catch (err) {
      skipped++;
      errors.push({
        row: rowNo,
        message: err instanceof Error ? err.message : "Create failed",
      });
    }
  }

  return NextResponse.json({ created, updated: 0, skipped, errors });
}

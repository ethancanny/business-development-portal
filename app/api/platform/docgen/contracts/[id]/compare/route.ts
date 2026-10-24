import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { ensurePlatform } from "@/lib/platform/service";
import { DocGenError } from "@/lib/docgen/generate";
import { compareContractVersions } from "@/lib/docgen/contracts";

/** Version comparison (contract generation): line diff between two
 * versions of a contract. GET ?from=<v>&to=<v> — defaults to the two
 * most recent (previous vs current handled by the caller passing
 * explicit versions). */
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  if (!getSessionUser()) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await ensurePlatform();
  const sp = req.nextUrl.searchParams;
  const from = Number(sp.get("from") ?? 0);
  const to = Number(sp.get("to") ?? 0);
  if (!from || !to || from === to) {
    return NextResponse.json(
      { error: "from and to version numbers are required and must differ" },
      { status: 400 }
    );
  }
  try {
    const diff = await compareContractVersions(params.id, from, to);
    return NextResponse.json({
      from: diff.from,
      to: diff.to,
      added: diff.added,
      removed: diff.removed,
      truncated: diff.truncated,
      lines: diff.lines,
    });
  } catch (err) {
    if (err instanceof DocGenError) {
      const status = err.error === "contract_not_found" ? 404 : 400;
      return NextResponse.json({ error: err.error }, { status });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

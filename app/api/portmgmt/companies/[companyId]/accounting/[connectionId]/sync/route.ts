import { NextRequest, NextResponse } from "next/server";
import {
  authed,
  companyGate,
  ok,
  readBody,
  serviceError,
  sStr,
} from "@/lib/portmgmt/http";
import { getConnection, runSync, listSyncRuns } from "@/lib/portmgmt/accounting";

/** POST run a sync. Body: { mode: 'live' | 'dry_run' } — see
 * lib/portmgmt/accounting.ts for the honesty contract (a live run
 * without provider config finishes 'setup_required'; dry runs map the
 * sample payload only and create no statement sets). */
export async function POST(
  req: NextRequest,
  { params }: { params: { companyId: string; connectionId: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  const denied = companyGate(gate.ctx, params.companyId);
  if (denied) return denied;
  const actor = gate.user.name || gate.user.email;
  try {
    const existing = await getConnection(params.connectionId);
    if (!existing || existing.companyId !== params.companyId) {
      return serviceError(new Error("connection_not_found"), "accounting-sync");
    }
    const body = await readBody(req);
    // Accept both shapes: { mode: 'live' | 'dry_run' } (API contract)
    // and { dryRun: boolean } (Settings UI).
    const mode =
      sStr(body.mode) ??
      (body.dryRun === true
        ? "dry_run"
        : body.dryRun === false
          ? "live"
          : undefined);
    const run = await runSync(params.connectionId, { mode }, actor);
    const runs = await listSyncRuns(params.connectionId);
    return ok({ run, runs });
  } catch (err) {
    return serviceError(err, "accounting-sync");
  }
}

import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { provisionSharePointStorage } from "@/lib/storage/provision";
import { StorageSetupRequiredError } from "@/lib/storage/types";

/**
 * POST /api/platform/storage/provision — create the SharePoint
 * document library (if missing) and stamp every data room to the
 * SharePoint provider. Session-gated like every platform route;
 * setup problems (no consent, no reconnect, site not found) return
 * 409 with the provider's own explanation instead of a bare 500.
 */
export async function POST() {
  if (!getSessionUser()) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const report = await provisionSharePointStorage();
    return NextResponse.json({ ok: true, report });
  } catch (err) {
    if (err instanceof StorageSetupRequiredError) {
      return NextResponse.json(
        {
          error: "setup_required",
          detail: err.message,
          missingScopes: err.missingScopes,
        },
        { status: 409 }
      );
    }
    return NextResponse.json(
      {
        error: "provision_failed",
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    );
  }
}

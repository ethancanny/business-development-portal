import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getAccessContext } from "@/lib/platform/permissions";
import { ensurePlatform } from "@/lib/platform/service";
import { ensureDirectory } from "@/lib/directory/schema";
import { ensureCrm } from "@/lib/directory/crm";
import { importRows } from "@/lib/directory/service";
import { graph, msConnected } from "@/lib/microsoft";

/**
 * CRM Phase 1 — Outlook contacts import (attempt).
 *
 * Uses the existing Microsoft Graph helper (lib/microsoft.ts:
 * `graph(path, accessToken?, init?)`, tokens server-side in Neon).
 * The consented scope set in that module is
 * "offline_access Calendars.ReadWrite User.Read Mail.Read Mail.Send
 *  Files.ReadWrite.All Sites.ReadWrite.All" — it carries NO
 * Contacts.Read scope, so GET /me/contacts is expected to fail with
 * 403 today. Per DESIGN.md that maps, honestly, to
 *   { available: false, reason: 'contacts_scope_missing' }
 * and no contacts are ever fabricated. When the scope is granted,
 * contacts flow through the same importRows path as CSV import
 * (identical dedupe), honoring dryRun.
 */

interface GraphContact {
  displayName?: string;
  givenName?: string;
  surname?: string;
  emailAddresses?: Array<{ address?: string; name?: string }>;
  businessPhones?: string[];
  mobilePhone?: string;
  companyName?: string;
  jobTitle?: string;
}

const CONTACTS_PATH =
  "/me/contacts?$select=displayName,givenName,surname,emailAddresses,businessPhones,mobilePhone,companyName,jobTitle&$top=200";

const MAPPING: Record<string, string> = {
  name: "name",
  email: "email",
  phone: "phone",
  organizationName: "organizationName",
  title: "title",
};

export async function POST(req: NextRequest) {
  const user = getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const ctx = await getAccessContext(user);
  if (ctx.companyIds !== null) {
    return NextResponse.json({ error: "internal_only" }, { status: 403 });
  }
  await ensurePlatform();
  await ensureDirectory();
  await ensureCrm();
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const dryRun = body.dryRun === true || body.dryRun === "true" || body.dryRun === 1;
  const kind = typeof body.kind === "string" && body.kind ? body.kind : "person";

  if (!(await msConnected().catch(() => false))) {
    return NextResponse.json({ available: false, reason: "microsoft_not_connected" });
  }

  // Fetch contacts (bounded: ≤5 pages × 200, import cap is 1000 rows).
  const contacts: GraphContact[] = [];
  try {
    let path: string | null = CONTACTS_PATH;
    for (let page = 0; page < 5 && path; page++) {
      const res = (await graph(path)) as {
        value?: GraphContact[];
        "@odata.nextLink"?: string;
      };
      for (const c of res.value ?? []) contacts.push(c);
      const next = res["@odata.nextLink"];
      path = next ? next.replace("https://graph.microsoft.com/v1.0", "") : null;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Scope/permission failures from graph() read
    // "Graph GET /me/contacts… failed (403): …".
    if (
      message.includes("(403)") ||
      message.includes("(401)") ||
      /scope|consent|permission|Authorization_RequestDenied|ErrorAccessDenied/i.test(message)
    ) {
      return NextResponse.json({ available: false, reason: "contacts_scope_missing" });
    }
    if (/not connected/i.test(message)) {
      return NextResponse.json({ available: false, reason: "microsoft_not_connected" });
    }
    return NextResponse.json(
      { available: false, reason: "graph_error", error: message },
      { status: 502 }
    );
  }

  const rows: Record<string, string>[] = contacts
    .map((c) => {
      const name =
        (c.displayName ?? "").trim() ||
        [c.givenName, c.surname].filter(Boolean).join(" ").trim();
      return {
        name,
        email: (c.emailAddresses?.[0]?.address ?? "").trim(),
        phone: (c.businessPhones?.[0] ?? c.mobilePhone ?? "").trim(),
        organizationName: (c.companyName ?? "").trim(),
        title: (c.jobTitle ?? "").trim(),
      };
    })
    .filter((r) => r.name)
    .slice(0, 1000);

  try {
    // dryRun is Lane A's importRows extension (DESIGN.md); the cast
    // bridges Lane B's tree, where service.ts predates it.
    const result = await importRows({
      rows,
      mapping: MAPPING,
      kind,
      actor: user.name || user.email,
      dryRun,
    } as unknown as Parameters<typeof importRows>[0]);
    return NextResponse.json({ available: true, ...result });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 }
    );
  }
}

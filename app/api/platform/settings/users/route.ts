import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { ensurePlatform } from "@/lib/platform/service";
import {
  getUserRole,
  listUserRoles,
  setUserRole,
  LastAdminError,
  type Role,
} from "@/lib/platform/permissions";

/**
 * Settings → Users & Roles data (Navigation Restructure).
 * Admin-only: the session user must resolve to role 'admin'
 * (core.user_roles via getUserRole) — 401 with no session, 403 for
 * anyone else. GET lists core.user_roles; POST {email, role} writes
 * through setUserRole (which refuses to demote the last admin).
 */

async function requireAdmin() {
  const user = getSessionUser();
  if (!user) return { error: 401 as const };
  await ensurePlatform();
  const role = await getUserRole(user.email);
  if (role !== "admin") return { error: 403 as const };
  return { user };
}

export async function GET() {
  const gate = await requireAdmin();
  if ("error" in gate) {
    return NextResponse.json(
      { error: gate.error === 401 ? "Unauthorized" : "Forbidden" },
      { status: gate.error }
    );
  }
  const users = await listUserRoles();
  return NextResponse.json({ users });
}

export async function POST(req: NextRequest) {
  const gate = await requireAdmin();
  if ("error" in gate) {
    return NextResponse.json(
      { error: gate.error === 401 ? "Unauthorized" : "Forbidden" },
      { status: gate.error }
    );
  }
  const body = (await req.json().catch(() => ({}))) as {
    email?: unknown;
    role?: unknown;
  };
  const email = typeof body.email === "string" ? body.email.trim() : "";
  const role = typeof body.role === "string" ? body.role : "";
  if (!email) {
    return NextResponse.json({ error: "email is required" }, { status: 400 });
  }
  if (role !== "admin" && role !== "internal" && role !== "guest") {
    return NextResponse.json({ error: "invalid role" }, { status: 400 });
  }
  try {
    await setUserRole(email, role as Role);
  } catch (err) {
    if (err instanceof LastAdminError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to set role" },
      { status: 400 }
    );
  }
  const users = await listUserRoles();
  return NextResponse.json({ ok: true, users });
}

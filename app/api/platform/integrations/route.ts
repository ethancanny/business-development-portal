import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { ensurePlatform, getIntegrations } from "@/lib/platform/service";

export async function GET() {
  if (!getSessionUser()) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await ensurePlatform();
  const integrations = await getIntegrations();
  return NextResponse.json({ integrations });
}

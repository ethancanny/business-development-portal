import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { ensurePlatform } from "@/lib/platform/service";
import { ensureDirectory } from "@/lib/directory/schema";
import { createTemplate, listTemplates } from "@/lib/directory/service";

export async function GET() {
  if (!getSessionUser()) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await ensurePlatform();
  await ensureDirectory();
  const templates = await listTemplates(50);
  return NextResponse.json(
    { templates, items: templates },
    { headers: { "Cache-Control": "private, max-age=300" } }
  );
}

export async function POST(req: NextRequest) {
  const user = getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await ensurePlatform();
  await ensureDirectory();
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const name = typeof body.name === "string" ? body.name : "";
  if (!name.trim()) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  const template = await createTemplate({
    name,
    subject: typeof body.subject === "string" ? body.subject : "",
    body: typeof body.body === "string" ? body.body : "",
    createdBy: user.name || user.email,
  });
  return NextResponse.json({ template }, { status: 201 });
}

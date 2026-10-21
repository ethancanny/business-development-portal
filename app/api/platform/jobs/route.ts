import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import {
  ensurePlatform,
  listJobsSvc,
  retryJobSvc,
  runJobSvc,
} from "@/lib/platform/service";

export async function GET(req: NextRequest) {
  if (!getSessionUser()) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await ensurePlatform();
  const status = req.nextUrl.searchParams.get("status") ?? undefined;
  const jobs = await listJobsSvc(status, 50);
  return NextResponse.json({ jobs });
}

export async function POST(req: NextRequest) {
  if (!getSessionUser()) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await ensurePlatform();
  const body = (await req.json().catch(() => ({}))) as {
    id?: unknown;
    action?: unknown;
  };
  const id = typeof body.id === "string" ? body.id : "";
  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }
  if (body.action === "run") {
    const result = await runJobSvc(id);
    return NextResponse.json(result, { status: result.ok ? 200 : 400 });
  }
  const ok = await retryJobSvc(id);
  if (!ok) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}

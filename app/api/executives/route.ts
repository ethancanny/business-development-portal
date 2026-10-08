import { NextRequest, NextResponse } from "next/server";
import { getExecutives, saveExecutives, newId, logActivity } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { EXEC_STAGES, type Executive } from "@/lib/types";

export async function GET() {
  if (!getSessionUser()) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json(await getExecutives());
}

function parseIndustries(body: unknown): string[] {
  const list = Array.isArray(body)
    ? body
    : typeof body === "string"
      ? body.split(",")
      : [];
  return list.map((v) => String(v).trim()).filter((v) => v !== "");
}

export async function POST(req: NextRequest) {
  const user = getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  if (!body.name || String(body.name).trim() === "") {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  const execs = await getExecutives();
  const now = new Date().toISOString();
  const exec: Executive = {
    id: newId(),
    name: String(body.name).trim(),
    currentTitle: String(body.currentTitle ?? "").trim(),
    targetRole: String(body.targetRole ?? "").trim(),
    stage: EXEC_STAGES.includes(body.stage) ? body.stage : "Sourcing",
    background: String(body.background ?? ""),
    notes: String(body.notes ?? ""),
    owner: String(body.owner ?? "").trim() || user.email,
    industries: parseIndustries(body.industries),
    createdAt: now,
    updatedAt: now,
  };

  execs.push(exec);
  await saveExecutives(execs);
  await logActivity({
    type: "exec.created",
    actor: user.name,
    message: `${user.name} added ${exec.name} to executive sourcing`,
    dealId: null,
    execId: exec.id,
    dealName: null,
    execName: exec.name,
  });
  return NextResponse.json(exec, { status: 201 });
}

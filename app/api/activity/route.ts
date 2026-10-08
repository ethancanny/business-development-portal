import { NextRequest, NextResponse } from "next/server";
import { getActivity } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";

export async function GET(req: NextRequest) {
  if (!getSessionUser()) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const limit = Math.min(
    Math.max(Number(req.nextUrl.searchParams.get("limit")) || 100, 1),
    500
  );
  const events = await getActivity();
  return NextResponse.json(events.slice(0, limit));
}

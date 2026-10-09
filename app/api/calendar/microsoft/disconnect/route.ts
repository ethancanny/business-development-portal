import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { msDisconnect } from "@/lib/microsoft";

export async function POST() {
  if (!getSessionUser()) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    await msDisconnect();
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { getInteractions, saveInteractions } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";

interface Params {
  params: { id: string };
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const user = getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const items = await getInteractions();
  const idx = items.findIndex((i) => i.id === params.id);
  if (idx === -1) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  items.splice(idx, 1);
  await saveInteractions(items);
  return NextResponse.json({ ok: true });
}

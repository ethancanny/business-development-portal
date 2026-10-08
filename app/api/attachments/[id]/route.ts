import { NextRequest, NextResponse } from "next/server";
import { getAttachments, saveAttachments } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";

interface Params {
  params: { id: string };
}

// Download the file bytes.
export async function GET(_req: NextRequest, { params }: Params) {
  const user = getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const item = (await getAttachments()).find((a) => a.id === params.id);
  if (!item) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const bytes = Buffer.from(item.data, "base64");
  return new NextResponse(bytes, {
    headers: {
      "Content-Type": item.mimeType || "application/octet-stream",
      "Content-Disposition": `attachment; filename="${item.filename.replace(/"/g, "")}"`,
      "Content-Length": String(bytes.length),
    },
  });
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const user = getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const items = await getAttachments();
  const idx = items.findIndex((a) => a.id === params.id);
  if (idx === -1) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  items.splice(idx, 1);
  await saveAttachments(items);
  return NextResponse.json({ ok: true });
}

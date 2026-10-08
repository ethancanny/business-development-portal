import { NextRequest, NextResponse } from "next/server";
import {
  getAttachments,
  saveAttachments,
  getDeals,
  newId,
  logActivity,
} from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import type { Attachment } from "@/lib/types";

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB

export async function GET(req: NextRequest) {
  if (!getSessionUser()) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { searchParams } = new URL(req.url);
  const dealId = searchParams.get("dealId");
  let items = await getAttachments();
  if (dealId) items = items.filter((a) => a.dealId === dealId);
  // Never send file bytes in listings.
  return NextResponse.json(
    items.map(({ data, ...rest }) => rest)
  );
}

export async function POST(req: NextRequest) {
  const user = getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  if (!body.dealId || !body.filename || !body.data) {
    return NextResponse.json(
      { error: "dealId, filename and data are required" },
      { status: 400 }
    );
  }
  const data: string = String(body.data);
  // Rough byte size from base64 length.
  const size = Math.floor((data.length * 3) / 4);
  if (size > MAX_BYTES) {
    return NextResponse.json(
      { error: "File too large (5 MB max)" },
      { status: 400 }
    );
  }
  const now = new Date().toISOString();
  const attachment: Attachment = {
    id: newId(),
    dealId: String(body.dealId),
    filename: String(body.filename).slice(0, 200),
    mimeType: String(body.mimeType ?? "application/octet-stream"),
    size,
    data,
    createdAt: now,
  };
  const items = await getAttachments();
  items.push(attachment);
  await saveAttachments(items);

  const actor = user.name || user.email;
  const dealName =
    (await getDeals()).find((d) => d.id === attachment.dealId)?.companyName ??
    null;
  await logActivity({
    type: "deal.attachment",
    actor,
    message: `${actor} attached ${attachment.filename}${
      dealName ? ` to ${dealName}` : ""
    }`,
    dealId: attachment.dealId,
    execId: null,
    dealName,
    execName: null,
  });
  const { data: _d, ...rest } = attachment;
  return NextResponse.json(rest, { status: 201 });
}

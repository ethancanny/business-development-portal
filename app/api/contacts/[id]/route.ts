import { NextRequest, NextResponse } from "next/server";
import { getContacts, saveContacts } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";

interface Params {
  params: { id: string };
}

export async function PUT(req: NextRequest, { params }: Params) {
  const user = getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const contacts = await getContacts();
  const idx = contacts.findIndex((c) => c.id === params.id);
  if (idx === -1) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const prev = contacts[idx];
  const updated = {
    ...prev,
    name: body.name !== undefined ? String(body.name).trim() : prev.name,
    role: body.role !== undefined ? String(body.role).trim() : prev.role,
    email: body.email !== undefined ? String(body.email).trim() : prev.email,
    phone: body.phone !== undefined ? String(body.phone).trim() : prev.phone,
    linkedin:
      body.linkedin !== undefined ? String(body.linkedin).trim() : prev.linkedin,
    notes: body.notes !== undefined ? String(body.notes) : prev.notes,
    owner:
      body.owner !== undefined ? String(body.owner).trim() : prev.owner,
    updatedAt: new Date().toISOString(),
  };
  contacts[idx] = updated;
  await saveContacts(contacts);
  return NextResponse.json(updated);
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const user = getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const contacts = await getContacts();
  const idx = contacts.findIndex((c) => c.id === params.id);
  if (idx === -1) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  contacts.splice(idx, 1);
  await saveContacts(contacts);
  return NextResponse.json({ ok: true });
}

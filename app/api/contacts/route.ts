import { NextRequest, NextResponse } from "next/server";
import { getContacts, saveContacts, newId, logActivity } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import type { Contact } from "@/lib/types";

export async function GET() {
  if (!getSessionUser()) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json(await getContacts());
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
  const now = new Date().toISOString();
  const contact: Contact = {
    id: newId(),
    name: String(body.name).trim(),
    role: String(body.role ?? "").trim(),
    email: String(body.email ?? "").trim(),
    phone: String(body.phone ?? "").trim(),
    linkedin: String(body.linkedin ?? "").trim(),
    notes: String(body.notes ?? ""),
    dealId: body.dealId ? String(body.dealId) : null,
    execId: body.execId ? String(body.execId) : null,
    owner: String(body.owner ?? "").trim() || user.email,
    createdAt: now,
    updatedAt: now,
  };
  const contacts = await getContacts();
  contacts.push(contact);
  await saveContacts(contacts);
  const actor = user.name || user.email;
  await logActivity({
    type: "deal.contact",
    actor,
    message: `${actor} added contact ${contact.name}${
      contact.dealId ? " to a deal" : ""
    }`,
    dealId: contact.dealId,
    execId: contact.execId,
    dealName: null,
    execName: null,
  });
  return NextResponse.json(contact, { status: 201 });
}

import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { sendToUser } from "@/lib/push";

/** Send a test notification to the caller. Bypasses quiet hours and
 * caps (but not the subscription itself); the send is logged. */
export async function POST() {
  const user = getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const result = await sendToUser(user.email, {
    type: "test",
    entityKey: `test-${Date.now()}`,
    genericTitle: "Test notification",
    genericBody: "Canny Capital Portal — push is working",
    detailTitle: "Test notification",
    detailBody: "Canny Capital Portal — push is working",
    url: "/settings",
    bypass: true,
  });
  return NextResponse.json({ ok: result.status === "sent", ...result });
}

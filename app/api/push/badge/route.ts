import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getDealFlow, getTasks } from "@/lib/db";
import { phoenixDate } from "@/lib/push-db";

/** App-icon badge count: follow-ups due today or overdue (same Task
 * store the Overview reads) + Activity items still awaiting triage
 * (deal_flow status "new"). */
export async function GET() {
  if (!getSessionUser()) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const today = phoenixDate();
  const [tasks, flow] = await Promise.all([getTasks(), getDealFlow()]);
  const dueFollowups = tasks.filter(
    (t) => !t.done && t.dueDate !== "" && t.dueDate <= today
  ).length;
  const newItems = flow.filter((i) => i.status === "new").length;
  return NextResponse.json({ count: dueFollowups + newItems, dueFollowups, newItems });
}

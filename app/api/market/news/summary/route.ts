import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getNewsRawSnippet, setNewsSummary } from "@/lib/news-db";
import { logSync } from "@/lib/market-db";

/**
 * Agent-written news summaries (redesign Wave 2, licensing-critical).
 * POST /api/market/news/summary { id, summary }
 *
 * Summaries must be OUR OWN WORDS: at most 2 sentences, at most 400
 * characters, and never a copy of the publisher's text. The copy guard
 * rejects any summary sharing a run of 8+ consecutive words with the
 * story's raw RSS snippet; every rejection is logged to mi_sync_log
 * (job `intel-news-summary`) so a pattern of rejects is visible.
 * Auth: portal session OR Bearer CRON_SECRET (middleware lets this path
 * through; the check happens here).
 */
function authorized(req: NextRequest): boolean {
  if (getSessionUser()) return true;
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

function wordRuns(text: string, n: number): Set<string> {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  const out = new Set<string>();
  for (let i = 0; i + n <= words.length; i++) out.add(words.slice(i, i + n).join(" "));
  return out;
}

function sharesWordRun(summary: string, source: string, n = 8): boolean {
  const src = wordRuns(source, n);
  if (!src.size) return false;
  for (const run of Array.from(wordRuns(summary, n))) {
    if (src.has(run)) return true;
  }
  return false;
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = (await req.json().catch(() => ({}))) as { id?: unknown; summary?: unknown };
  const id = String(body.id ?? "");
  const summary = String(body.summary ?? "").trim().replace(/\s+/g, " ");
  if (!id || !summary) {
    return NextResponse.json({ error: "Body must be { id, summary }" }, { status: 400 });
  }

  const reject = async (reason: string) => {
    await logSync("intel-news-summary", "check", 0, `rejected summary for ${id}: ${reason}`.slice(0, 500)).catch(() => undefined);
    return NextResponse.json({ error: `Summary rejected: ${reason}` }, { status: 400 });
  };

  if (summary.length > 400) return reject(`over 400 characters (${summary.length})`);
  const sentences = summary.split(/[.!?]+/).map((s) => s.trim()).filter(Boolean);
  if (sentences.length > 2) return reject(`over 2 sentences (${sentences.length})`);

  const snippet = await getNewsRawSnippet(id);
  if (snippet === null) {
    return NextResponse.json({ error: "News item not found" }, { status: 404 });
  }
  if (sharesWordRun(summary, snippet)) {
    return reject("shares an 8+ word run with the publisher snippet — summaries must be original wording");
  }

  const ok = await setNewsSummary(id, summary);
  if (!ok) return NextResponse.json({ error: "News item not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}

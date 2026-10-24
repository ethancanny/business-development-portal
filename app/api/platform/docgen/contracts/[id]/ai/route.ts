import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { ensurePlatform } from "@/lib/platform/service";
import { DocGenError } from "@/lib/docgen/generate";
import { ContractAiError } from "@/lib/docgen/ai";
import {
  aiSummarizeChanges,
  aiSummarizeContract,
} from "@/lib/docgen/contracts";

/**
 * AI assistance for a contract (guardrail-bound): kind "summary"
 * summarizes the current version; kind "changes" summarizes the diff
 * between two versions. AI never drafts contract language. Output
 * is always labeled "AI draft — for attorney review".
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const user = getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await ensurePlatform();
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const kind = typeof body.kind === "string" ? body.kind : "";
  const actor = user.name || user.email;
  try {
    if (kind === "summary") {
      const result = await aiSummarizeContract(params.id, actor);
      return NextResponse.json(result);
    }
    if (kind === "changes") {
      const from = Number(body.from ?? 0);
      const to = Number(body.to ?? 0);
      if (!from || !to || from === to) {
        return NextResponse.json(
          { error: "from and to version numbers are required and must differ" },
          { status: 400 }
        );
      }
      const result = await aiSummarizeChanges(params.id, from, to, actor);
      return NextResponse.json(result);
    }
    return NextResponse.json(
      { error: "kind must be 'summary' or 'changes'" },
      { status: 400 }
    );
  } catch (err) {
    if (err instanceof ContractAiError || err instanceof DocGenError) {
      const code = err instanceof ContractAiError ? err.error : err.error;
      const status =
        code === "ai_not_configured"
          ? 409
          : code === "contract_not_found"
            ? 404
            : 400;
      return NextResponse.json({ error: code }, { status });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

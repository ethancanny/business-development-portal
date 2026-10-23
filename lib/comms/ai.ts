import { getSettings } from "../docint/service";
import type { ReportRow, NarrativeStatement } from "./service";

/**
 * AI narrative generation (Part 12).
 *
 * Provider rules: any chat-completions provider whose terms offer
 * no-training / limited-retention on API traffic works — OpenAI API,
 * Anthropic, or Azure OpenAI are the named options. The key comes ONLY
 * from the COMMS_AI_API_KEY env var; endpoint/model are env-overridable
 * (defaults target the OpenAI-compatible chat completions shape).
 *
 * Honesty rules:
 * - No provider key → narrative_status 'setup_required'. Text is NEVER
 *   fabricated as a fallback.
 * - A deal with document intelligence disabled (docint getSettings)
 *   → 'blocked_disabled'; the provider is never called.
 * - Statements must cite appendix figures; any statement whose
 *   figureKeys are not a subset of the report's appendix keys is
 *   dropped before persistence.
 * - Logs carry ids and counts only — never figures or statement text.
 */

const DEFAULT_ENDPOINT = "https://api.openai.com/v1/chat/completions";
const DEFAULT_MODEL = "gpt-4o-mini";
const TIMEOUT_MS = 30_000;

const SETUP_STEPS = [
  "Pick a provider with no-training / limited-retention API terms (OpenAI API, Anthropic, or Azure OpenAI).",
  "Set COMMS_AI_API_KEY in the portal's environment (Vercel env vars) — keys are read from env only, never stored in the database.",
  "Optionally set COMMS_AI_ENDPOINT and COMMS_AI_MODEL to point at a non-default provider or model.",
  "Redeploy/restart so the new env vars are picked up, then use 'Generate with AI' on a report with a narrative block.",
];

export interface AiStatus {
  configured: boolean;
  provider: "openai-compatible" | null;
  detail: string;
  setupSteps: string[];
}

function aiKey(): string {
  return (process.env.COMMS_AI_API_KEY ?? "").trim();
}

export function aiStatus(): AiStatus {
  const configured = Boolean(aiKey());
  return {
    configured,
    provider: configured ? "openai-compatible" : null,
    detail: configured
      ? `Configured (model ${process.env.COMMS_AI_MODEL || DEFAULT_MODEL}).`
      : "COMMS_AI_API_KEY is not set — AI narrative generation is unavailable and no text will be fabricated.",
    setupSteps: configured ? [] : SETUP_STEPS,
  };
}

export interface GenerateNarrativeResult {
  status: string;
  detail?: string;
  statementCount?: number;
}

function narrativeBlocksOf(report: ReportRow) {
  return (report.render?.blocks ?? []).filter((b) => b.type === "narrative");
}

/**
 * Generate narrative statements for a report's narrative block(s).
 * The validated statements are persisted as a NEW report version via
 * service.updateReportNarrative (lazy literal import — service.ts
 * imports aiStatus from here, so a static value import would cycle).
 * Per the contract's demand shape ({statements:[...]}), statements are
 * written to the FIRST narrative block; additional narrative blocks
 * are left untouched.
 */
export async function generateNarrative(
  report: ReportRow,
  actor: string
): Promise<GenerateNarrativeResult> {
  const { updateReportNarrative, setNarrativeStatus } = await import(
    "./service"
  );
  const blocks = narrativeBlocksOf(report);
  if (!blocks.length) {
    return { status: "none" };
  }

  // Per-deal document-intelligence toggle gates ALL AI processing for
  // the deal — narrative generation included.
  if (report.dealId) {
    try {
      const settings = await getSettings(report.dealId);
      if (settings.enabled === false) {
        await setNarrativeStatus(report.id, "blocked_disabled", actor);
        return {
          status: "blocked_disabled",
          detail:
            "Document intelligence is disabled for this deal, so AI narrative generation is blocked.",
        };
      }
    } catch (err) {
      console.error(
        "[comms:ai] docint settings check failed for report",
        report.id,
        err instanceof Error ? err.message : String(err)
      );
    }
  }

  if (!aiKey()) {
    await setNarrativeStatus(report.id, "setup_required", actor);
    return {
      status: "setup_required",
      detail:
        "COMMS_AI_API_KEY is not set. Set it (and optionally COMMS_AI_ENDPOINT / COMMS_AI_MODEL) to enable AI narrative generation.",
    };
  }

  const appendixKeys = new Set(report.appendix.map((f) => f.key));
  const figureList = report.appendix.map((f) => ({
    key: f.key,
    label: f.label,
    value: f.value,
    format: f.format,
  }));
  const blockContext = (report.render?.blocks ?? [])
    .filter((b) => b.type !== "narrative")
    .map((b) => ({
      key: b.key,
      type: b.type,
      heading: b.heading,
      dataStatus: b.dataStatus,
      figureKeys: (b.figures ?? []).map((f) => f.key),
    }));

  const systemPrompt = [
    "You write short, factual narrative statements for a private-equity investor report.",
    "Every statement MUST cite the appendix figures it relies on.",
    "Use ONLY the figures provided — never invent numbers, names, or events.",
    "Respond with JSON only, exactly this shape:",
    '{"statements":[{"text":"...","figureKeys":["<appendix key>", ...]}]}',
    "Write 3-6 statements. Each statement is one or two sentences.",
  ].join("\n");
  const userPrompt = JSON.stringify({
    reportTitle: report.title,
    purpose: report.purpose,
    audience: report.audience,
    narrativeBlockHeadings: blocks.map((b) => b.heading),
    blocks: blockContext,
    figures: figureList,
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(process.env.COMMS_AI_ENDPOINT || DEFAULT_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${aiKey()}`,
      },
      body: JSON.stringify({
        model: process.env.COMMS_AI_MODEL || DEFAULT_MODEL,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        response_format: { type: "json_object" },
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`AI provider responded ${res.status}`);
    }
    const data = (await res.json().catch(() => null)) as {
      choices?: { message?: { content?: string } }[];
    } | null;
    const content = data?.choices?.[0]?.message?.content ?? "";
    const parsed = JSON.parse(content) as {
      statements?: { text?: unknown; figureKeys?: unknown }[];
    };
    const raw = Array.isArray(parsed.statements) ? parsed.statements : [];
    const statements: NarrativeStatement[] = [];
    for (const s of raw) {
      const text = typeof s.text === "string" ? s.text.trim() : "";
      const keys = Array.isArray(s.figureKeys)
        ? s.figureKeys.map((k) => String(k))
        : [];
      if (!text || !keys.length) continue;
      // Every cited figure must exist in the report appendix.
      if (!keys.every((k) => appendixKeys.has(k))) continue;
      statements.push({ text: text.slice(0, 600), figureKeys: keys });
      if (statements.length >= 12) break;
    }
    if (!statements.length) {
      throw new Error("AI provider returned no valid statements");
    }
    const target = blocks[0];
    await updateReportNarrative(
      report.id,
      { [target.key]: statements },
      actor,
      "ready"
    );
    console.log(
      `[comms:ai] narrative ready for report ${report.id}: ${statements.length} statement(s)`
    );
    return { status: "ready", statementCount: statements.length };
  } catch (err) {
    const detail =
      err instanceof Error ? err.message.slice(0, 300) : String(err).slice(0, 300);
    console.error(
      "[comms:ai] narrative generation failed for report",
      report.id,
      detail
    );
    try {
      await setNarrativeStatus(report.id, "error", actor);
    } catch {
      /* status write is best-effort on the error path */
    }
    return { status: "error", detail };
  } finally {
    clearTimeout(timer);
  }
}

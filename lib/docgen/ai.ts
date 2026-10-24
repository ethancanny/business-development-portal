import { aiStatus } from "../comms/ai";

/**
 * AI assistance for contracts (Oct 24, 2026) — GUARDRAIL-BOUND.
 *
 * Ethan's rule: AI may ONLY (a) summarize a contract and (b)
 * summarize what changed between two versions. It must NEVER draft
 * contract language — there is deliberately no drafting function in
 * this module. Every output is stored and rendered under the label
 * "AI draft — for attorney review".
 *
 * Provider: the portal's COMMS_AI provider (openai-compatible chat
 * completions; COMMS_AI_API_KEY / COMMS_AI_ENDPOINT / COMMS_AI_MODEL
 * env vars — the same plumbing lib/comms/ai.ts uses for report
 * narratives). aiStatus() from lib/comms/ai is the single source of
 * truth for "configured". No key → actions hide and the API refuses;
 * text is never fabricated as a fallback.
 */

export const AI_DRAFT_LABEL = "AI draft — for attorney review";

const DEFAULT_ENDPOINT = "https://api.openai.com/v1/chat/completions";
const DEFAULT_MODEL = "gpt-4o-mini";
const TIMEOUT_MS = 45_000;
const MAX_INPUT_CHARS = 24_000;

export function contractAiConfigured(): boolean {
  return aiStatus().configured;
}

export class ContractAiError extends Error {
  error: string;
  constructor(code: string) {
    super(code);
    this.name = "ContractAiError";
    this.error = code;
  }
}

async function chatComplete(system: string, user: string): Promise<string> {
  const key = (process.env.COMMS_AI_API_KEY ?? "").trim();
  if (!key) throw new ContractAiError("ai_not_configured");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(process.env.COMMS_AI_ENDPOINT || DEFAULT_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: process.env.COMMS_AI_MODEL || DEFAULT_MODEL,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user.slice(0, MAX_INPUT_CHARS) },
        ],
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new ContractAiError(`ai_provider_error_${res.status}`);
    }
    const data = (await res.json().catch(() => null)) as {
      choices?: { message?: { content?: string } }[];
    } | null;
    const content = (data?.choices?.[0]?.message?.content ?? "").trim();
    if (!content) throw new ContractAiError("ai_empty_response");
    return content.slice(0, 6000);
  } catch (err) {
    if (err instanceof ContractAiError) throw err;
    throw new ContractAiError(
      err instanceof Error && err.name === "AbortError"
        ? "ai_timeout"
        : "ai_request_failed"
    );
  } finally {
    clearTimeout(timer);
  }
}

/** Summarize a contract's text. Summary only — never new language. */
export async function summarizeContractText(text: string): Promise<string> {
  const system = [
    "You summarize legal documents for a deal team. Summarize ONLY what the document says.",
    "Cover: document type, the parties, the subject company/asset, key economic terms as stated, key dates as stated, exclusivity/confidentiality terms as stated, and any signature blocks present.",
    "Never draft, propose, or rewrite contract language. Never add terms that are not in the text. If a fact is not in the text, do not mention it.",
    "Write plain prose, 2 short paragraphs at most, no headings, no bullet lists.",
  ].join("\n");
  return chatComplete(system, text);
}

/** Summarize a precomputed line diff between two versions. */
export async function summarizeVersionChanges(
  changedLines: string[],
  fromVersion: number,
  toVersion: number
): Promise<string> {
  const system = [
    "You describe changes between two versions of a legal document, from a line diff ('-' lines were removed, '+' lines were added).",
    "Describe ONLY the changes shown: what was added, removed, or altered in substance (amounts, dates, names, obligations).",
    "Never draft, propose, or rewrite contract language. Never speculate about why a change was made.",
    "Write plain prose, 1-2 short paragraphs, no headings, no bullet lists. If the diff shows no substantive change, say so in one sentence.",
  ].join("\n");
  const user = [
    `Changes from version ${fromVersion} to version ${toVersion}:`,
    ...changedLines,
  ].join("\n");
  return chatComplete(system, user);
}

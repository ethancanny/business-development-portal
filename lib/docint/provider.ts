import { getDocument, readDocumentBytes } from "../dataroom/documents";
import { getDocumentText } from "../dataroom/extract";

/**
 * Document intelligence providers (Part 5B).
 *
 * Two providers behind one interface:
 * - azureProvider ("azure-document-intelligence") — used when BOTH
 *   AZURE_DOCINT_ENDPOINT and AZURE_DOCINT_KEY are set in the
 *   environment. Keys are read from process.env only, never logged,
 *   never stored.
 * - localProvider ("local-patterns") — pattern extraction over the
 *   text the Phase 3 extractor already produced for the document
 *   (lib/dataroom/extract.ts). No external calls. Its fields are
 *   low-confidence by design and always land as 'provisional'.
 *
 * HOUSE RULE (Phase 5 Item 0 fix): the production minifier degrades
 * `\b` inside string-built regexes to a backspace character. Every
 * pattern in this file is a regex LITERAL — never build a RegExp
 * from a string here.
 */

export interface ExtractedField {
  fieldKey: string;
  label: string;
  valueText: string;
  confidence: number;
  page: number | null;
  passage: string;
}

export interface DocintAnalyzeInput {
  documentId: string;
  fileName: string;
  mime: string;
}

export interface DocintAnalyzeResult {
  pages: number | null;
  fields: ExtractedField[];
}

export interface DocintProvider {
  name: string;
  analyze(input: DocintAnalyzeInput): Promise<DocintAnalyzeResult>;
}

/** The contract terms this module extracts, in display order. */
export const FIELD_DEFS: Array<{ key: string; label: string }> = [
  { key: "counterparty", label: "Counterparty" },
  { key: "contract_type", label: "Contract type" },
  { key: "effective_date", label: "Effective date" },
  { key: "term", label: "Term" },
  { key: "expiry_date", label: "Expiry date" },
  { key: "rent", label: "Rent" },
  { key: "escalations", label: "Escalations" },
  { key: "renewal_options", label: "Renewal options" },
  { key: "termination_options", label: "Termination options" },
  { key: "change_of_control", label: "Change of control" },
  { key: "exclusivity", label: "Exclusivity" },
  { key: "right_of_first_refusal", label: "Right of first refusal" },
];

export function labelForField(fieldKey: string): string {
  return FIELD_DEFS.find((d) => d.key === fieldKey)?.label ?? fieldKey;
}

export const AZURE_NO_TRAINING_DETAIL =
  "This provider is Azure AI Document Intelligence (Microsoft). " +
  "Documents are sent to the configured Azure resource only so it can " +
  "return extraction results: Microsoft does not train models on " +
  "customer documents, and customer data is not used to improve " +
  "Microsoft's models, per Microsoft's Azure AI data-privacy terms " +
  "(data, privacy and security terms for Azure AI services). " +
  "Extracted fields are stored in the portal as provisional until a " +
  "partner reviews them.";

const LOCAL_DETAIL =
  "Local pattern extraction over the document text already extracted " +
  "by the portal (no external calls, nothing leaves the portal). " +
  "Matches are heuristic and low-confidence by design; every field " +
  "lands as provisional and needs human review.";

const AZURE_UNCONFIGURED_DETAIL =
  "Azure AI Document Intelligence is not configured " +
  "(AZURE_DOCINT_ENDPOINT / AZURE_DOCINT_KEY are not set), so the " +
  "local pattern provider is active instead.";

function azureConfigured(): boolean {
  return Boolean(
    process.env.AZURE_DOCINT_ENDPOINT && process.env.AZURE_DOCINT_KEY
  );
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/* --------------------------- Azure provider --------------------------- */

interface AzureElement {
  content?: string;
  boundingRegions?: Array<{ pageNumber?: number }>;
}

interface AzureKeyValuePair {
  key?: AzureElement | string;
  value?: AzureElement | string;
  confidence?: number;
}

interface AzureParagraph {
  content?: string;
  boundingRegions?: Array<{ pageNumber?: number }>;
}

interface AzureAnalyzeResult {
  pages?: unknown[];
  keyValuePairs?: AzureKeyValuePair[];
  paragraphs?: AzureParagraph[];
}

function elementContent(el: AzureElement | string | undefined): string {
  if (!el) return "";
  if (typeof el === "string") return el;
  return typeof el.content === "string" ? el.content : "";
}

function elementPage(el: AzureElement | string | undefined): number | null {
  if (!el || typeof el === "string") return null;
  const page = el.boundingRegions?.[0]?.pageNumber;
  return typeof page === "number" && isFinite(page) ? page : null;
}

/**
 * Map a raw Azure key/value key (lowercased) to a FIELD_DEFS key.
 * Check order matters: "termination" contains "term", so the more
 * specific clause keys are tested before the generic ones.
 */
function mapAzureKeyToField(rawKey: string): string | null {
  const k = rawKey.toLowerCase();
  if (!k) return null;
  if (k.includes("termination")) return "termination_options";
  if (k.includes("change of control") || k.includes("assignment"))
    return "change_of_control";
  if (k.includes("right of first refusal") || k.includes("rofr"))
    return "right_of_first_refusal";
  if (k.includes("exclusiv")) return "exclusivity";
  if (k.includes("renewal") || k.includes("renew")) return "renewal_options";
  if (k.includes("escalat") || k.includes("increase")) return "escalations";
  if (
    k.includes("expiration") ||
    k.includes("expiry") ||
    k.includes("expires")
  )
    return "expiry_date";
  if (k.includes("effective") || k.includes("commencement"))
    return "effective_date";
  if (k.includes("contract type") || k.includes("agreement type"))
    return "contract_type";
  if (k.includes("rent")) return "rent";
  if (
    k.includes("counterparty") ||
    k.includes("landlord") ||
    k.includes("tenant") ||
    k.includes("lessee") ||
    k.includes("lessor")
  )
    return "counterparty";
  if (k.includes("term") || k.includes("duration")) return "term";
  return null;
}

/** Clause keywords scanned in paragraphs when KV mapping missed a field. */
const PARAGRAPH_CLAUSES: Array<{ fieldKey: string; needles: string[] }> = [
  { fieldKey: "renewal_options", needles: ["renewal", "renew"] },
  {
    fieldKey: "termination_options",
    needles: ["termination", "terminate"],
  },
  { fieldKey: "change_of_control", needles: ["change of control"] },
  { fieldKey: "exclusivity", needles: ["exclusiv"] },
  {
    fieldKey: "right_of_first_refusal",
    needles: ["right of first refusal"],
  },
];

export const azureProvider: DocintProvider = {
  name: "azure-document-intelligence",
  async analyze(input: DocintAnalyzeInput): Promise<DocintAnalyzeResult> {
    const endpoint = (process.env.AZURE_DOCINT_ENDPOINT ?? "").replace(
      /\/+$/,
      ""
    );
    const key = process.env.AZURE_DOCINT_KEY ?? "";
    if (!endpoint || !key) throw new Error("azure_not_configured");

    // Bytes come only through the dataroom documents service; the
    // provider never touches storage or Postgres for file content.
    const doc = await getDocument(input.documentId);
    if (!doc) throw new Error("bytes_unavailable");
    let bytes: Buffer;
    try {
      const read = await readDocumentBytes(doc);
      bytes = read.bytes;
    } catch {
      throw new Error("bytes_unavailable");
    }
    if (!bytes || !bytes.length) throw new Error("bytes_unavailable");

    const mime =
      input.mime || doc.mime || "application/octet-stream";
    const analyzeUrl =
      `${endpoint}/documentintelligence/documentModels/` +
      `prebuilt-layout:analyze?api-version=2024-11-30`;
    const postRes = await fetch(analyzeUrl, {
      method: "POST",
      headers: {
        "Ocp-Apim-Subscription-Key": key,
        "Content-Type": mime,
      },
      body: bytes as unknown as BodyInit,
    });
    if (postRes.status !== 202) {
      throw new Error(`azure_http_${postRes.status}`);
    }
    const operationUrl =
      postRes.headers.get("Operation-Location") ??
      postRes.headers.get("operation-location");
    if (!operationUrl) throw new Error("azure_no_operation_location");

    let analyzeResult: AzureAnalyzeResult | null = null;
    for (let poll = 0; poll < 30; poll += 1) {
      await sleep(2000);
      const pollRes = await fetch(operationUrl, {
        method: "GET",
        headers: { "Ocp-Apim-Subscription-Key": key },
      });
      if (!pollRes.ok) throw new Error(`azure_http_${pollRes.status}`);
      const payload = (await pollRes.json()) as {
        status?: string;
        analyzeResult?: AzureAnalyzeResult;
      };
      const status = (payload.status ?? "").toLowerCase();
      if (status === "succeeded") {
        analyzeResult = payload.analyzeResult ?? {};
        break;
      }
      if (status === "failed") throw new Error("azure_analysis_failed");
      // "running" / "notStarted" — keep polling.
    }
    if (!analyzeResult) throw new Error("azure_poll_timeout");

    const pages = Array.isArray(analyzeResult.pages)
      ? analyzeResult.pages.length
      : null;

    const byKey = new Map<string, ExtractedField>();
    for (const pair of analyzeResult.keyValuePairs ?? []) {
      const fieldKey = mapAzureKeyToField(elementContent(pair.key));
      if (!fieldKey || byKey.has(fieldKey)) continue;
      const valueText = elementContent(pair.value).trim();
      if (!valueText) continue;
      byKey.set(fieldKey, {
        fieldKey,
        label: labelForField(fieldKey),
        valueText,
        confidence:
          typeof pair.confidence === "number" && isFinite(pair.confidence)
            ? pair.confidence
            : 0.5,
        page: elementPage(pair.value),
        passage: valueText,
      });
    }

    // Paragraph fallback for clause fields the KV pass missed.
    const paragraphs = analyzeResult.paragraphs ?? [];
    for (const clause of PARAGRAPH_CLAUSES) {
      if (byKey.has(clause.fieldKey)) continue;
      for (const para of paragraphs) {
        const content = (para.content ?? "").trim();
        if (!content) continue;
        const lower = content.toLowerCase();
        if (!clause.needles.some((n) => lower.includes(n))) continue;
        const passage = content.slice(0, 400);
        const pageRaw = para.boundingRegions?.[0]?.pageNumber;
        byKey.set(clause.fieldKey, {
          fieldKey: clause.fieldKey,
          label: labelForField(clause.fieldKey),
          valueText: passage,
          confidence: 0.5,
          page:
            typeof pageRaw === "number" && isFinite(pageRaw)
              ? pageRaw
              : null,
          passage,
        });
        break;
      }
    }

    const fields = FIELD_DEFS.map((d) => byKey.get(d.key)).filter(
      (f): f is ExtractedField => Boolean(f)
    );
    return { pages, fields };
  },
};

/* --------------------------- Local provider --------------------------- */

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function firstSentence(
  sentences: string[],
  test: (s: string) => boolean
): string | null {
  for (const s of sentences) {
    if (test(s)) return s;
  }
  return null;
}

const DATE_LIKE =
  /(\d{1,2}\/\d{1,2}\/\d{2,4}|\d{4}-\d{2}-\d{2}|(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4})/i;

export const localProvider: DocintProvider = {
  name: "local-patterns",
  async analyze(input: DocintAnalyzeInput): Promise<DocintAnalyzeResult> {
    const dt = await getDocumentText(input.documentId);
    const text = (dt.text ?? "").trim();
    if (!text) return { pages: null, fields: [] };
    const sentences = splitSentences(text);
    const found = new Map<string, ExtractedField>();
    const add = (
      fieldKey: string,
      sentence: string | null,
      confidence: number
    ) => {
      if (!sentence || found.has(fieldKey)) return;
      const value = sentence.trim().slice(0, 300);
      if (!value) return;
      found.set(fieldKey, {
        fieldKey,
        label: labelForField(fieldKey),
        valueText: value,
        confidence: Math.min(confidence, 0.65),
        page: null,
        passage: value,
      });
    };

    // Counterparty — the sentence naming landlord/tenant/lessor/lessee.
    add(
      "counterparty",
      firstSentence(sentences, (s) => /landlord|tenant|lessor|lessee/i.test(s)),
      0.45
    );

    // Contract type — an explicit "<X> Agreement" instrument phrase.
    add(
      "contract_type",
      firstSentence(sentences, (s) =>
        /lease agreement|services agreement|service agreement|license agreement|purchase agreement|employment agreement|loan agreement|management agreement/i.test(
          s
        )
      ),
      0.45
    );

    // Effective date — a date in a sentence anchored on
    // effective / commencement / dated.
    add(
      "effective_date",
      firstSentence(
        sentences,
        (s) => /effective|commencement|dated/i.test(s) && DATE_LIKE.test(s)
      ),
      0.55
    );

    // Term — "term of N years/months"; fall back to a sentence that
    // bounds the term by an expiry / through date.
    add(
      "term",
      firstSentence(sentences, (s) =>
        /term of\s+\d+\s*(years?|months?)/i.test(s)
      ) ??
        firstSentence(
          sentences,
          (s) => /(expires on|through)\s/i.test(s) && DATE_LIKE.test(s)
        ),
      0.55
    );

    // Expiry date — a date in a sentence anchored on expiry language.
    add(
      "expiry_date",
      firstSentence(
        sentences,
        (s) => /expir/i.test(s) && DATE_LIKE.test(s)
      ),
      0.55
    );

    // Rent — a $ amount in a sentence about rent / lease payments.
    add(
      "rent",
      firstSentence(
        sentences,
        (s) => /rent|lease payment/i.test(s) && /\$\s*\d/.test(s)
      ),
      0.55
    );

    // Escalations — escalation language; a stated % makes it an
    // amount-anchored match (0.55), bare presence is 0.45.
    const escSentence = firstSentence(sentences, (s) =>
      /escalat|increase of\s+\d|CPI/i.test(s)
    );
    add(
      "escalations",
      escSentence,
      escSentence && /\d+(\.\d+)?\s*%/.test(escSentence) ? 0.55 : 0.45
    );

    // Renewal — renewal / extension-option language.
    add(
      "renewal_options",
      firstSentence(sentences, (s) => /renew|extension option/i.test(s)),
      0.45
    );

    // Termination — termination language tied to notice; fall back to
    // termination language alone when no notice sentence exists.
    add(
      "termination_options",
      firstSentence(
        sentences,
        (s) => /terminat/i.test(s) && /notice/i.test(s)
      ) ?? firstSentence(sentences, (s) => /terminat/i.test(s)),
      0.45
    );

    // Change of control / assignment.
    add(
      "change_of_control",
      firstSentence(sentences, (s) =>
        /change of control|assignment/i.test(s)
      ),
      0.45
    );

    // Exclusivity.
    add(
      "exclusivity",
      firstSentence(sentences, (s) => /exclusiv/i.test(s)),
      0.45
    );

    // Right of first refusal.
    add(
      "right_of_first_refusal",
      firstSentence(sentences, (s) =>
        /right of first refusal|ROFR|ROFO/i.test(s)
      ),
      0.45
    );

    const fields = FIELD_DEFS.map((d) => found.get(d.key)).filter(
      (f): f is ExtractedField => Boolean(f)
    );
    return { pages: null, fields };
  },
};

/* ------------------------------ selection ----------------------------- */

export function getActiveProvider(): DocintProvider {
  return azureConfigured() ? azureProvider : localProvider;
}

export async function getDocintStatus(): Promise<{
  activeProvider: string;
  azure: { configured: boolean; detail: string };
  local: { configured: true; detail: string };
}> {
  const configured = azureConfigured();
  return {
    activeProvider: configured ? azureProvider.name : localProvider.name,
    azure: {
      configured,
      detail: configured ? AZURE_NO_TRAINING_DETAIL : AZURE_UNCONFIGURED_DETAIL,
    },
    local: { configured: true, detail: LOCAL_DETAIL },
  };
}

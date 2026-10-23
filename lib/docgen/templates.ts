import { sql, newId, str, isoOrNull } from "../platform/db";
import { logUsage } from "../platform/usage";
import { ensureDocgenSchema, type DocgenTemplateRow } from "./schema";

/**
 * Document templates (Phase 10) — seed catalog + CRUD.
 *
 * Six professional templates ship as seeds, inserted idempotently
 * (ON CONFLICT (key) DO NOTHING via the partial unique index's
 * arbiter inference on plain INSERT ... ON CONFLICT DO NOTHING) the
 * first time any docgen surface is touched. Seeds are never
 * overwritten afterwards: a partner's edits to a seeded template
 * survive restarts. Custom templates created via the API get a
 * slug key derived from the name when none is supplied.
 *
 * Merge fields available in every body (built in generate.ts —
 * anything else renders as "—" and is reported unresolved):
 *   deal.companyName, deal.industry, deal.city, deal.stage,
 *   deal.contactName, deal.contactEmail, deal.broker, deal.owner,
 *   deal.askingPrice, deal.dealValue, deal.revenue, deal.ebitda,
 *   company.name, company.city,
 *   fin.latestRevenue, fin.latestEbitda, fin.latestPeriodEnd,
 *   firm.name, date.today, date.year
 * Bracketed blanks like [●] are intentional template blanks where
 * no portal data source exists (exclusivity days, percentages) —
 * they are NOT fabricated values and stay visible for hand edits.
 */

export interface SeedTemplate {
  key: string;
  name: string;
  description: string;
  body: string;
}

const LOI_BODY = `LETTER OF INTENT

{{date.today}}

VIA EMAIL

{{deal.contactName}}
{{deal.companyName}}
{{deal.city}}, Arizona
Email: {{deal.contactEmail}}

Re: Proposed acquisition of {{deal.companyName}} (the "Company")

Dear {{deal.contactName}}:

This letter of intent (this "LOI") sets out the principal terms on which {{firm.name}} ("Buyer") proposes to acquire all or substantially all of the business and assets (or equity interests) of {{company.name}}, a company located in {{company.city}}, Arizona, operating in the {{deal.industry}} industry (the "Transaction"). The Company is currently in the "{{deal.stage}}" stage of Buyer's evaluation pipeline. Broker / intermediary of record: {{deal.broker}}.

HEADLINE TERMS

Purchase price: {{deal.askingPrice}} (the asking price currently contemplated for the Company).
Indicative enterprise value: {{deal.dealValue}}.
Most recent revenue: {{deal.revenue}}.
Most recent EBITDA: {{deal.ebitda}}.
Latest reported financial period: revenue {{fin.latestRevenue}}, EBITDA {{fin.latestEbitda}}, for the period ending {{fin.latestPeriodEnd}}.

The purchase price would be payable at closing as follows: [●]% in cash at closing, [●]% by way of a seller note on market terms, and [●]% as rollover equity / earnout, in each case as further described in the definitive agreement. The Transaction would be structured as an asset purchase or equity purchase as Buyer and the sellers mutually determine after tax and legal review.

STRUCTURE SUMMARY

Buyer expects the definitive agreement to include customary representations, warranties, covenants, and closing conditions, a working-capital adjustment mechanism, an escrow or holdback of [●]% of the purchase price for [●] months, and employment or consulting arrangements with key personnel to be agreed during diligence.

EXCLUSIVITY AND DILIGENCE

In consideration of the time and expense Buyer will incur, the sellers agree that for a period of [●] days from acceptance of this LOI (the "Exclusivity Period"), neither the Company nor its representatives will solicit, entertain, or engage in discussions regarding any alternative sale, investment, or recapitalization of the Company. Buyer requests a diligence period of [●] days from acceptance, with reasonable access to the Company's books, records, facilities, customers (as mutually agreed), and personnel.

BINDING AND NON-BINDING PROVISIONS

Except for the provisions regarding exclusivity, confidentiality, expenses, and governing law, which are binding, this LOI is an expression of intent only and does not create a binding obligation to consummate the Transaction. This LOI is governed by the laws of the State of Arizona. Each party bears its own costs, except as otherwise agreed in writing.

If the foregoing reflects your understanding, please sign below and return a copy to {{deal.owner}} at {{firm.name}}.

AGREED AND ACCEPTED — SELLER:

{{deal.companyName}}

By: ___________________________________
Name: {{deal.contactName}}
Title: [●]
Date: [●]

AGREED AND ACCEPTED — BUYER:

{{firm.name}}

By: ___________________________________
Name: {{deal.owner}}
Title: Partner
Date: {{date.today}}`;

const IOI_BODY = `INDICATION OF INTEREST

{{date.today}}

{{deal.contactName}}
{{deal.companyName}}
{{deal.city}}, Arizona
Email: {{deal.contactEmail}}

Re: Indication of interest — {{deal.companyName}}

Dear {{deal.contactName}}:

{{firm.name}} is pleased to submit this indication of interest (this "IOI") with respect to a potential acquisition of {{company.name}} (the "Company"), located in {{company.city}}, Arizona, and operating in the {{deal.industry}} industry. The Company is at the "{{deal.stage}}" stage of our process. Broker / intermediary of record: {{deal.broker}}.

INDICATIVE VALUATION

Based solely on the limited information made available to us to date — including revenue of {{deal.revenue}} and EBITDA of {{deal.ebitda}} (latest reported period ending {{fin.latestPeriodEnd}}: revenue {{fin.latestRevenue}}, EBITDA {{fin.latestEbitda}}) — our indicative enterprise value is centered on {{deal.dealValue}}, within an indicative range of [●] to [●]. The contemplated asking price is {{deal.askingPrice}}. This indication is preliminary, is not a binding offer, and is subject to confirmatory due diligence, quality-of-earnings review, and negotiation of definitive documentation.

INDICATIVE STRUCTURE

We would expect a structure of cash at closing, a seller note, and/or rollover equity in proportions of approximately [●], to be refined during diligence. We anticipate a diligence period of [●] days and are prepared to move promptly.

This IOI is non-binding and creates no obligation on either party, other than with respect to confidentiality. It is governed by the laws of the State of Arizona.

Submitted by:

{{firm.name}}

By: ___________________________________
Name: {{deal.owner}}
Title: Partner
Date: {{date.today}}`;

const NDA_BODY = `MUTUAL NON-DISCLOSURE AGREEMENT

This Mutual Non-Disclosure Agreement (this "Agreement") is entered into as of {{date.today}} (the "Effective Date"), by and between {{firm.name}} ("Canny Capital") and {{company.name}}, located in {{company.city}}, Arizona (the "Company"), acting through {{deal.contactName}} (collectively, the "Parties"), in connection with the Parties' evaluation of a potential business transaction involving the Company, which operates in the {{deal.industry}} industry (the "Transaction").

1. DEFINITION OF CONFIDENTIAL INFORMATION

"Confidential Information" means all non-public information disclosed by or on behalf of a Party (the "Disclosing Party") to the other Party (the "Receiving Party") in connection with the Transaction, whether orally, visually, or in writing, including financial statements, business plans, customer and vendor information, pricing, and the existence and terms of the Parties' discussions.

2. OBLIGATIONS

The Receiving Party agrees to hold all Confidential Information in strict confidence, to use it solely for evaluating the Transaction, and to disclose it only to its representatives who need to know it for that purpose and who are bound by obligations at least as protective as those in this Agreement. Contact for notices to the Company: {{deal.contactName}}, {{deal.contactEmail}}.

3. EXCLUSIONS

Confidential Information does not include information that (a) is or becomes publicly available without breach of this Agreement, (b) was known to the Receiving Party without a duty of confidentiality before disclosure, (c) is received from a third party not known to be bound by a duty of confidentiality, or (d) is independently developed without use of Confidential Information.

4. TERM

This Agreement takes effect on the Effective Date. The obligations in this Agreement survive for two (2) years from the Effective Date; obligations regarding trade secrets survive for so long as they remain trade secrets under applicable law.

5. RETURN OF MATERIALS; NO OBLIGATION

Upon request, the Receiving Party will return or destroy all Confidential Information of the Disclosing Party. Nothing in this Agreement obligates either Party to proceed with the Transaction.

6. GOVERNING LAW

This Agreement is governed by and construed in accordance with the laws of the State of Arizona, without regard to conflict-of-laws principles. The Parties consent to the exclusive jurisdiction of the state and federal courts located in Maricopa County, Arizona.

ACKNOWLEDGED AND AGREED:

{{firm.name}}

By: ___________________________________
Name: {{deal.owner}}
Title: Partner
Date: {{date.today}}

{{company.name}}

By: ___________________________________
Name: {{deal.contactName}}
Title: [●]
Date: [●]`;

const CIM_BODY = `CONFIDENTIAL INFORMATION MEMORANDUM — OUTLINE

{{company.name}}
{{company.city}}, Arizona · {{deal.industry}}
Prepared {{date.today}} · {{date.year}}
Status: OUTLINE — figures below are drawn from portal records for {{deal.companyName}} and are to be confirmed before distribution.

1. EXECUTIVE SUMMARY

{{company.name}} is a {{deal.industry}} business based in {{company.city}}, Arizona. Transaction stage: {{deal.stage}}. Asking price: {{deal.askingPrice}}. Indicative enterprise value: {{deal.dealValue}}. Transaction contact: {{deal.contactName}} ({{deal.contactEmail}}). Broker / intermediary of record: {{deal.broker}}. Deal owner: {{deal.owner}}.

[●] One-paragraph investment thesis and highlights to be drafted.

2. BUSINESS OVERVIEW

[●] History and ownership.
[●] Products and services.
[●] Customers and end markets.
[●] Facilities, equipment, and headcount.
[●] Competitive positioning.

3. FINANCIAL SUMMARY

Revenue (deal record): {{deal.revenue}}.
EBITDA (deal record): {{deal.ebitda}}.
Latest reported period ending {{fin.latestPeriodEnd}}: revenue {{fin.latestRevenue}}, EBITDA {{fin.latestEbitda}}.

[●] Three-year historical financial table.
[●] Adjustments and add-backs schedule.
[●] Quality-of-earnings summary.

4. GROWTH OPPORTUNITIES

[●] Organic growth initiatives.
[●] Add-on acquisition opportunities.
[●] Market and industry tailwinds.

5. TRANSACTION OVERVIEW

The sellers are offering {{deal.companyName}} at an asking price of {{deal.askingPrice}}. {{firm.name}} is evaluating the opportunity on behalf of its partners. [●] Proposed structure, timing, and process milestones to be inserted.

6. PROCESS AND CONTACT

All inquiries: {{deal.contactName}}, {{deal.contactEmail}}. This outline is confidential and intended solely for the internal use of {{firm.name}} in {{date.year}}.`;

const CLOSING_CHECKLIST_BODY = `CLOSING CHECKLIST

Transaction: Acquisition of {{deal.companyName}} ({{company.name}})
Buyer: {{firm.name}}
Company city: {{company.city}}, Arizona · Industry: {{deal.industry}}
Deal stage at preparation: {{deal.stage}} · Prepared: {{date.today}}
Deal owner: {{deal.owner}} · Broker / intermediary: {{deal.broker}}
Target contact: {{deal.contactName}} ({{deal.contactEmail}})
Reference figures — asking price {{deal.askingPrice}}; enterprise value {{deal.dealValue}}; revenue {{deal.revenue}}; EBITDA {{deal.ebitda}}

Check each item when the final executed or received version is on file.

TRANSACTION DOCUMENTS

[ ] Purchase agreement (asset or equity) — fully executed
[ ] Disclosure schedules — final version
[ ] Bill of sale / assignment and assumption agreement
[ ] Seller note and security documents (if any)
[ ] Rollover / equity subscription documents (if any)
[ ] Employment and consulting agreements for key personnel
[ ] Non-competition and non-solicitation agreements
[ ] Transition services agreement (if any)

FUNDS FLOW AND CONSIDERATION

[ ] Funds flow memorandum — final, agreed by all parties
[ ] Closing statement / settlement statement
[ ] Wire instructions verified (by voice callback)
[ ] Escrow agreement and escrow deposit (if any)
[ ] Payoff letters for all indebtedness to be repaid at closing
[ ] Lien releases and UCC terminations for paid-off debt
[ ] Estimated closing working-capital statement

CONSENTS AND APPROVALS

[ ] Board consent of {{company.name}} approving the Transaction
[ ] Member / shareholder consents of the sellers
[ ] Landlord consent and lease assignment / estoppel
[ ] Key customer and vendor consents
[ ] Lender consent (if any debt remains outstanding)
[ ] Governmental licenses and permits — transfer or reissuance plan

SIGNATURE PAGES AND CERTIFICATES

[ ] Signature pages collected for every transaction document
[ ] Officer's certificate of the Company
[ ] Secretary's certificate with organizational documents and incumbency
[ ] Certificate of good standing — Arizona (dated within [●] days of closing)
[ ] FIRPTA / non-foreign affidavit (if applicable)
[ ] IRS Form W-9 for each seller

ESCROW AND POST-CLOSING

[ ] Escrow agent confirmation of receipt of funds and documents
[ ] Post-closing deliverables log opened (working-capital true-up, escrow releases)
[ ] Books and records delivery confirmed
[ ] Insurance tail / replacement policies bound

Prepared by {{firm.name}} · {{date.today}}`;

const BOARD_CONSENT_BODY = `UNANIMOUS WRITTEN CONSENT IN LIEU OF MEETING

OF THE BOARD OF DIRECTORS / MANAGERS OF

{{company.name}}

The undersigned, constituting all of the directors (or managers, as applicable) of {{company.name}}, a company organized under the laws of the State of Arizona, located in {{company.city}}, Arizona (the "Company"), acting pursuant to applicable law and the Company's organizational documents, hereby adopt, effective as of {{date.today}}, the following resolutions:

RECITALS

WHEREAS, the Company operates in the {{deal.industry}} industry and is the subject of a proposed transaction (the "Transaction") with {{firm.name}}, on the terms contemplated in the transaction documents presented to the undersigned, including a contemplated purchase price of {{deal.askingPrice}} and enterprise value of {{deal.dealValue}}; and

WHEREAS, the undersigned have reviewed the Transaction, the related documents, and the advice of the Company's advisors, with transaction contact {{deal.contactName}} ({{deal.contactEmail}}) and broker / intermediary of record {{deal.broker}}; and

WHEREAS, the undersigned deem it advisable and in the best interests of the Company and its stakeholders to approve the Transaction.

RESOLUTIONS

RESOLVED, that the Transaction, and the execution, delivery, and performance of all agreements and documents contemplated by it (collectively, the "Transaction Documents"), be, and they hereby are, APPROVED.

RESOLVED FURTHER, that the officers of the Company be, and each of them hereby is, authorized and directed, for and on behalf of the Company, to execute and deliver the Transaction Documents and to take all actions contemplated by them, including the delivery of closing certificates, payoff letters, and signature pages.

RESOLVED FURTHER, that all actions heretofore taken by any officer or representative of the Company in connection with the Transaction be, and they hereby are, ratified and confirmed.

RESOLVED FURTHER, that this consent may be executed in counterparts (including by electronic signature), each of which is an original, and that it shall be filed with the Company's books and records.

SIGNATURES

Director / Manager: ___________________________________
Name: [●]
Date: [●]

Director / Manager: ___________________________________
Name: [●]
Date: [●]

Director / Manager: ___________________________________
Name: [●]
Date: [●]

Prepared in connection with {{deal.companyName}} · {{date.year}}`;

export const SEED_TEMPLATES: SeedTemplate[] = [
  {
    key: "loi",
    name: "Letter of Intent (LOI)",
    description:
      "Proposed acquisition terms: headline price/value, structure summary, exclusivity and diligence periods as bracketed blanks, seller + buyer signature blocks.",
    body: LOI_BODY,
  },
  {
    key: "ioi",
    name: "Indication of Interest (IOI)",
    description:
      "Shorter, non-binding indication: indicative value centered on the deal value, structure outline, and diligence ask.",
    body: IOI_BODY,
  },
  {
    key: "nda",
    name: "Mutual NDA",
    description:
      "Mutual confidentiality agreement between Canny Capital Partners and the company: definition, exclusions, 2-year term, Arizona governing law.",
    body: NDA_BODY,
  },
  {
    key: "cim",
    name: "CIM Outline",
    description:
      "Confidential information memorandum outline with the known deal and financial figures filled in and drafting slots marked.",
    body: CIM_BODY,
  },
  {
    key: "closing-checklist",
    name: "Closing Checklist",
    description:
      "Closing deliverables checklist (funds flow, signature pages, consents, payoff letters, escrow) with the deal and company named.",
    body: CLOSING_CHECKLIST_BODY,
  },
  {
    key: "board-consent",
    name: "Board Consent",
    description:
      "Unanimous written consent in lieu of meeting approving the transaction for the company, with director signature lines.",
    body: BOARD_CONSENT_BODY,
  },
];

/* ------------------------------ ensure ------------------------------ */

let seeded = false;

/** Schema + idempotent seed. Cheap to call per request. */
export async function ensureDocgen(): Promise<void> {
  await ensureDocgenSchema();
  if (seeded) return;
  const db = sql();
  for (const seed of SEED_TEMPLATES) {
    await db`
      INSERT INTO docgen.templates (id, key, name, description, body, created_by)
      VALUES (${newId()}, ${seed.key}, ${seed.name}, ${seed.description},
        ${seed.body}, 'system')
      ON CONFLICT DO NOTHING`;
  }
  seeded = true;
}

/* ------------------------------- CRUD ------------------------------- */

function rowToTemplate(r: Record<string, unknown>): DocgenTemplateRow {
  return {
    id: str(r.id),
    key: str(r.key),
    name: str(r.name),
    description: str(r.description),
    body: str(r.body),
    createdBy: str(r.created_by),
    createdAt: isoOrNull(r.created_at) ?? "",
    updatedAt: isoOrNull(r.updated_at) ?? "",
  };
}

const TPL_COLS = `
  id, key, name, description, body, created_by, created_at, updated_at`;

export async function listTemplates(): Promise<DocgenTemplateRow[]> {
  await ensureDocgen();
  const db = sql();
  const rows = await db`
    SELECT ${db.unsafe(TPL_COLS)} FROM docgen.templates
    WHERE deleted_at IS NULL
    ORDER BY created_at ASC`;
  const items = rows.map((r) => rowToTemplate(r as Record<string, unknown>));
  logUsage("docgen_templates_list", items.length, JSON.stringify(items).length);
  return items;
}

export async function countTemplates(): Promise<number> {
  await ensureDocgen();
  const db = sql();
  const rows = await db`
    SELECT count(*)::int AS n FROM docgen.templates WHERE deleted_at IS NULL`;
  return rows.length ? Number(rows[0].n ?? 0) : 0;
}

export async function getTemplateById(
  id: string
): Promise<DocgenTemplateRow | null> {
  await ensureDocgen();
  const db = sql();
  const rows = await db`
    SELECT ${db.unsafe(TPL_COLS)} FROM docgen.templates
    WHERE id = ${id} AND deleted_at IS NULL LIMIT 1`;
  return rows.length
    ? rowToTemplate(rows[0] as Record<string, unknown>)
    : null;
}

export async function getTemplateByKey(
  key: string
): Promise<DocgenTemplateRow | null> {
  await ensureDocgen();
  const db = sql();
  const rows = await db`
    SELECT ${db.unsafe(TPL_COLS)} FROM docgen.templates
    WHERE key = ${key} AND deleted_at IS NULL LIMIT 1`;
  return rows.length
    ? rowToTemplate(rows[0] as Record<string, unknown>)
    : null;
}

export function slugifyKey(name: string): string {
  const slug = (name ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return slug || "template";
}

export async function createTemplate(
  input: { key?: string; name: string; description?: string; body: string },
  actor: string
): Promise<DocgenTemplateRow> {
  await ensureDocgen();
  const db = sql();
  const name = (input.name ?? "").trim().slice(0, 200);
  if (!name) throw new Error("name_required");
  const body = (input.body ?? "").trim();
  if (!body) throw new Error("body_required");
  let key = (input.key ?? "").trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-").slice(0, 60);
  if (!key) key = slugifyKey(name);
  const existing = await getTemplateByKey(key);
  if (existing) throw new Error("key_conflict");
  const id = newId();
  const rows = await db`
    INSERT INTO docgen.templates (id, key, name, description, body, created_by)
    VALUES (${id}, ${key}, ${name},
      ${(input.description ?? "").trim().slice(0, 500)}, ${body}, ${actor})
    RETURNING ${db.unsafe(TPL_COLS)}`;
  return rowToTemplate(rows[0] as Record<string, unknown>);
}

export async function updateTemplate(
  id: string,
  patch: { name?: string; description?: string; body?: string },
  actor: string
): Promise<DocgenTemplateRow | null> {
  await ensureDocgen();
  const current = await getTemplateById(id);
  if (!current) return null;
  void actor;
  const name =
    patch.name !== undefined ? patch.name.trim().slice(0, 200) : current.name;
  if (!name) throw new Error("name_required");
  const description =
    patch.description !== undefined
      ? patch.description.trim().slice(0, 500)
      : current.description;
  const body = patch.body !== undefined ? patch.body : current.body;
  if (!String(body).trim()) throw new Error("body_required");
  const db = sql();
  const rows = await db`
    UPDATE docgen.templates SET
      name = ${name}, description = ${description}, body = ${body},
      updated_at = now()
    WHERE id = ${id} AND deleted_at IS NULL
    RETURNING ${db.unsafe(TPL_COLS)}`;
  return rows.length
    ? rowToTemplate(rows[0] as Record<string, unknown>)
    : null;
}

export async function softDeleteTemplate(id: string): Promise<boolean> {
  await ensureDocgen();
  const db = sql();
  const rows = await db`
    UPDATE docgen.templates SET deleted_at = now(), updated_at = now()
    WHERE id = ${id} AND deleted_at IS NULL
    RETURNING id`;
  return rows.length > 0;
}

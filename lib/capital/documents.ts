import { getDealContext } from "../diligence/service";
import { listTemplates } from "../docgen/templates";
import { CapitalError } from "./service";

/**
 * Documents & contracts grouping (Investors & Capital Redesign
 * Step 1, Part B §3): which docgen templates belong on a raise's
 * Documents tab depends on the deal's investment type.
 *
 * Boundary: templates are read ONLY through lib/docgen's template
 * list service — this module never queries docgen tables, never
 * generates anything, and never drafts contract language. Generation
 * stays with docgen and its approved-only rule; here each template
 * surfaces with the status docgen reports (approved | draft).
 *
 * Matching: a template joins the FIRST group (in listed order) whose
 * name/key token patterns appear in the template's name or key —
 * each template appears in at most one group.
 */

export interface TemplateGroupDef {
  key: string;
  label: string;
  /** Lowercase tokens matched against template name + key. */
  patterns: string[];
}

const NDA_GROUP: TemplateGroupDef = {
  key: "nda",
  label: "NDA",
  patterns: ["nda", "non-disclosure", "nondisclosure", "confidentiality"],
};

const GROUPS_BY_TYPE: Record<string, TemplateGroupDef[]> = {
  platform_lbo: [
    {
      key: "spv_operating_agreement",
      label: "SPV operating agreement",
      patterns: ["operating agreement", "spv"],
    },
    {
      key: "subscription_agreement",
      label: "Subscription agreement",
      patterns: ["subscription"],
    },
    { key: "side_letters", label: "Side letters", patterns: ["side letter"] },
    NDA_GROUP,
  ],
  add_on: [
    {
      key: "addon_funding_notice",
      label: "Add-on funding / capital call notice",
      patterns: ["capital call", "funding notice", "add-on funding", "addon funding"],
    },
    { key: "joinder", label: "Joinder", patterns: ["joinder"] },
    NDA_GROUP,
  ],
  early_stage: [
    {
      key: "safe_note",
      label: "SAFE / note",
      patterns: ["safe", "convertible note"],
    },
    {
      key: "term_sheet_summary",
      label: "Term sheet summary",
      patterns: ["term sheet"],
    },
    {
      key: "spv_documents",
      label: "SPV documents",
      patterns: ["spv", "operating agreement"],
    },
    NDA_GROUP,
  ],
  minority_growth: [
    {
      key: "term_sheet_summary",
      label: "Term sheet summary",
      patterns: ["term sheet"],
    },
    {
      key: "subscription_documents",
      label: "Subscription documents",
      patterns: ["subscription"],
    },
    NDA_GROUP,
  ],
};

/** Group definitions for a deal type; unknown/null falls back to the
 * Platform LBO set (the most complete) so the tab is never empty of
 * structure. */
export function templateGroupsForType(
  typeKey: string | null | undefined
): TemplateGroupDef[] {
  if (typeKey && GROUPS_BY_TYPE[typeKey]) return GROUPS_BY_TYPE[typeKey];
  return GROUPS_BY_TYPE.platform_lbo;
}

export interface DealTemplateItem {
  id: string;
  name: string;
  key: string;
  status: string;
}

export interface DealTemplateGroup {
  key: string;
  label: string;
  templates: DealTemplateItem[];
}

export interface DealTemplateGroups {
  typeKey: string | null;
  groups: DealTemplateGroup[];
}

export async function getDealTemplateGroups(
  dealId: string
): Promise<DealTemplateGroups> {
  const ctx = await getDealContext(dealId);
  if (!ctx) throw new CapitalError("deal_not_found");
  const typeKey = ctx.investmentType ? ctx.investmentType : null;
  const defs = templateGroupsForType(typeKey);
  const templates = await listTemplates();
  const groups: DealTemplateGroup[] = defs.map((d) => ({
    key: d.key,
    label: d.label,
    templates: [],
  }));
  for (const tpl of templates) {
    const hay = `${tpl.name} ${tpl.key}`.toLowerCase();
    const idx = defs.findIndex((d) =>
      d.patterns.some((p) => hay.includes(p))
    );
    if (idx < 0) continue;
    groups[idx].templates.push({
      id: tpl.id,
      name: tpl.name,
      key: tpl.key,
      status: tpl.status,
    });
  }
  return { typeKey, groups };
}

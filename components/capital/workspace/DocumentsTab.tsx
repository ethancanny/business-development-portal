"use client";

/**
 * Documents tab (redesign Step 1, Part B §3) — template groups for
 * THIS deal's investment type from GET …/deals/[dealId]/templates.
 * Approved templates generate through the existing
 * GenerateDocumentButton (scope="deal", label "Generate contract" —
 * Ethan's label decision); draft templates cannot generate and say
 * where to approve them. No free-form AI drafting of contract
 * language — the attorney-review banner from the docgen flow sits
 * at the top. Below, the deal company's ContractsPanel is the
 * register (its statuses live there).
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ErrorState, SkeletonRows } from "@/components/ui";
import {
  API,
  api,
  cardCls,
  type CapitalTabProps,
} from "@/components/capital/types";
import ContractsPanel from "@/components/docgen/ContractsPanel";
import { GenerateDocumentButton } from "@/components/docgen/GenerateDocument";
import {
  fetchBundle,
  typeLabelOf,
  type WorkspaceBundle,
} from "@/components/capital/workspace/shared";

interface TemplateItem {
  id: string;
  name: string;
  key: string;
  status: string; // approved | draft
}

interface TemplateGroup {
  key: string;
  label: string;
  templates: TemplateItem[];
}

interface TemplatesData {
  groups: TemplateGroup[];
  typeKey: string;
}

export default function DocumentsTab({ dealId }: CapitalTabProps) {
  const [bundle, setBundle] = useState<WorkspaceBundle | null>(null);
  const [data, setData] = useState<TemplatesData | null>(null);
  const [loading, setLoading] = useState(true);
  const [tplFailed, setTplFailed] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setTplFailed(false);
    try {
      const [b, t] = await Promise.all([
        fetchBundle(dealId).catch(() => null),
        api<TemplatesData>(`${API}/deals/${encodeURIComponent(dealId)}/templates`).catch(
          () => null
        ),
      ]);
      setBundle(b);
      if (t) {
        setData({
          groups: Array.isArray(t.groups) ? t.groups : [],
          typeKey: t.typeKey ?? "",
        });
      } else {
        setTplFailed(true);
      }
    } finally {
      setLoading(false);
    }
  }, [dealId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) return <SkeletonRows rows={5} />;

  const companyId = bundle?.companyId ?? "";
  const typeLabel = typeLabelOf(bundle);

  return (
    <div className="space-y-5">
      {/* Attorney-review banner (docgen pattern) */}
      <p className="rounded-2xl border border-amber-300 bg-amber-50 px-5 py-4 text-sm text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
        <span className="font-semibold">Draft for attorney review.</span>{" "}
        Every generated document carries the “Draft for attorney review” banner.
        Generation uses approved templates only, pre-filled from the deal and the
        investor&apos;s Directory record — there is no free-form AI drafting of
        contract language.
      </p>

      <div className={cardCls}>
        <h3 className="font-display text-lg font-semibold text-[#0d1f3c] dark:text-white">
          Templates for this deal{data?.typeKey || bundle ? ` — ${typeLabel}` : ""}
        </h3>
        {tplFailed ? (
          <div className="mt-3">
            <p className="text-sm text-slate-500 dark:text-white/50">
              The per-type template list for this deal could not be loaded, so no
              template groups are shown. Approved deal templates can still be
              picked inside the Generate flow.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <GenerateDocumentButton scope="deal" dealId={dealId} label="Generate contract" />
              <button type="button" className="btn btn-secondary btn-sm min-h-[44px]" onClick={() => void load()}>
                Retry template list
              </button>
            </div>
          </div>
        ) : !data || data.groups.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500 dark:text-white/50">
            No template groups are configured for this deal&apos;s type yet.
            Templates are managed in{" "}
            <Link href="/settings/templates" className="font-semibold text-gold-700 hover:underline dark:text-gold-400">
              Settings → Templates
            </Link>
            .
          </p>
        ) : (
          <div className="mt-4 space-y-5">
            {data.groups.map((g) => (
              <div key={g.key}>
                <h4 className="text-sm font-semibold text-[#0d1f3c] dark:text-white">{g.label}</h4>
                {g.templates.length === 0 ? (
                  <p className="mt-1 text-sm text-slate-500 dark:text-white/50">No templates in this group yet.</p>
                ) : (
                  <ul className="mt-2 divide-y divide-slate-100 dark:divide-white/5">
                    {g.templates.map((t) => {
                      const approved = t.status === "approved";
                      return (
                        <li key={t.id} className="flex flex-wrap items-center gap-2 py-2.5">
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium text-[#0d1f3c] dark:text-white">{t.name}</span>
                            {t.key && <span className="block text-xs text-slate-400 dark:text-white/40">{t.key}</span>}
                          </span>
                          <span className={`badge ${approved ? "badge-fit" : "badge-warn"}`}>
                            {approved ? "Approved" : "Draft"}
                          </span>
                          {approved ? (
                            <GenerateDocumentButton
                              scope="deal"
                              dealId={dealId}
                              label="Generate contract"
                              className="btn btn-primary btn-sm min-h-[44px]"
                            />
                          ) : (
                            <span className="text-xs text-slate-500 dark:text-white/50">
                              Draft — approve in{" "}
                              <Link href="/settings/templates" className="font-semibold text-gold-700 hover:underline dark:text-gold-400">
                                Settings → Templates
                              </Link>
                            </span>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Register */}
      {companyId ? (
        <ContractsPanel companyId={companyId} />
      ) : (
        <div className={cardCls}>
          <h3 className="font-display text-lg font-semibold text-[#0d1f3c] dark:text-white">Contracts</h3>
          <p className="mt-2 text-sm text-slate-500 dark:text-white/50">
            The contracts register hangs off the deal&apos;s company, and this
            deal&apos;s bundle did not return a companyId — so the register is
            not shown rather than listing unrelated contracts. Generated
            documents still register against the deal through the flow above.
          </p>
        </div>
      )}
    </div>
  );
}

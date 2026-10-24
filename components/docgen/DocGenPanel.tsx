"use client";

/**
 * DocGenPanel (Phase 10) — company-profile document generation.
 *
 * Mounted on the company profile by the coordinator with just
 * { companyId }. Loads the template catalog (GET docgen/templates),
 * the company's deals (from the company detail payload's linked
 * deals; falls back to /api/deals filtered by company name when the
 * payload carries none), and prior generations for the company
 * (GET docgen/documents?companyId=). Generate POSTs to
 * docgen/generate and links the result into the Phase 3 document
 * library via /documents?doc=<documentId>.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { EmptyState, ErrorState, SkeletonRows } from "@/components/ui";
import { fmtDate } from "@/lib/format";
import SigningActions from "@/components/signing/EnvelopeStatus";

interface DocgenTemplate {
  id: string;
  key: string;
  name: string;
  description: string;
  status: string;
  scope: string;
}

interface DealOption {
  id: string;
  label: string;
}

interface Generation {
  id: string;
  templateKey: string;
  templateName: string;
  documentId: string;
  documentName: string;
  dealId: string | null;
  actor: string;
  createdAt: string;
}

interface GenerateResult {
  documentId: string;
  documentName: string;
  version: number;
  roomId: string | null;
  unresolvedFields: string[];
}

const inputCls =
  "w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-[#0d1f3c] outline-none focus:border-[#b8975a] dark:border-white/10 dark:bg-[#132847]/60 dark:text-white";
const labelCls =
  "mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-white/40";

export default function DocGenPanel({ companyId }: { companyId: string }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [companyName, setCompanyName] = useState("");
  const [templates, setTemplates] = useState<DocgenTemplate[]>([]);
  const [deals, setDeals] = useState<DealOption[]>([]);
  const [generations, setGenerations] = useState<Generation[]>([]);

  const [templateId, setTemplateId] = useState("");
  const [dealId, setDealId] = useState("");
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [result, setResult] = useState<GenerateResult | null>(null);
  const [reloadTick, setReloadTick] = useState(0);

  const loadGenerations = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/platform/docgen/documents?companyId=${encodeURIComponent(companyId)}&limit=25`
      );
      if (!res.ok) return;
      const data = (await res.json()) as { items?: Generation[] };
      setGenerations(Array.isArray(data.items) ? data.items : []);
    } catch {
      /* generations list is auxiliary */
    }
  }, [companyId]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const [tplRes, compRes] = await Promise.all([
        fetch("/api/platform/docgen/templates"),
        fetch(`/api/platform/companies/${encodeURIComponent(companyId)}`),
      ]);
      if (!tplRes.ok) throw new Error(`HTTP ${tplRes.status}`);
      const tplData = (await tplRes.json()) as {
        templates?: DocgenTemplate[];
      };
      // Oct 24, 2026 (Contract generation): generation is
      // approved-templates-only — this panel lists only templates
      // Ethan has approved in Settings → Templates.
      const tpls = (
        Array.isArray(tplData.templates) ? tplData.templates : []
      ).filter((t) => t.status === "approved");
      setTemplates(tpls);
      setTemplateId((cur) => cur || tpls[0]?.id || "");

      let name = "";
      let dealOpts: DealOption[] = [];
      if (compRes.ok) {
        const detail = (await compRes.json()) as {
          company?: { name?: string };
          linked?: {
            deals?: Array<{
              id: string;
              name?: string;
              stage?: string;
            }>;
          };
        };
        name = detail.company?.name ?? "";
        const linked = detail.linked?.deals ?? [];
        dealOpts = linked.map((d) => ({
          id: d.id,
          label: d.name || name || d.id,
        }));
      }
      setCompanyName(name);

      if (!dealOpts.length && name) {
        // Fallback: the legacy deals list, filtered by company name.
        try {
          const dealsRes = await fetch("/api/deals");
          if (dealsRes.ok) {
            const raw = (await dealsRes.json()) as unknown;
            const list = Array.isArray(raw)
              ? raw
              : Array.isArray((raw as { deals?: unknown[] })?.deals)
                ? ((raw as { deals: unknown[] }).deals as Array<{
                    id: string;
                    companyName?: string;
                    stage?: string;
                  }>)
                : [];
            dealOpts = (list as Array<{ id: string; companyName?: string }>)
              .filter((d) => d.companyName === name)
              .map((d) => ({ id: d.id, label: d.companyName || d.id }));
          }
        } catch {
          /* fallback is best-effort */
        }
      }
      setDeals(dealOpts);
      setDealId((cur) => cur || dealOpts[0]?.id || "");
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => {
    void load();
  }, [load, reloadTick]);

  useEffect(() => {
    void loadGenerations();
  }, [loadGenerations, reloadTick]);

  const runGenerate = useCallback(async () => {
    if (!templateId || !dealId || generating) return;
    setGenerating(true);
    setGenError(null);
    setResult(null);
    try {
      const res = await fetch("/api/platform/docgen/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ templateId, dealId }),
      });
      const data = (await res.json().catch(() => ({}))) as
        | GenerateResult
        | { error?: string };
      if (!res.ok) {
        const code = (data as { error?: string }).error ?? `HTTP ${res.status}`;
        setGenError(
          code === "template_not_found"
            ? "That template could not be found — it may have been deleted. Reload and try again."
            : code === "template_not_approved"
              ? "That template is not approved — only approved templates generate documents. Approve it in Settings → Templates."
              : code === "deal_not_found"
              ? "That deal could not be found in the pipeline."
              : `Generation failed (${code}).`
        );
        return;
      }
      setResult(data as GenerateResult);
      setReloadTick((t) => t + 1);
    } catch {
      setGenError("Generation request failed — try again.");
    } finally {
      setGenerating(false);
    }
  }, [templateId, dealId, generating]);

  return (
    <section className="card-surface p-5" aria-label="Generate documents">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-bold uppercase tracking-wide text-[#0d1f3c] dark:text-white">
          Generate documents
        </h2>
        {companyName && (
          <span className="text-xs text-caption">{companyName}</span>
        )}
      </div>

      {loading ? (
        <SkeletonRows rows={4} />
      ) : error ? (
        <ErrorState
          title="Could not load document generation"
          message="Templates or company deals could not be loaded — try again in a moment."
          onRetry={() => setReloadTick((t) => t + 1)}
        />
      ) : templates.length === 0 ? (
        <EmptyState
          title="No approved templates"
          message="Only approved templates can generate documents. Templates are managed and approved in Settings → Templates."
        />
      ) : deals.length === 0 ? (
        <EmptyState
          title="No linked deal"
          message="Generation needs a pipeline deal for this company — the document is filled from the deal's record. Link or create a deal first."
        />
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-[220px] flex-1 sm:max-w-sm">
              <label className={labelCls} htmlFor="docgen-template">
                Template
              </label>
              <select
                id="docgen-template"
                value={templateId}
                onChange={(e) => setTemplateId(e.target.value)}
                className={`${inputCls} min-h-[44px]`}
              >
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
              {templates.find((t) => t.id === templateId)?.description && (
                <p className="mt-1 text-xs text-caption">
                  {templates.find((t) => t.id === templateId)?.description}
                </p>
              )}
            </div>
            <div className="min-w-[220px] flex-1 sm:max-w-sm">
              <label className={labelCls} htmlFor="docgen-deal">
                Deal
              </label>
              <select
                id="docgen-deal"
                value={dealId}
                onChange={(e) => setDealId(e.target.value)}
                className={`${inputCls} min-h-[44px]`}
              >
                {deals.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.label}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="button"
              disabled={!templateId || !dealId || generating}
              onClick={() => void runGenerate()}
              className="btn btn-primary min-h-[44px]"
            >
              {generating ? "Generating…" : "Generate"}
            </button>
          </div>

          {genError && (
            <p
              role="alert"
              className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-200"
            >
              {genError}
            </p>
          )}

          {result && (
            <div className="mt-4 rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-700 dark:bg-white/5 dark:text-white/80">
              <p>
                Generated{" "}
                <span className="font-semibold text-[#0d1f3c] dark:text-white">
                  {result.documentName}
                </span>{" "}
                (v{result.version})
                {result.roomId ? " — filed in the deal's data room." : "."}{" "}
                <Link
                  href={`/documents?doc=${encodeURIComponent(result.documentId)}`}
                  className="font-semibold text-gold-700 hover:underline dark:text-gold-400"
                >
                  Open in Documents
                </Link>
              </p>
              {result.unresolvedFields.length > 0 && (
                <p className="mt-1 text-xs text-caption">
                  Fields with no data on file (shown as — in the document):{" "}
                  {result.unresolvedFields.join(", ")}
                </p>
              )}
            </div>
          )}

          <div className="mt-5 border-t border-slate-100 pt-4 dark:border-white/5">
            <h3 className="mb-2 text-sm font-bold uppercase tracking-wide text-[#0d1f3c] dark:text-white">
              Previously generated
            </h3>
            {generations.length === 0 ? (
              <p className="text-sm text-caption">
                Nothing generated for this company yet.
              </p>
            ) : (
              <ul className="divide-y divide-slate-100 dark:divide-white/5">
                {generations.map((g) => (
                  <li
                    key={g.id}
                    className="flex flex-wrap items-center gap-2 py-2.5"
                  >
                    <span className="min-w-0 flex-1 truncate text-sm text-slate-800 dark:text-white/90">
                      <span className="font-medium">
                        {g.documentName || g.templateName}
                      </span>
                      <span className="text-caption">
                        {" "}
                        · {g.templateName} · {fmtDate(g.createdAt)}
                        {g.actor ? ` · ${g.actor}` : ""}
                      </span>
                    </span>
                    <Link
                      href={`/documents?doc=${encodeURIComponent(g.documentId)}`}
                      className="btn btn-secondary btn-sm min-h-[44px]"
                    >
                      Open
                    </Link>
                    <SigningActions
                      documentId={g.documentId}
                      documentName={g.documentName || g.templateName}
                    />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </section>
  );
}

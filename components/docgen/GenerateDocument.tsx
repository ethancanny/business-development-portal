"use client";

/**
 * GenerateDocument (Contract generation, Oct 24, 2026) — the shared
 * drafting flow used on the deal page (Business Development) and on
 * Investors & Capital.
 *
 * Steps: pick an APPROVED template (drafts never appear) → pick the
 * counterparty from the Directory / the investor (+ commitment) →
 * field-by-field review of every merge field the template uses,
 * pre-filled from the deal, the Directory and the investor record →
 * key dates → generate. Output is .docx + PDF with the "Draft for
 * attorney review" banner, filed to the deal's data room when the
 * deal has one and registered as a contract record.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";

interface TemplateOpt {
  id: string;
  key: string;
  name: string;
  description: string;
  version: number;
  scope: string;
  sourceFormat: string;
}

interface ReviewField {
  field: string;
  label: string;
  group: string;
  value: string;
  source: string;
}

interface ContextData {
  fields: ReviewField[];
  companyName: string;
  investorName: string;
  counterparty: { name: string; email: string; title: string; company: string } | null;
  roomId: string | null;
  commitments: Array<{
    id: string;
    dealId: string;
    dealName: string;
    companyName: string;
    amount: number;
    stage: string;
  }>;
}

interface DirectoryHit {
  id: string;
  name: string;
  title: string;
  email: string;
  organizationName: string;
}

interface InvestorOpt {
  personId: string;
  name: string;
  firm: string;
  title: string;
}

/** Empty-state copy for the template picker: when approved templates
 * exist for the OTHER scope, say so with the count — "3 approved
 * templates exist for deals — none for investors yet" — instead of
 * implying the library is empty. */
function emptyTemplateMessage(
  scope: "deal" | "investor",
  counts: Record<string, number>
): string {
  const mine = scope === "investor" ? "investor" : "deal";
  const other = scope === "investor" ? "deal" : "investor";
  const otherCount = counts[other] ?? 0;
  if (otherCount > 0) {
    return `No approved ${mine} templates yet — but ${otherCount} approved template${otherCount === 1 ? "" : "s"} exist${otherCount === 1 ? "s" : ""} for ${other === "investor" ? "investors" : "deals"}. Approve one for this surface (or set its scope to General) in`;
  }
  return `No approved ${mine} templates yet. Create and approve one in`;
}

const inputCls =
  "w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-[#0d1f3c] outline-none focus:border-[#b8975a] dark:border-white/10 dark:bg-[#132847]/60 dark:text-white";
const labelCls =
  "mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-white/40";

export function GenerateDocumentButton({
  scope,
  dealId,
  investorPersonId,
  label,
  className,
  onGenerated,
}: {
  scope: "deal" | "investor";
  dealId?: string;
  investorPersonId?: string;
  label?: string;
  className?: string;
  onGenerated?: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className={className ?? "btn btn-primary btn-sm min-h-[44px]"}
        onClick={() => setOpen(true)}
      >
        {label ?? "Generate contract"}
      </button>
      {open && (
        <GenerateDocumentDrawer
          scope={scope}
          dealId={dealId}
          investorPersonId={investorPersonId}
          onClose={() => setOpen(false)}
          onGenerated={onGenerated}
        />
      )}
    </>
  );
}

function GenerateDocumentDrawer({
  scope,
  dealId,
  investorPersonId: fixedInvestorId,
  onClose,
  onGenerated,
}: {
  scope: "deal" | "investor";
  dealId?: string;
  investorPersonId?: string;
  onClose: () => void;
  onGenerated?: () => void;
}) {
  const [templates, setTemplates] = useState<TemplateOpt[]>([]);
  const [tplLoading, setTplLoading] = useState(true);
  const [templateId, setTemplateId] = useState("");
  /** Approved counts per scope across the WHOLE library (Send
   * anywhere, Oct 25, 2026) — the scoped fetch alone can't see that
   * approved templates exist for other surfaces, which is exactly
   * what the empty state needs to say. */
  const [approvedCounts, setApprovedCounts] = useState<Record<string, number>>({});

  const [investors, setInvestors] = useState<InvestorOpt[]>([]);
  const [investorId, setInvestorId] = useState(fixedInvestorId ?? "");
  const [commitmentId, setCommitmentId] = useState("");

  const [cpQuery, setCpQuery] = useState("");
  const [cpHits, setCpHits] = useState<DirectoryHit[]>([]);
  const [cpId, setCpId] = useState("");
  const [cpName, setCpName] = useState("");

  const [ctx, setCtx] = useState<ContextData | null>(null);
  const [ctxLoading, setCtxLoading] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const [keyDates, setKeyDates] = useState({
    exclusivityExpiry: "",
    closing: "",
    renewal: "",
  });
  const [step, setStep] = useState<"pick" | "review" | "done">("pick");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    contractId: string;
    title: string;
    docxDocumentId: string;
    pdfDocumentId: string;
    roomId: string | null;
    unresolvedFields: string[];
  } | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(
          `/api/platform/docgen/templates?scope=${scope}&status=approved`,
          { cache: "no-store" }
        );
        if (!res.ok) throw new Error();
        const data = (await res.json()) as { templates?: TemplateOpt[] };
        const list = Array.isArray(data.templates) ? data.templates : [];
        setTemplates(list);
        setTemplateId((cur) => cur || list[0]?.id || "");
      } catch {
        setError("Could not load approved templates.");
      } finally {
        setTplLoading(false);
      }
    })();
    // Unfiltered approved fetch for the empty state's per-scope
    // counts — best-effort; the scoped list above is authoritative.
    (async () => {
      try {
        const res = await fetch(
          "/api/platform/docgen/templates?status=approved",
          { cache: "no-store" }
        );
        if (!res.ok) return;
        const data = (await res.json()) as { templates?: TemplateOpt[] };
        const counts: Record<string, number> = {};
        for (const t of Array.isArray(data.templates) ? data.templates : []) {
          counts[t.scope] = (counts[t.scope] ?? 0) + 1;
        }
        setApprovedCounts(counts);
      } catch {
        /* counts are an empty-state nicety only */
      }
    })();
  }, [scope]);

  useEffect(() => {
    if (scope !== "investor" || fixedInvestorId) return;
    (async () => {
      try {
        const res = await fetch("/api/platform/capital/investors?limit=50");
        if (!res.ok) return;
        const data = (await res.json()) as {
          items?: InvestorOpt[];
          investors?: InvestorOpt[];
        };
        setInvestors(
          Array.isArray(data.items)
            ? data.items
            : Array.isArray(data.investors)
              ? data.investors
              : []
        );
      } catch {
        /* picker stays empty; id can still be fixed by selection */
      }
    })();
  }, [scope, fixedInvestorId]);

  useEffect(() => {
    if (scope !== "deal") return;
    const q = cpQuery.trim();
    if (q.length < 2) {
      setCpHits([]);
      return;
    }
    const t = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/platform/directory?q=${encodeURIComponent(q)}&limit=10`
        );
        if (!res.ok) return;
        const data = (await res.json()) as { items?: DirectoryHit[] };
        setCpHits(Array.isArray(data.items) ? data.items : []);
      } catch {
        /* search is best-effort */
      }
    }, 250);
    return () => clearTimeout(t);
  }, [cpQuery, scope]);

  const loadContext = useCallback(async () => {
    if (!templateId) return;
    setCtxLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ templateId });
      if (scope === "deal" && dealId) params.set("dealId", dealId);
      if (scope === "investor" && investorId)
        params.set("investorPersonId", investorId);
      if (commitmentId) params.set("commitmentId", commitmentId);
      if (cpId) params.set("counterpartyPersonId", cpId);
      const res = await fetch(`/api/platform/docgen/context?${params}`);
      const data = (await res.json().catch(() => ({}))) as ContextData & {
        error?: string;
      };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setCtx(data);
      const map: Record<string, string> = {};
      for (const f of data.fields) map[f.field] = f.value;
      setValues(map);
      setStep("review");
    } catch (err) {
      setError(
        `Could not prepare the drafting context (${err instanceof Error ? err.message : "error"}).`
      );
    } finally {
      setCtxLoading(false);
    }
  }, [templateId, scope, dealId, investorId, commitmentId, cpId]);

  const grouped = useMemo(() => {
    const out = new Map<string, ReviewField[]>();
    for (const f of ctx?.fields ?? []) {
      const arr = out.get(f.group) ?? [];
      arr.push(f);
      out.set(f.group, arr);
    }
    return Array.from(out.entries());
  }, [ctx]);

  const canReview =
    Boolean(templateId) &&
    (scope === "deal" ? Boolean(dealId) : Boolean(investorId));

  const generate = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/platform/docgen/contracts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          templateId,
          dealId: scope === "deal" ? dealId : undefined,
          investorPersonId: scope === "investor" ? investorId : undefined,
          commitmentId: commitmentId || undefined,
          counterpartyPersonId: cpId || undefined,
          fieldValues: values,
          keyDates: {
            exclusivityExpiry: keyDates.exclusivityExpiry || null,
            closing: keyDates.closing || null,
            renewal: keyDates.renewal || null,
          },
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        contract?: { id: string; title: string };
        docxDocumentId?: string;
        pdfDocumentId?: string;
        roomId?: string | null;
        unresolvedFields?: string[];
      };
      if (!res.ok || !data.contract) {
        setError(
          data.error === "template_not_approved"
            ? "That template is not approved — approve it in Settings → Templates first."
            : `Generation failed (${data.error ?? res.status}).`
        );
        return;
      }
      setResult({
        contractId: data.contract.id,
        title: data.contract.title,
        docxDocumentId: data.docxDocumentId ?? "",
        pdfDocumentId: data.pdfDocumentId ?? "",
        roomId: data.roomId ?? null,
        unresolvedFields: data.unresolvedFields ?? [],
      });
      setStep("done");
      onGenerated?.();
    } catch {
      setError("Generation request failed — try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex" role="dialog" aria-modal="true" aria-label="Generate contract">
      <button
        type="button"
        aria-label="Close"
        className="flex-1 bg-black/40"
        onClick={onClose}
      />
      <div className="flex h-full w-full max-w-[580px] flex-col bg-white shadow-2xl dark:bg-[#0d1f3c]">
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4 dark:border-white/10">
          <div>
            <h2 className="font-display text-xl font-semibold text-[#0d1f3c] dark:text-white">
              Generate contract
            </h2>
            <p className="mt-0.5 text-xs text-slate-400 dark:text-white/40">
              Approved templates only · output is .docx + PDF with a
              “Draft for attorney review” banner
            </p>
          </div>
          <button
            type="button"
            className="btn btn-secondary btn-sm min-h-[44px]"
            onClick={onClose}
          >
            Close
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {error && (
            <p role="alert" className="mb-4 rounded-xl bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-300">
              {error}
            </p>
          )}

          {step === "pick" && (
            <div className="space-y-4">
              <div>
                <label className={labelCls}>Template (approved)</label>
                {tplLoading ? (
                  <p className="text-sm text-slate-400">Loading templates…</p>
                ) : templates.length === 0 ? (
                  <p className="rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-600 dark:bg-white/5 dark:text-white/70">
                    {emptyTemplateMessage(scope, approvedCounts)}{" "}
                    <Link href="/settings/templates" className="font-semibold text-gold-700 underline dark:text-gold-400">
                      Settings → Templates
                    </Link>
                    .
                  </p>
                ) : (
                  <select
                    className={`${inputCls} min-h-[44px]`}
                    value={templateId}
                    onChange={(e) => setTemplateId(e.target.value)}
                  >
                    {templates.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name} (v{t.version})
                      </option>
                    ))}
                  </select>
                )}
                {templates.find((t) => t.id === templateId)?.description && (
                  <p className="mt-1 text-xs text-slate-400 dark:text-white/40">
                    {templates.find((t) => t.id === templateId)?.description}
                  </p>
                )}
              </div>

              {scope === "investor" && !fixedInvestorId && (
                <div>
                  <label className={labelCls}>Investor</label>
                  <select
                    className={`${inputCls} min-h-[44px]`}
                    value={investorId}
                    onChange={(e) => setInvestorId(e.target.value)}
                  >
                    <option value="">Select an investor…</option>
                    {investors.map((inv) => (
                      <option key={inv.personId} value={inv.personId}>
                        {inv.name}
                        {inv.firm ? ` — ${inv.firm}` : ""}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {scope === "deal" && (
                <div>
                  <label className={labelCls}>
                    Counterparty (Directory — optional)
                  </label>
                  {cpId ? (
                    <p className="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-3 text-sm dark:bg-white/5">
                      <span className="font-medium text-[#0d1f3c] dark:text-white">
                        {cpName}
                      </span>
                      <button
                        type="button"
                        className="text-xs font-semibold text-[#8a6f3c] hover:underline"
                        onClick={() => {
                          setCpId("");
                          setCpName("");
                        }}
                      >
                        Clear
                      </button>
                    </p>
                  ) : (
                    <>
                      <input
                        className={`${inputCls} min-h-[44px]`}
                        value={cpQuery}
                        onChange={(e) => setCpQuery(e.target.value)}
                        placeholder="Search the Directory to pre-fill the counterparty…"
                      />
                      {cpHits.length > 0 && (
                        <ul className="mt-2 divide-y divide-slate-100 rounded-xl border border-slate-100 dark:divide-white/5 dark:border-white/10">
                          {cpHits.map((h) => (
                            <li key={h.id}>
                              <button
                                type="button"
                                className="w-full px-3 py-2 text-left hover:bg-[#f0f4fa] dark:hover:bg-white/5"
                                onClick={() => {
                                  setCpId(h.id);
                                  setCpName(h.name);
                                  setCpHits([]);
                                }}
                              >
                                <span className="block text-sm font-medium text-[#0d1f3c] dark:text-white">
                                  {h.name}
                                </span>
                                <span className="block text-xs text-slate-400">
                                  {[h.title, h.organizationName, h.email]
                                    .filter(Boolean)
                                    .join(" · ")}
                                </span>
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                      <p className="mt-1 text-xs text-slate-400 dark:text-white/40">
                        Without a pick, the deal&apos;s contact on file is
                        used. Every field stays editable in the review step.
                      </p>
                    </>
                  )}
                </div>
              )}

              <button
                type="button"
                className="btn btn-primary min-h-[44px] w-full"
                disabled={!canReview || ctxLoading}
                onClick={() => void loadContext()}
              >
                {ctxLoading ? "Preparing…" : "Continue to field review"}
              </button>
            </div>
          )}

          {step === "review" && ctx && (
            <div className="space-y-5">
              <p className="text-sm text-slate-500 dark:text-white/50">
                Review every field before generating — values come from{" "}
                {scope === "investor"
                  ? "the investor record and its capital stack"
                  : "the deal and the Directory"}
                ; anything blank renders as “—” in the document.
              </p>

              {scope === "investor" && ctx.commitments.length > 0 && (
                <div>
                  <label className={labelCls}>Commitment / deal context</label>
                  <select
                    className={`${inputCls} min-h-[44px]`}
                    value={commitmentId}
                    onChange={(e) => {
                      setCommitmentId(e.target.value);
                    }}
                  >
                    <option value="">First commitment (default)</option>
                    {ctx.commitments.map((c) => (
                      <option key={c.id} value={c.id}>
                        {(c.dealName || c.companyName || "Deal") +
                          ` — $${c.amount.toLocaleString("en-US")} (${c.stage})`}
                      </option>
                    ))}
                  </select>
                  <p className="mt-1 text-xs text-slate-400">
                    Changing this after review reloads the fields — use the
                    back button and re-run the review if you switch.
                  </p>
                </div>
              )}

              {grouped.map(([group, fields]) => (
                <div key={group}>
                  <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-[#0d1f3c] dark:text-white">
                    {group}
                  </h3>
                  <div className="space-y-3">
                    {fields.map((f) => (
                      <div key={f.field}>
                        <label className={labelCls}>
                          {f.label}{" "}
                          <span className="normal-case text-slate-300 dark:text-white/30">
                            · {`{{${f.field}}}`} · from {f.source}
                          </span>
                        </label>
                        <input
                          className={`${inputCls} min-h-[44px] ${!values[f.field] ? "border-amber-300 dark:border-amber-500/40" : ""}`}
                          value={values[f.field] ?? ""}
                          onChange={(e) =>
                            setValues((v) => ({ ...v, [f.field]: e.target.value }))
                          }
                          placeholder="— (no data on file)"
                        />
                      </div>
                    ))}
                  </div>
                </div>
              ))}

              <div>
                <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-[#0d1f3c] dark:text-white">
                  Key dates (optional — tracked on the contract)
                </h3>
                <div className="grid gap-3 sm:grid-cols-3">
                  <div>
                    <label className={labelCls}>Exclusivity expiry</label>
                    <input
                      type="date"
                      className={`${inputCls} min-h-[44px]`}
                      value={keyDates.exclusivityExpiry}
                      onChange={(e) =>
                        setKeyDates((k) => ({ ...k, exclusivityExpiry: e.target.value }))
                      }
                    />
                  </div>
                  <div>
                    <label className={labelCls}>Closing</label>
                    <input
                      type="date"
                      className={`${inputCls} min-h-[44px]`}
                      value={keyDates.closing}
                      onChange={(e) =>
                        setKeyDates((k) => ({ ...k, closing: e.target.value }))
                      }
                    />
                  </div>
                  <div>
                    <label className={labelCls}>Renewal</label>
                    <input
                      type="date"
                      className={`${inputCls} min-h-[44px]`}
                      value={keyDates.renewal}
                      onChange={(e) =>
                        setKeyDates((k) => ({ ...k, renewal: e.target.value }))
                      }
                    />
                  </div>
                </div>
                <p className="mt-1 text-xs text-slate-400">
                  Once the contract is executed, these dates appear on the
                  Calendar automatically.
                </p>
              </div>

              <div className="flex gap-2 pb-2">
                <button
                  type="button"
                  className="btn btn-secondary min-h-[44px]"
                  onClick={() => setStep("pick")}
                >
                  Back
                </button>
                <button
                  type="button"
                  className="btn btn-primary min-h-[44px] flex-1"
                  disabled={busy}
                  onClick={() => void generate()}
                >
                  {busy ? "Generating…" : "Generate .docx + PDF"}
                </button>
              </div>
            </div>
          )}

          {step === "done" && result && (
            <div className="space-y-4">
              <p className="rounded-xl bg-emerald-500/10 px-4 py-3 text-sm text-emerald-800 dark:text-emerald-200">
                Generated <strong>{result.title}</strong> —{" "}
                {result.roomId
                  ? "filed in the deal's data room and registered as a contract."
                  : "registered as a contract and saved to the document library."}
              </p>
              <div className="flex flex-wrap gap-2">
                <Link
                  href={`/documents?doc=${encodeURIComponent(result.pdfDocumentId)}`}
                  className="btn btn-primary btn-sm min-h-[44px]"
                >
                  Open PDF
                </Link>
                <Link
                  href={`/documents?doc=${encodeURIComponent(result.docxDocumentId)}`}
                  className="btn btn-secondary btn-sm min-h-[44px]"
                >
                  Open .docx
                </Link>
              </div>
              {result.unresolvedFields.length > 0 && (
                <p className="text-sm text-slate-500 dark:text-white/50">
                  Fields with no data (shown as “—”):{" "}
                  {result.unresolvedFields.join(", ")}
                </p>
              )}
              <p className="text-sm text-slate-500 dark:text-white/50">
                Manage signers, status, redlines and versions from the
                company&apos;s Contracts section
                {scope === "investor" ? " or this investor's Documents card" : ""}.
              </p>
              <button
                type="button"
                className="btn btn-secondary min-h-[44px] w-full"
                onClick={onClose}
              >
                Done
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

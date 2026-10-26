"use client";

/**
 * ContractsPanel (Contract generation, Oct 24, 2026) — the Contracts
 * surface on the company profile (and, with investorPersonId, on the
 * investor's record). Lists every agreement with type, counterparty,
 * status, version history, key dates and file links; expanding a
 * contract manages signers, the status flow
 * (draft → in review → out for signature → executed), counterparty
 * redline uploads (each a new version), a version comparison view,
 * and AI summaries — always labeled "AI draft — for attorney
 * review". Every action lands in the contract's audit/event log.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { EmptyState, ErrorState, SkeletonRows } from "@/components/ui";
import { fmtDate } from "@/lib/format";
import ContractSendDialog from "@/components/docgen/ContractSendDialog";

type ContractStatus = "draft" | "in_review" | "out_for_signature" | "executed";

interface Contract {
  id: string;
  title: string;
  templateName: string;
  templateKey: string;
  templateVersion: number;
  scope: string;
  companyId: string | null;
  dealId: string | null;
  investorPersonId: string | null;
  companyName: string;
  investorName: string;
  counterpartyName: string;
  counterpartyEmail: string;
  counterpartyTitle: string;
  counterpartyCompany: string;
  status: ContractStatus;
  currentVersion: number;
  currentDocumentId: string | null;
  currentPdfDocumentId: string | null;
  roomId: string | null;
  keyDates: { exclusivityExpiry: string | null; closing: string | null; renewal: string | null };
  signers: Signer[];
  aiSummary: string;
  aiSummaryVersion: number | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

interface Signer {
  name: string;
  email: string;
  title: string;
  order: number;
  status: string;
  signedAt: string | null;
  envelopeId: string | null;
}

interface Version {
  id: string;
  version: number;
  kind: string;
  documentId: string;
  documentName: string;
  pdfDocumentId: string | null;
  pdfDocumentName: string;
  note: string;
  aiChangeSummary: string;
  createdBy: string;
  createdAt: string;
}

interface ContractEvent {
  id: string;
  actor: string;
  kind: string;
  detail: string;
  createdAt: string;
}

interface Detail {
  contract: Contract;
  versions: Version[];
  events: ContractEvent[];
  envelope: { id: string; status: string; detail: string } | null;
  aiConfigured: boolean;
  esignProvider: string;
}

interface DiffData {
  added: number;
  removed: number;
  truncated: boolean;
  lines: Array<{ type: "same" | "add" | "del"; text: string }>;
}

const STATUS_LABEL: Record<ContractStatus, string> = {
  draft: "Draft",
  in_review: "In review",
  out_for_signature: "Out for signature",
  executed: "Executed",
};

const STATUS_BADGE: Record<ContractStatus, string> = {
  draft: "badge-neutral",
  in_review: "badge-warn",
  out_for_signature: "badge-warn",
  executed: "badge-fit",
};

const inputCls =
  "w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-[#0d1f3c] outline-none focus:border-[#b8975a] dark:border-white/10 dark:bg-[#132847]/60 dark:text-white";
const labelCls =
  "mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-white/40";

function AiLabel() {
  return (
    <span className="badge bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-200">
      AI draft — for attorney review
    </span>
  );
}

export default function ContractsPanel({
  companyId,
  investorPersonId,
}: {
  companyId?: string;
  investorPersonId?: string;
}) {
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const params = new URLSearchParams({ limit: "50" });
      if (companyId) params.set("companyId", companyId);
      if (investorPersonId) params.set("investorPersonId", investorPersonId);
      const res = await fetch(`/api/platform/docgen/contracts?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { contracts?: Contract[] };
      setContracts(Array.isArray(data.contracts) ? data.contracts : []);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [companyId, investorPersonId]);

  useEffect(() => {
    void load();
  }, [load, reloadTick]);

  const isInvestor = Boolean(investorPersonId);

  return (
    <section className="card-surface p-5" aria-label="Contracts" id="contracts">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-bold uppercase tracking-wide text-[#0d1f3c] dark:text-white">
          Contracts
        </h2>
        <span className="text-xs text-caption">
          Agreements, versions, signers and key dates
        </span>
      </div>

      {loading ? (
        <SkeletonRows rows={3} />
      ) : error ? (
        <ErrorState
          title="Could not load contracts"
          message="The contracts list could not be loaded — try again in a moment."
          onRetry={() => setReloadTick((t) => t + 1)}
        />
      ) : contracts.length === 0 ? (
        <EmptyState
          title="No contracts yet"
          message={
            isInvestor
              ? "Draft a document for this investor — it will be registered here with its versions and signers."
              : "Generate a document from a deal — approved templates only — and it will be registered here with its versions and signers."
          }
        />
      ) : (
        <ul className="divide-y divide-slate-100 dark:divide-white/5">
          {contracts.map((c) => (
            <li key={c.id} className="py-3 first:pt-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-slate-800 dark:text-white/90">
                    {c.title}
                  </span>
                  <span className="block text-xs text-caption">
                    {c.templateName} v{c.templateVersion}
                    {c.counterpartyName
                      ? ` · ${c.counterpartyName}${c.counterpartyCompany ? ` (${c.counterpartyCompany})` : ""}`
                      : ""}
                    {isInvestor && c.companyName ? ` · ${c.companyName}` : ""}
                    {" "}· v{c.currentVersion} · updated {fmtDate(c.updatedAt)}
                  </span>
                </span>
                <span className={`badge ${STATUS_BADGE[c.status]}`}>
                  {STATUS_LABEL[c.status]}
                </span>
                {c.currentPdfDocumentId && (
                  <Link
                    href={`/documents?doc=${encodeURIComponent(c.currentPdfDocumentId)}`}
                    className="btn btn-secondary btn-sm min-h-[44px]"
                  >
                    PDF
                  </Link>
                )}
                {c.currentDocumentId && (
                  <Link
                    href={`/documents?doc=${encodeURIComponent(c.currentDocumentId)}`}
                    className="btn btn-secondary btn-sm min-h-[44px]"
                  >
                    File
                  </Link>
                )}
                <button
                  type="button"
                  className="btn btn-secondary btn-sm min-h-[44px]"
                  onClick={() => setOpenId(openId === c.id ? null : c.id)}
                >
                  {openId === c.id ? "Close" : "Manage"}
                </button>
              </div>
              {(c.keyDates.exclusivityExpiry || c.keyDates.closing || c.keyDates.renewal) && (
                <p className="mt-1.5 flex flex-wrap gap-1.5">
                  {c.keyDates.exclusivityExpiry && (
                    <span className="badge badge-neutral">
                      Exclusivity {fmtDate(c.keyDates.exclusivityExpiry)}
                    </span>
                  )}
                  {c.keyDates.closing && (
                    <span className="badge badge-neutral">
                      Closing {fmtDate(c.keyDates.closing)}
                    </span>
                  )}
                  {c.keyDates.renewal && (
                    <span className="badge badge-neutral">
                      Renewal {fmtDate(c.keyDates.renewal)}
                    </span>
                  )}
                </p>
              )}
              {openId === c.id && (
                <ContractDetail
                  contractId={c.id}
                  onChanged={() => setReloadTick((t) => t + 1)}
                />
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ContractDetail({
  contractId,
  onChanged,
}: {
  contractId: string;
  onChanged: () => void;
}) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [signers, setSigners] = useState<Signer[]>([]);
  const [keyDates, setKeyDates] = useState({
    exclusivityExpiry: "",
    closing: "",
    renewal: "",
  });
  const [showSend, setShowSend] = useState(false);
  const [cmpFrom, setCmpFrom] = useState(0);
  const [cmpTo, setCmpTo] = useState(0);
  const [diff, setDiff] = useState<DiffData | null>(null);
  const [aiBusy, setAiBusy] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/platform/docgen/contracts/${contractId}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as Detail;
      setDetail(data);
      setSigners(data.contract.signers);
      setKeyDates({
        exclusivityExpiry: data.contract.keyDates.exclusivityExpiry ?? "",
        closing: data.contract.keyDates.closing ?? "",
        renewal: data.contract.keyDates.renewal ?? "",
      });
      if (data.versions.length >= 2) {
        setCmpFrom(data.versions[1].version);
        setCmpTo(data.versions[0].version);
      }
    } catch {
      setError("Could not load this contract's detail.");
    } finally {
      setLoading(false);
    }
  }, [contractId]);

  useEffect(() => {
    void load();
  }, [load]);

  const patch = async (body: Record<string, unknown>, okMsg: string) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/platform/docgen/contracts/${contractId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setNotice(okMsg);
      await load();
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Update failed.");
    } finally {
      setBusy(false);
    }
  };

  const uploadRedline = async (file: File) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const form = new FormData();
      form.set("file", file);
      form.set("note", "Counterparty redline");
      const res = await fetch(
        `/api/platform/docgen/contracts/${contractId}/redline`,
        { method: "POST", body: form }
      );
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        version?: number;
      };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setNotice(`Redline saved as version ${data.version}.`);
      setDiff(null);
      await load();
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Redline upload failed.");
    } finally {
      setBusy(false);
    }
  };

  const runCompare = async () => {
    if (!cmpFrom || !cmpTo || cmpFrom === cmpTo) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/platform/docgen/contracts/${contractId}/compare?from=${cmpFrom}&to=${cmpTo}`
      );
      const data = (await res.json().catch(() => ({}))) as DiffData & {
        error?: string;
      };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setDiff(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Comparison failed.");
    } finally {
      setBusy(false);
    }
  };

  const runAi = async (kind: "summary" | "changes") => {
    setAiBusy(kind);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/platform/docgen/contracts/${contractId}/ai`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          kind === "summary" ? { kind } : { kind, from: cmpFrom, to: cmpTo }
        ),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setNotice(
        kind === "summary"
          ? "AI summary generated — labeled as a draft for attorney review."
          : "AI change summary generated — labeled as a draft for attorney review."
      );
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "AI request failed.");
    } finally {
      setAiBusy("");
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      const res = await fetch(`/api/platform/docgen/contracts/${contractId}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      onChanged();
    } catch {
      setError("Delete failed.");
      setBusy(false);
    }
  };

  if (loading) return <SkeletonRows rows={4} />;
  if (!detail) {
    return (
      <p className="mt-3 text-sm text-red-600 dark:text-red-300">
        {error ?? "Detail unavailable."}
      </p>
    );
  }
  const c = detail.contract;
  const executed = c.status === "executed";

  return (
    <div className="mt-4 rounded-2xl border border-slate-200 p-4 dark:border-white/10">
      {error && (
        <p role="alert" className="mb-3 rounded-xl bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-300">
          {error}
        </p>
      )}
      {notice && (
        <p className="mb-3 rounded-xl bg-emerald-500/10 px-4 py-3 text-sm text-emerald-800 dark:text-emerald-200">
          {notice}
        </p>
      )}

      {/* Status flow */}
      <div className="flex flex-wrap items-center gap-2">
        <span className={`badge ${STATUS_BADGE[c.status]}`}>
          {STATUS_LABEL[c.status]}
        </span>
        {detail.envelope && (
          <span className="badge badge-neutral">
            Envelope: {detail.envelope.status}
          </span>
        )}
        <span className="text-xs text-slate-400 dark:text-white/40">
          Signing provider: {detail.esignProvider} · Generated by {c.createdBy} ·{" "}
          {fmtDate(c.createdAt)}
        </span>
        <span className="flex-1" />
        {c.status === "draft" && (
          <button type="button" className="btn btn-secondary btn-sm min-h-[44px]" disabled={busy}
            onClick={() => void patch({ status: "in_review" }, "Moved to in review.")}>
            Move to in review
          </button>
        )}
        {c.status === "in_review" && (
          <button type="button" className="btn btn-secondary btn-sm min-h-[44px]" disabled={busy}
            onClick={() => void patch({ status: "draft" }, "Returned to draft.")}>
            Back to draft
          </button>
        )}
        {!executed && (
          <button type="button" className="btn btn-primary btn-sm min-h-[44px]" disabled={busy}
            onClick={() => setShowSend(true)}>
            Send…
          </button>
        )}
        {!executed && (
          <button type="button" className="btn btn-secondary btn-sm min-h-[44px]" disabled={busy}
            onClick={() => void patch({ status: "executed" }, "Marked executed. Key dates now flow to the Calendar.")}>
            Mark executed
          </button>
        )}
        {confirmDelete ? (
          <>
            <button type="button" className="btn btn-sm min-h-[44px] bg-red-600 text-white hover:bg-red-700" disabled={busy} onClick={() => void remove()}>
              Confirm delete
            </button>
            <button type="button" className="btn btn-secondary btn-sm min-h-[44px]" onClick={() => setConfirmDelete(false)}>
              Keep
            </button>
          </>
        ) : (
          <button type="button" className="btn btn-secondary btn-sm min-h-[44px]" disabled={busy} onClick={() => setConfirmDelete(true)}>
            Delete
          </button>
        )}
      </div>

      <div className="mt-4 grid gap-5 lg:grid-cols-2">
        {/* Signers */}
        <div>
          <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-[#0d1f3c] dark:text-white">
            Signers
          </h3>
          <div className="space-y-2">
            {signers.map((s, i) => (
              <div key={i} className="grid grid-cols-[1fr_1fr_auto] items-end gap-2">
                <div>
                  <label className={labelCls}>Name</label>
                  <input className={`${inputCls} min-h-[40px]`} value={s.name} disabled={executed}
                    onChange={(e) => setSigners((arr) => arr.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
                </div>
                <div>
                  <label className={labelCls}>Email</label>
                  <input className={`${inputCls} min-h-[40px]`} value={s.email} disabled={executed}
                    onChange={(e) => setSigners((arr) => arr.map((x, j) => (j === i ? { ...x, email: e.target.value } : x)))} />
                </div>
                <span className="flex items-center gap-2 pb-1">
                  <span className="badge badge-neutral">
                    {s.status}
                    {s.signedAt ? ` · ${fmtDate(s.signedAt)}` : ""}
                  </span>
                  {!executed && (
                    <button type="button" className="text-xs font-semibold text-red-600 hover:underline"
                      onClick={() => setSigners((arr) => arr.filter((_, j) => j !== i))}>
                      Remove
                    </button>
                  )}
                </span>
                <div className="col-span-2">
                  <input className={`${inputCls} min-h-[40px]`} value={s.title} placeholder="Title" disabled={executed}
                    onChange={(e) => setSigners((arr) => arr.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))} />
                </div>
              </div>
            ))}
          </div>
          {!executed && (
            <div className="mt-2 flex gap-2">
              <button type="button" className="btn btn-secondary btn-sm min-h-[44px]"
                onClick={() => setSigners((arr) => [...arr, { name: "", email: "", title: "", order: arr.length + 1, status: "pending", signedAt: null, envelopeId: null }])}>
                Add signer
              </button>
              <button type="button" className="btn btn-secondary btn-sm min-h-[44px]" disabled={busy}
                onClick={() => void patch({ signers }, "Signers saved.")}>
                Save signers
              </button>
            </div>
          )}

          <h3 className="mb-2 mt-5 text-xs font-bold uppercase tracking-wider text-[#0d1f3c] dark:text-white">
            Key dates
          </h3>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className={labelCls}>Exclusivity expiry</label>
              <input type="date" className={`${inputCls} min-h-[40px]`} value={keyDates.exclusivityExpiry} disabled={executed}
                onChange={(e) => setKeyDates((k) => ({ ...k, exclusivityExpiry: e.target.value }))} />
            </div>
            <div>
              <label className={labelCls}>Closing</label>
              <input type="date" className={`${inputCls} min-h-[40px]`} value={keyDates.closing} disabled={executed}
                onChange={(e) => setKeyDates((k) => ({ ...k, closing: e.target.value }))} />
            </div>
            <div>
              <label className={labelCls}>Renewal</label>
              <input type="date" className={`${inputCls} min-h-[40px]`} value={keyDates.renewal} disabled={executed}
                onChange={(e) => setKeyDates((k) => ({ ...k, renewal: e.target.value }))} />
            </div>
          </div>
          {!executed && (
            <button type="button" className="btn btn-secondary btn-sm mt-2 min-h-[44px]" disabled={busy}
              onClick={() => void patch({ keyDates: {
                exclusivityExpiry: keyDates.exclusivityExpiry || null,
                closing: keyDates.closing || null,
                renewal: keyDates.renewal || null,
              } }, "Key dates saved.")}>
              Save key dates
            </button>
          )}
          <p className="mt-1 text-xs text-slate-400">
            Executed contracts place these dates on the Calendar.
          </p>
        </div>

        {/* Versions + compare */}
        <div>
          <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-[#0d1f3c] dark:text-white">
            Versions
          </h3>
          <ul className="divide-y divide-slate-100 dark:divide-white/5">
            {detail.versions.map((v) => (
              <li key={v.id} className="py-2">
                <p className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-semibold text-[#0d1f3c] dark:text-white">
                    v{v.version}
                  </span>
                  <span className="badge badge-neutral">{v.kind}</span>
                  <span className="min-w-0 flex-1 truncate text-slate-600 dark:text-white/70">
                    {v.documentName || v.pdfDocumentName}
                  </span>
                  {v.pdfDocumentId && (
                    <Link href={`/documents?doc=${encodeURIComponent(v.pdfDocumentId)}`} className="text-xs font-semibold text-gold-700 hover:underline dark:text-gold-400">
                      PDF
                    </Link>
                  )}
                  <Link href={`/documents?doc=${encodeURIComponent(v.documentId)}`} className="text-xs font-semibold text-gold-700 hover:underline dark:text-gold-400">
                    File
                  </Link>
                </p>
                <p className="mt-0.5 text-xs text-slate-400">
                  {v.note} · {v.createdBy} · {fmtDate(v.createdAt)}
                </p>
                {v.aiChangeSummary && (
                  <div className="mt-2 rounded-xl bg-slate-50 px-3 py-2 dark:bg-white/5">
                    <AiLabel />
                    <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700 dark:text-white/80">
                      {v.aiChangeSummary}
                    </p>
                  </div>
                )}
              </li>
            ))}
          </ul>
          {!executed && (
            <>
              <button type="button" className="btn btn-secondary btn-sm mt-2 min-h-[44px]" disabled={busy}
                onClick={() => fileRef.current?.click()}>
                Upload counterparty redline (new version)
              </button>
              <input ref={fileRef} type="file" className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void uploadRedline(f);
                  e.target.value = "";
                }} />
            </>
          )}

          {detail.versions.length >= 2 && (
            <div className="mt-4">
              <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-[#0d1f3c] dark:text-white">
                Compare versions
              </h3>
              <div className="flex flex-wrap items-center gap-2">
                <select className={`${inputCls} min-h-[40px] w-auto`} value={cmpFrom}
                  onChange={(e) => setCmpFrom(Number(e.target.value))}>
                  {detail.versions.map((v) => (
                    <option key={v.id} value={v.version}>v{v.version}</option>
                  ))}
                </select>
                <span className="text-sm text-slate-400">→</span>
                <select className={`${inputCls} min-h-[40px] w-auto`} value={cmpTo}
                  onChange={(e) => setCmpTo(Number(e.target.value))}>
                  {detail.versions.map((v) => (
                    <option key={v.id} value={v.version}>v{v.version}</option>
                  ))}
                </select>
                <button type="button" className="btn btn-secondary btn-sm min-h-[44px]" disabled={busy}
                  onClick={() => void runCompare()}>
                  Compare
                </button>
                {detail.aiConfigured && (
                  <button type="button" className="btn btn-secondary btn-sm min-h-[44px]" disabled={aiBusy === "changes"}
                    onClick={() => void runAi("changes")}>
                    {aiBusy === "changes" ? "Summarizing…" : "AI change summary"}
                  </button>
                )}
              </div>
              {diff && (
                <div className="mt-3 max-h-[380px] overflow-y-auto rounded-xl border border-slate-100 dark:border-white/10">
                  <p className="border-b border-slate-100 px-3 py-2 text-xs text-slate-500 dark:border-white/10 dark:text-white/50">
                    {diff.added} line{diff.added === 1 ? "" : "s"} added ·{" "}
                    {diff.removed} removed
                    {diff.truncated ? " · diff truncated for display" : ""}
                  </p>
                  <pre className="whitespace-pre-wrap px-3 py-2 font-mono text-xs leading-relaxed">
                    {diff.lines.map((l, i) => (
                      <div key={i} className={
                        l.type === "add"
                          ? "bg-emerald-500/10 text-emerald-900 dark:text-emerald-200"
                          : l.type === "del"
                            ? "bg-red-500/10 text-red-900 line-through dark:text-red-200"
                            : "text-slate-500 dark:text-white/50"
                      }>
                        {l.type === "add" ? "+ " : l.type === "del" ? "− " : "  "}
                        {l.text}
                      </div>
                    ))}
                  </pre>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* AI summary */}
      <div className="mt-5 border-t border-slate-100 pt-4 dark:border-white/5">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-xs font-bold uppercase tracking-wider text-[#0d1f3c] dark:text-white">
            AI summary
          </h3>
          {detail.aiConfigured ? (
            <button type="button" className="btn btn-secondary btn-sm min-h-[44px]" disabled={aiBusy === "summary"}
              onClick={() => void runAi("summary")}>
              {aiBusy === "summary"
                ? "Summarizing…"
                : c.aiSummary
                  ? "Regenerate summary"
                  : "Summarize this contract"}
            </button>
          ) : (
            <span className="text-xs text-slate-400">
              AI is not configured — summaries are unavailable.
            </span>
          )}
        </div>
        {c.aiSummary && (
          <div className="mt-2 rounded-xl bg-slate-50 px-4 py-3 dark:bg-white/5">
            <AiLabel />
            <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700 dark:text-white/80">
              {c.aiSummary}
            </p>
            <p className="mt-1 text-xs text-slate-400">
              Summary of v{c.aiSummaryVersion ?? c.currentVersion}. AI
              summarizes only — it never drafts contract language.
            </p>
          </div>
        )}
      </div>

      {/* Audit / event log */}
      <div className="mt-5 border-t border-slate-100 pt-4 dark:border-white/5">
        <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-[#0d1f3c] dark:text-white">
          History
        </h3>
        {detail.events.length === 0 ? (
          <p className="text-sm text-slate-400">No events recorded.</p>
        ) : (
          <ol className="relative space-y-3 border-l border-slate-200 pl-4 dark:border-white/10">
            {detail.events.map((e) => (
              <li key={e.id} className="relative">
                <span aria-hidden className="absolute -left-[1.3rem] top-1.5 h-2 w-2 rounded-full bg-[#b8975a]" />
                <p className="text-sm leading-snug text-slate-700 dark:text-white/85">
                  {e.detail}
                </p>
                <p className="mt-0.5 text-xs text-caption">
                  {e.actor} · {e.kind.replace(/_/g, " ")} · {fmtDate(e.createdAt)}
                </p>
              </li>
            ))}
          </ol>
        )}
      </div>

      {showSend && (
        <ContractSendDialog
          contract={{
            id: c.id,
            title: c.title,
            status: c.status,
            signers: signers.map((s) => ({
              name: s.name,
              email: s.email,
              status: s.status,
            })),
            counterpartyName: c.counterpartyName,
            counterpartyEmail: c.counterpartyEmail,
            investorPersonId: c.investorPersonId,
          }}
          onClose={() => setShowSend(false)}
          onChanged={() => {
            void load();
            onChanged();
          }}
        />
      )}
    </div>
  );
}

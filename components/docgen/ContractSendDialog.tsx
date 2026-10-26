"use client";

/**
 * ContractSendDialog (Send anywhere, Oct 25, 2026) — the shared Send
 * dialog for contracts/documents, mounted from ContractsPanel's
 * expanded detail so it appears unchanged on the company profile,
 * the raise workspace Documents tab, the investor record and
 * Diligence.
 *
 * Channels:
 * - Signature: the existing send-for-signature flow. The one-time
 *   signer links and the envelope's email status are shown HERE
 *   (sent = signer emails went out; setup_required / manual_link =
 *   share the links yourself).
 * - Email: the current PDF as an attachment to picked recipients
 *   (Directory search, the contract's counterparty / investor, or
 *   manual entry). The server enforces the same data-room gate as
 *   signature and logs every attempt.
 *
 * Prior sends for the contract are listed from the send log. The
 * panel is full-screen on mobile.
 */

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui";
import { fmtDate } from "@/lib/format";

export interface SendDialogContract {
  id: string;
  title: string;
  status: string;
  signers: Array<{ name: string; email: string; status: string }>;
  counterpartyName: string;
  counterpartyEmail: string;
  investorPersonId: string | null;
}

interface SendLogRow {
  id: string;
  recipientName: string;
  recipientEmail: string;
  channel: string;
  actor: string;
  state: string;
  error: string;
  createdAt: string;
}

interface RecipientRow {
  name: string;
  email: string;
}

interface DirectoryHit {
  id: string;
  name: string;
  email: string;
  sub: string;
}

const inputCls =
  "w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-[#0d1f3c] outline-none focus:border-[#b8975a] dark:border-white/10 dark:bg-[#132847]/60 dark:text-white";
const labelCls =
  "mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-white/40";

const ROOM_ERROR =
  "That recipient is not an approved party for this data room (U.S.-persons-only / restricted). Add them to the Directory or the room's domain allowlist first.";

function friendlyError(code: string, status: number): string {
  if (code === "signer_not_approved_for_room") return ROOM_ERROR;
  if (code === "signable_pdf_unavailable")
    return "This version has no signable PDF. Re-upload the current version — a PDF companion is created automatically — then send again.";
  if (code === "already_sent") return "This contract is already out for signature.";
  if (code === "contract_executed") return "This contract is executed — it can no longer be sent.";
  if (code === "signers_required") return "Add at least one signer to the contract first.";
  if (code === "signer_email_required") return "Every signer needs an email address.";
  if (code === "recipients_required") return "Add at least one recipient with an email address.";
  if (code === "document_not_found") return "The contract's current file could not be found.";
  return `Send failed (${code || status}).`;
}

function emailStatusText(status: string): string {
  if (status === "sent") return "Signer emails were sent by the portal.";
  if (status === "setup_required")
    return "Email transport needs setup — the signer emails were NOT sent. Share each link below yourself.";
  return "Share each signer link below yourself — links are shown once.";
}

export default function ContractSendDialog({
  contract,
  onClose,
  onChanged,
}: {
  contract: SendDialogContract;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [channel, setChannel] = useState<"signature" | "email">("signature");
  const [log, setLog] = useState<SendLogRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sigResult, setSigResult] = useState<{
    provider: string;
    emailStatus: string;
    links: Array<{ name: string; email: string; url: string }>;
  } | null>(null);

  const [recipients, setRecipients] = useState<RecipientRow[]>(() =>
    contract.counterpartyEmail
      ? [{ name: contract.counterpartyName, email: contract.counterpartyEmail }]
      : [{ name: "", email: "" }]
  );
  const [subject, setSubject] = useState(
    `Document for your review: ${contract.title}`
  );
  const [emailResult, setEmailResult] = useState<Array<{
    recipientName: string;
    recipientEmail: string;
    state: string;
    error: string;
  }> | null>(null);

  const loadLog = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/platform/docgen/contracts/${contract.id}/sends`,
        { cache: "no-store" }
      );
      if (!res.ok) return;
      const data = (await res.json()) as { sends?: SendLogRow[] };
      setLog(Array.isArray(data.sends) ? data.sends : []);
    } catch {
      /* the log is informational; sending still works without it */
    }
  }, [contract.id]);

  useEffect(() => {
    void loadLog();
  }, [loadLog]);

  // Resolve the contract's investor to a name + email via the capital
  // investors list (commitments carry no emails; the list items do).
  useEffect(() => {
    if (!contract.investorPersonId) return;
    (async () => {
      try {
        const res = await fetch("/api/platform/capital/investors?limit=100", {
          cache: "no-store",
        });
        if (!res.ok) return;
        const data = (await res.json()) as {
          items?: Array<{ personId: string; name: string; email: string }>;
        };
        const inv = (data.items ?? []).find(
          (i) => i.personId === contract.investorPersonId
        );
        if (inv?.email) {
          setRecipients((rows) =>
            rows.some((r) => r.email.toLowerCase() === inv.email.toLowerCase())
              ? rows
              : [{ name: inv.name, email: inv.email }, ...rows.filter((r) => r.email)]
          );
        }
      } catch {
        /* investor prefill is best-effort */
      }
    })();
  }, [contract.investorPersonId]);

  const sendSignature = async () => {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(
        `/api/platform/docgen/contracts/${contract.id}/send`,
        { method: "POST" }
      );
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        provider?: string;
        emailStatus?: string;
        links?: Array<{ name: string; email: string; url: string }>;
      };
      if (!res.ok) throw new Error(friendlyError(data.error ?? "", res.status));
      setSigResult({
        provider: data.provider ?? "in-house",
        emailStatus: data.emailStatus ?? "manual_link",
        links: Array.isArray(data.links) ? data.links : [],
      });
      await loadLog();
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Send failed.");
    } finally {
      setBusy(false);
    }
  };

  const sendEmail = async () => {
    const rows = recipients.filter((r) => r.email.includes("@"));
    if (!rows.length) {
      setError("Add at least one recipient with an email address.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await fetch(
        `/api/platform/docgen/contracts/${contract.id}/send-email`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ recipients: rows, subject }),
        }
      );
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        sends?: Array<{
          recipientName: string;
          recipientEmail: string;
          state: string;
          error: string;
        }>;
      };
      if (!res.ok) throw new Error(friendlyError(data.error ?? "", res.status));
      setEmailResult(Array.isArray(data.sends) ? data.sends : []);
      await loadLog();
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Send failed.");
    } finally {
      setBusy(false);
    }
  };

  const canSignature =
    contract.status === "draft" || contract.status === "in_review";

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-navy-950/60 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`Send ${contract.title}`}
      onClick={() => !busy && onClose()}
    >
      <div
        className="card-surface flex h-full w-full flex-col overflow-hidden p-5 sm:h-auto sm:max-h-[92vh] sm:max-w-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="font-display text-xl font-semibold text-navy-900 dark:text-white">
              Send contract
            </h3>
            <p className="mt-0.5 truncate text-sm text-slate-500 dark:text-white/50">
              {contract.title}
            </p>
          </div>
          <Button variant="ghost" size="sm" className="min-h-[44px]" onClick={onClose} disabled={busy}>
            Close
          </Button>
        </div>

        <div className="mt-4 flex gap-1.5" role="tablist" aria-label="Send channel">
          <button
            type="button"
            role="tab"
            aria-selected={channel === "signature"}
            className={`btn btn-sm min-h-[44px] flex-1 ${channel === "signature" ? "btn-primary" : "btn-secondary"}`}
            onClick={() => setChannel("signature")}
          >
            For signature
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={channel === "email"}
            className={`btn btn-sm min-h-[44px] flex-1 ${channel === "email" ? "btn-primary" : "btn-secondary"}`}
            onClick={() => setChannel("email")}
          >
            Email the PDF
          </button>
        </div>

        <div className="mt-4 min-h-0 flex-1 overflow-y-auto">
          {error && (
            <p role="alert" className="mb-3 rounded-xl bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-300">
              {error}
            </p>
          )}

          {channel === "signature" && (
            <div>
              {contract.status === "executed" ? (
                <p className="text-sm text-slate-500 dark:text-white/50">
                  This contract is executed — it can no longer be sent for signature.
                </p>
              ) : contract.status === "out_for_signature" && !sigResult ? (
                <p className="text-sm text-slate-500 dark:text-white/50">
                  This contract is already out for signature. The signer
                  links were shown once, at send time — see the send log
                  below for the recorded outcome.
                </p>
              ) : sigResult ? (
                <div className="space-y-3">
                  <p className="rounded-xl bg-emerald-500/10 px-4 py-3 text-sm text-emerald-800 dark:text-emerald-200">
                    Sent for signature via {sigResult.provider} signing.{" "}
                    {emailStatusText(sigResult.emailStatus)}
                  </p>
                  {sigResult.links.length > 0 && (
                    <div className="rounded-xl bg-slate-50 px-4 py-3 dark:bg-white/5">
                      <p className="text-sm font-semibold text-[#0d1f3c] dark:text-white">
                        Signer links (shown once — share with each signer)
                      </p>
                      <ul className="mt-2 space-y-1.5">
                        {sigResult.links.map((l) => (
                          <li key={l.email} className="break-all text-sm text-slate-600 dark:text-white/70">
                            {l.name} ({l.email}):{" "}
                            <span className="font-mono text-xs">{l.url}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              ) : (
                <>
                  <p className="text-sm text-slate-500 dark:text-white/50">
                    Signers on this contract:
                  </p>
                  {contract.signers.length === 0 ? (
                    <p className="mt-2 rounded-xl bg-amber-500/10 px-4 py-3 text-sm text-amber-800 dark:text-amber-200">
                      No signers yet — add signers in the contract detail first.
                    </p>
                  ) : (
                    <ul className="mt-2 space-y-1.5">
                      {contract.signers.map((s, i) => (
                        <li key={i} className="flex flex-wrap items-center gap-2 text-sm text-slate-700 dark:text-white/80">
                          <span className="font-medium">{s.name || "—"}</span>
                          <span className="text-slate-400">{s.email}</span>
                          <span className="badge badge-neutral">{s.status}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  <p className="mt-3 text-xs text-slate-400 dark:text-white/40">
                    If the contract sits in a U.S.-persons-only or restricted
                    data room, every signer must be an approved party for
                    that room (Directory record or allowlisted domain).
                  </p>
                  <div className="mt-4 flex justify-end">
                    <Button
                      variant="primary"
                      size="sm"
                      className="min-h-[44px]"
                      onClick={() => void sendSignature()}
                      loading={busy}
                      disabled={busy || !canSignature || contract.signers.length === 0}
                    >
                      Send for signature
                    </Button>
                  </div>
                </>
              )}
            </div>
          )}

          {channel === "email" && (
            <div>
              {emailResult ? (
                <div className="space-y-3">
                  <p className="rounded-xl bg-slate-500/10 px-4 py-3 text-sm text-slate-700 dark:text-white/80">
                    Email attempts recorded — per-recipient outcomes:
                  </p>
                  {emailResult.map((s, i) => (
                    <p key={i} className="text-sm text-slate-600 dark:text-white/70">
                      <span className="font-semibold">{s.recipientName || s.recipientEmail}</span>{" "}
                      — {s.state === "sent"
                        ? "sent"
                        : s.state === "setup_required"
                          ? "NOT sent — email transport needs setup"
                          : `failed${s.error ? ` (${s.error})` : ""}`}
                    </p>
                  ))}
                  <div className="flex justify-end">
                    <Button variant="primary" size="sm" className="min-h-[44px]" onClick={onClose}>
                      Done
                    </Button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="space-y-3">
                    {recipients.map((row, i) => (
                      <div key={i} className="rounded-xl border border-slate-200 p-3 dark:border-white/10">
                        <DirectoryPicker
                          onPick={(hit) =>
                            setRecipients((rows) =>
                              rows.map((r, j) =>
                                j === i ? { name: hit.name, email: hit.email || r.email } : r
                              )
                            )
                          }
                        />
                        <div className="mt-2 grid gap-2 sm:grid-cols-2">
                          <div>
                            <label className={labelCls}>Name</label>
                            <input
                              className={`${inputCls} min-h-[44px]`}
                              value={row.name}
                              onChange={(e) =>
                                setRecipients((rows) =>
                                  rows.map((r, j) => (j === i ? { ...r, name: e.target.value } : r))
                                )
                              }
                              placeholder="Recipient name"
                            />
                          </div>
                          <div>
                            <label className={labelCls}>Email</label>
                            <input
                              className={`${inputCls} min-h-[44px]`}
                              value={row.email}
                              onChange={(e) =>
                                setRecipients((rows) =>
                                  rows.map((r, j) => (j === i ? { ...r, email: e.target.value } : r))
                                )
                              }
                              placeholder="name@example.com"
                            />
                          </div>
                        </div>
                        {recipients.length > 1 && (
                          <div className="mt-2 text-right">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setRecipients((rows) => rows.filter((_, j) => j !== i))}
                            >
                              Remove recipient
                            </Button>
                          </div>
                        )}
                      </div>
                    ))}
                    <Button
                      variant="secondary"
                      size="sm"
                      className="min-h-[44px]"
                      onClick={() => setRecipients((rows) => [...rows, { name: "", email: "" }])}
                    >
                      Add recipient
                    </Button>
                  </div>
                  <div className="mt-4">
                    <label className={labelCls}>Subject</label>
                    <input
                      className={`${inputCls} min-h-[44px]`}
                      value={subject}
                      onChange={(e) => setSubject(e.target.value)}
                    />
                  </div>
                  <p className="mt-3 text-xs text-slate-400 dark:text-white/40">
                    The current PDF is attached. If the contract sits in a
                    U.S.-persons-only or restricted data room, every
                    recipient must be an approved party for that room —
                    the same gate as sending for signature.
                  </p>
                  <div className="mt-4 flex justify-end">
                    <Button
                      variant="primary"
                      size="sm"
                      className="min-h-[44px]"
                      onClick={() => void sendEmail()}
                      loading={busy}
                      disabled={busy || contract.status === "executed"}
                    >
                      Email the PDF
                    </Button>
                  </div>
                </>
              )}
            </div>
          )}

          {/* Send log */}
          {log.length > 0 && (
            <div className="mt-6 border-t border-slate-100 pt-4 dark:border-white/5">
              <h4 className="text-xs font-bold uppercase tracking-wider text-[#0d1f3c] dark:text-white">
                Previous sends
              </h4>
              <ul className="mt-2 space-y-2">
                {log.map((s) => (
                  <li key={s.id} className="flex flex-wrap items-center gap-2 text-sm text-slate-600 dark:text-white/70">
                    <span className="badge badge-neutral">
                      {s.channel === "signature" ? "Signature" : "Email"}
                    </span>
                    <span className="font-medium">{s.recipientName || s.recipientEmail}</span>
                    <span className="text-xs text-slate-400">{s.recipientEmail}</span>
                    <span className={`badge ${s.state === "sent" ? "badge-fit" : "badge-warn"}`}>
                      {s.state.replace(/_/g, " ")}
                    </span>
                    <span className="text-xs text-slate-400">
                      {s.actor} · {fmtDate(s.createdAt)}
                    </span>
                    {s.error && (
                      <span className="w-full text-xs text-red-600 dark:text-red-300">{s.error}</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** Directory search picker — the SendDialog pattern: search people,
 * pick to fill the row's name + email. */
function DirectoryPicker({ onPick }: { onPick: (hit: DirectoryHit) => void }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<DirectoryHit[]>([]);
  const [open, setOpen] = useState(false);

  const search = async (term: string) => {
    setQ(term);
    if (term.trim().length < 2) {
      setHits([]);
      setOpen(false);
      return;
    }
    try {
      const res = await fetch(
        `/api/platform/directory?q=${encodeURIComponent(term.trim())}&limit=10`,
        { cache: "no-store" }
      );
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      const rows = (Array.isArray(data.items)
        ? data.items
        : Array.isArray(data.records)
          ? data.records
          : []) as Array<Record<string, unknown>>;
      const str = (v: unknown) => (typeof v === "string" ? v : "");
      setHits(
        rows
          .map((r) => ({
            id: str(r.personId ?? r.id),
            name: str(r.name),
            email: str(r.email),
            sub: [str(r.firm), str(r.title), str(r.kind)].filter(Boolean).join(" · "),
          }))
          .filter((h) => h.id && h.name)
      );
      setOpen(true);
    } catch {
      setHits([]);
    }
  };

  return (
    <div className="relative">
      <label className={labelCls}>Find in Directory</label>
      <input
        className={`${inputCls} min-h-[44px]`}
        value={q}
        onChange={(e) => void search(e.target.value)}
        placeholder="Search people by name…"
      />
      {open && hits.length > 0 && (
        <ul className="absolute inset-x-0 top-full z-10 mt-1 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-pop dark:border-white/10 dark:bg-[#132847]">
          {hits.map((h) => (
            <li key={h.id}>
              <button
                type="button"
                className="flex min-h-[44px] w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-[#f0f4fa] dark:hover:bg-white/5"
                onClick={() => {
                  onPick(h);
                  setQ(h.name);
                  setOpen(false);
                }}
              >
                <span className="font-medium text-navy-900 dark:text-white">{h.name}</span>
                <span className="truncate text-xs text-slate-400 dark:text-white/40">
                  {h.email || h.sub}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

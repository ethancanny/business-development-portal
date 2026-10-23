"use client";

/**
 * EnvelopeStatus + SigningActions + EnvelopeDetail (in-house
 * signing, portal side).
 *
 * - SigningActions is the mount unit: a status chip for the latest
 *   envelope on a document/report (hidden when there is none) plus a
 *   "Send for signature" button opening SendForSignature. Clicking
 *   the chip opens EnvelopeDetail.
 * - EnvelopeDetail shows signer rows (status + viewed/signed
 *   times), the event timeline, artifacts (executed / certificate
 *   documents, linked into /documents?doc=<id>), and the sender
 *   actions: Void, Resend link per unsigned signer (new link shown
 *   once), Change expiry, Finalize (retry), and Verify (renders the
 *   seal check list + audit-chain verdict). All calls hit the
 *   pinned /api/platform/signing/** routes.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Button, ErrorState, SkeletonRows } from "@/components/ui";
import { fmtDate } from "@/lib/format";
import SendForSignature from "@/components/signing/SendForSignature";
import {
  copyText,
  envelopeBadgeClass,
  envelopeStatusLabel,
  inputCls,
  labelCls,
  listFrom,
  pick,
  str,
  type EnvelopeListItem,
  type Rec,
} from "@/components/signing/types";

/* ------------------------------ chip ------------------------------ */

function parseListItem(r: Rec): EnvelopeListItem {
  const signers = listFrom<Rec>(r, "signers").map((s) => ({
    name: str(pick(s, "name")),
    email: str(pick(s, "email")),
    status: str(pick(s, "status")),
  }));
  return {
    id: str(pick(r, "id")),
    documentId:
      (pick(r, "documentId", "document_id") as string | null) ?? null,
    reportId: (pick(r, "reportId", "report_id") as string | null) ?? null,
    status: str(pick(r, "status")),
    signers,
    createdAt: str(pick(r, "createdAt", "created_at")),
    completedAt:
      (pick(r, "completedAt", "completed_at") as string | null) ?? null,
  };
}

export default function SigningActions({
  documentId,
  reportId,
  documentName,
}: {
  documentId?: string;
  reportId?: string;
  documentName: string;
}) {
  const [latest, setLatest] = useState<EnvelopeListItem | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [showSend, setShowSend] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);

  const load = useCallback(async () => {
    try {
      const qs = documentId
        ? `documentId=${encodeURIComponent(documentId)}`
        : `reportId=${encodeURIComponent(reportId || "")}`;
      const res = await fetch(`/api/platform/signing/envelopes?${qs}`);
      if (!res.ok) {
        setLatest(null);
        return;
      }
      const data = (await res.json()) as Rec;
      const items = listFrom<Rec>(data, "items", "envelopes").map(parseListItem);
      setLatest(items.length > 0 ? items[0] : null);
    } catch {
      setLatest(null);
    } finally {
      setLoaded(true);
    }
  }, [documentId, reportId]);

  useEffect(() => {
    void load();
  }, [load, reloadTick]);

  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      {loaded && latest && (
        <button
          type="button"
          onClick={() => setDetailId(latest.id)}
          className={`badge min-h-[32px] ${envelopeBadgeClass(latest.status)}`}
          title="View signing envelope"
        >
          Signature: {envelopeStatusLabel(latest.status)}
        </button>
      )}
      <button
        type="button"
        onClick={() => setShowSend(true)}
        className="btn btn-secondary btn-sm min-h-[44px]"
      >
        Send for signature
      </button>
      {showSend && (
        <SendForSignature
          documentId={documentId}
          reportId={reportId}
          documentName={documentName}
          onClose={() => setShowSend(false)}
          onDone={() => setReloadTick((t) => t + 1)}
        />
      )}
      {detailId && (
        <EnvelopeDetailDialog
          envelopeId={detailId}
          onClose={() => setDetailId(null)}
          onChanged={() => setReloadTick((t) => t + 1)}
        />
      )}
    </span>
  );
}

/* ----------------------------- detail ----------------------------- */

interface SignerRow {
  id: string;
  name: string;
  email: string;
  status: string;
  viewedAt: string;
  consentedAt: string;
  signedAt: string;
}
interface EventRow {
  id: string;
  kind: string;
  actor: string;
  detail: string;
  createdAt: string;
}
interface ArtifactRow {
  kind: string;
  label: string;
  documentId: string;
}
interface VerifyCheck {
  key: string;
  label: string;
  ok: boolean;
  detail: string;
}

export function EnvelopeDetailDialog({
  envelopeId,
  onClose,
  onChanged,
}: {
  envelopeId: string;
  onClose: () => void;
  onChanged?: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [envelope, setEnvelope] = useState<Rec | null>(null);
  const [signers, setSigners] = useState<SignerRow[]>([]);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [artifacts, setArtifacts] = useState<ArtifactRow[]>([]);
  const [reloadTick, setReloadTick] = useState(0);

  const [busy, setBusy] = useState("");
  const [actionMsg, setActionMsg] = useState("");
  const [voidReason, setVoidReason] = useState("");
  const [showVoid, setShowVoid] = useState(false);
  const [newExpiry, setNewExpiry] = useState("");
  const [resentUrl, setResentUrl] = useState("");
  const [copied, setCopied] = useState(false);
  const [verify, setVerify] = useState<{
    ok: boolean;
    checks: VerifyCheck[];
    auditChainValid: boolean;
  } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const res = await fetch(
        `/api/platform/signing/envelopes/${encodeURIComponent(envelopeId)}`
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as Rec;
      const env = (pick(data, "envelope") ?? data) as Rec;
      setEnvelope(env);
      const signing = (pick(data, "signing") ?? {}) as Rec;
      setSigners(
        listFrom<Rec>(data, "signers").map((s) => ({
          id: str(pick(s, "id", "signerId")),
          name: str(pick(s, "name")),
          email: str(pick(s, "email")),
          status: str(pick(s, "status")),
          viewedAt: str(pick(s, "viewedAt", "viewed_at", "firstViewedAt")),
          consentedAt: str(
            pick(s, "consentedAt", "consented_at", "consentAt", "consent_at")
          ),
          signedAt: str(pick(s, "signedAt", "signed_at")),
        }))
      );
      setEvents(
        listFrom<Rec>(data, "events").map((e, i) => {
          const rawDetail = pick(e, "detail", "message");
          const detailText =
            typeof rawDetail === "string"
              ? rawDetail
              : rawDetail && typeof rawDetail === "object"
                ? str(
                    pick(
                      rawDetail as Rec,
                      "message",
                      "reason",
                      "label",
                      "status"
                    )
                  )
                : "";
          return {
            id: str(pick(e, "id")) || String(i),
            kind: str(pick(e, "kind", "type", "event")),
            actor: str(pick(e, "actor", "actorEmail", "actor_email")),
            detail: detailText,
            createdAt: str(pick(e, "createdAt", "created_at")),
          };
        })
      );
      const arts = listFrom<Rec>(data, "artifacts").map((a) => ({
        kind: str(pick(a, "kind", "type")),
        label:
          str(pick(a, "label", "name")) ||
          str(pick(a, "kind", "type")) ||
          "Document",
        documentId: str(pick(a, "documentId", "document_id", "id")),
      }));
      // Fall back to the signing record's document ids.
      if (arts.length === 0) {
        const candidates: Array<[string, string]> = [
          ["executed", "Executed document"],
          ["certificate", "Signing certificate"],
        ];
        for (const [kind, label] of candidates) {
          const id = str(
            pick(
              signing,
              kind === "executed"
                ? "executedDocumentId"
                : "certificateDocumentId",
              kind === "executed"
                ? "executed_document_id"
                : "certificate_document_id"
            )
          );
          if (id) arts.push({ kind, label, documentId: id });
        }
      }
      setArtifacts(arts.filter((a) => a.documentId));
      const exp = str(pick(env, "expiresAt", "expires_at"));
      if (exp) setNewExpiry(exp.slice(0, 10));
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [envelopeId]);

  useEffect(() => {
    void load();
  }, [load, reloadTick]);

  const post = async (
    action: string,
    body?: Rec
  ): Promise<Rec | null> => {
    const res = await fetch(
      `/api/platform/signing/envelopes/${encodeURIComponent(envelopeId)}/${action}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body ?? {}),
      }
    );
    const data = (await res.json().catch(() => ({}))) as Rec;
    if (!res.ok) {
      const detail = str(pick(data, "detail")) || str(pick(data, "error"));
      throw new Error(detail || `HTTP ${res.status}`);
    }
    return data;
  };

  const runAction = async (
    key: string,
    fn: () => Promise<void>,
    okMsg: string
  ) => {
    if (busy) return;
    setBusy(key);
    setActionMsg("");
    try {
      await fn();
      setActionMsg(okMsg);
      setReloadTick((t) => t + 1);
      if (onChanged) onChanged();
    } catch (err) {
      setActionMsg(
        err instanceof Error ? `Action failed: ${err.message}` : "Action failed."
      );
    } finally {
      setBusy("");
    }
  };

  const status = envelope ? str(pick(envelope, "status")) : "";
  const terminal =
    status === "completed" || status === "voided" || status === "declined";

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-navy-950/60 p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label="Signing envelope"
    >
      <div className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl dark:bg-[#0f2242] sm:p-6">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="font-display text-2xl font-semibold text-[#0d1f3c] dark:text-white">
              Signing envelope
            </h2>
            {envelope && (
              <p className="mt-0.5 text-sm text-slate-500 dark:text-white/50">
                {str(pick(envelope, "documentName", "document_name")) ||
                  "Document"}{" "}
                · created{" "}
                {str(pick(envelope, "createdAt", "created_at"))
                  ? fmtDate(str(pick(envelope, "createdAt", "created_at")))
                  : "—"}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="btn btn-ghost btn-sm min-h-[44px]"
          >
            Close
          </button>
        </div>

        {loading ? (
          <div className="mt-4">
            <SkeletonRows rows={5} />
          </div>
        ) : error || !envelope ? (
          <ErrorState
            title="Could not load this envelope"
            message="The envelope detail could not be loaded."
            onRetry={() => setReloadTick((t) => t + 1)}
          />
        ) : (
          <>
            <p className="mt-3">
              <span className={`badge ${envelopeBadgeClass(status)}`}>
                {envelopeStatusLabel(status)}
              </span>{" "}
              <span className="text-xs text-slate-400 dark:text-white/40">
                {str(pick(envelope, "signingOrder", "signing_order")) ||
                  "parallel"}{" "}
                signing
                {str(pick(envelope, "expiresAt", "expires_at"))
                  ? ` · expires ${fmtDate(str(pick(envelope, "expiresAt", "expires_at")))}`
                  : ""}
                {str(pick(envelope, "completedAt", "completed_at"))
                  ? ` · completed ${fmtDate(str(pick(envelope, "completedAt", "completed_at")))}`
                  : ""}
              </span>
            </p>

            {/* Signers */}
            <h3 className="mt-5 text-sm font-bold uppercase tracking-wide text-[#0d1f3c] dark:text-white">
              Signers
            </h3>
            {signers.length === 0 ? (
              <p className="mt-2 text-sm text-slate-400 dark:text-white/40">
                No signers recorded.
              </p>
            ) : (
              <ul className="mt-2 divide-y divide-slate-100 dark:divide-white/5">
                {signers.map((s) => {
                  const unsigned =
                    s.status !== "signed" &&
                    s.status !== "completed" &&
                    s.status !== "declined";
                  return (
                    <li key={s.id || s.email} className="py-2.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="min-w-0 flex-1 text-sm">
                          <span className="font-medium text-[#0d1f3c] dark:text-white">
                            {s.name || "Signer"}
                          </span>{" "}
                          <span className="text-slate-400 dark:text-white/40">
                            {s.email}
                          </span>
                        </span>
                        <span className={`badge ${envelopeBadgeClass(s.status === "signed" ? "completed" : s.status)}`}>
                          {envelopeStatusLabel(s.status)}
                        </span>
                        {!terminal && unsigned && s.id && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="min-h-[44px]"
                            disabled={!!busy}
                            loading={busy === `resend-${s.id}`}
                            onClick={() =>
                              void runAction(
                                `resend-${s.id}`,
                                async () => {
                                  const data = await post("resend", {
                                    signerId: s.id,
                                  });
                                  const url = str(
                                    pick(data ?? {}, "url", "link")
                                  );
                                  if (url) {
                                    setResentUrl(url);
                                    setCopied(false);
                                  }
                                },
                                "A fresh signing link was created — copy it below (shown once)."
                              )
                            }
                          >
                            Resend link
                          </Button>
                        )}
                      </div>
                      <p className="mt-0.5 text-xs text-slate-400 dark:text-white/40">
                        {s.viewedAt ? `Viewed ${fmtDate(s.viewedAt)}` : "Not viewed yet"}
                        {s.consentedAt ? ` · Consented ${fmtDate(s.consentedAt)}` : ""}
                        {s.signedAt ? ` · Signed ${fmtDate(s.signedAt)}` : ""}
                      </p>
                    </li>
                  );
                })}
              </ul>
            )}

            {resentUrl && (
              <div className="mt-3 rounded-xl border border-[#b8975a]/50 bg-[#b8975a]/10 px-4 py-3">
                <p className="text-sm font-semibold text-[#0d1f3c] dark:text-white">
                  New signing link — shown once
                </p>
                <div className="mt-2 flex gap-2">
                  <input
                    readOnly
                    value={resentUrl}
                    aria-label="New signing link"
                    className={`${inputCls} min-w-0 flex-1`}
                    onFocus={(e) => e.target.select()}
                  />
                  <Button
                    variant="secondary"
                    className="min-h-[44px] shrink-0"
                    onClick={() => {
                      void copyText(resentUrl).then((ok) => {
                        if (ok) setCopied(true);
                      });
                    }}
                  >
                    {copied ? "Copied" : "Copy"}
                  </Button>
                </div>
              </div>
            )}

            {/* Artifacts */}
            {artifacts.length > 0 && (
              <div className="mt-5">
                <h3 className="text-sm font-bold uppercase tracking-wide text-[#0d1f3c] dark:text-white">
                  Signed artifacts
                </h3>
                <div className="mt-2 flex flex-wrap gap-2">
                  {artifacts.map((a, i) => (
                    <Link
                      key={`${a.documentId}-${i}`}
                      href={`/documents?doc=${encodeURIComponent(a.documentId)}`}
                      className="btn btn-secondary btn-sm min-h-[44px]"
                    >
                      {a.label}
                    </Link>
                  ))}
                </div>
              </div>
            )}

            {/* Actions */}
            {!terminal && (
              <div className="mt-5 border-t border-slate-100 pt-4 dark:border-white/5">
                <h3 className="text-sm font-bold uppercase tracking-wide text-[#0d1f3c] dark:text-white">
                  Actions
                </h3>
                <div className="mt-3 flex flex-wrap items-end gap-2">
                  <div>
                    <label className={labelCls} htmlFor="env-expiry">
                      Change expiry
                    </label>
                    <input
                      id="env-expiry"
                      type="date"
                      value={newExpiry}
                      onChange={(e) => setNewExpiry(e.target.value)}
                      className={`${inputCls} min-h-[44px] w-auto`}
                    />
                  </div>
                  <Button
                    variant="secondary"
                    className="min-h-[44px]"
                    disabled={!!busy || !newExpiry}
                    loading={busy === "expiry"}
                    onClick={() =>
                      void runAction(
                        "expiry",
                        async () => {
                          await post("expiry", {
                            expiresAt: new Date(
                              `${newExpiry}T23:59:59`
                            ).toISOString(),
                          });
                        },
                        "Expiry updated."
                      )
                    }
                  >
                    Save expiry
                  </Button>
                  <Button
                    variant="secondary"
                    className="min-h-[44px]"
                    disabled={!!busy}
                    loading={busy === "finalize"}
                    onClick={() =>
                      void runAction(
                        "finalize",
                        async () => {
                          await post("finalize");
                        },
                        "Finalize run — the executed copy and certificate are filed when every signer has signed."
                      )
                    }
                  >
                    Finalize
                  </Button>
                  <Button
                    variant="danger"
                    className="min-h-[44px]"
                    disabled={!!busy}
                    onClick={() => setShowVoid((s) => !s)}
                  >
                    Void envelope…
                  </Button>
                </div>
                {showVoid && (
                  <div className="mt-3 rounded-xl bg-red-500/5 px-4 py-3">
                    <label className={labelCls} htmlFor="env-void-reason">
                      Void reason (shown to signers)
                    </label>
                    <input
                      id="env-void-reason"
                      value={voidReason}
                      onChange={(e) => setVoidReason(e.target.value)}
                      className={`${inputCls} min-h-[44px]`}
                      placeholder="e.g. Superseded by a revised draft"
                    />
                    <div className="mt-2 flex gap-2">
                      <Button
                        variant="danger"
                        className="min-h-[44px]"
                        disabled={!!busy || !voidReason.trim()}
                        loading={busy === "void"}
                        onClick={() =>
                          void runAction(
                            "void",
                            async () => {
                              await post("void", {
                                reason: voidReason.trim(),
                              });
                              setShowVoid(false);
                            },
                            "Envelope voided — signer links stop working immediately."
                          )
                        }
                      >
                        Confirm void
                      </Button>
                      <Button
                        variant="ghost"
                        className="min-h-[44px]"
                        onClick={() => setShowVoid(false)}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Verify */}
            <div className="mt-5 border-t border-slate-100 pt-4 dark:border-white/5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-bold uppercase tracking-wide text-[#0d1f3c] dark:text-white">
                  Seal verification
                </h3>
                <Button
                  variant="secondary"
                  className="min-h-[44px]"
                  disabled={!!busy}
                  loading={busy === "verify"}
                  onClick={() => {
                    setBusy("verify");
                    setActionMsg("");
                    void post("verify")
                      .then((data) => {
                        const d = data ?? {};
                        setVerify({
                          ok: d.ok === true,
                          auditChainValid: d.auditChainValid === true,
                          checks: listFrom<Rec>(d, "checks").map((c) => ({
                            key: str(pick(c, "key")) || str(pick(c, "label")),
                            label: str(pick(c, "label")) || str(pick(c, "key")),
                            ok: c.ok === true,
                            detail: str(pick(c, "detail")),
                          })),
                        });
                      })
                      .catch((err) => {
                        setActionMsg(
                          err instanceof Error
                            ? `Verification failed: ${err.message}`
                            : "Verification failed."
                        );
                      })
                      .finally(() => setBusy(""));
                  }}
                >
                  Verify seal
                </Button>
              </div>
              {verify && (
                <div className="mt-3">
                  <p
                    className={`text-sm font-semibold ${verify.ok && verify.auditChainValid ? "text-emerald-700 dark:text-emerald-300" : "text-red-700 dark:text-red-300"}`}
                  >
                    {verify.ok && verify.auditChainValid
                      ? "Seal valid — document integrity and the audit chain check out."
                      : "Verification found problems — see the checks below."}
                  </p>
                  <ul className="mt-2 space-y-1.5">
                    {verify.checks.map((c) => (
                      <li key={c.key} className="flex flex-wrap gap-2 text-sm">
                        <span aria-hidden>{c.ok ? "✓" : "✗"}</span>
                        <span className="font-medium text-[#0d1f3c] dark:text-white">
                          {c.label}
                        </span>
                        {c.detail && (
                          <span className="text-slate-500 dark:text-white/60">
                            {c.detail}
                          </span>
                        )}
                      </li>
                    ))}
                    <li className="flex flex-wrap gap-2 text-sm">
                      <span aria-hidden>{verify.auditChainValid ? "✓" : "✗"}</span>
                      <span className="font-medium text-[#0d1f3c] dark:text-white">
                        Audit chain
                      </span>
                      <span className="text-slate-500 dark:text-white/60">
                        {verify.auditChainValid ? "Intact" : "Broken"}
                      </span>
                    </li>
                  </ul>
                </div>
              )}
            </div>

            {actionMsg && (
              <p className="mt-4 rounded-xl bg-slate-500/10 px-4 py-3 text-sm text-slate-700 dark:text-white/80">
                {actionMsg}
              </p>
            )}

            {/* Timeline */}
            <div className="mt-5 border-t border-slate-100 pt-4 dark:border-white/5">
              <h3 className="text-sm font-bold uppercase tracking-wide text-[#0d1f3c] dark:text-white">
                Event timeline
              </h3>
              {events.length === 0 ? (
                <p className="mt-2 text-sm text-slate-400 dark:text-white/40">
                  No events recorded yet.
                </p>
              ) : (
                <ul className="mt-2 space-y-1.5">
                  {events.map((e) => (
                    <li key={e.id} className="flex flex-wrap gap-x-2 text-sm">
                      <span className="text-xs text-slate-400 dark:text-white/40">
                        {e.createdAt ? fmtDate(e.createdAt) : ""}
                      </span>
                      <span className="font-medium text-[#0d1f3c] dark:text-white">
                        {e.kind.replace(/_/g, " ")}
                      </span>
                      {e.actor && (
                        <span className="text-slate-500 dark:text-white/60">
                          {e.actor}
                        </span>
                      )}
                      {e.detail && (
                        <span className="text-slate-500 dark:text-white/60">
                          {e.detail}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

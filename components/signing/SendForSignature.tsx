"use client";

/**
 * SendForSignature — portal dialog that creates a signing envelope
 * for a generated document (docgen esign route) or a Part 12 report
 * (signing envelopes route). Recipients are edited as rows (name +
 * email + optional access code), with a parallel/sequential signing
 * order, an expiry date (default from the signing settings), and an
 * optional message. On success each signer's link is listed with a
 * Copy button — links are shown ONCE. When the response's
 * signing.email_status says delivery is manual, the honest note
 * about Mail.Send is shown verbatim.
 */

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui";
import { copyText, inputCls, labelCls, pick, str, type Rec } from "@/components/signing/types";

interface RecipientRow {
  name: string;
  email: string;
  accessCode: string;
}

interface SignerLink {
  signerId: string;
  name: string;
  email: string;
  url: string;
}

export default function SendForSignature({
  documentId,
  reportId,
  documentName,
  onClose,
  onDone,
}: {
  documentId?: string;
  reportId?: string;
  documentName: string;
  onClose: () => void;
  onDone?: () => void;
}) {
  const [rows, setRows] = useState<RecipientRow[]>([
    { name: "", email: "", accessCode: "" },
  ]);
  const [signingOrder, setSigningOrder] = useState<"parallel" | "sequential">(
    "parallel"
  );
  const [expiryDate, setExpiryDate] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [links, setLinks] = useState<SignerLink[] | null>(null);
  const [emailStatus, setEmailStatus] = useState("");
  const [copiedId, setCopiedId] = useState("");

  // Default expiry from the signing settings (defaultExpiryDays);
  // falls back to 14 days when the settings read is unavailable.
  useEffect(() => {
    let live = true;
    const applyDefault = (days: number) => {
      if (!live) return;
      const d = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
      const iso = d.toISOString().slice(0, 10);
      setExpiryDate((cur) => cur || iso);
    };
    fetch("/api/platform/signing/settings")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        // The settings route wraps its payload: { settings: {...} }.
        const s = (data && typeof data === "object"
          ? ((data as Rec).settings as Rec | undefined) ?? (data as Rec)
          : {}) as Rec;
        const days =
          typeof s.defaultExpiryDays === "number"
            ? s.defaultExpiryDays
            : typeof s.default_expiry_days === "number"
              ? (s.default_expiry_days as number)
              : 14;
        applyDefault(days > 0 ? days : 14);
      })
      .catch(() => applyDefault(14));
    return () => {
      live = false;
    };
  }, []);

  const updateRow = (i: number, patch: Partial<RecipientRow>) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const removeRow = (i: number) =>
    setRows((rs) => (rs.length > 1 ? rs.filter((_, j) => j !== i) : rs));
  const addRow = () =>
    setRows((rs) => [...rs, { name: "", email: "", accessCode: "" }]);

  const validRows = rows.filter(
    (r) => r.name.trim() && /.+@.+\..+/.test(r.email.trim())
  );
  const canSubmit = validRows.length > 0 && !busy;

  const submit = useCallback(async () => {
    if (!canSubmit) return;
    setBusy(true);
    setError("");
    try {
      const recipients = validRows.map((r) => {
        const rec: Rec = { name: r.name.trim(), email: r.email.trim() };
        if (r.accessCode.trim()) rec.accessCode = r.accessCode.trim();
        return rec;
      });
      const body: Rec = {
        recipients,
        signingOrder,
      };
      if (message.trim()) body.message = message.trim();
      if (expiryDate) {
        body.expiresAt = new Date(`${expiryDate}T23:59:59`).toISOString();
      }
      const url = reportId
        ? "/api/platform/signing/envelopes"
        : `/api/platform/docgen/documents/${encodeURIComponent(documentId || "")}/esign`;
      if (reportId) body.reportId = reportId;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as Rec;
      if (!res.ok) {
        const detail = str(pick(data, "detail")) || str(pick(data, "error"));
        setError(
          detail === "setup_required"
            ? "Signing isn't active yet — the in-house signing service reports setup required."
            : detail
              ? `Could not create the envelope (${detail}).`
              : `Could not create the envelope (HTTP ${res.status}).`
        );
        return;
      }
      const signing = (pick(data, "signing") ?? {}) as Rec;
      const envelope = (pick(data, "envelope") ?? {}) as Rec;
      setEmailStatus(
        str(
          pick(signing, "email_status", "emailStatus") ??
            pick(envelope, "email_status", "emailStatus") ??
            pick(data, "email_status", "emailStatus")
        )
      );
      const rawLinks = Array.isArray(data.links) ? (data.links as Rec[]) : [];
      setLinks(
        rawLinks.map((l) => ({
          signerId: str(pick(l, "signerId", "signer_id")),
          name: str(pick(l, "name")),
          email: str(pick(l, "email")),
          url: str(pick(l, "url", "link")),
        }))
      );
      if (onDone) onDone();
    } catch {
      setError("The request failed — please try again.");
    } finally {
      setBusy(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canSubmit, signingOrder, message, expiryDate, reportId, documentId]);

  const manualEmail =
    emailStatus !== "" && emailStatus !== "sent" && emailStatus !== "emailed";

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-navy-950/60 p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label="Send for signature"
    >
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl dark:bg-[#0f2242] sm:p-6">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="font-display text-2xl font-semibold text-[#0d1f3c] dark:text-white">
              Send for signature
            </h2>
            <p className="mt-0.5 truncate text-sm text-slate-500 dark:text-white/50">
              {documentName}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="btn btn-ghost btn-sm min-h-[44px]"
          >
            Close
          </button>
        </div>

        {links === null ? (
          <>
            <div className="mt-4 space-y-3">
              {rows.map((row, i) => (
                <div
                  key={i}
                  className="rounded-xl border border-slate-200 p-3 dark:border-white/10"
                >
                  <div className="grid gap-2 sm:grid-cols-2">
                    <div>
                      <label className={labelCls} htmlFor={`sf-name-${i}`}>
                        Signer name
                      </label>
                      <input
                        id={`sf-name-${i}`}
                        value={row.name}
                        onChange={(e) => updateRow(i, { name: e.target.value })}
                        placeholder="Full name"
                        className={`${inputCls} min-h-[44px]`}
                      />
                    </div>
                    <div>
                      <label className={labelCls} htmlFor={`sf-email-${i}`}>
                        Email
                      </label>
                      <input
                        id={`sf-email-${i}`}
                        type="email"
                        value={row.email}
                        onChange={(e) => updateRow(i, { email: e.target.value })}
                        placeholder="signer@example.com"
                        className={`${inputCls} min-h-[44px]`}
                      />
                    </div>
                  </div>
                  <div className="mt-2 flex items-end gap-2">
                    <div className="min-w-0 flex-1">
                      <label className={labelCls} htmlFor={`sf-code-${i}`}>
                        Access code (optional)
                      </label>
                      <input
                        id={`sf-code-${i}`}
                        value={row.accessCode}
                        onChange={(e) =>
                          updateRow(i, { accessCode: e.target.value })
                        }
                        placeholder="Signer must enter this to sign"
                        autoComplete="off"
                        className={`${inputCls} min-h-[44px]`}
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => removeRow(i)}
                      disabled={rows.length <= 1}
                      className="btn btn-ghost btn-sm min-h-[44px]"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={addRow}
              className="btn btn-secondary btn-sm mt-3 min-h-[44px]"
            >
              Add recipient
            </button>

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <fieldset>
                <legend className={labelCls}>Signing order</legend>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setSigningOrder("parallel")}
                    aria-pressed={signingOrder === "parallel"}
                    className={`chip min-h-[44px] ${signingOrder === "parallel" ? "chip-active" : ""}`}
                  >
                    Parallel
                  </button>
                  <button
                    type="button"
                    onClick={() => setSigningOrder("sequential")}
                    aria-pressed={signingOrder === "sequential"}
                    className={`chip min-h-[44px] ${signingOrder === "sequential" ? "chip-active" : ""}`}
                  >
                    Sequential
                  </button>
                </div>
              </fieldset>
              <div>
                <label className={labelCls} htmlFor="sf-expiry">
                  Link expires
                </label>
                <input
                  id="sf-expiry"
                  type="date"
                  value={expiryDate}
                  onChange={(e) => setExpiryDate(e.target.value)}
                  className={`${inputCls} min-h-[44px]`}
                />
              </div>
            </div>

            <div className="mt-3">
              <label className={labelCls} htmlFor="sf-message">
                Message to signers (optional)
              </label>
              <textarea
                id="sf-message"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={3}
                placeholder="Please review and sign…"
                className={inputCls}
              />
            </div>

            {error && (
              <p
                role="alert"
                className="mt-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-200"
              >
                {error}
              </p>
            )}

            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <Button
                variant="ghost"
                className="min-h-[44px]"
                onClick={onClose}
                disabled={busy}
              >
                Cancel
              </Button>
              <Button
                className="min-h-[44px]"
                onClick={() => void submit()}
                disabled={!canSubmit}
                loading={busy}
              >
                Create signing links
              </Button>
            </div>
          </>
        ) : (
          <>
            <p className="mt-3 rounded-xl bg-emerald-500/10 px-4 py-3 text-sm text-emerald-800 dark:text-emerald-200">
              Envelope created. Share each signer&apos;s personal link
              below — each link is shown only once.
            </p>
            {links.length === 0 ? (
              <p className="mt-3 text-sm text-slate-500 dark:text-white/60">
                The envelope was created, but no signer links were
                returned. Open the envelope status to manage it.
              </p>
            ) : (
              <ul className="mt-3 space-y-3">
                {links.map((l, i) => (
                  <li
                    key={l.signerId || i}
                    className="rounded-xl border border-slate-200 p-3 dark:border-white/10"
                  >
                    <p className="text-sm font-semibold text-[#0d1f3c] dark:text-white">
                      {l.name || "Signer"}{" "}
                      <span className="font-normal text-slate-400 dark:text-white/40">
                        {l.email}
                      </span>
                    </p>
                    <div className="mt-2 flex gap-2">
                      <input
                        readOnly
                        value={l.url}
                        aria-label={`Signing link for ${l.name || l.email}`}
                        className={`${inputCls} min-w-0 flex-1`}
                        onFocus={(e) => e.target.select()}
                      />
                      <Button
                        variant="secondary"
                        className="min-h-[44px] shrink-0"
                        onClick={() => {
                          void copyText(l.url).then((ok) => {
                            if (ok) setCopiedId(l.signerId || String(i));
                          });
                        }}
                      >
                        {copiedId === (l.signerId || String(i))
                          ? "Copied"
                          : "Copy"}
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {manualEmail && (
              <p className="mt-3 rounded-xl bg-amber-500/10 px-4 py-3 text-sm text-amber-800 dark:text-amber-200">
                Email sending activates when Microsoft Mail.Send is
                connected — share these links directly for now. Each
                link is shown only once.
              </p>
            )}
            {emailStatus === "sent" && (
              <p className="mt-3 text-sm text-slate-500 dark:text-white/60">
                Signers were also notified by email.
              </p>
            )}
            <div className="mt-4 flex justify-end">
              <Button className="min-h-[44px]" onClick={onClose}>
                Done
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

"use client";

/**
 * EsignSettingsCard — Settings card for the IN-HOUSE e-signature
 * module (replaces the Phase 10 framework card). Live data from
 * the signing API:
 * - GET /api/platform/signing/status → provider state + the portal
 *   signing certificate (subject, SHA fingerprint, validity).
 * - GET /api/platform/signing/settings → consent disclosure text +
 *   default link expiry (edited here, saved via PUT on the same
 *   route).
 * - GET /api/platform/signing/envelopes → the 10 most recent
 *   envelopes; a row opens the shared EnvelopeDetail dialog.
 * When the API still reports setupRequired, the card renders the
 * API's own detail + setup steps honestly — never a fake state.
 */

import { useCallback, useEffect, useState } from "react";
import { Button, ErrorState, SkeletonRows } from "@/components/ui";
import { fmtDate } from "@/lib/format";
import { EnvelopeDetailDialog } from "@/components/signing/EnvelopeStatus";
import {
  copyText,
  envelopeBadgeClass,
  envelopeStatusLabel,
  inputCls,
  labelCls,
  listFrom,
  pick,
  str,
  type Rec,
} from "@/components/signing/types";

interface SigningStatus {
  provider: string;
  configured: boolean;
  setupRequired: boolean;
  detail: string;
  setupSteps: string[];
  certificate: {
    subject: string;
    fingerprint: string;
    notBefore: string;
    notAfter: string;
  } | null;
}

interface RecentEnvelope {
  id: string;
  status: string;
  signers: Array<{ name: string; email: string; status: string }>;
  createdAt: string;
  completedAt: string | null;
}

export default function EsignSettingsCard() {
  const [status, setStatus] = useState<SigningStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [consentText, setConsentText] = useState("");
  const [defaultDays, setDefaultDays] = useState(14);
  const [settingsReadable, setSettingsReadable] = useState(true);
  const [savingSettings, setSavingSettings] = useState(false);
  const [settingsMsg, setSettingsMsg] = useState("");

  const [recent, setRecent] = useState<RecentEnvelope[]>([]);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [fpCopied, setFpCopied] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/platform/signing/status");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as Rec;
      const cert = (pick(data, "certificate") ?? null) as Rec | null;
      setStatus({
        provider: str(pick(data, "provider")) || "in-house",
        configured: data.configured === true,
        setupRequired: data.setupRequired === true,
        detail: str(pick(data, "detail")),
        setupSteps: Array.isArray(data.setupSteps)
          ? (data.setupSteps as unknown[]).map((s) => str(s))
          : [],
        certificate: cert
          ? {
              subject: str(pick(cert, "subject")),
              fingerprint: str(pick(cert, "fingerprint")),
              notBefore: str(pick(cert, "notBefore", "not_before")),
              notAfter: str(pick(cert, "notAfter", "not_after")),
            }
          : null,
      });
    } catch {
      setError("E-signature status could not be loaded.");
    } finally {
      setLoading(false);
    }

    // Settings (consent + default expiry). A 404 here means the
    // settings read isn't live yet — the editors stay visible but
    // say so, and saving reports the API's answer honestly.
    try {
      const res = await fetch("/api/platform/signing/settings");
      if (res.ok) {
        const raw = (await res.json()) as Rec;
        // The settings route wraps its payload: { settings: {...} }.
        const data = (pick(raw, "settings") as Rec | undefined) ?? raw;
        setSettingsReadable(true);
        if (typeof data.consentText === "string") {
          setConsentText(data.consentText);
        }
        const days = pick(data, "defaultExpiryDays", "default_expiry_days");
        if (typeof days === "number" && days > 0) setDefaultDays(days);
      } else {
        setSettingsReadable(false);
      }
    } catch {
      setSettingsReadable(false);
    }

    try {
      const res = await fetch("/api/platform/signing/envelopes");
      if (res.ok) {
        const data = (await res.json()) as Rec;
        const items = listFrom<Rec>(data, "items", "envelopes")
          .slice(0, 10)
          .map((r) => ({
            id: str(pick(r, "id")),
            status: str(pick(r, "status")),
            signers: listFrom<Rec>(r, "signers").map((s) => ({
              name: str(pick(s, "name")),
              email: str(pick(s, "email")),
              status: str(pick(s, "status")),
            })),
            createdAt: str(pick(r, "createdAt", "created_at")),
            completedAt:
              (pick(r, "completedAt", "completed_at") as string | null) ??
              null,
          }));
        setRecent(items);
      }
    } catch {
      /* recent list is auxiliary */
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const saveSettings = async () => {
    if (savingSettings) return;
    setSavingSettings(true);
    setSettingsMsg("");
    try {
      const res = await fetch("/api/platform/signing/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          consentText: consentText,
          defaultExpiryDays: defaultDays,
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as Rec;
        const detail = str(pick(data, "detail")) || str(pick(data, "error"));
        setSettingsMsg(
          detail
            ? `Could not save (${detail}).`
            : "Could not save the signing settings."
        );
        return;
      }
      setSettingsMsg("Signing settings saved.");
    } catch {
      setSettingsMsg("Could not save the signing settings.");
    } finally {
      setSavingSettings(false);
    }
  };

  const cert = status?.certificate ?? null;

  return (
    <div>
      <h3 className="text-sm font-bold uppercase tracking-wide text-[#0d1f3c] dark:text-white">
        E-signature (in-house)
      </h3>
      <p className="mt-1 text-sm text-slate-500 dark:text-white/50">
        Signing runs inside this portal — token-link signer pages,
        consent capture, a tamper-evident seal, and a signing
        certificate filed with every completed envelope. No external
        provider.
      </p>

      <div className="mt-3">
        {loading ? (
          <SkeletonRows rows={3} />
        ) : error ? (
          <ErrorState
            title="Could not load e-signature status"
            message={error}
            onRetry={() => void load()}
          />
        ) : !status ? (
          <p className="text-sm text-slate-400 dark:text-white/40">
            No e-signature provider is registered yet.
          </p>
        ) : (
          <div>
            <div className="flex items-start gap-3 py-3">
              <span
                aria-hidden
                className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${status.configured && !status.setupRequired ? "bg-emerald-500" : "bg-amber-500"}`}
              />
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-baseline gap-x-2 text-sm font-semibold text-[#0d1f3c] dark:text-white">
                  In-house (portal)
                  <span className="text-xs font-medium text-slate-400 dark:text-white/40">
                    {status.setupRequired
                      ? "setup required"
                      : status.configured
                        ? "active"
                        : "not configured"}
                  </span>
                </p>
                {status.detail && (
                  <p className="mt-0.5 text-sm text-slate-500 dark:text-white/60">
                    {status.detail}
                  </p>
                )}
              </div>
            </div>

            {status.setupRequired && status.setupSteps.length > 0 && (
              <div className="mt-1">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-white/40">
                  Setup steps
                </p>
                <ol className="mt-1.5 list-decimal space-y-1 pl-5 text-sm text-slate-600 dark:text-white/70">
                  {status.setupSteps.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ol>
              </div>
            )}

            {/* Certificate */}
            <div className="mt-4 border-t border-slate-100 pt-4 dark:border-white/5">
              <p className={labelCls}>Signing certificate</p>
              {cert ? (
                <dl className="space-y-2 text-sm">
                  <div>
                    <dt className="text-xs text-slate-400 dark:text-white/40">Subject</dt>
                    <dd className="text-[#0d1f3c] dark:text-white">{cert.subject || "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-400 dark:text-white/40">Fingerprint (SHA)</dt>
                    <dd className="flex flex-wrap items-center gap-2">
                      <code className="min-w-0 flex-1 break-all font-mono text-xs text-[#0d1f3c] dark:text-white">
                        {cert.fingerprint
                          ? cert.fingerprint.length > 32
                            ? `${cert.fingerprint.slice(0, 32)}…`
                            : cert.fingerprint
                          : "—"}
                      </code>
                      {cert.fingerprint && (
                        <Button
                          variant="secondary"
                          size="sm"
                          className="min-h-[44px]"
                          onClick={() => {
                            void copyText(cert.fingerprint).then((ok) => {
                              if (ok) setFpCopied(true);
                            });
                          }}
                        >
                          {fpCopied ? "Copied" : "Copy"}
                        </Button>
                      )}
                    </dd>
                  </div>
                  <div className="flex flex-wrap gap-x-6">
                    <div>
                      <dt className="text-xs text-slate-400 dark:text-white/40">Valid from</dt>
                      <dd className="text-[#0d1f3c] dark:text-white">
                        {cert.notBefore ? fmtDate(cert.notBefore) : "—"}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-slate-400 dark:text-white/40">Valid to</dt>
                      <dd className="text-[#0d1f3c] dark:text-white">
                        {cert.notAfter ? fmtDate(cert.notAfter) : "—"}
                      </dd>
                    </div>
                  </div>
                </dl>
              ) : (
                <p className="text-sm text-slate-400 dark:text-white/40">
                  No signing certificate is issued yet — it appears here
                  once the signing service is configured.
                </p>
              )}
            </div>

            {/* Consent + defaults editor */}
            <div className="mt-4 border-t border-slate-100 pt-4 dark:border-white/5">
              <p className={labelCls}>Consent disclosure (shown to every signer)</p>
              <textarea
                value={consentText}
                onChange={(e) => setConsentText(e.target.value)}
                rows={5}
                className={inputCls}
                aria-label="Consent disclosure text"
                placeholder="By signing, you agree to use electronic records and signatures…"
              />
              <div className="mt-3 flex flex-wrap items-end gap-3">
                <div>
                  <label className={labelCls} htmlFor="esign-default-days">
                    Default link expiry (days)
                  </label>
                  <input
                    id="esign-default-days"
                    type="number"
                    min={1}
                    max={365}
                    value={defaultDays}
                    onChange={(e) =>
                      setDefaultDays(Number(e.target.value) || 14)
                    }
                    className={`${inputCls} min-h-[44px] w-28`}
                  />
                </div>
                <Button
                  onClick={() => void saveSettings()}
                  disabled={savingSettings}
                  loading={savingSettings}
                  className="min-h-[44px]"
                >
                  Save signing settings
                </Button>
              </div>
              {!settingsReadable && (
                <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">
                  The settings read endpoint isn&apos;t responding yet —
                  values above are defaults, and saving reports the
                  service&apos;s answer.
                </p>
              )}
              {settingsMsg && (
                <p className="mt-2 text-sm text-slate-600 dark:text-white/70">
                  {settingsMsg}
                </p>
              )}
            </div>

            {/* Recent envelopes */}
            <div className="mt-4 border-t border-slate-100 pt-4 dark:border-white/5">
              <p className={labelCls}>Recent envelopes</p>
              {recent.length === 0 ? (
                <p className="text-sm text-slate-400 dark:text-white/40">
                  No envelopes yet — send a document for signature from
                  a data room, the Documents library, or a report.
                </p>
              ) : (
                <ul className="divide-y divide-slate-100 dark:divide-white/5">
                  {recent.map((e) => (
                    <li key={e.id}>
                      <button
                        type="button"
                        onClick={() => setDetailId(e.id)}
                        className="flex min-h-[44px] w-full flex-wrap items-center gap-2 py-2 text-left"
                      >
                        <span className="min-w-0 flex-1 truncate text-sm text-slate-700 dark:text-white/80">
                          {e.signers.length > 0
                            ? e.signers
                                .map((s) => s.name || s.email)
                                .join(", ")
                            : "Envelope"}
                          <span className="text-xs text-slate-400 dark:text-white/40">
                            {" "}
                            · {e.createdAt ? fmtDate(e.createdAt) : ""}
                            {e.completedAt
                              ? ` · completed ${fmtDate(e.completedAt)}`
                              : ""}
                          </span>
                        </span>
                        <span className={`badge ${envelopeBadgeClass(e.status)}`}>
                          {envelopeStatusLabel(e.status)}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </div>

      {detailId && (
        <EnvelopeDetailDialog
          envelopeId={detailId}
          onClose={() => setDetailId(null)}
          onChanged={() => void load()}
        />
      )}
    </div>
  );
}

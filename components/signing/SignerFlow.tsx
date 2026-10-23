"use client";

/**
 * SignerFlow — the public e-signature signer surface (in-house
 * signing). Standalone chrome (navy header, Canny wordmark, no
 * AppShell): load state → record view → document panel → consent →
 * optional access code → type-or-draw signature → two-step confirm →
 * sign. Terminal states (waiting / signed / completed / declined /
 * voided / expired / not found) each get clear copy. All actions go
 * through /api/sign/[token]/** — the token is the only credential.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Button, SkeletonRows } from "@/components/ui";
import { fmtDate } from "@/lib/format";

type SignState =
  | "waiting"
  | "active"
  | "signed"
  | "completed"
  | "declined"
  | "voided"
  | "expired";

interface SignerStatePayload {
  state: SignState;
  documentName?: string;
  senderName?: string;
  senderEmail?: string;
  signer?: { name: string; email: string };
  signingOrder?: string;
  position?: number;
  totalSigners?: number;
  requiresAccessCode?: boolean;
  consented?: boolean;
  expiresAt?: string | null;
  consentText?: string;
  downloadAvailable?: boolean;
}

const cardCls =
  "rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-[#132847]/60 sm:p-6";
const inputCls =
  "w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-[#0d1f3c] outline-none placeholder:text-slate-300 focus:border-[#b8975a] dark:border-white/10 dark:bg-[#132847]/60 dark:text-white dark:placeholder:text-white/30";
const labelCls =
  "mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-white/40";
const CURSIVE_STACK =
  '"Snell Roundhand","Segoe Script","Bradley Hand",cursive';

export default function SignerFlow({ token }: { token: string }) {
  const [payload, setPayload] = useState<SignerStatePayload | null>(null);
  const [loadKind, setLoadKind] = useState<
    "loading" | "ready" | "not_found" | "error"
  >("loading");
  const viewFiredRef = useRef(false);

  const [consentChecked, setConsentChecked] = useState(false);
  const [consentBusy, setConsentBusy] = useState(false);
  const [consentError, setConsentError] = useState("");

  const [accessCode, setAccessCode] = useState("");
  const [accessVerified, setAccessVerified] = useState(false);
  const [accessBusy, setAccessBusy] = useState(false);
  const [accessMsg, setAccessMsg] = useState("");

  const [tab, setTab] = useState<"typed" | "drawn">("typed");
  const [typedName, setTypedName] = useState("");
  const [hasInk, setHasInk] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);
  const lastPosRef = useRef<{ x: number; y: number } | null>(null);

  const [confirming, setConfirming] = useState(false);
  const [signBusy, setSignBusy] = useState(false);
  const [signError, setSignError] = useState("");
  const [signResult, setSignResult] = useState<{
    envelopeStatus: string;
    finalizePending?: boolean;
  } | null>(null);

  const [showDecline, setShowDecline] = useState(false);
  const [declineReason, setDeclineReason] = useState("");
  const [declineBusy, setDeclineBusy] = useState(false);
  const [declinedDone, setDeclinedDone] = useState(false);

  const base = `/api/sign/${encodeURIComponent(token)}`;

  const load = useCallback(async () => {
    setLoadKind("loading");
    try {
      const res = await fetch(base, { cache: "no-store" });
      const data = (await res.json().catch(() => ({}))) as SignerStatePayload &
        Record<string, unknown>;
      if (res.status === 404) {
        setLoadKind("not_found");
        setPayload(null);
        return;
      }
      if (res.status === 410) {
        setPayload({ state: "expired", documentName: data.documentName });
        setLoadKind("ready");
        return;
      }
      if (!res.ok || !data.state) {
        setLoadKind("error");
        return;
      }
      setPayload(data);
      setLoadKind("ready");
      // Record the view once per page load (server applies
      // first-view semantics).
      if (
        !viewFiredRef.current &&
        (data.state === "waiting" ||
          data.state === "active" ||
          data.state === "signed" ||
          data.state === "completed")
      ) {
        viewFiredRef.current = true;
        void fetch(`${base}/view`, { method: "POST" }).catch(() => {});
      }
    } catch {
      setLoadKind("error");
    }
  }, [base]);

  useEffect(() => {
    void load();
  }, [load]);

  /* ------------------------------ canvas ------------------------------ */

  const sizeCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const w = canvas.clientWidth || 320;
    if (canvas.width !== w * 2) {
      const prev = hasInk ? canvas.toDataURL("image/png") : "";
      canvas.width = w * 2;
      canvas.height = 360;
      const ctx = canvas.getContext("2d");
      if (ctx && prev) {
        const img = new Image();
        img.onload = () => ctx.drawImage(img, 0, 0);
        img.src = prev;
      }
    }
  }, [hasInk]);

  useEffect(() => {
    if (tab === "drawn") sizeCanvas();
  }, [tab, sizeCanvas, payload]);

  const canvasPos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * canvas.width,
      y: ((e.clientY - rect.top) / rect.height) * canvas.height,
    };
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.setPointerCapture(e.pointerId);
    drawingRef.current = true;
    lastPosRef.current = canvasPos(e);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    const last = lastPosRef.current;
    if (!canvas || !ctx || !last) return;
    const pos = canvasPos(e);
    ctx.strokeStyle = "#0d1f3c";
    ctx.lineWidth = 5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(last.x, last.y);
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
    lastPosRef.current = pos;
    if (!hasInk) setHasInk(true);
  };
  const endStroke = () => {
    drawingRef.current = false;
    lastPosRef.current = null;
  };
  const clearCanvas = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasInk(false);
  };

  /* ------------------------------ actions ------------------------------ */

  const submitConsent = async () => {
    if (!consentChecked || consentBusy) return;
    setConsentBusy(true);
    setConsentError("");
    try {
      const res = await fetch(`${base}/consent`, { method: "POST" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await load();
    } catch {
      setConsentError("Consent could not be recorded — please try again.");
    } finally {
      setConsentBusy(false);
    }
  };

  const verifyAccessCode = async () => {
    if (!accessCode.trim() || accessBusy) return;
    setAccessBusy(true);
    setAccessMsg("");
    try {
      const res = await fetch(`${base}/access-code`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: accessCode.trim() }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        locked?: boolean;
        attemptsLeft?: number | null;
      };
      if (res.status === 423 || data.locked) {
        setAccessMsg(
          "Too many incorrect attempts — this link is temporarily locked. Contact the sender."
        );
        return;
      }
      if (!res.ok || !data.ok) {
        setAccessMsg(
          data.attemptsLeft != null
            ? `That code wasn't right. ${data.attemptsLeft} attempt${data.attemptsLeft === 1 ? "" : "s"} left.`
            : "That code wasn't right — check it and try again."
        );
        return;
      }
      setAccessVerified(true);
      setAccessMsg("Access code accepted.");
    } catch {
      setAccessMsg("The code could not be checked — please try again.");
    } finally {
      setAccessBusy(false);
    }
  };

  const canSign =
    tab === "typed" ? typedName.trim().length > 0 : hasInk;

  const submitSign = async () => {
    if (!canSign || signBusy) return;
    setSignBusy(true);
    setSignError("");
    try {
      const body: Record<string, unknown> = { kind: tab };
      if (tab === "typed") {
        body.typedName = typedName.trim();
      } else {
        const canvas = canvasRef.current;
        body.signaturePngBase64 = canvas
          ? canvas.toDataURL("image/png")
          : "";
      }
      if (payload?.requiresAccessCode && accessCode.trim()) {
        body.accessCode = accessCode.trim();
      }
      const res = await fetch(`${base}/sign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        envelopeStatus?: string;
        finalizePending?: boolean;
        error?: string;
      };
      if (!res.ok) {
        setSignError(
          data.error === "consent_required"
            ? "Please record your consent above before signing."
            : data.error === "typed_name_mismatch"
              ? "The typed name must match the name this document was sent to."
              : data.error === "access_code_invalid"
                ? "The access code wasn't accepted — re-enter it above and try again."
                : data.error === "access_code_locked"
                  ? "Too many incorrect access-code attempts — this link is temporarily locked."
                  : data.error === "rate_limited"
                    ? "Too many attempts — please wait a few minutes and try again."
                    : "Signing failed — please try again."
        );
        setConfirming(false);
        return;
      }
      setSignResult({
        envelopeStatus: data.envelopeStatus || "signed",
        finalizePending: data.finalizePending === true,
      });
      void load();
    } catch {
      setSignError("Signing failed — please try again.");
      setConfirming(false);
    } finally {
      setSignBusy(false);
    }
  };

  const submitDecline = async () => {
    if (declineBusy) return;
    setDeclineBusy(true);
    try {
      const res = await fetch(`${base}/decline`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: declineReason.trim() }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setDeclinedDone(true);
    } catch {
      /* keep the form open for a retry */
    } finally {
      setDeclineBusy(false);
    }
  };

  /* ------------------------------ render ------------------------------ */

  const shell = (children: React.ReactNode) => (
    <div className="min-h-screen bg-slate-50 dark:bg-[#0a1930]">
      <header className="bg-[#0d1f3c]">
        <div className="mx-auto max-w-3xl px-4 py-5 sm:px-6">
          <p className="font-display text-2xl font-semibold text-white">
            Canny Capital Partners
          </p>
          <p className="mt-1 text-sm text-[#e8dfc8]">Electronic signature</p>
        </div>
        <div className="h-0.5 bg-[#b8975a]" />
      </header>
      <main className="mx-auto max-w-3xl space-y-5 px-4 py-6 sm:px-6">
        {children}
      </main>
    </div>
  );

  const terminal = (title: string, message: string, extra?: React.ReactNode) =>
    shell(
      <div className={`${cardCls} text-center`}>
        <h1 className="font-display text-2xl font-semibold text-[#0d1f3c] dark:text-white">
          {title}
        </h1>
        <p className="mx-auto mt-2 max-w-md text-sm text-slate-600 dark:text-white/70">
          {message}
        </p>
        {extra}
        <p className="mt-4 text-xs text-slate-400 dark:text-white/40">
          If you believe this is a mistake, contact the person who sent
          you this link.
        </p>
      </div>
    );

  if (loadKind === "loading") {
    return shell(
      <div className={cardCls}>
        <SkeletonRows rows={5} />
      </div>
    );
  }
  if (loadKind === "not_found") {
    return terminal(
      "Link not valid",
      "This signing link doesn't match a document. Check the link from your email, or contact the sender for a fresh one."
    );
  }
  if (loadKind === "error" || !payload) {
    return shell(
      <div className={`${cardCls} text-center`}>
        <h1 className="font-display text-2xl font-semibold text-[#0d1f3c] dark:text-white">
          Something went wrong
        </h1>
        <p className="mt-2 text-sm text-slate-600 dark:text-white/70">
          The signing page could not be loaded.
        </p>
        <Button className="mt-4 min-h-[44px]" onClick={() => void load()}>
          Retry
        </Button>
      </div>
    );
  }

  const state = declinedDone ? "declined" : payload.state;
  const docName = payload.documentName || "Document";
  const senderLabel =
    payload.senderName || payload.senderEmail || "Canny Capital Partners";
  const docUrl = `${base}/document`;
  const showDocument =
    state === "waiting" ||
    state === "active" ||
    state === "signed" ||
    state === "completed";

  if (state === "expired") {
    return terminal(
      "This link has expired",
      `The signing link for ${docName} expired${payload.expiresAt ? ` on ${fmtDate(payload.expiresAt)}` : ""}. Contact ${senderLabel} for a fresh link.`
    );
  }
  if (state === "voided") {
    return terminal(
      "This request was voided",
      `The sender voided the signature request for ${docName}. No signature is needed — contact ${senderLabel} with any questions.`
    );
  }
  if (state === "declined") {
    return terminal(
      "Declined",
      declinedDone
        ? `You declined to sign ${docName}. The sender has been notified.`
        : `This signature request for ${docName} was declined, so it is closed.`
    );
  }

  const completedBlock = (
    <div className={`${cardCls} text-center`}>
      <h1 className="font-display text-2xl font-semibold text-[#0d1f3c] dark:text-white">
        Signed and complete
      </h1>
      <p className="mx-auto mt-2 max-w-md text-sm text-slate-600 dark:text-white/70">
        All signers have signed {docName}. The executed copy, sealed
        with its signing certificate, is below.
      </p>
      <a
        href={docUrl}
        download
        className="btn btn-primary mt-4 min-h-[44px]"
      >
        Download executed PDF
      </a>
    </div>
  );

  const signedBlock = (
    <div className={`${cardCls} text-center`}>
      <h1 className="font-display text-2xl font-semibold text-[#0d1f3c] dark:text-white">
        You&apos;ve signed
      </h1>
      <p className="mx-auto mt-2 max-w-md text-sm text-slate-600 dark:text-white/70">
        Your signature on {docName} is recorded. The document is
        waiting on the remaining signer
        {payload.totalSigners && payload.totalSigners > 2 ? "s" : ""} —
        you&apos;ll be able to download the executed copy here once
        everyone has signed.
      </p>
    </div>
  );

  return shell(
    <>
      <section className={cardCls}>
        <p className={labelCls}>Document to sign</p>
        <h1 className="font-display text-2xl font-semibold text-[#0d1f3c] dark:text-white">
          {docName}
        </h1>
        <p className="mt-1 text-sm text-slate-600 dark:text-white/70">
          Sent by {senderLabel}
          {payload.signer?.name
            ? ` to ${payload.signer.name}${payload.signer.email ? ` (${payload.signer.email})` : ""}`
            : ""}
          .
        </p>
        {payload.totalSigners && payload.totalSigners > 1 && (
          <p className="mt-1 text-xs text-slate-400 dark:text-white/40">
            Signer {payload.position ?? 1} of {payload.totalSigners}
            {payload.signingOrder === "sequential"
              ? " · sequential signing"
              : ""}
          </p>
        )}
        {payload.expiresAt && state === "active" && (
          <p className="mt-1 text-xs text-slate-400 dark:text-white/40">
            Please sign by {fmtDate(payload.expiresAt)}.
          </p>
        )}
      </section>

      {state === "completed" && completedBlock}
      {state === "signed" && !signResult && signedBlock}
      {signResult && state !== "completed" && (
        <div className={`${cardCls} text-center`}>
          <h2 className="font-display text-2xl font-semibold text-[#0d1f3c] dark:text-white">
            Signature recorded
          </h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-slate-600 dark:text-white/70">
            {signResult.finalizePending
              ? `Your signature on ${docName} is recorded. The final sealed copy is still being prepared — the sender can complete it from the portal, and this page will show the download once it's ready.`
              : `Your signature on ${docName} is recorded — signed, waiting for the other signers. This page will offer the executed copy once everyone has signed.`}
          </p>
        </div>
      )}
      {signResult && state === "completed" && null}

      {showDocument && (
        <section className={cardCls}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-bold uppercase tracking-wide text-[#0d1f3c] dark:text-white">
              Document
            </h2>
            <a
              href={docUrl}
              download
              className="btn btn-secondary btn-sm min-h-[44px]"
            >
              Download copy
            </a>
          </div>
          <iframe
            title={docName}
            src={docUrl}
            className="mt-3 h-[480px] w-full rounded-xl border border-slate-200 dark:border-white/10"
          />
        </section>
      )}

      {state === "waiting" && (
        <section className={cardCls}>
          <h2 className="font-display text-xl font-semibold text-[#0d1f3c] dark:text-white">
            It&apos;s not your turn yet
          </h2>
          <p className="mt-2 text-sm text-slate-600 dark:text-white/70">
            This document uses sequential signing, and an earlier signer
            hasn&apos;t signed yet. You can review the document above
            now — signing opens here as soon as it&apos;s your turn, and
            the sender can let you know when that happens.
          </p>
        </section>
      )}

      {state === "active" && !signResult && (
        <>
          {/* Consent */}
          <section className={cardCls}>
            <h2 className="text-sm font-bold uppercase tracking-wide text-[#0d1f3c] dark:text-white">
              Consent to electronic signatures
            </h2>
            {payload.consented ? (
              <p className="mt-2 text-sm text-emerald-700 dark:text-emerald-300">
                Consent recorded — thank you.
              </p>
            ) : (
              <>
                <div className="mt-3 max-h-44 overflow-y-auto whitespace-pre-wrap rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-600 dark:bg-white/5 dark:text-white/75">
                  {payload.consentText ||
                    "By checking the box below, you agree to sign this document electronically and to receive it in electronic form. Your electronic signature has the same legal effect as a handwritten one. You may request a paper copy from the sender at any time."}
                </div>
                <label className="mt-3 flex min-h-[44px] cursor-pointer items-start gap-2.5 text-sm text-slate-700 dark:text-white/80">
                  <input
                    type="checkbox"
                    checked={consentChecked}
                    onChange={(e) => setConsentChecked(e.target.checked)}
                    className="mt-0.5 h-5 w-5 shrink-0"
                  />
                  I agree to use electronic records and signatures for
                  this document.
                </label>
                {consentError && (
                  <p role="alert" className="mt-2 text-sm text-red-600 dark:text-red-300">
                    {consentError}
                  </p>
                )}
                <Button
                  className="mt-3 min-h-[44px]"
                  onClick={() => void submitConsent()}
                  disabled={!consentChecked || consentBusy}
                  loading={consentBusy}
                >
                  Agree and continue
                </Button>
              </>
            )}
          </section>

          {/* Access code */}
          {payload.requiresAccessCode && (
            <section className={cardCls}>
              <h2 className="text-sm font-bold uppercase tracking-wide text-[#0d1f3c] dark:text-white">
                Access code
              </h2>
              <p className="mt-2 text-sm text-slate-600 dark:text-white/70">
                The sender protected this document with an access code.
                Enter the code they gave you to unlock signing.
              </p>
              {accessVerified ? (
                <p className="mt-2 text-sm text-emerald-700 dark:text-emerald-300">
                  Access code accepted.
                </p>
              ) : (
                <>
                  <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                    <input
                      value={accessCode}
                      onChange={(e) => setAccessCode(e.target.value)}
                      placeholder="Access code"
                      autoComplete="off"
                      className={`${inputCls} min-h-[44px] flex-1`}
                      aria-label="Access code"
                    />
                    <Button
                      variant="secondary"
                      className="min-h-[44px]"
                      onClick={() => void verifyAccessCode()}
                      disabled={!accessCode.trim() || accessBusy}
                      loading={accessBusy}
                    >
                      Verify code
                    </Button>
                  </div>
                  {accessMsg && (
                    <p role="alert" className="mt-2 text-sm text-slate-600 dark:text-white/70">
                      {accessMsg}
                    </p>
                  )}
                </>
              )}
            </section>
          )}

          {/* Signature */}
          {payload.consented &&
            (!payload.requiresAccessCode || accessVerified) && (
              <section className={cardCls}>
                <h2 className="text-sm font-bold uppercase tracking-wide text-[#0d1f3c] dark:text-white">
                  Your signature
                </h2>
                <div className="mt-3 flex gap-2" role="tablist" aria-label="Signature style">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={tab === "typed"}
                    onClick={() => setTab("typed")}
                    className={`chip min-h-[44px] ${tab === "typed" ? "chip-active" : ""}`}
                  >
                    Type
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={tab === "drawn"}
                    onClick={() => setTab("drawn")}
                    className={`chip min-h-[44px] ${tab === "drawn" ? "chip-active" : ""}`}
                  >
                    Draw
                  </button>
                </div>

                {tab === "typed" ? (
                  <div className="mt-3">
                    <label className={labelCls} htmlFor="typed-name">
                      Type your full name
                    </label>
                    <input
                      id="typed-name"
                      value={typedName}
                      onChange={(e) => setTypedName(e.target.value)}
                      placeholder={payload.signer?.name || "Your full name"}
                      autoComplete="name"
                      className={`${inputCls} min-h-[44px]`}
                    />
                    <div className="mt-3 flex min-h-[72px] items-center justify-center rounded-xl border border-dashed border-slate-300 px-4 py-3 dark:border-white/20">
                      <span
                        style={{ fontFamily: CURSIVE_STACK, fontStyle: "italic" }}
                        className="text-3xl text-[#0d1f3c] dark:text-white"
                      >
                        {typedName.trim() || "Your signature"}
                      </span>
                    </div>
                    <p className="mt-2 text-xs text-slate-400 dark:text-white/40">
                      Preview only — your typed name is rendered as
                      your signature in the signed document.
                    </p>
                  </div>
                ) : (
                  <div className="mt-3">
                    <p className={labelCls}>Draw your signature</p>
                    <canvas
                      ref={canvasRef}
                      height={360}
                      style={{ height: 180, touchAction: "none" }}
                      className="w-full rounded-xl border border-slate-300 bg-white dark:border-white/20"
                      onPointerDown={onPointerDown}
                      onPointerMove={onPointerMove}
                      onPointerUp={endStroke}
                      onPointerCancel={endStroke}
                      aria-label="Signature drawing area"
                    />
                    <div className="mt-2 flex justify-end">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="min-h-[44px]"
                        onClick={clearCanvas}
                      >
                        Clear
                      </Button>
                    </div>
                  </div>
                )}

                {signError && (
                  <p role="alert" className="mt-2 rounded-xl bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-300">
                    {signError}
                  </p>
                )}

                {!confirming ? (
                  <Button
                    className="mt-4 min-h-[44px] w-full sm:w-auto"
                    onClick={() => setConfirming(true)}
                    disabled={!canSign}
                  >
                    Adopt signature and sign
                  </Button>
                ) : (
                  <div className="mt-4 rounded-xl bg-slate-50 px-4 py-3 dark:bg-white/5">
                    <p className="text-sm text-slate-700 dark:text-white/80">
                      By confirming, you sign {docName} electronically
                      as {payload.signer?.name || "the named signer"}.
                      This action is recorded with the date, time, and
                      your IP address.
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button
                        className="min-h-[44px]"
                        onClick={() => void submitSign()}
                        disabled={signBusy}
                        loading={signBusy}
                      >
                        Confirm and sign
                      </Button>
                      <Button
                        variant="ghost"
                        className="min-h-[44px]"
                        onClick={() => setConfirming(false)}
                        disabled={signBusy}
                      >
                        Back
                      </Button>
                    </div>
                  </div>
                )}
              </section>
            )}

          {/* Decline */}
          <section className="px-1">
            {!showDecline ? (
              <button
                type="button"
                onClick={() => setShowDecline(true)}
                className="min-h-[44px] text-sm font-medium text-slate-500 underline-offset-2 hover:underline dark:text-white/50"
              >
                Decline to sign
              </button>
            ) : (
              <div className={cardCls}>
                <h2 className="text-sm font-bold uppercase tracking-wide text-[#0d1f3c] dark:text-white">
                  Decline to sign
                </h2>
                <p className="mt-2 text-sm text-slate-600 dark:text-white/70">
                  Declining closes this request for everyone. The
                  sender will see your reason.
                </p>
                <textarea
                  value={declineReason}
                  onChange={(e) => setDeclineReason(e.target.value)}
                  rows={3}
                  placeholder="Reason (optional)"
                  className={`${inputCls} mt-3`}
                  aria-label="Decline reason"
                />
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    variant="danger"
                    className="min-h-[44px]"
                    onClick={() => void submitDecline()}
                    disabled={declineBusy}
                    loading={declineBusy}
                  >
                    Decline to sign
                  </Button>
                  <Button
                    variant="ghost"
                    className="min-h-[44px]"
                    onClick={() => setShowDecline(false)}
                    disabled={declineBusy}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            )}
          </section>
        </>
      )}
    </>
  );
}

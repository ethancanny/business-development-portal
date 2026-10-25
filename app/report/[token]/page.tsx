"use client";

/**
 * Standalone recipient report page (/report/[token]) — no portal
 * chrome (the AppShell bypass for /report/* renders this standalone).
 * Loads the audience-filtered render + recipient meta from
 * /api/report-guest/[token] and renders the institutional document
 * (ReportDocument, guest mode): firm wordmark band, subject mark per
 * codename rules, executive summary, TOC, sources appendix,
 * audience confidentiality footer, recipient watermark.
 *
 * Interaction (spec §8): a tracked PDF download, contextual replies
 * (per-section "Comment on this section" targets the reply card at
 * the end; an overall message is always available), the sender's
 * name, a confirmation after sending, and "Request a call" ONLY when
 * a scheduling link is configured. Error states are explicit:
 * revoked / expired / not_found — content is never shown for an
 * invalid token.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import ReportDocument from "@/components/comms/ReportDocument";
import type {
  ReportGuestMeta,
  ReportRender,
} from "@/components/comms/types";

type LoadState =
  | { kind: "loading" }
  | {
      kind: "ready";
      render: ReportRender;
      meta: ReportGuestMeta | null;
      purpose: string;
    }
  | { kind: "revoked" }
  | { kind: "expired" }
  | { kind: "not_found" }
  | { kind: "error" };

export default function RecipientReportPage() {
  const params = useParams();
  const token = typeof params?.token === "string" ? params.token : "";
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [replySection, setReplySection] = useState<{
    key: string;
    heading: string;
  } | null>(null);
  const [replyBusy, setReplyBusy] = useState(false);
  const [replyNote, setReplyNote] = useState("");
  const [replySent, setReplySent] = useState(false);
  const replyRef = useRef<HTMLDivElement>(null);
  const messageRef = useRef<HTMLTextAreaElement>(null);

  const load = useCallback(async () => {
    if (!token) {
      setState({ kind: "not_found" });
      return;
    }
    setState({ kind: "loading" });
    try {
      const res = await fetch(`/api/report-guest/${encodeURIComponent(token)}`, {
        cache: "no-store",
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) {
        const code = typeof data.error === "string" ? data.error : "";
        if (code === "revoked") setState({ kind: "revoked" });
        else if (code === "expired") setState({ kind: "expired" });
        else if (code === "not_found" || res.status === 404) setState({ kind: "not_found" });
        else setState({ kind: "error" });
        return;
      }
      const render = (data.render ?? null) as ReportRender | null;
      if (!render) {
        setState({ kind: "error" });
        return;
      }
      const meta = (data.meta ?? null) as ReportGuestMeta | null;
      const report = (data.report ?? {}) as Record<string, unknown>;
      if (meta?.preparedFor?.name) setName(meta.preparedFor.name);
      setState({
        kind: "ready",
        render,
        meta,
        purpose: typeof report.purpose === "string" ? report.purpose : "",
      });
    } catch {
      setState({ kind: "error" });
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const focusReply = useCallback((section: { key: string; heading: string } | null) => {
    setReplySection(section);
    setReplySent(false);
    setReplyNote("");
    requestAnimationFrame(() => {
      replyRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      messageRef.current?.focus({ preventScroll: true });
    });
  }, []);

  const sendReply = async () => {
    if (!message.trim() || replyBusy) return;
    setReplyBusy(true);
    setReplyNote("");
    try {
      const res = await fetch(
        `/api/report-guest/${encodeURIComponent(token)}/reply`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: name.trim() || undefined,
            body: message.trim(),
            sectionKey: replySection?.key,
          }),
        }
      );
      if (!res.ok) throw new Error("failed");
      setMessage("");
      setReplySection(null);
      setReplySent(true);
      setReplyNote(
        "Thank you — your reply has been sent to Canny Capital Partners."
      );
    } catch {
      setReplyNote(
        "Your reply could not be sent. Please try again, or contact the sender directly."
      );
    } finally {
      setReplyBusy(false);
    }
  };

  const pdfHref = `/api/report-guest/${encodeURIComponent(token)}/pdf`;
  const ready = state.kind === "ready" ? state : null;
  const senderName =
    ready?.meta?.sender.name || "Canny Capital Partners";

  return (
    <main className="min-h-screen bg-[#faf8f2] px-3 py-6 pb-24 sm:px-4 sm:py-10 sm:pb-10">
      {state.kind === "loading" && (
        <div className="mx-auto mt-10 w-full max-w-[920px] bg-white p-10 text-center shadow-xl ring-1 ring-black/5" aria-busy="true">
          <p className="text-sm text-stone-500">Loading report…</p>
        </div>
      )}

      {state.kind === "revoked" && (
        <ErrorCard
          title="Access revoked"
          message="Access to this report has been revoked by the sender. If you believe this is a mistake, please contact Canny Capital Partners."
        />
      )}
      {state.kind === "expired" && (
        <ErrorCard
          title="Link expired"
          message="This report link has expired. Please contact Canny Capital Partners for a fresh link."
        />
      )}
      {state.kind === "not_found" && (
        <ErrorCard
          title="Report not found"
          message="This link doesn't match a delivered report. Check the link from your email, or contact the sender."
        />
      )}
      {state.kind === "error" && (
        <div className="mx-auto mt-10 w-full max-w-[920px] bg-white p-10 text-center shadow-xl ring-1 ring-black/5">
          <ErrorCard
            title="Something went wrong"
            message="The report could not be loaded."
            bare
          />
          <button type="button" className="btn btn-primary btn-sm mt-4" onClick={() => void load()}>
            Retry
          </button>
        </div>
      )}

      {ready && (
        <>
          <ReportDocument
            render={ready.render}
            meta={ready.meta}
            mode="guest"
            purpose={ready.purpose || undefined}
            downloadHref={pdfHref}
            onReplySection={(key, heading) => focusReply({ key, heading })}
          />

          {/* Reply card */}
          <div
            ref={replyRef}
            className="mx-auto mt-6 w-full max-w-[920px] scroll-mt-6 bg-white p-6 shadow-xl ring-1 ring-black/5 sm:p-8"
          >
            <h2 className="font-display text-xl font-semibold text-navy-900">
              Reply to {senderName}
            </h2>
            <p className="mt-1 text-sm text-stone-500">
              Your reply goes to the report&apos;s sender at Canny Capital
              Partners and is attached to this report.
            </p>
            {replySection && (
              <p className="mt-3 inline-flex items-center gap-2 rounded-full bg-cream px-3 py-1 text-xs font-semibold text-navy-800 ring-1 ring-gold-500/50">
                About: {replySection.heading}
                <button
                  type="button"
                  aria-label="Clear section"
                  className="text-stone-400 hover:text-navy-900"
                  onClick={() => setReplySection(null)}
                >
                  ✕
                </button>
              </p>
            )}
            <div className="mt-4 space-y-3">
              <div>
                <label
                  className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-stone-400"
                  htmlFor="reply-name"
                >
                  Your name
                </label>
                <input
                  id="reply-name"
                  className="w-full rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm text-navy-900 outline-none placeholder:text-stone-300 focus:border-gold-500"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Optional"
                />
              </div>
              <div>
                <label
                  className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-stone-400"
                  htmlFor="reply-body"
                >
                  Message
                </label>
                <textarea
                  id="reply-body"
                  ref={messageRef}
                  className="min-h-[96px] w-full rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm text-navy-900 outline-none placeholder:text-stone-300 focus:border-gold-500"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder={
                    replySection
                      ? `Your comment on “${replySection.heading}”…`
                      : "Questions or comments on this report…"
                  }
                />
              </div>
            </div>
            {replyNote && (
              <p
                role={replySent ? "status" : "alert"}
                className={`mt-3 rounded-xl px-4 py-3 text-sm ${
                  replySent
                    ? "bg-[#eef4ec] text-[#2f6b4f]"
                    : "bg-[#faeeea] text-[#9c3d2e]"
                }`}
              >
                {replyNote}
              </p>
            )}
            <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
              {ready.meta?.schedulingUrl && (
                <a
                  href={ready.meta.schedulingUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="btn btn-secondary btn-sm min-h-[44px]"
                >
                  Request a call
                </a>
              )}
              <button
                type="button"
                className="btn btn-primary btn-sm min-h-[44px]"
                onClick={() => void sendReply()}
                disabled={!message.trim() || replyBusy}
              >
                {replyBusy ? "Sending…" : "Send reply"}
              </button>
            </div>
          </div>

          {/* Mobile action bar — Download stays reachable (§4). */}
          <div className="fixed inset-x-0 bottom-0 z-30 flex gap-2 border-t border-stone-200 bg-white/95 p-3 backdrop-blur sm:hidden">
            <a href={pdfHref} className="btn btn-primary btn-sm min-h-[44px] flex-1">
              Download PDF
            </a>
            <button
              type="button"
              className="btn btn-secondary btn-sm min-h-[44px] flex-1"
              onClick={() => focusReply(null)}
            >
              Reply
            </button>
            {ready.meta?.schedulingUrl && (
              <a
                href={ready.meta.schedulingUrl}
                target="_blank"
                rel="noreferrer"
                className="btn btn-secondary btn-sm min-h-[44px] flex-1"
              >
                Request a call
              </a>
            )}
          </div>
        </>
      )}
    </main>
  );
}

function ErrorCard({
  title,
  message,
  bare = false,
}: {
  title: string;
  message: string;
  bare?: boolean;
}) {
  const inner = (
    <>
      <h1 className="font-display text-2xl font-semibold text-navy-900">
        {title}
      </h1>
      <p className="mx-auto mt-2 max-w-md text-sm text-stone-500">
        {message}
      </p>
    </>
  );
  if (bare) return <div className="text-center">{inner}</div>;
  return (
    <div className="mx-auto mt-10 w-full max-w-[920px] bg-white p-10 text-center shadow-xl ring-1 ring-black/5">
      {inner}
    </div>
  );
}

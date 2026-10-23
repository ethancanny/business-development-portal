"use client";

/**
 * Standalone recipient report page (/report/[token]) — no portal
 * chrome (the AppShell bypass for /report/* is coordinator wiring;
 * this page renders standalone regardless). Loads the
 * audience-filtered render from /api/report-guest/[token], shows it
 * through <ReportView/>, offers the tracked PDF download, and a
 * reply form. Error states are explicit: revoked / expired /
 * not_found each get their own message — the report content is never
 * shown for an invalid token.
 */

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import ReportView from "@/components/comms/ReportView";
import type { ReportRender } from "@/components/comms/types";

type LoadState =
  | { kind: "loading" }
  | { kind: "ready"; render: ReportRender; title: string }
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
  const [replyBusy, setReplyBusy] = useState(false);
  const [replyNote, setReplyNote] = useState("");

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
      const meta = (data.report ?? {}) as Record<string, unknown>;
      setState({
        kind: "ready",
        render,
        title: typeof meta.title === "string" ? meta.title : render.title,
      });
    } catch {
      setState({ kind: "error" });
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

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
          body: JSON.stringify({ name: name.trim() || undefined, body: message.trim() }),
        }
      );
      if (!res.ok) throw new Error("failed");
      setMessage("");
      setReplyNote("Thank you — your reply has been sent to Canny Capital Partners.");
    } catch {
      setReplyNote("Your reply could not be sent. Please try again, or contact the sender directly.");
    } finally {
      setReplyBusy(false);
    }
  };

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-10 dark:bg-navy-950">
      <div className="mx-auto w-full max-w-3xl">
        <p className="text-center text-xs font-semibold uppercase tracking-[0.2em] text-gold-700 dark:text-gold-400">
          Canny Capital Partners
        </p>

        {state.kind === "loading" && (
          <div className="card-surface mt-6 p-8 text-center" aria-busy="true">
            <p className="text-sm text-slate-500 dark:text-white/50">Loading report…</p>
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
          <div className="card-surface mt-6 p-8 text-center">
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

        {state.kind === "ready" && (
          <>
            <div className="card-surface mt-6 p-6 sm:p-8">
              <ReportView render={state.render} />
            </div>

            <div className="mt-4 flex justify-center">
              <a
                href={`/api/report-guest/${encodeURIComponent(token)}/pdf`}
                className="btn btn-primary btn-sm min-h-[44px]"
              >
                Download PDF
              </a>
            </div>

            <div className="card-surface mt-6 p-6">
              <h2 className="font-display text-xl font-semibold text-navy-900 dark:text-white">
                Reply to Canny Capital Partners
              </h2>
              <div className="mt-3 space-y-3">
                <div>
                  <label
                    className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-white/40"
                    htmlFor="reply-name"
                  >
                    Your name
                  </label>
                  <input
                    id="reply-name"
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-[#0d1f3c] outline-none placeholder:text-slate-300 focus:border-[#b8975a] dark:border-white/10 dark:bg-white/5 dark:text-white dark:placeholder:text-white/30"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Optional"
                  />
                </div>
                <div>
                  <label
                    className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-white/40"
                    htmlFor="reply-body"
                  >
                    Message
                  </label>
                  <textarea
                    id="reply-body"
                    className="min-h-[96px] w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-[#0d1f3c] outline-none placeholder:text-slate-300 focus:border-[#b8975a] dark:border-white/10 dark:bg-white/5 dark:text-white dark:placeholder:text-white/30"
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    placeholder="Questions or comments on this report…"
                  />
                </div>
              </div>
              {replyNote && (
                <p className="mt-3 rounded-xl bg-slate-500/10 px-4 py-3 text-sm text-slate-700 dark:text-white/80">
                  {replyNote}
                </p>
              )}
              <div className="mt-4 flex justify-end">
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
          </>
        )}

        <p className="mt-8 text-center text-xs text-slate-400 dark:text-white/35">
          This link is personal to its recipient and expires 30 days
          after delivery. Please do not forward it.
        </p>
      </div>
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
      <h1 className="font-display text-2xl font-semibold text-navy-900 dark:text-white">
        {title}
      </h1>
      <p className="mx-auto mt-2 max-w-md text-sm text-slate-500 dark:text-white/50">
        {message}
      </p>
    </>
  );
  if (bare) return <div className="text-center">{inner}</div>;
  return <div className="card-surface mt-6 p-8 text-center">{inner}</div>;
}

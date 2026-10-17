"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Operator sourcing — manual sources & capture (Operator Build 3,
 * Oct 17, 2026). Some spec sources cannot be mined automatically:
 * they sit behind human checks, account logins, or simply do not
 * publish the fields the candidate system needs. Rather than building
 * scrapers for them (Ethan's rules: no automated logins anywhere, no
 * CAPTCHA workarounds), they are listed here with their status and
 * what Ethan can do by hand. Finds from any of them enter through the
 * /capture form (or the bookmarklet below), which enforces the same
 * source-URL rule as every other candidate create.
 */

export interface ManualSource {
  name: string;
  status: string;
  detail: string;
  ethanAction: string;
}

export const MANUAL_SOURCES: ManualSource[] = [
  {
    name: "ACC officers & statutory agents",
    status: "Blocked — human check + account login",
    detail:
      "Arizona Corporation Commission entity records name a company's officers and statutory agent — a rich operator source — but the public eCorp search sits behind a human verification check, and no bulk officer feed is published. The eCorp login is saved in the Secure Vault, but automated browser access is currently blocked at the platform layer, so there is no recurring ACC officer feed.",
    ethanAction:
      "Run the entity search yourself at ecorp.azcc.gov, then add the officers through Capture (below) with the entity page as the source URL — or paste the ACC file number into a note and Muse will cross-check it.",
  },
  {
    name: "DLLC licensees & agents",
    status: "Blocked — search retired / login-gated",
    detail:
      "The Department of Liquor Licenses and Control's legacy licensee search was retired, and its replacement portal puts licensee and agent detail behind an account login. No public bulk list of licensees/agents is published, so the hospitality spine carries 0 DLLC licenses and there is no agent feed to mine.",
    ethanAction:
      "File a DLLC records request for the licensee list, or capture individual licensees/agents through Capture when you come across them. Muse can draft the records request on request.",
  },
  {
    name: "ADHS facility administrators",
    status: "Blocked — the data does not exist in the source",
    detail:
      "The public ADHS licensing databases (AZ Care Check / Providers & Facility files) publish facility, license, category, and unit data — but no administrator or manager name fields at all. Verified Oct 2026 across all 27,011 healthcare company records in the portal: zero administrator names exist to mine, so this feed cannot be built until a source publishes the names.",
    ethanAction:
      "When you learn a facility administrator's name (a call, a meeting, a referral), add them through Capture with where you found it as the source. Nothing else is needed — the gap is in the source data, not the portal.",
  },
  {
    name: "LinkedIn",
    status: "Partial — public search index only",
    detail:
      "There is no LinkedIn connector, and automated logins to LinkedIn (or any site) are never used. LinkedIn finds therefore arrive only through the public search index, which mostly surfaces company pages and posts rather than personal profiles — expect low yield, and a candidate is labeled “LinkedIn” only when its saved source URL is a linkedin.com page.",
    ethanAction:
      "When you spot an operator on LinkedIn yourself, use the Capture bookmarklet on that page — the form prefills with the LinkedIn URL and the record is labeled LinkedIn automatically.",
  },
];

const CAPTURE_URL = "https://portal.cannycapitalpartners.com/capture";

/** Bookmarklet: open /capture in a new tab prefilled with the current
 * page's URL and title. Built as a string and assigned via ref —
 * React will not render a javascript: href from JSX directly. */
export const BOOKMARKLET_SNIPPET = `javascript:(function(){var u=encodeURIComponent(window.location.href);var t=encodeURIComponent(document.title||'');window.open('${CAPTURE_URL}?url='+u+'&title='+t,'_blank');})();`;

export default function ManualSourcesSettings() {
  const linkRef = useRef<HTMLAnchorElement | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (linkRef.current) {
      linkRef.current.setAttribute("href", BOOKMARKLET_SNIPPET);
    }
  }, []);

  const copySnippet = async () => {
    try {
      await navigator.clipboard.writeText(BOOKMARKLET_SNIPPET);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div>
      <div className="flex flex-col gap-4">
        {MANUAL_SOURCES.map((s) => (
          <div
            key={s.name}
            className="rounded-xl border border-slate-200 p-4 dark:border-white/10"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-sm font-bold text-[#0d1f3c] dark:text-white">
                {s.name}
              </h3>
              <span className="rounded bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-400/10 dark:text-amber-300">
                {s.status}
              </span>
            </div>
            <p className="mt-2 text-sm text-slate-600 dark:text-white/70">
              {s.detail}
            </p>
            <p className="mt-2 text-sm text-slate-600 dark:text-white/70">
              <span className="font-semibold text-slate-700 dark:text-white/85">
                What you can do:{" "}
              </span>
              {s.ethanAction}
            </p>
          </div>
        ))}
      </div>

      <div className="mt-6 border-t border-slate-100 pt-5 dark:border-white/10">
        <h3 className="text-sm font-bold text-[#0d1f3c] dark:text-white">
          Capture a candidate by hand
        </h3>
        <p className="mt-1 text-sm text-slate-600 dark:text-white/70">
          The capture form adds a candidate under the same rules as every
          feed: the source URL is required, and a repeat of an existing
          name + company + title records a new sighting instead of a
          duplicate. On a phone, use your browser&apos;s Share menu and
          pick the portal (where supported) — it opens the same form
          prefilled.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <a
            href="/capture"
            className="btn btn-primary"
          >
            Open the capture form
          </a>
          <a
            ref={linkRef}
            href="#"
            onClick={(e) => e.preventDefault()}
            draggable
            className="cursor-grab rounded-lg border border-dashed border-[#b8975a] px-4 py-2 text-sm font-medium text-[#0d1f3c] dark:text-white/85"
            title="Drag me to your bookmarks bar"
          >
            ⤴ Capture to Canny Capital
          </a>
          <span className="text-xs text-slate-400 dark:text-white/40">
            Drag the dashed button to your bookmarks bar, then click it on
            any page to capture the person you found there.
          </span>
        </div>
        <div className="mt-3">
          <span className="mb-1 block text-sm font-medium text-slate-700 dark:text-white/80">
            Bookmarklet code (if drag-and-drop doesn&apos;t work, paste this
            as a bookmark URL)
          </span>
          <div className="flex gap-2">
            <code className="min-w-0 flex-1 overflow-auto whitespace-nowrap rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600 dark:border-white/10 dark:bg-white/5 dark:text-white/60">
              {BOOKMARKLET_SNIPPET}
            </code>
            <button
              type="button"
              onClick={copySnippet}
              className="shrink-0 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-600 dark:border-white/20 dark:text-white/70"
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

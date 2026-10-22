"use client";

import { Suspense, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import PageHero from "@/components/PageHero";

/**
 * Manual candidate capture (Operator Discovery spec — manual capture;
 * Build 3, Oct 17, 2026). One form that adds an operator candidate
 * under exactly the rules of the automated feeds: the source URL is
 * required, the "LinkedIn" label is accepted only for a linkedin.com
 * URL (the API enforces both), and a repeat name + company + title
 * merges as a new sighting instead of duplicating.
 *
 * Entry points, all via query params:
 *  - the Settings bookmarklet: ?url=<page url>&title=<page title>
 *  - the PWA Web Share Target (manifest share_target): the platform
 *    sends ?title=<page title>&text=<shared text>&url=<shared url>
 *  - a plain link / manual visit: any of name, role, company, city,
 *    referrer, source may also be prefilled.
 */

const SOURCE_TYPES = [
  "Web research",
  "News",
  "LinkedIn",
  "Referral",
  "SAM.gov",
  "License records",
  "NPPES registry",
];

const inputCls =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-[#b8975a] dark:border-white/15 dark:bg-white/5 dark:text-white/90";
const labelCls =
  "mb-1 block text-sm font-medium text-slate-700 dark:text-white/80";

function phoenixToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Phoenix",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function firstUrlIn(text: string): string {
  const m = text.match(/https?:\/\/[^\s)]+/);
  return m ? m[0] : "";
}

function defaultSourceType(url: string): string {
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (host === "linkedin.com" || host.endsWith(".linkedin.com")) {
      return "LinkedIn";
    }
  } catch {
    /* not a URL yet — fall through */
  }
  return "Web research";
}

interface Result {
  ok: boolean;
  message: string;
}

function CaptureForm() {
  const sp = useSearchParams();

  const initial = useMemo(() => {
    const sharedText = (sp.get("text") ?? "").trim();
    const urlParam = (sp.get("url") ?? "").trim();
    const sourceUrl = urlParam || firstUrlIn(sharedText);
    const pageTitle = (sp.get("title") ?? "").trim();
    const noteBits: string[] = [];
    if (pageTitle) noteBits.push(`Captured from: ${pageTitle}`);
    if (sharedText && sharedText !== sourceUrl) {
      noteBits.push(sharedText.slice(0, 400));
    }
    const city = (sp.get("city") ?? "").trim();
    return {
      name: (sp.get("name") ?? "").trim(),
      currentTitle: (sp.get("role") ?? sp.get("personTitle") ?? "").trim(),
      company: (sp.get("company") ?? "").trim(),
      city,
      industry: (sp.get("industry") ?? "").trim(),
      focusSector: (sp.get("focus") ?? "") !== "other",
      sourceType:
        (sp.get("source") ?? "").trim() || defaultSourceType(sourceUrl),
      sourceUrl,
      referrer: (sp.get("referrer") ?? "").trim(),
      fitNotes: noteBits.join("\n"),
      dateFound: phoenixToday(),
      locationVerified: Boolean(city),
    };
  }, [sp]);

  const [form, setForm] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  const set = (k: keyof typeof form, v: string | boolean) =>
    setForm((f) => ({ ...f, [k]: v }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setResult(null);
    if (!form.name.trim()) {
      setResult({ ok: false, message: "Name is required." });
      return;
    }
    if (!form.sourceUrl.trim()) {
      setResult({
        ok: false,
        message:
          "Source URL is required — every candidate record must carry the URL it was found at.",
      });
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/operators/candidates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name.trim(),
          currentTitle: form.currentTitle.trim(),
          company: form.company.trim(),
          industry: form.industry.trim(),
          focusSector: form.focusSector,
          city: form.city.trim(),
          locationVerified: form.locationVerified,
          sourceType: form.sourceType,
          sourceUrl: form.sourceUrl.trim(),
          dateFound: form.dateFound,
          referrer: form.referrer.trim(),
          fitNotes: form.fitNotes.trim(),
          status: "Candidate",
        }),
      });
      const body = (await res.json().catch(() => ({}))) as Record<
        string,
        unknown
      >;
      if (!res.ok) {
        setResult({
          ok: false,
          message: String(body.error ?? `Save failed (${res.status}).`),
        });
        return;
      }
      const sightings = Array.isArray(body.sightings)
        ? body.sightings.length
        : null;
      setResult({
        ok: true,
        message: body.merged
          ? `Already on file — this was recorded as a new sighting${sightings ? ` (#${sightings})` : ""} for ${form.name.trim()}. No duplicate was created.`
          : `Candidate added: ${form.name.trim()}${form.company ? ` — ${form.company.trim()}` : ""}. They start as Candidate until reviewed.`,
      });
    } catch {
      setResult({
        ok: false,
        message: "Network error — the candidate was not saved. Try again.",
      });
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    setForm({
      name: "",
      currentTitle: "",
      company: "",
      city: "",
      industry: "",
      focusSector: true,
      sourceType: "Web research",
      sourceUrl: "",
      referrer: "",
      fitNotes: "",
      dateFound: phoenixToday(),
      locationVerified: false,
    });
    setResult(null);
  };

  return (
    <form
      onSubmit={submit}
      className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-[#132847]/60 sm:p-6"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className={labelCls}>Name *</span>
          <input
            className={inputCls}
            value={form.name}
            onChange={(e) => set("name", e.target.value)}
            placeholder="Jane Operator"
            autoComplete="off"
          />
        </label>
        <label className="block">
          <span className={labelCls}>Current title</span>
          <input
            className={inputCls}
            value={form.currentTitle}
            onChange={(e) => set("currentTitle", e.target.value)}
            placeholder="President / COO / GM…"
            autoComplete="off"
          />
        </label>
        <label className="block">
          <span className={labelCls}>Company</span>
          <input
            className={inputCls}
            value={form.company}
            onChange={(e) => set("company", e.target.value)}
            autoComplete="off"
          />
        </label>
        <label className="block">
          <span className={labelCls}>City</span>
          <input
            className={inputCls}
            value={form.city}
            onChange={(e) => set("city", e.target.value)}
            placeholder="Phoenix"
            autoComplete="off"
          />
        </label>
        <label className="block">
          <span className={labelCls}>Industry</span>
          <input
            className={inputCls}
            value={form.industry}
            onChange={(e) => set("industry", e.target.value)}
            placeholder="Healthcare, Trades & Construction…"
            autoComplete="off"
          />
        </label>
        <label className="block">
          <span className={labelCls}>Sector</span>
          <select
            className={inputCls}
            value={form.focusSector ? "focus" : "other"}
            onChange={(e) => set("focusSector", e.target.value === "focus")}
          >
            <option value="focus">Focus sector</option>
            <option value="other">Other sector</option>
          </select>
        </label>
        <label className="block">
          <span className={labelCls}>Source type</span>
          <select
            className={inputCls}
            value={form.sourceType}
            onChange={(e) => set("sourceType", e.target.value)}
          >
            {SOURCE_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className={labelCls}>Date found</span>
          <input
            type="date"
            className={inputCls}
            value={form.dateFound}
            onChange={(e) => set("dateFound", e.target.value)}
          />
        </label>
      </div>

      <label className="mt-4 block">
        <span className={labelCls}>Source URL *</span>
        <input
          className={inputCls}
          value={form.sourceUrl}
          onChange={(e) => set("sourceUrl", e.target.value)}
          placeholder="https://… (the page where you found them)"
          autoComplete="off"
        />
        <span className="mt-1 block text-xs text-slate-400 dark:text-white/40">
          Required — every candidate carries the URL it was found at. The
          LinkedIn label is accepted only for a linkedin.com URL.
        </span>
      </label>

      <label className="mt-4 block">
        <span className={labelCls}>Referrer</span>
        <input
          className={inputCls}
          value={form.referrer}
          onChange={(e) => set("referrer", e.target.value)}
          placeholder="Who pointed you to them (if anyone)"
          autoComplete="off"
        />
      </label>

      <label className="mt-4 block">
        <span className={labelCls}>Notes</span>
        <textarea
          className={`${inputCls} min-h-[84px]`}
          value={form.fitNotes}
          onChange={(e) => set("fitNotes", e.target.value)}
          placeholder="Why they look like a fit — size, tenure, signals…"
        />
      </label>

      <label className="mt-4 flex items-center gap-2 text-sm text-slate-700 dark:text-white/80">
        <input
          type="checkbox"
          checked={form.locationVerified}
          onChange={(e) => set("locationVerified", e.target.checked)}
          className="h-4 w-4 accent-[#b8975a]"
        />
        Arizona location confirmed (unconfirmed candidates stay unscored in
        the “Location unverified” bucket)
      </label>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={busy}
          className="rounded-lg bg-[#0d1f3c] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 dark:bg-[#b8975a] dark:text-[#0d1f3c]"
        >
          {busy ? "Saving…" : "Add candidate"}
        </button>
        {result?.ok && (
          <button
            type="button"
            onClick={reset}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 dark:border-white/20 dark:text-white/70"
          >
            Capture another
          </button>
        )}
        {result && (
          <p
            className={`text-sm ${result.ok ? "text-emerald-600 dark:text-emerald-300" : "text-red-600 dark:text-red-300"}`}
          >
            {result.message}
          </p>
        )}
      </div>
    </form>
  );
}

export default function CapturePage() {
  return (
    <div>
      <PageHero
        eyebrow="Operator sourcing"
        title="Capture a candidate"
        subtitle="Add an operator you found — a LinkedIn page, a news item, a referral. The source URL is required, and duplicates merge as sightings."
      />
      <div className="mx-auto max-w-[900px] px-4 py-6 sm:px-6">
        <Suspense fallback={null}>
          <CaptureForm />
        </Suspense>
      </div>
    </div>
  );
}

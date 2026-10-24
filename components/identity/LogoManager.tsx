"use client";

import { useRef, useState } from "react";
import CompanyMark from "./CompanyMark";
import {
  accentForSurface,
  normalizeHex,
} from "@/lib/identity/shared";

interface IdentityState {
  logoVersion: number;
  logoSource: string;
  logoMime: string;
  logoUpdatedAt: string | null;
  accentColor: string;
  accentSuggested: string;
  website: string;
}

interface Candidate {
  token: string;
  kind: string;
  label: string;
}

/**
 * Logo + accent editor for the company profile (Deal Identity
 * System). Upload (PNG/JPG/SVG) always overrides; auto-fetch gathers
 * candidates from the company's domain and saves ONLY the one Ethan
 * explicitly confirms in the dialog — fetching alone never writes.
 * The accent color is suggested from the logo's dominant color and
 * stays editable; renders use contrast-safe derivatives.
 */
export default function LogoManager({
  companyId,
  companyName,
  initial,
  fallbackWebsite = "",
}: {
  companyId: string;
  companyName: string;
  initial: IdentityState;
  fallbackWebsite?: string;
}) {
  const [identity, setIdentity] = useState<IdentityState>(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [accentDraft, setAccentDraft] = useState(initial.accentColor ?? "");
  const fileRef = useRef<HTMLInputElement>(null);

  // Auto-fetch dialog state.
  const [dialog, setDialog] = useState(false);
  const [domain, setDomain] = useState(
    initial.website || fallbackWebsite || ""
  );
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  const base = `/api/platform/companies/${encodeURIComponent(companyId)}`;

  function applyIdentity(next: Partial<IdentityState>) {
    setIdentity((prev) => {
      const merged = { ...prev, ...next };
      setAccentDraft(merged.accentColor ?? "");
      return merged;
    });
  }

  async function upload(file: File) {
    setBusy("upload");
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`${base}/logo`, { method: "POST", body: form });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || data.error || `HTTP ${res.status}`);
      applyIdentity(data.identity);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    if (!window.confirm("Remove this company's logo? The monogram badge will be used instead.")) return;
    setBusy("remove");
    setError(null);
    try {
      const res = await fetch(`${base}/logo`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || data.error || `HTTP ${res.status}`);
      applyIdentity(data.identity);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function findCandidates() {
    setBusy("fetch");
    setError(null);
    setCandidates(null);
    setSelected(null);
    try {
      const res = await fetch(`${base}/logo/fetch-candidates`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || data.error || `HTTP ${res.status}`);
      setCandidates(data.candidates ?? []);
      if (data.domain) setDomain(data.domain);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function confirmCandidate() {
    if (!selected) return;
    setBusy("confirm");
    setError(null);
    try {
      const res = await fetch(`${base}/logo/confirm-fetched`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: selected, domain }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || data.error || `HTTP ${res.status}`);
      applyIdentity(data.identity);
      setDialog(false);
      setCandidates(null);
      setSelected(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function saveAccent(color: string) {
    const hex = normalizeHex(color);
    if (!hex) {
      setError("Accent color must be a hex value like #3b5b84.");
      return;
    }
    setBusy("accent");
    setError(null);
    try {
      const res = await fetch(`${base}/identity`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accentColor: hex }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || data.error || `HTTP ${res.status}`);
      applyIdentity(data.identity);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  const accent = identity.accentColor || "";
  const suggested = identity.accentSuggested || "";

  return (
    <div className="rounded-lg border border-slate-200 p-3 dark:border-white/10">
      <div className="flex items-start gap-3">
        <CompanyMark
          companyId={companyId}
          name={companyName}
          logoVersion={identity.logoVersion}
          size={44}
          rounded="rounded-lg"
        />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-slate-900 dark:text-white">
            Logo &amp; accent
          </p>
          <p className="text-xs text-caption">
            {identity.logoVersion > 0
              ? `${identity.logoSource === "fetched" ? "Fetched from website" : "Uploaded"}${identity.logoUpdatedAt ? ` · ${new Date(identity.logoUpdatedAt).toLocaleDateString()}` : ""}`
              : "No logo stored — the monogram badge is used."}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="btn-secondary text-xs"
              disabled={busy !== null}
              onClick={() => fileRef.current?.click()}
            >
              {busy === "upload" ? "Uploading…" : "Upload logo"}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/svg+xml"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void upload(f);
                e.target.value = "";
              }}
            />
            <button
              type="button"
              className="btn-secondary text-xs"
              disabled={busy !== null}
              onClick={() => {
                setDialog(true);
                setCandidates(null);
                setSelected(null);
                setError(null);
              }}
            >
              Auto-fetch from website
            </button>
            {identity.logoVersion > 0 && (
              <button
                type="button"
                className="btn-secondary text-xs"
                disabled={busy !== null}
                onClick={() => void remove()}
              >
                Remove
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Accent color */}
      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3 dark:border-white/5">
        <span className="micro-label">Accent</span>
        <span
          aria-hidden
          className="h-6 w-6 rounded ring-1 ring-slate-300 dark:ring-white/20"
          style={{ backgroundColor: accent ? accentForSurface(accent, "onLight") : "transparent" }}
        />
        <input
          type="text"
          value={accentDraft}
          onChange={(e) => setAccentDraft(e.target.value)}
          placeholder="#3b5b84"
          className="input w-28 text-xs"
          aria-label="Accent color hex"
        />
        <button
          type="button"
          className="btn-secondary text-xs"
          disabled={busy !== null || !accentDraft}
          onClick={() => void saveAccent(accentDraft)}
        >
          {busy === "accent" ? "Saving…" : "Save accent"}
        </button>
        {suggested && suggested !== accent && (
          <button
            type="button"
            className="inline-flex items-center gap-1.5 text-xs text-slate-600 underline decoration-dotted underline-offset-2 hover:text-slate-900 dark:text-white/70 dark:hover:text-white"
            disabled={busy !== null}
            onClick={() => void saveAccent(suggested)}
            title="Use the color suggested from the logo"
          >
            <span
              aria-hidden
              className="inline-block h-3.5 w-3.5 rounded-sm ring-1 ring-slate-300 dark:ring-white/20"
              style={{ backgroundColor: suggested }}
            />
            Use suggested {suggested}
          </button>
        )}
      </div>

      {error && (
        <p className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p>
      )}

      {/* Auto-fetch dialog */}
      {dialog && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-6"
          role="dialog"
          aria-modal="true"
          aria-label="Auto-fetch logo from website"
          onClick={() => setDialog(false)}
        >
          <div
            className="max-h-[88vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white p-4 shadow-xl dark:bg-[#101b30] sm:rounded-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="font-display text-base font-semibold text-slate-900 dark:text-white">
                  Auto-fetch logo
                </h3>
                <p className="mt-0.5 text-xs text-caption">
                  Candidates come from the company&apos;s website. Nothing is
                  saved until you pick one and confirm.
                </p>
              </div>
              <button
                type="button"
                className="btn-secondary text-xs"
                onClick={() => setDialog(false)}
              >
                Close
              </button>
            </div>
            <div className="mt-3 flex gap-2">
              <input
                type="text"
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
                placeholder="company.com"
                className="input flex-1 text-sm"
                aria-label="Website domain"
              />
              <button
                type="button"
                className="btn-primary text-xs"
                disabled={busy !== null || !domain.trim()}
                onClick={() => void findCandidates()}
              >
                {busy === "fetch" ? "Looking…" : "Find candidates"}
              </button>
            </div>
            {candidates && (
              <>
                {candidates.length === 0 ? (
                  <p className="mt-3 text-sm text-caption">
                    No candidates found on that domain.
                  </p>
                ) : (
                  <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4">
                    {candidates.map((c) => (
                      <button
                        key={c.token}
                        type="button"
                        onClick={() => setSelected(c.token)}
                        className={`flex flex-col items-center gap-1 rounded-lg border p-2 text-center ${
                          selected === c.token
                            ? "border-[#b8975a] ring-1 ring-[#b8975a]"
                            : "border-slate-200 dark:border-white/10"
                        }`}
                        title={c.label}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={`${base}/logo/candidate?t=${encodeURIComponent(c.token)}`}
                          alt=""
                          className="h-12 w-12 bg-white object-contain"
                          loading="lazy"
                        />
                        <span className="w-full truncate text-[10px] text-caption">
                          {c.kind}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
                <div className="mt-3 flex items-center justify-end gap-2">
                  <button
                    type="button"
                    className="btn-secondary text-xs"
                    onClick={() => setDialog(false)}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="btn-primary text-xs"
                    disabled={busy !== null || !selected}
                    onClick={() => void confirmCandidate()}
                  >
                    {busy === "confirm" ? "Saving…" : "Save selected logo"}
                  </button>
                </div>
              </>
            )}
            {error && (
              <p className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import PageHero from "@/components/PageHero";
import { fmtMoney } from "@/lib/format";
import type { Deal, Executive } from "@/lib/types";

/**
 * Directory (Ethan, Oct 9, 2026): every operator and business the firm
 * interacts with, on one page, with a pull-up profile for each — contact
 * details, background/notes, pairings, and a link into the Pipeline.
 */

interface Entry {
  kind: "operator" | "business";
  id: string;
  name: string;
  sub: string;
  stage: string;
  owner: string;
  tags: string[];
  searchText: string;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-white/40">
        {label}
      </p>
      <div className="mt-0.5 text-sm font-medium text-[#0d1f3c] dark:text-white">{children}</div>
    </div>
  );
}

export default function Directory() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [execs, setExecs] = useState<Executive[]>([]);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<{ kind: string; id: string } | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [meRes, dealsRes, execsRes] = await Promise.all([
          fetch("/api/auth/me"),
          fetch("/api/deals"),
          fetch("/api/executives"),
        ]);
        if (meRes.status === 401 || dealsRes.status === 401) {
          router.replace("/login");
          return;
        }
        if (dealsRes.ok) setDeals(await dealsRes.json());
        if (execsRes.ok) setExecs(await execsRes.json());
        const param = new URLSearchParams(window.location.search).get("q");
        if (param) setQ(param);
      } finally {
        setLoading(false);
      }
    })();
  }, [router]);

  const entries = useMemo<Entry[]>(() => {
    const ops: Entry[] = execs.map((e) => ({
      kind: "operator",
      id: e.id,
      name: e.name,
      sub: e.currentTitle || e.targetRole || "Operator",
      stage: e.stage,
      owner: e.owner,
      tags: e.industries ?? [],
      searchText:
        `${e.name} ${e.currentTitle} ${e.targetRole} ${(e.industries ?? []).join(" ")} ${e.background} ${e.notes}`.toLowerCase(),
    }));
    const biz: Entry[] = deals.map((d) => ({
      kind: "business",
      id: d.id,
      name: d.companyName,
      sub: d.industry || "Business",
      stage: d.stage,
      owner: d.owner,
      tags: [d.city, d.broker].filter((s) => s && s.trim()),
      searchText:
        `${d.companyName} ${d.industry} ${d.city} ${d.broker} ${d.contactName} ${d.notes}`.toLowerCase(),
    }));
    return [...ops, ...biz];
  }, [deals, execs]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return entries;
    return entries.filter((e) => e.searchText.includes(needle));
  }, [entries, q]);

  const selected = useMemo(() => {
    if (sel) {
      const hit = entries.find((e) => e.kind === sel.kind && e.id === sel.id);
      if (hit) return hit;
    }
    return filtered[0] ?? entries[0] ?? null;
  }, [entries, filtered, sel]);

  const selExec =
    selected?.kind === "operator" ? execs.find((e) => e.id === selected.id) : undefined;
  const selDeal =
    selected?.kind === "business" ? deals.find((d) => d.id === selected.id) : undefined;
  const pairedExecs = selDeal
    ? execs.filter((e) => (selDeal.operatorIds ?? []).indexOf(e.id) >= 0)
    : [];
  const pairedDeals = selExec
    ? deals.filter((d) => (d.operatorIds ?? []).indexOf(selExec.id) >= 0)
    : [];

  const group = (kind: Entry["kind"], label: string) => {
    const rows = filtered.filter((e) => e.kind === kind);
    if (rows.length === 0) return null;
    return (
      <div className="mb-6">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-white/40">
          {label} · {rows.length}
        </p>
        <ul className="space-y-1.5">
          {rows.map((e) => {
            const active = selected?.kind === e.kind && selected?.id === e.id;
            return (
              <li key={`${e.kind}-${e.id}`}>
                <button
                  onClick={() => setSel({ kind: e.kind, id: e.id })}
                  className={`w-full rounded-xl border px-3 py-2.5 text-left transition ${
                    active
                      ? "border-[#b8975a] bg-[#b8975a]/10 ring-1 ring-[#b8975a]"
                      : "border-slate-200 bg-white hover:border-[#b8975a]/60 dark:border-white/10 dark:bg-[#132847]/60"
                  }`}
                >
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-sm font-semibold text-[#0d1f3c] dark:text-white">
                      {e.name}
                    </span>
                    <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-500 dark:bg-white/10 dark:text-white/60">
                      {e.stage}
                    </span>
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-slate-400 dark:text-white/40">
                    {e.sub}
                    {e.tags.length > 0 ? ` · ${e.tags.join(" · ")}` : ""}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    );
  };

  return (
    <div>
      <PageHero
        eyebrow="Canny Capital Partners"
        title="Directory"
        subtitle="Every operator and business we interact with — pull up a profile"
      />
      <div className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6">
        {loading ? (
          <p className="text-sm text-slate-400 dark:text-white/40">Loading directory…</p>
        ) : (
          <div className="grid items-start gap-6 lg:grid-cols-[380px_1fr]">
            <div>
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search people, companies, industries…"
                className="mb-4 w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-[#0d1f3c] outline-none placeholder:text-slate-300 focus:border-[#b8975a] dark:border-white/10 dark:bg-[#132847]/60 dark:text-white dark:placeholder:text-white/30"
              />
              {group("operator", "Operators")}
              {group("business", "Businesses")}
              {filtered.length === 0 && (
                <p className="text-sm text-slate-400 dark:text-white/40">
                  Nobody matches that search yet.
                </p>
              )}
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-[#132847]/60 lg:sticky lg:top-4">
              {!selected ? (
                <p className="text-sm text-slate-400 dark:text-white/40">
                  No profiles yet — operators and businesses appear here as they enter the
                  pipeline.
                </p>
              ) : (
                <>
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                        selected.kind === "operator"
                          ? "bg-violet-100 text-violet-800 dark:bg-violet-500/15 dark:text-violet-300"
                          : "bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-300"
                      }`}
                    >
                      {selected.kind === "operator" ? "Operator" : "Business"}
                    </span>
                    <span className="rounded-full bg-[#b8975a]/15 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[#8a6f3e] dark:text-[#d4b37a]">
                      {selected.stage}
                    </span>
                    {selected.owner && (
                      <span className="text-xs text-slate-400 dark:text-white/40">
                        Claimed by {selected.owner}
                      </span>
                    )}
                  </div>
                  <h3 className="mt-3 text-2xl font-bold text-[#0d1f3c] dark:text-white">
                    {selected.name}
                  </h3>
                  <p className="mt-0.5 text-sm text-slate-500 dark:text-white/60">
                    {selected.sub}
                  </p>

                  {selExec && (
                    <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-3">
                      <Field label="Current title">{selExec.currentTitle || "—"}</Field>
                      <Field label="Target role">{selExec.targetRole || "—"}</Field>
                      <Field label="Industries">
                        {(selExec.industries ?? []).join(", ") || "—"}
                      </Field>
                    </div>
                  )}
                  {selDeal && (
                    <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-3">
                      <Field label="Industry">{selDeal.industry || "—"}</Field>
                      <Field label="Location">
                        {selDeal.city ? (
                          <a
                            href={`https://www.google.com/maps/search/${encodeURIComponent(selDeal.city)}`}
                            target="_blank"
                            rel="noreferrer"
                            className="underline decoration-[#b8975a] decoration-2 underline-offset-2"
                          >
                            {selDeal.city}
                          </a>
                        ) : (
                          "—"
                        )}
                      </Field>
                      <Field label="Broker">{selDeal.broker || "—"}</Field>
                      {selDeal.askingPrice != null && (
                        <Field label="Asking price">{fmtMoney(selDeal.askingPrice)}</Field>
                      )}
                      {selDeal.revenue != null && (
                        <Field label="Revenue">{fmtMoney(selDeal.revenue)}</Field>
                      )}
                      {selDeal.ebitda != null && (
                        <Field label="EBITDA">{fmtMoney(selDeal.ebitda)}</Field>
                      )}
                      {selDeal.dealValue > 0 && (
                        <Field label="Deal value">{fmtMoney(selDeal.dealValue)}</Field>
                      )}
                      {(selDeal.contactName || selDeal.contactEmail) && (
                        <Field label="Contact">
                          {selDeal.contactEmail ? (
                            <a
                              href={`mailto:${selDeal.contactEmail}`}
                              className="underline decoration-[#b8975a] decoration-2 underline-offset-2"
                            >
                              {selDeal.contactName || selDeal.contactEmail}
                            </a>
                          ) : (
                            selDeal.contactName
                          )}
                        </Field>
                      )}
                      <Field label="Source">{selDeal.source || "—"}</Field>
                    </div>
                  )}

                  {selExec && selExec.background && (
                    <div className="mt-5">
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-white/40">
                        Background
                      </p>
                      <div className="mt-1 max-h-56 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-sm leading-relaxed text-slate-600 dark:bg-white/[0.04] dark:text-white/75">
                        {selExec.background}
                      </div>
                    </div>
                  )}
                  {((selExec && selExec.notes) || (selDeal && selDeal.notes)) && (
                    <div className="mt-4">
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-white/40">
                        Notes
                      </p>
                      <div className="mt-1 max-h-56 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-sm leading-relaxed text-slate-600 dark:bg-white/[0.04] dark:text-white/75">
                        {selExec ? selExec.notes : selDeal?.notes}
                      </div>
                    </div>
                  )}

                  {pairedExecs.length > 0 && (
                    <div className="mt-5">
                      <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-white/40">
                        Paired operators
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {pairedExecs.map((e) => (
                          <button
                            key={e.id}
                            onClick={() => setSel({ kind: "operator", id: e.id })}
                            className="rounded-full border border-[#b8975a]/50 px-2.5 py-1 text-xs font-semibold text-[#0d1f3c] transition hover:bg-[#b8975a]/15 dark:text-white"
                          >
                            ◈ {e.name}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  {pairedDeals.length > 0 && (
                    <div className="mt-5">
                      <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-white/40">
                        Paired businesses
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {pairedDeals.map((d) => (
                          <button
                            key={d.id}
                            onClick={() => setSel({ kind: "business", id: d.id })}
                            className="rounded-full border border-[#b8975a]/50 px-2.5 py-1 text-xs font-semibold text-[#0d1f3c] transition hover:bg-[#b8975a]/15 dark:text-white"
                          >
                            ◈ {d.companyName}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="mt-6 border-t border-slate-100 pt-4 dark:border-white/10">
                    <Link
                      href="/pipeline"
                      className="text-sm font-semibold text-[#8a6f3e] underline decoration-[#b8975a] decoration-2 underline-offset-2 dark:text-[#d4b37a]"
                    >
                      Open in Pipeline →
                    </Link>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

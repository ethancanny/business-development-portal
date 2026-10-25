"use client";

/**
 * ReportDocument — the institutional report document (Report viewer
 * redesign, Oct 24, 2026). ONE renderer for the recipient page, the
 * sender's recipient-preview, and the internal view, all driven by
 * the pure presentation model in lib/comms/present (the same model
 * the PDF renderer consumes, so web and PDF cannot drift).
 *
 * Design: ivory page, deep navy header band with the desert hero and
 * the full Canny wordmark (ALWAYS shown, even under a codename),
 * subject logo/monogram beside the title per the deal identity
 * codename rules, gold rules, navy headings, warm gray body, company
 * accent ONLY for charts / tile accents / highlights. Recipient
 * modes never render missing / not-applicable / internal-only
 * sections — the model hides them; the sender preview surfaces them
 * as warnings OUTSIDE this component.
 */

import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  buildPresentModel,
  columnAlign,
  formatCell,
  formatFigure,
  notesLabel,
  type PresentSection,
} from "@/lib/comms/present";
import type { ReportRender as LibReportRender } from "@/lib/comms/types";
import type {
  ReportGuestMeta,
  ReportRender,
} from "@/components/comms/types";

const FIRM_WORDMARK =
  "https://cannycapitalpartners.com/canny-logo-white.png";
const HERO_IMAGE =
  "https://cannycapitalpartners.com/arizona-desert-landscape.jpg";
const BASE_SERIES = ["#0d1f3c", "#b8975a", "#3b5b84", "#2f7f79", "#b5703a"];

export interface ReportDocumentProps {
  render: ReportRender;
  meta?: ReportGuestMeta | null;
  mode: "guest" | "preview" | "internal";
  purpose?: string;
  downloadHref?: string;
  onReplySection?: (sectionKey: string, heading: string) => void;
}

export default function ReportDocument({
  render,
  meta = null,
  mode,
  purpose,
  downloadHref,
  onReplySection,
}: ReportDocumentProps) {
  const internal = mode === "internal";
  const model = useMemo(
    () =>
      buildPresentModel(render as unknown as LibReportRender, {
        purpose: purpose ?? meta?.purpose,
        internal,
      }),
    [render, purpose, meta?.purpose, internal]
  );
  const accent = meta?.mark.accentColor || undefined;
  const seriesColors = useMemo(
    () => (accent ? [accent, ...BASE_SERIES.slice(1)] : BASE_SERIES),
    [accent]
  );

  const [active, setActive] = useState<string>("");
  useEffect(() => {
    if (!model.showToc) return;
    const ids = [
      ...(model.exec ? ["exec-summary"] : []),
      ...model.sections.map((s) => s.key),
      "appendix",
    ];
    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) setActive(e.target.id);
        }
      },
      { rootMargin: "-15% 0px -70% 0px" }
    );
    for (const id of ids) {
      const el = document.getElementById(id);
      if (el) obs.observe(el);
    }
    return () => obs.disconnect();
  }, [model]);

  const tocItems = [
    ...(model.exec ? [{ id: "exec-summary", label: "Executive summary" }] : []),
    ...model.sections.map((s) => ({ id: s.key, label: s.heading })),
    { id: "appendix", label: "Sources and data" },
  ];

  const reportType =
    meta?.reportType ||
    render.title.split(" — ")[0] ||
    "Report";
  const subjectName = meta ? meta.subjectName : render.subjectLabel;
  const showSubject = Boolean(subjectName) && subjectName !== reportType;

  return (
    <div className="relative mx-auto w-full max-w-[920px] bg-white text-stone-700 shadow-xl ring-1 ring-black/5">
      {/* Watermark — recipient name + email, web view (spec §5). */}
      {mode !== "internal" && meta?.preparedFor?.email && (
        <div
          aria-hidden
          className="pointer-events-none fixed inset-0 z-40 flex flex-col items-center justify-center gap-40 overflow-hidden"
        >
          {[0, 1, 2].map((i) => (
            <p
              key={i}
              style={{ transform: "rotate(-24deg)" }}
              className="whitespace-nowrap text-[26px] font-semibold tracking-wide text-navy-900/[0.05]"
            >
              {meta.preparedFor.name} · {meta.preparedFor.email}
            </p>
          ))}
        </div>
      )}

      {/* ------------------------- header band ------------------------- */}
      <div
        className="border-b-2 border-gold-500 px-6 py-6 sm:px-10"
        style={{
          backgroundImage: `linear-gradient(rgba(8,20,38,0.87), rgba(8,20,38,0.94)), url(${HERO_IMAGE})`,
          backgroundSize: "cover",
          backgroundPosition: "center",
        }}
      >
        <img
          src={FIRM_WORDMARK}
          alt="Canny Capital Partners"
          className="h-10 w-auto"
          loading="lazy"
        />
        <p className="mt-4 text-[11px] font-bold uppercase tracking-[0.22em] text-gold-400">
          {reportType}
        </p>
      </div>

      {render.sample && (
        <div
          role="alert"
          className="bg-amber-500/15 px-6 py-2.5 text-center text-xs font-bold uppercase tracking-widest text-amber-800 ring-1 ring-inset ring-amber-500/40 sm:px-10"
        >
          Sample — not a real report
        </div>
      )}
      {meta?.hasNewerVersion && (
        <div
          role="alert"
          className="bg-amber-50 px-6 py-3 text-sm text-amber-900 ring-1 ring-inset ring-amber-500/30 sm:px-10"
        >
          <span className="font-bold">New version available.</span> A newer
          version of this report has been sent to you — check your inbox
          for the latest link.
        </div>
      )}

      {/* ------------------------- title block ------------------------- */}
      <div className="px-6 pt-7 sm:px-10">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-4">
            {meta?.mark.kind === "logo" && meta.mark.logoPath && (
              <img
                src={meta.mark.logoPath}
                alt=""
                className="mt-1 h-12 w-auto max-w-[150px] object-contain"
                loading="lazy"
              />
            )}
            {meta?.mark.kind === "monogram" && (
              <div
                aria-hidden
                className="mt-1 flex h-12 w-12 shrink-0 items-center justify-center rounded-md font-display text-lg font-bold text-white"
                style={{ backgroundColor: meta.mark.color ?? "#0d1f3c" }}
              >
                {meta.mark.initials}
              </div>
            )}
            <div className="min-w-0">
              <h1 className="font-display text-[28px] font-semibold leading-tight text-navy-900 sm:text-[34px]">
                {showSubject ? subjectName : reportType}
              </h1>
              {showSubject && (
                <p className="mt-0.5 text-sm text-stone-500">
                  {reportType}
                  {meta?.subjectSecondary
                    ? ` · ${meta.subjectSecondary}`
                    : ""}
                </p>
              )}
              {meta?.codenameActive && (
                <p className="mt-1 text-xs font-semibold uppercase tracking-wider text-stone-400">
                  Codename — counterparty identity withheld
                </p>
              )}
            </div>
          </div>
          {downloadHref && (
            <a
              href={downloadHref}
              className="btn btn-primary btn-sm min-h-[44px] shrink-0"
            >
              Download PDF
            </a>
          )}
        </div>

        {meta && (
          <dl className="mt-6 grid grid-cols-2 gap-x-6 gap-y-3 border-t border-stone-200 pt-5 text-sm md:grid-cols-3">
            <MetaItem label="Prepared for">
              {meta.preparedFor.name || "—"}
              {meta.preparedFor.organization
                ? `, ${meta.preparedFor.organization}`
                : ""}
            </MetaItem>
            <MetaItem label="Prepared by">
              {meta.preparedBy}
              {meta.sender.name ? ` — ${meta.sender.name}` : ""}
            </MetaItem>
            <MetaItem label="Reporting period">
              {meta.periodLabel || "—"}
            </MetaItem>
            <MetaItem label="As of">
              {meta.asOf || "—"}
            </MetaItem>
            <MetaItem label="Version">{`Version ${meta.version}`}</MetaItem>
            <MetaItem label="Report ID">
              <span className="text-xs">{meta.reportId}</span>
            </MetaItem>
          </dl>
        )}
        {meta?.expiresLabel && (
          <p className="mt-4">
            <span className="inline-block rounded-full bg-cream px-3 py-1 text-xs font-semibold text-navy-800 ring-1 ring-gold-500/50">
              {meta.expiresLabel}
            </span>
          </p>
        )}
        {!meta && render.asOf && (
          <p className="mt-3 text-sm text-stone-500">As of {render.asOf}</p>
        )}
      </div>

      {/* --------------------------- body ------------------------------ */}
      <div className="px-6 pb-4 sm:px-10">
        {model.showToc && (
          <details className="mt-6 rounded-lg bg-cream/70 px-4 py-3 lg:hidden">
            <summary className="cursor-pointer text-xs font-bold uppercase tracking-wider text-navy-900">
              Contents
            </summary>
            <ul className="mt-2 space-y-1.5 text-sm">
              {tocItems.map((t) => (
                <li key={t.id}>
                  <a href={`#${t.id}`} className="text-navy-800 hover:underline">
                    {t.label}
                  </a>
                </li>
              ))}
            </ul>
          </details>
        )}

        <div className={model.showToc ? "lg:grid lg:grid-cols-[190px_1fr] lg:gap-10" : ""}>
          {model.showToc && (
            <nav aria-label="Contents" className="mt-8 hidden lg:block">
              <div className="sticky top-6">
                <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-stone-400">
                  Contents
                </p>
                <ul className="mt-3 space-y-1 border-l border-stone-200">
                  {tocItems.map((t) => (
                    <li key={t.id}>
                      <a
                        href={`#${t.id}`}
                        className={`-ml-px block border-l-2 py-1 pl-3 text-[13px] leading-snug ${
                          active === t.id
                            ? "border-gold-500 font-semibold text-navy-900"
                            : "border-transparent text-stone-500 hover:text-navy-800"
                        }`}
                      >
                        {t.label}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            </nav>
          )}

          <div className="min-w-0">
            {model.exec && (
              <section id="exec-summary" className="scroll-mt-24 pt-8">
                <h2 className="font-display text-[22px] font-semibold text-navy-900">
                  Executive summary
                </h2>
                {model.exec.tiles.length > 0 && (
                  <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
                    {model.exec.tiles.map((tile, i) => (
                      <div
                        key={tile.key}
                        className="rounded-lg bg-cream/70 px-3.5 py-3 ring-1 ring-stone-200/70"
                        style={{
                          borderLeft: `3px solid ${i === 0 && accent ? accent : "#b8975a"}`,
                        }}
                      >
                        <p className="text-[10px] font-bold uppercase tracking-wider text-stone-500">
                          {tile.label}
                        </p>
                        <p className="tnum mt-1 text-xl font-bold leading-none text-navy-900">
                          {tile.value}
                        </p>
                        {tile.delta && (
                          <p
                            className={`mt-1.5 text-[11px] font-semibold ${
                              tile.deltaTone === "down"
                                ? "text-[#9c3d2e]"
                                : tile.deltaTone === "up"
                                  ? "text-[#2f6b4f]"
                                  : "text-stone-500"
                            }`}
                          >
                            {tile.deltaTone === "up"
                              ? "▲ "
                              : tile.deltaTone === "down"
                                ? "▼ "
                                : ""}
                            {tile.delta}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                {model.exec.takeaways.length > 0 && (
                  <ul className="mt-5 space-y-2.5">
                    {model.exec.takeaways.map((t, i) => (
                      <li key={i} className="flex gap-2.5 text-[15px] leading-relaxed">
                        <span aria-hidden className="mt-[9px] h-1.5 w-1.5 shrink-0 rounded-full bg-gold-500" />
                        <a
                          href={`#${t.sectionKey}`}
                          className="text-stone-700 underline decoration-gold-500/50 decoration-dotted underline-offset-4 hover:text-navy-900"
                        >
                          {t.text}
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )}

            {model.sections.map((section) => (
              <SectionView
                key={section.key}
                section={section}
                footnotes={model.footnotes}
                internal={internal}
                seriesColors={seriesColors}
                onReplySection={mode === "guest" ? onReplySection : undefined}
              />
            ))}

            {/* ------------------------- appendix ------------------------- */}
            <details id="appendix" className="scroll-mt-24 border-t-2 border-gold-500/60 py-6" open={internal}>
              <summary className="cursor-pointer font-display text-[22px] font-semibold text-navy-900">
                Sources and data
              </summary>
              <p className="mt-1 text-sm text-stone-500">
                Every figure used in this report, with its source and
                review status. Footnote numbers in the sections refer
                to this list.
              </p>
              {model.appendix.length === 0 ? (
                <p className="mt-3 text-sm text-stone-500">
                  No figures were used in this report.
                </p>
              ) : (
                <div className="mt-4 overflow-x-auto">
                  <table className="tbl-grad w-full min-w-[560px] text-sm">
                    <thead>
                      <tr>
                        <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide">#</th>
                        <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide">Figure</th>
                        <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase tracking-wide">Value</th>
                        <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide">Source</th>
                        <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {model.appendix.map((f, i) => (
                        <tr key={f.key} className="border-t border-stone-100">
                          <td className="tnum px-3 py-2 text-stone-400">{i + 1}</td>
                          <td className="px-3 py-2 font-medium text-navy-900">{f.label}</td>
                          <td className="tnum px-3 py-2 text-right font-semibold text-navy-900">
                            {formatFigure(f)}
                          </td>
                          <td className="px-3 py-2 text-stone-500">
                            {internal && f.href?.startsWith("/") ? (
                              <a href={f.href} className="font-semibold text-gold-700 hover:underline">
                                {f.sourceLabel || f.sourceModule}
                              </a>
                            ) : (
                              f.sourceLabel || f.sourceModule
                            )}
                          </td>
                          <td className="px-3 py-2">
                            <span
                              className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ${
                                f.verification === "reviewed"
                                  ? "bg-[#eef4ec] text-[#2f6b4f] ring-[#2f6b4f]/25"
                                  : "bg-[#faf1e3] text-[#8a6d1f] ring-[#8a6d1f]/25"
                              }`}
                            >
                              {f.verification === "reviewed" ? "Reviewed" : "Unreviewed"}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </details>
          </div>
        </div>
      </div>

      {/* --------------------------- footer ---------------------------- */}
      <footer className="border-t-2 border-gold-500/60 bg-cream/50 px-6 py-6 sm:px-10">
        {meta && (
          <p className="text-sm font-semibold text-navy-900">
            {meta.confidentiality}
          </p>
        )}
        {(render.disclaimers ?? []).map((d, i) => (
          <p key={i} className="mt-2 text-xs leading-relaxed text-stone-500">
            {d}
          </p>
        ))}
        {meta && (meta.sender.email || meta.sender.phone || meta.sender.name) && (
          <p className="mt-4 text-sm text-stone-600">
            <span className="font-semibold text-navy-900">Questions?</span>{" "}
            {meta.sender.name}
            {meta.sender.email && (
              <>
                {" · "}
                <a href={`mailto:${meta.sender.email}`} className="font-semibold text-gold-700 hover:underline">
                  {meta.sender.email}
                </a>
              </>
            )}
            {meta.sender.phone && ` · ${meta.sender.phone}`}
          </p>
        )}
        <p className="mt-3 text-xs text-stone-400">
          {meta
            ? `Report ${meta.reportId} · Version ${meta.version} · Prepared by ${meta.preparedBy}`
            : `Prepared by ${render.firm || "Canny Capital Partners"}`}
        </p>
        {model.showToc && (
          <nav aria-label="Sections" className="mt-3 hidden flex-wrap gap-x-4 gap-y-1 text-xs sm:flex">
            {tocItems.map((t) => (
              <a key={t.id} href={`#${t.id}`} className="text-stone-500 hover:text-navy-900 hover:underline">
                {t.label}
              </a>
            ))}
          </nav>
        )}
      </footer>
    </div>
  );
}

function MetaItem({
  label,
  children,
}: {
  label: string;
  children: import("react").ReactNode;
}) {
  return (
    <div>
      <dt className="text-[10px] font-bold uppercase tracking-[0.16em] text-stone-400">
        {label}
      </dt>
      <dd className="mt-0.5 font-medium text-navy-900">{children}</dd>
    </div>
  );
}

/* ------------------------------ sections ----------------------------- */

function SectionView({
  section,
  footnotes,
  internal,
  seriesColors,
  onReplySection,
}: {
  section: PresentSection;
  footnotes: Record<string, number>;
  internal: boolean;
  seriesColors: string[];
  onReplySection?: (sectionKey: string, heading: string) => void;
}) {
  const b = section.block;
  const showHeadline = section.headline && section.type !== "narrative";
  return (
    <section id={section.key} className="scroll-mt-24 border-t-2 border-gold-500/60 py-6">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-display text-[22px] font-semibold text-navy-900">
          {section.heading}
        </h3>
        {internal && section.internalOnly && (
          <span className="rounded-full bg-navy-50 px-2 py-0.5 text-[11px] font-semibold text-navy-800 ring-1 ring-navy-900/15">
            Internal only
          </span>
        )}
        {internal && section.dataStatus === "missing" && (
          <span className="rounded-full bg-[#faf1e3] px-2 py-0.5 text-[11px] font-semibold text-[#8a6d1f] ring-1 ring-[#8a6d1f]/25">
            Data missing
          </span>
        )}
        {internal && section.dataStatus === "not_applicable" && (
          <span className="rounded-full bg-cream px-2 py-0.5 text-[11px] font-semibold text-stone-500 ring-1 ring-stone-300/60">
            Not applicable
          </span>
        )}
        {onReplySection && (
          <button
            type="button"
            onClick={() => onReplySection(section.key, section.heading)}
            className="ml-auto text-xs font-semibold text-gold-700 hover:underline"
          >
            Comment on this section
          </button>
        )}
      </div>

      {showHeadline && (
        <p className="mt-1.5 text-[15px] italic leading-relaxed text-stone-500">
          {section.headline}
        </p>
      )}

      {section.type === "narrative" &&
        (b.narrative?.statements ?? []).map((s, i) => (
          <p key={i} className="mt-3 text-[15px] leading-relaxed text-stone-700">
            {s.text}
            {(s.figureKeys ?? []).map((k) =>
              footnotes[k] ? (
                <sup key={k} className="ml-0.5">
                  <a href="#appendix" className="font-semibold text-gold-700 hover:underline">
                    [{footnotes[k]}]
                  </a>
                </sup>
              ) : null
            )}
          </p>
        ))}
      {section.type === "narrative" &&
        (b.narrative?.statements ?? []).length === 0 && (
          <p className="mt-3 text-sm text-stone-400">
            {internal ? "No narrative statements yet." : ""}
          </p>
        )}

      {b.table && b.table.rows?.length > 0 && (
        <div className="mt-4 overflow-x-auto rounded-md ring-1 ring-stone-200">
          <table className="tbl-grad w-full min-w-[520px] text-sm">
            <thead>
              <tr>
                {b.table.columns.map((c, i) => (
                  <th
                    key={i}
                    className={`px-3 py-2.5 text-xs font-semibold uppercase tracking-wide ${
                      i > 0 && columnAlign(b.table!.rows, i) === "right"
                        ? "text-right"
                        : "text-left"
                    }`}
                  >
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {b.table.rows.map((row, ri) => (
                <tr key={ri} className="border-t border-stone-100">
                  {row.map((cell, ci) => {
                    const isStatusCol = /status/i.test(b.table!.columns[ci] ?? "");
                    const align =
                      ci > 0 && columnAlign(b.table!.rows, ci) === "right";
                    return (
                      <td
                        key={ci}
                        className={`px-3 py-2 ${
                          align ? "tnum text-right" : ""
                        } ${ci === 0 ? "font-medium text-navy-900" : "text-stone-700"}`}
                      >
                        {isStatusCol && cell !== null && cell !== "" ? (
                          <StatusBadge value={String(cell)} />
                        ) : (
                          formatCell(cell)
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {b.chart && <ChartBlock block={b} colors={seriesColors} />}

      {b.text && section.type !== "narrative" && section.type !== "findings" && (
        <div className="mt-3 space-y-2.5">
          {b.text.split("\n").map((line, i) => {
            const t = line.trim();
            if (!t) return null;
            if (t.startsWith("## ")) {
              return (
                <h4 key={i} className="pt-1.5 font-display text-[17px] font-semibold text-navy-900">
                  {t.slice(3)}
                </h4>
              );
            }
            if (/^citations:/i.test(t)) {
              return (
                <p key={i} className="text-xs italic text-stone-400">
                  {t}
                </p>
              );
            }
            return (
              <p key={i} className="text-[15px] leading-relaxed text-stone-700">
                {t}
              </p>
            );
          })}
        </div>
      )}

      {!b.table && (b.figures?.length ?? 0) > 0 && (
        <dl className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {b.figures.map((f) => (
            <div key={f.key} className="rounded-lg bg-cream/70 px-3.5 py-2.5 ring-1 ring-stone-200/70">
              <dt className="text-[10px] font-bold uppercase tracking-wider text-stone-500">
                {f.label}
                {footnotes[f.key] && (
                  <sup className="ml-1">
                    <a href="#appendix" className="text-gold-700 hover:underline">
                      [{footnotes[f.key]}]
                    </a>
                  </sup>
                )}
              </dt>
              <dd className="tnum mt-0.5 text-lg font-semibold text-navy-900">
                {formatFigure(f)}
              </dd>
            </div>
          ))}
        </dl>
      )}

      {b.table && section.figureNotes.length > 0 && (
        <p className="mt-2.5 text-xs text-stone-400">
          Sources:{" "}
          <a href="#appendix" className="font-semibold text-gold-700 hover:underline">
            {notesLabel(section.figureNotes)}
          </a>{" "}
          in Sources and data.
        </p>
      )}
    </section>
  );
}

function StatusBadge({ value }: { value: string }) {
  const v = value.toLowerCase();
  const cls = /pass|complian|met|closed|resolved/.test(v)
    ? "bg-[#eef4ec] text-[#2f6b4f] ring-[#2f6b4f]/25"
    : /fail|breach|confirmed|high/.test(v)
      ? "bg-[#faeeea] text-[#9c3d2e] ring-[#9c3d2e]/25"
      : /proposed|open|medium/.test(v)
        ? "bg-[#faf1e3] text-[#8a6d1f] ring-[#8a6d1f]/25"
        : "bg-navy-50 text-navy-800 ring-navy-900/15";
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ${cls}`}>
      {value}
    </span>
  );
}

function ChartBlock({
  block,
  colors,
}: {
  block: PresentSection["block"];
  colors: string[];
}) {
  const chart = block.chart;
  if (!chart || !chart.series?.length) return null;
  const xs: string[] = [];
  for (const s of chart.series) {
    for (const p of s.points) if (!xs.includes(p.x)) xs.push(p.x);
  }
  const data = xs.map((x) => {
    const row: Record<string, string | number> = { x };
    for (const s of chart.series) {
      const pt = s.points.find((p) => p.x === x);
      if (pt) row[s.name] = pt.y;
    }
    return row;
  });
  if (data.length === 0) return null;
  const common = (
    <>
      <CartesianGrid stroke="#e7e2d6" strokeDasharray="3 3" />
      <XAxis dataKey="x" tick={{ fontSize: 11, fill: "#78716c" }} minTickGap={24} />
      <YAxis
        tick={{ fontSize: 11, fill: "#78716c" }}
        tickFormatter={(v: number) =>
          v >= 1_000_000 ? `$${(v / 1_000_000).toFixed(1)}M` : v >= 1000 ? `$${Math.round(v / 1000)}k` : `${v}`
        }
      />
      <Tooltip formatter={(value) => typeof value === "number" ? value.toLocaleString("en-US") : String(value ?? "")} />
    </>
  );
  return (
    <div className="mt-4 h-64">
      <ResponsiveContainer width="100%" height="100%">
        {chart.kind === "line" ? (
          <LineChart data={data} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
            {common}
            {chart.series.map((s, i) => (
              <Line
                key={s.name}
                type="monotone"
                dataKey={s.name}
                stroke={colors[i % colors.length]}
                strokeWidth={2}
                dot={false}
              />
            ))}
          </LineChart>
        ) : (
          <BarChart data={data} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
            {common}
            {chart.series.map((s, i) => (
              <Bar key={s.name} dataKey={s.name} fill={colors[i % colors.length]} />
            ))}
          </BarChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}

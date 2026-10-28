"use client";

/**
 * Playbook & Ideas — Due Diligence hub section (Oct 27, 2026).
 *
 * Curated reference content: a summarized technical due-diligence
 * playbook for aerospace supplier targets (Ethan's research plan,
 * Oct 27, 2026), kept as diligence suggestions/ideas to pull into a
 * deal's own checklist. This is compile-time static content — no
 * endpoint, no fetch, no Neon reads, no version gate needed — and it
 * is deliberately NOT merged into the live diligence workspaces:
 * their per-deal checklists and counts are untouched.
 *
 * Display copy is the approved summary
 * (aerospace-tech-dd-summary-2026-10-27); the Sources expansion
 * carries the full reference list from the source plan so nothing
 * from the original is lost.
 */

import { cardCls, tdCls } from "@/components/diligence/types";

/* ------------------------------ content ------------------------------- */

interface PlaybookCategory {
  title: string;
  thesis: string;
  bullets: Array<{ label: string; text: string }>;
  redGreen?: { red: string; green: string };
}

const INTRO =
  "Primes are pushing rate production, digital visibility, and compliance down the supply chain — a supplier's technical posture decides whether it keeps its slots on approved supplier lists, and that posture is diligence-able before close.";

const CATEGORIES: PlaybookCategory[] = [
  {
    title: "Modern Automation & Factory Floor Capability",
    thesis:
      "OEMs are forcing suppliers off manual “craftsman” processes to hit rate increases. Evaluate whether the target can scale with repeatable, autonomous hardware.",
    bullets: [
      {
        label: "Multi-axis CNC density",
        text: "5-axis (or greater) share vs standard 3-axis; single-setup machining of complex flight-critical parts eliminates repositioning error.",
      },
      {
        label: "Pallet automation & lights-out readiness",
        text: "automated pallet changers / robotic loading; floor structured for unattended multi-shift running, so capacity grows without linear headcount.",
      },
      {
        label: "PLC openness",
        text: "primary assets on open protocols (OPC UA, Modbus); closed proprietary controls that block machine-data extraction are a major gap.",
      },
      {
        label: "Machine-level IoT",
        text: "sensors on high-value equipment (temperature, spindle vibration, oil pressure, cycle times) feeding predictive maintenance instead of reactive repair.",
      },
    ],
    redGreen: {
      red: "Manual setups / depreciated 3-axis machinery · paper travelers · reactive maintenance",
      green:
        "Multi-axis centers with robotic cells · connected telemetry with anomaly alerts · digital travelers on live terminals",
    },
  },
  {
    title: "The Digital Thread & ERP/MES Integration",
    thesis:
      "Contestable OEM work requires a component's full genealogy stitched from engineering ingest to shipment.",
    bullets: [
      {
        label: "MBD interoperability",
        text: "Model-Based Definition with FAI parameters and tolerances embedded in the 3D model; no manual transcription at setup.",
      },
      {
        label: "MES↔ERP integrity",
        text: "bidirectional sync linking shop-floor timestamps, work orders, operator IDs, and machine parameters back to financial records.",
      },
      {
        label: "Digital concession workflows",
        text: "non-conformities routed through structured, auditable deviation workflows across PLM/ERP/customer systems.",
      },
      {
        label: "Configuration control",
        text: "ECOs trigger immediate electronic updates to BOMs, work instructions, and sub-tier purchase orders.",
      },
    ],
  },
  {
    title: "Metrology, Inspection & Automated Quality Control",
    thesis:
      "Meeting print is the floor; primes want machine-generated proof of continuous conformance.",
    bullets: [
      {
        label: "Automated metrology",
        text: "CMM / 3D laser scanning; manual caliper inspection doesn't meet Tier-1 data-log expectations.",
      },
      {
        label: "AS9102 FAI automation",
        text: "digital FAI with automatic ballooning and Forms 1–3 populated from machine data.",
      },
      {
        label: "Nadcap special processes in-house",
        text: "heat treat, chemical processing, coatings, NDT (MPI, radiography) under active Nadcap accreditation; outsourcing them imports lead-time volatility and margin erosion.",
      },
      {
        label: "Software & calibration control",
        text: "test/inspection/NC software under configuration control; calibration aligned to ANSI/NCSL Z540.",
      },
    ],
  },
  {
    title: "Cybersecurity, Traceability & Compliance Moats",
    thesis:
      "Approved Supplier List standing demands airtight security and material traceability.",
    bullets: [
      {
        label: "AS9100 Rev D → IA9100",
        text: "verify registration directly on the IAQG OASIS database; AS9100 transitions to IA9100 in late 2026 — check whether a gap analysis has started.",
      },
      {
        label: "CMMC 2.0 readiness",
        text: "for defense work, verify alignment and physical IT/OT network segmentation isolating machining networks from corporate IT.",
      },
      {
        label: "ITAR / EAR standing",
        text: "active, unblemished ITAR registration and EAR protocols; unresolved export violations are immediate deal-breakers.",
      },
      {
        label: "Material traceability",
        text: "sample physical lots against mill certs, heat codes, and process logs; a broken Certificate of Conformance chain is catastrophic under OEM audit.",
      },
    ],
  },
];

const GATES: Array<{ gate: string; minimum: string; verify: string }> = [
  {
    gate: "QMS standing",
    minimum: "Valid AS9100 Rev D + IA9100 transition prep",
    verify: "IAQG OASIS database cross-reference",
  },
  {
    gate: "Export compliance",
    minimum: "Active ITAR registration + clear EAR controls",
    verify: "DD2345 forms, federal filing logs",
  },
  {
    gate: "Special processes",
    minimum: "Nadcap accreditation for all core chemical/thermal ops",
    verify: "Registrar scope vs the work being sourced",
  },
  {
    gate: "First article rigor",
    minimum: "Full 3-form AS9102 capability",
    verify: "Past customer submission history (auto-rejections)",
  },
  {
    gate: "Nonconformance",
    minimum: "Zero unauthorized MRB activity",
    verify: "Customer SLA terms (defect penalties ~$1,000/defect)",
  },
];

const SOURCE_GROUPS: Array<{
  heading: string;
  links: Array<{ label: string; href: string }>;
}> = [
  {
    heading: "Automation & factory floor",
    links: [
      {
        label: "Best Practices for Supplier Qualification in Aerospace — QSTRAT",
        href: "https://qstrat.com/supplier-qualification-best-practices-aerospace/",
      },
      {
        label: "Smart Manufacturing Readiness Assessment Checklist — Oxmaint",
        href: "https://oxmaint.com/industries/manufacturing-plant/smart-manufacturing-readiness-assessment-checklist",
      },
      {
        label: "Industry 4.0 Readiness Checklist for Manufacturers in 2026 — iFactory",
        href: "https://ifactoryapp.com/blog/industry-4-0-readiness-checklist-2026",
      },
      {
        label: "Advanced Aerospace Manufacturing Suppliers in the US — Precision AM",
        href: "https://precisionam.com/articles/aerospace/advanced-aerospace-manufacturing-suppliers-us/",
      },
      {
        label: "Boeing Pushes Suppliers to Adopt Automation — Yahoo Finance",
        href: "https://au.finance.yahoo.com/news/boeing-pushes-suppliers-adopt-automation-181811581.html",
      },
    ],
  },
  {
    heading: "Digital thread & ERP/MES",
    links: [
      {
        label: "The Digital Thread Imperative in Aerospace and Defense — Kearney",
        href: "https://www.kearney.com/service/digital-analytics/article/the-digital-thread-imperative-in-aerospace-and-defense",
      },
      {
        label: "MES for Aerospace — Evaluation Checklist — Connektica",
        href: "https://connektica.com/aerospace-mes-evaluation-checklist/",
      },
      {
        label: "Guide to the Digital Thread — 1factory",
        href: "https://www.1factory.com/quality-academy/guide-digital-thread.html",
      },
      {
        label: "What Is a Digital Thread in Aerospace Manufacturing? — Connect981",
        href: "https://connect981.com/faqs/what-is-a-digital-thread-in-aerospace-manufacturing-and-how-is-it-different-from-a-digital-twin",
      },
      {
        label: "Digital Thread & Non-Conformities — Infosys",
        href: "https://www.infosys.com/services/engineering-services/insights/digital-thread-non-conformities.html",
      },
      {
        label: "Digital Thread in Aerospace & Defense (video) — YouTube",
        href: "https://www.youtube.com/watch?v=qCHiNTC241k",
      },
    ],
  },
  {
    heading: "Metrology & quality",
    links: [
      {
        label: "Aerospace Traceability Audit Checklist — Manufacturo",
        href: "https://manufacturo.com/resources/surveys/aerospace-traceability-audit-checklist/",
      },
      {
        label: "Aerospace Precision Machining Requirements & Supplier Qualification — GoSCPM",
        href: "https://www.goscpm.com/post/aerospace-precision-machining-requirements-supplier-qualification",
      },
      {
        label: "Supplier Quality Requirements Manual AP0425 (PDF) — Kavlico / Sensata",
        href: "https://www.sensata.com/sites/default/files/a/kavlico-supplier-quality-requirements-manual-ap0425.pdf",
      },
    ],
  },
  {
    heading: "Cybersecurity, traceability & compliance",
    links: [
      {
        label: "Aerospace Parts Machining: A Practical Guide to Supplier Selection — WSM Technology",
        href: "https://www.wsmtechnology.com/feeds/blog/tight-tolerance-aerospace-machined-parts-supplier",
      },
      {
        label: "How to Qualify a New Supplier in Aerospace and Defense — Unitek-Kiwa",
        href: "https://www.unitek-kiwa.com/blog/how-to-qualify-aerospace-defense-supplier/",
      },
      {
        label: "Supplier Due Diligence Checklist: A Practical Guide — LinkedIn",
        href: "https://www.linkedin.com/pulse/supplier-due-diligence-checklist-practical-guide-tijana-zunic-maric-5rwwf",
      },
      {
        label: "Vendor Qualification in Aerospace: 7 Non-Negotiables — LinkedIn",
        href: "https://www.linkedin.com/pulse/vendor-qualification-aerospace-7-non-negotiables-txzmf",
      },
    ],
  },
  {
    heading: "Gates & buy-side playbooks",
    links: [
      {
        label: "Buy-Side M&A Playbook: Due Diligence in Aerospace & Defense — Fenwick",
        href: "https://whatstrending.fenwick.com/post/buy-side-ma-playbook-due-diligence-in-aerospace-defense-what-buyers-need-to",
      },
    ],
  },
];

/* ------------------------------ section ------------------------------- */

export default function PlaybookSection() {
  return (
    <div>
      <div className="mb-3">
        <h2 className="font-display text-2xl font-semibold text-[#0d1f3c] dark:text-white">
          Playbook &amp; Ideas
        </h2>
        <p className="mt-0.5 max-w-3xl text-sm text-slate-500 dark:text-white/50">
          Diligence suggestions and ideas — reference material to pull into a
          deal&apos;s own checklist. This page is curated content, not a live
          checklist: the workspaces above keep their own items and counts.
        </p>
      </div>

      <p className="mb-4 max-w-3xl text-sm leading-relaxed text-slate-600 dark:text-white/70">
        {INTRO} Summarized Oct 27, 2026 from the Aerospace Supplier Technical
        Due Diligence research plan; the full source list is in Sources at the
        bottom of this section.
      </p>

      <div className="grid gap-4 md:grid-cols-2">
        {CATEGORIES.map((cat) => (
          <article key={cat.title} className={cardCls}>
            <h3 className="font-display text-xl font-semibold text-[#0d1f3c] dark:text-white">
              {cat.title}
            </h3>
            <p className="mt-1 text-sm leading-relaxed text-slate-600 dark:text-white/70">
              {cat.thesis}
            </p>
            <ul className="mt-3 space-y-2.5">
              {cat.bullets.map((b) => (
                <li
                  key={b.label}
                  className="text-sm leading-relaxed text-slate-600 dark:text-white/70"
                >
                  <span className="font-semibold text-[#0d1f3c] dark:text-white">
                    {b.label}
                  </span>{" "}
                  — {b.text}
                </li>
              ))}
            </ul>
            {cat.redGreen && (
              <div className="mt-4 space-y-1.5 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-3 text-[13px] leading-relaxed dark:border-white/10 dark:bg-white/5">
                <p className="text-slate-600 dark:text-white/70">
                  <span className="font-semibold text-red-700 dark:text-red-300">
                    Red flag:
                  </span>{" "}
                  {cat.redGreen.red}
                </p>
                <p className="text-slate-600 dark:text-white/70">
                  <span className="font-semibold text-emerald-700 dark:text-emerald-300">
                    Green flag:
                  </span>{" "}
                  {cat.redGreen.green}
                </p>
              </div>
            )}
          </article>
        ))}
      </div>

      <h3 className="mt-8 font-display text-xl font-semibold text-[#0d1f3c] dark:text-white">
        Non-Negotiable Gates
      </h3>
      <p className="mt-0.5 text-sm text-slate-500 dark:text-white/50">
        Failing a gate means a substantial valuation haircut or removal from
        premium consideration.
      </p>
      <div className="card-surface mt-3 overflow-x-auto">
        <table className="tbl-grad w-full min-w-[640px] border-collapse text-sm">
          <thead>
            <tr>
              <th className="px-4 py-2.5 text-left">Gate</th>
              <th className="px-4 py-2.5 text-left">Minimum</th>
              <th className="px-4 py-2.5 text-left">Verify by</th>
            </tr>
          </thead>
          <tbody>
            {GATES.map((g) => (
              <tr key={g.gate}>
                <td className={`${tdCls} px-4 font-semibold`}>{g.gate}</td>
                <td className={`${tdCls} px-4`}>{g.minimum}</td>
                <td className={`${tdCls} px-4`}>{g.verify}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <details className="card-surface mt-6 px-4 py-3 sm:px-5">
        <summary className="cursor-pointer font-display text-lg font-semibold text-[#0d1f3c] dark:text-white">
          Sources — full reference list
        </summary>
        <div className="mt-3 grid gap-5 pb-2 sm:grid-cols-2">
          {SOURCE_GROUPS.map((group) => (
            <div key={group.heading}>
              <h4 className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-white/40">
                {group.heading}
              </h4>
              <ul className="mt-1.5 space-y-1.5">
                {group.links.map((l) => (
                  <li key={l.href} className="text-sm leading-relaxed">
                    <a
                      href={l.href}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[#0d1f3c] underline decoration-[#b8975a]/60 underline-offset-2 transition hover:text-[#b8975a] dark:text-white/85 dark:hover:text-[#b8975a]"
                    >
                      {l.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </details>
    </div>
  );
}

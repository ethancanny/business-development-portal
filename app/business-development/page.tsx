import Link from "next/link";
import PageHero from "@/components/PageHero";
import UnifiedTasks from "@/components/UnifiedTasks";

/**
 * Business Development hub (Phase 1 platform restructure): the
 * existing CRM — pipeline, market intel, activity triage, directory,
 * capture, audit trail — now lives under Business Development.
 * Every record here links to the central company record.
 */

const CARDS: { href: string; title: string; blurb: string }[] = [
  {
    href: "/pipeline",
    title: "Pipeline",
    blurb: "Acquisition deals and executive sourcing, stage by stage.",
  },
  {
    href: "/market-intel",
    title: "Market Intel",
    blurb: "Arizona fit targets, multiples, tailwinds, and market events.",
  },
  {
    href: "/activity",
    title: "Activity",
    blurb: "Fresh businesses for sale, available operators, and market notes to triage.",
  },
  {
    href: "/directory",
    title: "Directory",
    blurb: "Every operator, business, and investor the firm interacts with.",
  },
  {
    href: "/capture",
    title: "Capture",
    blurb: "Manually capture a candidate or company from a blocked source.",
  },
  {
    href: "/audit-trail",
    title: "Audit Trail",
    blurb: "The full history of changes across the CRM.",
  },
];

export default function BusinessDevelopmentPage() {
  return (
    <div>
      <PageHero
        eyebrow="Canny Capital Partners"
        title="Business Development"
        subtitle="Sourcing, market intelligence, and the deal pipeline"
      />
      <div className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {CARDS.map((card) => (
            <Link
              key={card.href}
              href={card.href}
              className="card-surface card-hover group block p-5 transition hover:ring-2 hover:ring-[#b8975a]/60"
            >
              <h2 className="font-display text-2xl font-semibold text-navy-900 transition group-hover:text-gold-700 dark:text-white dark:group-hover:text-gold-400">
                {card.title}
              </h2>
              <p className="mt-1.5 text-sm leading-relaxed text-slate-500 dark:text-white/60">
                {card.blurb}
              </p>
              <p className="mt-3 text-xs font-semibold text-[#8a6f3e] dark:text-[#d4b37a]">
                Open →
              </p>
            </Link>
          ))}
        </div>
        <section className="mt-10">
          <h2 className="font-display text-2xl font-semibold text-navy-900 dark:text-white">
            Tasks &amp; follow-ups
          </h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-white/60">
            Every open task across deals and operators — dated tasks appear
            on the Calendar automatically.
          </p>
          <div className="mt-4">
            <UnifiedTasks />
          </div>
        </section>
        <p className="mt-6 text-sm text-slate-400 dark:text-white/40">
          The existing CRM, now under Business Development — every record
          here links to the central company record, so deals, people, and
          documents stay connected across modules.
        </p>
      </div>
    </div>
  );
}

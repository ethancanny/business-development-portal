import Link from "next/link";

/**
 * Coming-soon panel for platform modules that are on the roadmap
 * but not yet built (Phase 1): serif module title, one-line blurb,
 * a gold rule, and the roadmap note with a way back to Overview.
 * Server-safe (no client hooks) so module placeholder pages stay
 * plain server components.
 */
export default function ComingSoon({
  title,
  blurb,
}: {
  title: string;
  blurb: string;
}) {
  return (
    <div className="mx-auto max-w-[900px] px-4 py-10 sm:px-6">
      <div className="card-surface card-accent px-6 py-10 text-center sm:px-10">
        <p className="micro-label">Module roadmap</p>
        <h1 className="mt-2 font-display text-4xl font-semibold text-navy-900 dark:text-white">
          {title}
        </h1>
        <div aria-hidden className="mx-auto mt-4 h-0.5 w-12 bg-[#b8975a]" />
        <p className="mx-auto mt-4 max-w-md text-sm leading-relaxed text-slate-500 dark:text-white/60">
          {blurb}
        </p>
        <p className="mt-6 text-xs text-slate-400 dark:text-white/40">
          This module is part of the platform roadmap and will be built
          in a later phase. Existing records are not affected.
        </p>
        <Link href="/overview" className="btn btn-primary btn-sm mt-6">
          Back to Overview
        </Link>
      </div>
    </div>
  );
}

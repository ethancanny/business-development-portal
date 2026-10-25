import PageHero from "@/components/PageHero";
import PushSettings from "@/components/PushSettings";
import SecuritySettings from "@/components/SecuritySettings";
import HospitalityFitSettings from "@/components/HospitalityFitSettings";
import ChainFilterSettings from "@/components/ChainFilterSettings";
import ManualSourcesSettings from "@/components/ManualSourcesSettings";
import JobQueuePanel from "@/components/JobQueuePanel";
import ValuationParamsSettings from "@/components/ValuationParamsSettings";
import SettingsNav from "@/components/settings/SettingsNav";
import StageGatesCard from "@/components/settings/StageGatesCard";
import EsignSettingsCard from "@/components/docgen/EsignSettingsCard";
import InvestmentTypesSettings from "@/components/settings/InvestmentTypesSettings";

/**
 * Settings — General (CRM Phase 2, Oct 2026; restructured with the
 * Navigation Restructure): notifications (PushSettings) and
 * security — passkeys, auto-lock, devices (SecuritySettings) — in
 * stacked cards under the standard page hero. Integrations moved to
 * /settings/integrations and user/role management to
 * /settings/users-roles (see SettingsNav).
 */
/** In-page section index (Ethan, Oct 24, 2026): the General tab is
 * one long stack of cards — these chips jump to each card. Anchor
 * jumps are smooth via the global scroll-behavior, and each section
 * carries a scroll-margin so it lands below the sticky bars. */
const SECTION_INDEX: { id: string; label: string }[] = [
  { id: "settings-notifications", label: "Notifications" },
  { id: "settings-security", label: "Security & devices" },
  { id: "settings-hospitality", label: "Hospitality fit rules" },
  { id: "settings-chain-filter", label: "Chain & franchise filter" },
  { id: "settings-manual-sources", label: "Manual sources" },
  { id: "settings-valuation", label: "Valuation parameters" },
  { id: "settings-stage-gates", label: "Stage gates" },
  { id: "settings-esignature", label: "E-signature" },
  { id: "settings-investment-types", label: "Investment types" },
  { id: "settings-background-jobs", label: "Background jobs" },
];

export default function SettingsPage() {
  return (
    <div>
      <PageHero
        eyebrow="Canny Capital Partners"
        title="Settings"
        subtitle="Notifications, passkeys, devices, and security for your account"
      />
      <SettingsNav />
      <div className="mx-auto flex max-w-[900px] flex-col gap-6 px-4 py-6 sm:px-6">
        <nav
          aria-label="Settings sections"
          className="sticky top-14 z-20 -mx-4 -mt-6 border-b border-slate-200/80 bg-[#fbf8f2]/90 px-4 py-2 backdrop-blur sm:-mx-6 sm:px-6 dark:border-white/10 dark:bg-[#0d1f3c]/90"
        >
          <div className="flex gap-2 overflow-x-auto sm:flex-wrap sm:overflow-x-visible">
            {SECTION_INDEX.map((s) => (
              <a
                key={s.id}
                href={`#${s.id}`}
                className="chip min-h-[40px] shrink-0 whitespace-nowrap"
              >
                {s.label}
              </a>
            ))}
          </div>
        </nav>

        <h3 className="px-1 -mb-2 mt-2 text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-white/40">
          Account &amp; security
        </h3>

        <section
          id="settings-notifications"
          className="scroll-mt-[104px] rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-[#132847]/60 sm:p-6"
        >
          <h2 className="text-lg font-bold text-[#0d1f3c] dark:text-white">
            Notifications
          </h2>
          <p className="mb-5 mt-1 text-sm text-slate-500 dark:text-white/50">
            Push alerts to your installed devices — pick which ones reach
            you, and when they stay quiet.
          </p>
          <PushSettings />
        </section>

        <section
          id="settings-security"
          className="scroll-mt-[104px] rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-[#132847]/60 sm:p-6"
        >
          <h2 className="text-lg font-bold text-[#0d1f3c] dark:text-white">
            Security &amp; devices
          </h2>
          <p className="mb-5 mt-1 text-sm text-slate-500 dark:text-white/50">
            Passkeys for sign-in and unlock, the idle auto-lock, and the
            devices that use your account.
          </p>
          <SecuritySettings />
        </section>

        <h3 className="px-1 -mb-2 mt-2 text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-white/40">
          Sourcing &amp; fit rules
        </h3>

        <section
          id="settings-hospitality"
          className="scroll-mt-[104px] rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-[#132847]/60 sm:p-6"
        >
          <h2 className="text-lg font-bold text-[#0d1f3c] dark:text-white">
            Hospitality fit rules
          </h2>
          <p className="mb-5 mt-1 text-sm text-slate-500 dark:text-white/50">
            When a hospitality operator group counts as an acquisition
            fit. These are settings, not code — saving re-judges every
            hospitality target immediately.
          </p>
          <HospitalityFitSettings />
        </section>

        <section
          id="settings-chain-filter"
          className="scroll-mt-[104px] rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-[#132847]/60 sm:p-6"
        >
          <h2 className="text-lg font-bold text-[#0d1f3c] dark:text-white">
            Chain &amp; franchise filter
          </h2>
          <p className="mb-5 mt-1 text-sm text-slate-500 dark:text-white/50">
            Canny targets independent, owner-operated businesses only. Companies
            flagged as national chains or franchises never appear in Fits — they
            collect in the Filtered Out view with their reason, and a “Not a
            chain” override there is permanent. The brand list and thresholds
            are settings, not code.
          </p>
          <ChainFilterSettings />
        </section>

        <section
          id="settings-manual-sources"
          className="scroll-mt-[104px] rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-[#132847]/60 sm:p-6"
        >
          <h2 className="text-lg font-bold text-[#0d1f3c] dark:text-white">
            Operator sourcing — manual sources
          </h2>
          <p className="mb-5 mt-1 text-sm text-slate-500 dark:text-white/50">
            Most candidate sources feed the portal automatically. These
            four can&apos;t — they sit behind human checks or account
            logins, or don&apos;t publish the names at all — so they are
            manual: what&apos;s blocked, why, and how to capture a find by
            hand.
          </p>
          <ManualSourcesSettings />
        </section>

        <h3 className="px-1 -mb-2 mt-2 text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-white/40">
          Deal workflow
        </h3>

        <section
          id="settings-valuation"
          className="scroll-mt-[104px] rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-[#132847]/60 sm:p-6"
        >
          <h2 className="text-lg font-bold text-[#0d1f3c] dark:text-white">
            Valuation parameters
          </h2>
          <p className="mb-5 mt-1 text-sm text-slate-500 dark:text-white/50">
            The global defaults behind every deal&apos;s economics model
            and deal screen in Investors &amp; Capital — entry, leverage
            and exit ranges, the target IRR, fee and waterfall defaults.
            A deal inherits these wherever its own inputs are blank.
          </p>
          <ValuationParamsSettings />
        </section>

        <section
          id="settings-stage-gates"
          className="scroll-mt-[104px] rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-[#132847]/60 sm:p-6"
        >
          <h2 className="text-lg font-bold text-[#0d1f3c] dark:text-white">
            Stage gates
          </h2>
          <p className="mb-5 mt-1 text-sm text-slate-500 dark:text-white/50">
            Conditions that must be met before a deal can advance to a
            pipeline stage. A blocked move names what&apos;s missing; an
            override needs a reason and is written to the audit trail.
          </p>
          <StageGatesCard />
        </section>

        <section
          id="settings-esignature"
          className="scroll-mt-[104px] rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-[#132847]/60 sm:p-6"
        >
          <h2 className="text-lg font-bold text-[#0d1f3c] dark:text-white">
            E-signature
          </h2>
          <p className="mb-5 mt-1 text-sm text-slate-500 dark:text-white/50">
            Send generated documents (LOIs, NDAs, consents) and reports
            for signature through the portal&apos;s own in-house
            signing module — certificate, consent disclosure, and the
            signing defaults.
          </p>
          <EsignSettingsCard />
        </section>

        <section
          id="settings-investment-types"
          className="scroll-mt-[104px] rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-[#132847]/60 sm:p-6"
        >
          <h2 className="text-lg font-bold text-[#0d1f3c] dark:text-white">
            Investment types
          </h2>
          <p className="mb-5 mt-1 text-sm text-slate-500 dark:text-white/50">
            The Investments pipeline&apos;s deal types (Platform LBO,
            Add-on, Early Stage — Minority Growth is defined but off
            until enabled here), each type&apos;s stage list, the
            structured metric fields deals carry, and the sector packs
            that apply extra fields by industry.
          </p>
          <InvestmentTypesSettings />
        </section>

        <h3 className="px-1 -mb-2 mt-2 text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-white/40">
          System
        </h3>

        <section
          id="settings-background-jobs"
          className="scroll-mt-[104px] rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-[#132847]/60 sm:p-6"
        >
          <h2 className="text-lg font-bold text-[#0d1f3c] dark:text-white">
            Background jobs
          </h2>
          <p className="mb-5 mt-1 text-sm text-slate-500 dark:text-white/50">
            Queued and recent background work — syncs, ingests, and event
            handlers. Retry a failed job or run a queued one now.
          </p>
          <JobQueuePanel />
        </section>
      </div>
    </div>
  );
}

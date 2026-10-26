import PageHero from "@/components/PageHero";
import PushSettings from "@/components/PushSettings";
import SecuritySettings from "@/components/SecuritySettings";
import HospitalityFitSettings from "@/components/HospitalityFitSettings";
import ChainFilterSettings from "@/components/ChainFilterSettings";
import ManualSourcesSettings from "@/components/ManualSourcesSettings";
import JobQueuePanel from "@/components/JobQueuePanel";
import ValuationParamsSettings from "@/components/ValuationParamsSettings";
import MatchingWeightsCard from "@/components/capital/MatchingWeightsCard";
import SettingsNav from "@/components/settings/SettingsNav";
import SettingsSectionNav from "@/components/settings/SettingsSectionNav";
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
/** Layout (Ethan, Oct 24, 2026): two columns on desktop — a sticky
 * left rail (SettingsSectionNav: the page's groups as dropdowns over
 * anchor links to each card) beside the card column; on mobile the
 * rail collapses to a single jump-to select at the top of the
 * column. Anchor jumps are smooth via the global scroll-behavior,
 * and each section carries a scroll-margin so it lands below the
 * sticky bars. This replaces the same-day chip index row, which
 * stacked three rows under the tab bar. */
export default function SettingsPage() {
  return (
    <div>
      <PageHero
        eyebrow="Canny Capital Partners"
        title="Settings"
        subtitle="Notifications, passkeys, devices, and security for your account"
      />
      <SettingsNav />
      <div className="mx-auto max-w-[1200px] px-4 py-6 sm:px-6">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:gap-8">
          <SettingsSectionNav />
          <div className="flex min-w-0 flex-1 flex-col gap-6">
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
          id="settings-matching-weights"
          className="scroll-mt-[104px] rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-[#132847]/60 sm:p-6"
        >
          <h2 className="text-lg font-bold text-[#0d1f3c] dark:text-white">
            Matching weights
          </h2>
          <p className="mb-5 mt-1 text-sm text-slate-500 dark:text-white/50">
            How investor matches are scored for a raise in Investors
            &amp; Capital — investment type, check size, sector,
            structure, geography, and prior activity. Points are
            relative: raising one weight makes it count more against
            the others.
          </p>
          <MatchingWeightsCard />
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
      </div>
    </div>
  );
}

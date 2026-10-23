import PageHero from "@/components/PageHero";
import PushSettings from "@/components/PushSettings";
import SecuritySettings from "@/components/SecuritySettings";
import HospitalityFitSettings from "@/components/HospitalityFitSettings";
import ChainFilterSettings from "@/components/ChainFilterSettings";
import ManualSourcesSettings from "@/components/ManualSourcesSettings";
import JobQueuePanel from "@/components/JobQueuePanel";
import DuplicatesPanel from "@/components/DuplicatesPanel";
import ValuationParamsSettings from "@/components/ValuationParamsSettings";
import SettingsNav from "@/components/settings/SettingsNav";
import StageGatesCard from "@/components/settings/StageGatesCard";
import EsignSettingsCard from "@/components/docgen/EsignSettingsCard";

/**
 * Settings — General (CRM Phase 2, Oct 2026; restructured with the
 * Navigation Restructure): notifications (PushSettings) and
 * security — passkeys, auto-lock, devices (SecuritySettings) — in
 * stacked cards under the standard page hero. Integrations moved to
 * /settings/integrations and user/role management to
 * /settings/users-roles (see SettingsNav).
 */
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
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-[#132847]/60 sm:p-6">
          <h2 className="text-lg font-bold text-[#0d1f3c] dark:text-white">
            Notifications
          </h2>
          <p className="mb-5 mt-1 text-sm text-slate-500 dark:text-white/50">
            Push alerts to your installed devices — pick which ones reach
            you, and when they stay quiet.
          </p>
          <PushSettings />
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-[#132847]/60 sm:p-6">
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

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-[#132847]/60 sm:p-6">
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

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-[#132847]/60 sm:p-6">
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

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-[#132847]/60 sm:p-6">
          <h2 className="text-lg font-bold text-[#0d1f3c] dark:text-white">
            Security &amp; devices
          </h2>
          <p className="mb-5 mt-1 text-sm text-slate-500 dark:text-white/50">
            Passkeys for sign-in and unlock, the idle auto-lock, and the
            devices that use your account.
          </p>
          <SecuritySettings />
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-[#132847]/60 sm:p-6">
          <h2 className="text-lg font-bold text-[#0d1f3c] dark:text-white">
            Background jobs
          </h2>
          <p className="mb-5 mt-1 text-sm text-slate-500 dark:text-white/50">
            Queued and recent background work — syncs, ingests, and event
            handlers. Retry a failed job or run a queued one now.
          </p>
          <JobQueuePanel />
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-[#132847]/60 sm:p-6">
          <h2 className="text-lg font-bold text-[#0d1f3c] dark:text-white">
            Duplicate detection &amp; merge
          </h2>
          <p className="mb-5 mt-1 text-sm text-slate-500 dark:text-white/50">
            Likely duplicate companies and people, scored by similarity.
            Merging keeps the first record and folds the second into it —
            every fact stays stored once, on the central record.
          </p>
          <DuplicatesPanel />
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-[#132847]/60 sm:p-6">
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

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-[#132847]/60 sm:p-6">
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

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-[#132847]/60 sm:p-6">
          <h2 className="text-lg font-bold text-[#0d1f3c] dark:text-white">
            E-signature
          </h2>
          <p className="mb-5 mt-1 text-sm text-slate-500 dark:text-white/50">
            Send generated documents (LOIs, NDAs, consents) and reports
            for signature through the portal&apos;s own in-house
            signing module — certificate, consent disclosure, default
            expiry, and recent envelopes.
          </p>
          <EsignSettingsCard />
        </section>
      </div>
    </div>
  );
}

import PageHero from "@/components/PageHero";
import IntegrationStatus from "@/components/IntegrationStatus";
import EntraSetup from "@/components/EntraSetup";
import DataRoomSettings from "@/components/DataRoomSettings";
import AccountingSettings from "@/components/portmgmt/AccountingSettings";
import SettingsNav from "@/components/settings/SettingsNav";

/**
 * Settings → Integrations (Navigation Restructure): the integration
 * sections moved here from the Settings index — live connection
 * status, the Entra ID calendar registration, accounting providers,
 * and data room / document storage.
 */
export default function SettingsIntegrationsPage() {
  return (
    <div>
      <PageHero
        eyebrow="Canny Capital Partners"
        title="Integrations"
        subtitle="Connected services, the calendar registration, and document storage"
      />
      <SettingsNav />
      <div className="mx-auto flex max-w-[900px] flex-col gap-6 px-4 py-6 sm:px-6">
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-[#132847]/60 sm:p-6">
          <h2 className="text-lg font-bold text-[#0d1f3c] dark:text-white">
            Integrations
          </h2>
          <p className="mb-5 mt-1 text-sm text-slate-500 dark:text-white/50">
            Live status for the platform&apos;s connected services — last
            success, last error, and what each connection feeds.
          </p>
          <IntegrationStatus />
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-[#132847]/60 sm:p-6">
          <h2 className="text-lg font-bold text-[#0d1f3c] dark:text-white">
            Microsoft Entra ID — calendar connection
          </h2>
          <p className="mb-5 mt-1 text-sm text-slate-500 dark:text-white/50">
            How the Outlook calendar integration is registered and kept
            alive: the existing app registration, its calendar-only
            permissions, the exact redirect URI, where credentials live,
            and how the webhook subscription renews itself.
          </p>
          <EntraSetup />
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-[#132847]/60 sm:p-6">
          <h2 className="text-lg font-bold text-[#0d1f3c] dark:text-white">
            Accounting integrations
          </h2>
          <p className="mb-5 mt-1 text-sm text-slate-500 dark:text-white/50">
            Per-company accounting providers — connection status, the env
            vars each one still needs, its setup steps, and a dry-run sync
            before anything goes live.
          </p>
          <AccountingSettings />
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-[#132847]/60 sm:p-6">
          <h2 className="text-lg font-bold text-[#0d1f3c] dark:text-white">
            Data rooms &amp; document storage
          </h2>
          <p className="mb-5 mt-1 text-sm text-slate-500 dark:text-white/50">
            Document storage connection status and the default data room
            template that seeds every new room — its folders and checklist
            items.
          </p>
          <DataRoomSettings />
        </section>
      </div>
    </div>
  );
}

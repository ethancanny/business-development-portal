import PageHero from "@/components/PageHero";
import PushSettings from "@/components/PushSettings";
import SecuritySettings from "@/components/SecuritySettings";

/**
 * Settings (CRM Phase 2, Oct 2026): notifications (PushSettings) and
 * security — passkeys, auto-lock, devices (SecuritySettings) — in
 * stacked cards under the standard page hero.
 */
export default function SettingsPage() {
  return (
    <div>
      <PageHero
        eyebrow="Canny Capital Partners"
        title="Settings"
        subtitle="Notifications, passkeys, devices, and security for your account"
      />
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
            Security &amp; devices
          </h2>
          <p className="mb-5 mt-1 text-sm text-slate-500 dark:text-white/50">
            Passkeys for sign-in and unlock, the idle auto-lock, and the
            devices that use your account.
          </p>
          <SecuritySettings />
        </section>
      </div>
    </div>
  );
}

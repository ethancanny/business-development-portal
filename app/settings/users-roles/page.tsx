import PageHero from "@/components/PageHero";
import ManagementUsers from "@/components/portmgmt/ManagementUsers";
import RolesPanel from "@/components/settings/RolesPanel";
import SettingsNav from "@/components/settings/SettingsNav";

/**
 * Settings → Users & Roles (Navigation Restructure): platform roles
 * (core.user_roles, admin-managed) plus the portfolio-company
 * management logins card moved here from the Settings index.
 */
export default function SettingsUsersRolesPage() {
  return (
    <div>
      <PageHero
        eyebrow="Canny Capital Partners"
        title="Users & Roles"
        subtitle="Platform roles and portfolio-company management logins"
      />
      <SettingsNav />
      <div className="mx-auto flex max-w-[900px] flex-col gap-6 px-4 py-6 sm:px-6">
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-[#132847]/60 sm:p-6">
          <h2 className="text-lg font-bold text-[#0d1f3c] dark:text-white">
            Roles
          </h2>
          <p className="mb-5 mt-1 text-sm text-slate-500 dark:text-white/50">
            Who can do what on the platform: admin (full access,
            including this page), internal (firm team), and guest
            (scoped external access).
          </p>
          <RolesPanel />
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-[#132847]/60 sm:p-6">
          <h2 className="text-lg font-bold text-[#0d1f3c] dark:text-white">
            Management users
          </h2>
          <p className="mb-5 mt-1 text-sm text-slate-500 dark:text-white/50">
            Portfolio-company management logins. Each user is scoped to the
            companies selected here and lands on the /my-company portal —
            they never see the internal platform.
          </p>
          <ManagementUsers />
        </section>
      </div>
    </div>
  );
}

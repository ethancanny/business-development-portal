import PageHero from "@/components/PageHero";
import VcWorkspace from "@/components/valuecreation/VcWorkspace";
import DealBanner from "@/components/identity/DealBanner";

export default function ValueCreationWorkspacePage({
  params,
  searchParams,
}: {
  params: { companyId: string };
  searchParams?: { tab?: string };
}) {
  return (
    <div>
      <PageHero
        eyebrow="Platform · Value Creation"
        title="Value Creation Plan"
        subtitle="Initiatives, 100-day plan, playbooks, driver trees, scenarios, process maps, add-ons, org & talent, targets, and exit readiness — for one company"
      />
      <div className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6">
        <DealBanner companyId={params.companyId} />
        <VcWorkspace companyId={params.companyId} initialTab={searchParams?.tab} />
      </div>
    </div>
  );
}

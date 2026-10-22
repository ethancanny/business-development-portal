import PageHero from "@/components/PageHero";
import VcWorkspace from "@/components/valuecreation/VcWorkspace";

export default function ValueCreationWorkspacePage({
  params,
}: {
  params: { companyId: string };
}) {
  return (
    <div>
      <PageHero
        eyebrow="Platform · Value Creation"
        title="Value Creation Plan"
        subtitle="Initiatives, 100-day plan, playbooks, driver trees, scenarios, process maps, add-ons, org & talent, targets, and exit readiness — for one company"
      />
      <div className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6">
        <VcWorkspace companyId={params.companyId} />
      </div>
    </div>
  );
}

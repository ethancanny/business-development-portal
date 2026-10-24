import PageHero from "@/components/PageHero";
import DiligenceWorkspace from "@/components/diligence/DiligenceWorkspace";
import DealBanner from "@/components/identity/DealBanner";

export default function DueDiligenceWorkspacePage({
  params,
}: {
  params: { dealId: string };
}) {
  return (
    <div>
      <PageHero
        eyebrow="Platform · Due Diligence"
        title="Diligence Workspace"
        subtitle="Checklist, requests, QoE workbench, findings, registers, and closing — for one deal"
      />
      <div className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6">
        {/* Deal Identity banner — page level, above the workspace
            (the workspace internals belong to the redesign build). */}
        <DealBanner dealId={params.dealId} />
        <DiligenceWorkspace dealId={params.dealId} />
      </div>
    </div>
  );
}

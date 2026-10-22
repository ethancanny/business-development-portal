import PageHero from "@/components/PageHero";
import DiligenceWorkspace from "@/components/diligence/DiligenceWorkspace";

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
        <DiligenceWorkspace dealId={params.dealId} />
      </div>
    </div>
  );
}

import PageHero from "@/components/PageHero";
import DiligenceIndex from "@/components/diligence/DiligenceIndex";

export default function DueDiligencePage() {
  return (
    <div>
      <PageHero
        eyebrow="Platform"
        title="Due Diligence"
        subtitle="Diligence workspaces for deals under review — checklists, requests, QoE, findings, and closing"
      />
      <div className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6">
        <DiligenceIndex />
      </div>
    </div>
  );
}

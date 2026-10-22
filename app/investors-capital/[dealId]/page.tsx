import PageHero from "@/components/PageHero";
import DealWorkspace from "@/components/capital/DealWorkspace";

export default function CapitalDealWorkspacePage({
  params,
}: {
  params: { dealId: string };
}) {
  return (
    <div>
      <PageHero
        eyebrow="Platform · Investors & Capital"
        title="Deal Capital Workspace"
        subtitle="Raise book, deal economics, deal screen, investment committee and investor reporting — for one deal"
      />
      <div className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6">
        <DealWorkspace dealId={params.dealId} />
      </div>
    </div>
  );
}

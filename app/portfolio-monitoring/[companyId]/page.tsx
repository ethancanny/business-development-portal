import PageHero from "@/components/PageHero";
import MonitoringWorkspace from "@/components/monitoring/Workspace";
import DealBanner from "@/components/identity/DealBanner";

export default function PortfolioCompanyMonitoringPage({
  params,
}: {
  params: { companyId: string };
}) {
  return (
    <div>
      <PageHero
        eyebrow="Platform · Portfolio Monitoring"
        title="Company Monitoring"
        subtitle="Baseline, reporting, KPIs, variance, value creation, cash & debt, covenants and alerts — for one portfolio company"
      />
      <div className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6">
        <DealBanner companyId={params.companyId} />
        <MonitoringWorkspace companyId={params.companyId} />
      </div>
    </div>
  );
}

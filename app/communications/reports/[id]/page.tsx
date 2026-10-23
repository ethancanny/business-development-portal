import ReportDetail from "@/components/comms/ReportDetail";

/** Report detail page (Part 12). Server wrapper — the detail
 *  component fetches from /api/platform/comms/reports/[id]. */
export default function ReportPage({
  params,
}: {
  params: { id: string };
}) {
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">
      <ReportDetail reportId={params.id} />
    </div>
  );
}

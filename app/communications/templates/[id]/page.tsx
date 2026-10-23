import TemplateEditor from "@/components/comms/TemplateEditor";

/** Template editor page (Part 12). Server wrapper — the editor is a
 *  client component fetching from /api/platform/comms/templates/[id]. */
export default function TemplatePage({
  params,
}: {
  params: { id: string };
}) {
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6">
      <TemplateEditor templateId={params.id} />
    </div>
  );
}

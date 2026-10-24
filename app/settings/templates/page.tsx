import PageHero from "@/components/PageHero";
import SettingsNav from "@/components/settings/SettingsNav";
import TemplateManager from "@/components/docgen/TemplateManager";

/**
 * Settings → Templates (Contract generation, Oct 24, 2026): the
 * contract template library — versioned templates with an approval
 * gate. Only approved templates can generate documents.
 */
export default function SettingsTemplatesPage() {
  return (
    <div>
      <PageHero
        eyebrow="Canny Capital Partners"
        title="Templates"
        subtitle="Contract templates for deals and investors — versioned, approved before use"
      />
      <SettingsNav />
      <div className="mx-auto max-w-[900px] px-4 py-6 sm:px-6">
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-[#132847]/60 sm:p-6">
          <h2 className="text-lg font-bold text-[#0d1f3c] dark:text-white">
            Contract template library
          </h2>
          <p className="mb-5 mt-1 text-sm text-slate-500 dark:text-white/50">
            Templates use merge fields (company, parties, price, dates,
            deal terms) filled from the deal, the Directory, or the
            investor record at generation time. Every template carries
            a version and a status: only <strong>approved</strong>{" "}
            templates can generate documents, and editing a template
            returns it to draft for re-approval. Generated documents
            are Word (.docx) + PDF and carry a “Draft for attorney
            review” banner.
          </p>
          <TemplateManager />
        </section>
      </div>
    </div>
  );
}

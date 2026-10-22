"use client";

import PageHero from "@/components/PageHero";
import DocumentsLibrary from "@/components/DocumentsLibrary";

export default function DocumentsPage() {
  return (
    <div>
      <PageHero
        eyebrow="Platform"
        title="Documents"
        subtitle="The cross-deal document library — search, preview, version, and share every file"
      />
      <div className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6">
        <DocumentsLibrary />
      </div>
    </div>
  );
}

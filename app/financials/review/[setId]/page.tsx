"use client";

import { useParams } from "next/navigation";
import PageHero from "@/components/PageHero";
import FinancialReview from "@/components/FinancialReview";

export default function FinancialReviewPage() {
  const params = useParams<{ setId: string }>();
  const setId = typeof params?.setId === "string" ? params.setId : "";
  return (
    <div>
      <PageHero
        eyebrow="Financials"
        title="Review financials"
        subtitle="Verify extracted lines against the source document, then post"
      />
      <div className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6">
        {setId ? <FinancialReview setId={setId} /> : null}
      </div>
    </div>
  );
}

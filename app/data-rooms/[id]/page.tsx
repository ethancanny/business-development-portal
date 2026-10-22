"use client";

import { useParams } from "next/navigation";
import PageHero from "@/components/PageHero";
import DataRoomDetail from "@/components/DataRoomDetail";

export default function DataRoomDetailPage() {
  const params = useParams<{ id: string }>();
  const id = typeof params?.id === "string" ? params.id : "";
  return (
    <div>
      <PageHero eyebrow="Platform" title="Data Room" subtitle="Diligence documents, checklist, guests, and Q&A" />
      <div className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6">
        {id ? <DataRoomDetail roomId={id} /> : null}
      </div>
    </div>
  );
}

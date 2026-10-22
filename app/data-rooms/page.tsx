"use client";

import PageHero from "@/components/PageHero";
import RoomsList from "@/components/DataRooms";

export default function DataRoomsPage() {
  return (
    <div>
      <PageHero
        eyebrow="Platform"
        title="Data Rooms"
        subtitle="Controlled diligence rooms for each deal — documents, checklists, guests, and Q&A in one place"
      />
      <div className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6">
        <RoomsList />
      </div>
    </div>
  );
}

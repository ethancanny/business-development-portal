"use client";

import { useParams } from "next/navigation";
import GuestRoom from "@/components/GuestRoom";

export default function GuestRoomPage() {
  const params = useParams<{ token: string }>();
  const token = typeof params?.token === "string" ? params.token : "";
  if (!token) return null;
  return <GuestRoom token={token} />;
}

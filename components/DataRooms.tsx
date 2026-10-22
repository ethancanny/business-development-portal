"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CardSkeleton, EmptyState, ErrorState } from "@/components/ui";
import { fmtDate } from "@/lib/format";

interface RoomRow {
  id: string;
  dealId: string;
  companyId: string | null;
  dealName: string;
  name: string;
  provider: string;
  status: string;
  domainAllowlist: string[];
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}
type RoomSummary = RoomRow & {
  documentCount: number;
  checklistTotal: number;
  checklistSatisfied: number;
  completenessPct: number;
  openQaCount: number;
};

interface DealLite {
  id: string;
  companyName: string;
}

const cardCls =
  "rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-[#132847]/60 sm:p-6";
const inputCls =
  "w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-[#0d1f3c] outline-none placeholder:text-slate-300 focus:border-[#b8975a] dark:border-white/10 dark:bg-[#132847]/60 dark:text-white dark:placeholder:text-white/30";
const labelCls =
  "mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-white/40";

export default function RoomsList() {
  const router = useRouter();
  const [rooms, setRooms] = useState<RoomSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [deals, setDeals] = useState<DealLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [dealId, setDealId] = useState("");
  const [roomName, setRoomName] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const [roomsRes, dealsRes] = await Promise.all([
        fetch("/api/platform/datarooms?limit=100&offset=0", { cache: "no-store" }),
        fetch("/api/deals").catch(() => null),
      ]);
      if (!roomsRes.ok) throw new Error(`HTTP ${roomsRes.status}`);
      const data = (await roomsRes.json()) as { items?: RoomSummary[]; total?: number };
      setRooms(Array.isArray(data.items) ? data.items : []);
      setTotal(typeof data.total === "number" ? data.total : (data.items?.length ?? 0));
      if (dealsRes && dealsRes.ok) {
        const d = (await dealsRes.json().catch(() => [])) as unknown;
        const arr = Array.isArray(d) ? (d as DealLite[]) : [];
        setDeals(arr.filter((x) => x && typeof x.id === "string"));
      }
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const roomDealIds = new Set(rooms.map((r) => r.dealId));
  const availableDeals = deals.filter((d) => !roomDealIds.has(d.id));

  const createRoom = async () => {
    if (!dealId || creating) return;
    setCreating(true);
    setCreateError("");
    try {
      const res = await fetch("/api/platform/datarooms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dealId, name: roomName.trim() || undefined }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { room?: RoomSummary };
      if (data.room?.id) {
        router.push(`/data-rooms/${data.room.id}`);
      } else {
        await load();
        setShowCreate(false);
      }
    } catch {
      setCreateError("Could not create the data room. Please try again.");
    } finally {
      setCreating(false);
    }
  };

  if (loading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true">
        {Array.from({ length: 6 }).map((_, i) => (
          <CardSkeleton key={i} lines={3} />
        ))}
      </div>
    );
  }

  if (error) {
    return <ErrorState title="Could not load data rooms" message="Data rooms could not be loaded. Try again in a moment." onRetry={() => void load()} />;
  }

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <Link href="/documents" className="btn btn-secondary min-h-[44px]">
          Documents library
        </Link>
        <button type="button" onClick={() => setShowCreate((s) => !s)} className="btn btn-primary min-h-[44px]" aria-expanded={showCreate}>
          New Data Room
        </button>
        <span className="ml-auto text-xs text-slate-400 dark:text-white/40">
          {total} room{total === 1 ? "" : "s"}
        </span>
      </div>

      {showCreate && (
        <div className={`${cardCls} mb-6`}>
          <h2 className="font-display text-xl font-semibold text-[#0d1f3c] dark:text-white">New Data Room</h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-white/50">Pick a deal to create a controlled diligence room for it.</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div>
              <label className={labelCls} htmlFor="room-deal">Deal</label>
              <select id="room-deal" value={dealId} onChange={(e) => setDealId(e.target.value)} className={inputCls}>
                <option value="">Select a deal</option>
                {(availableDeals.length ? availableDeals : deals).map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.companyName || d.id}
                  </option>
                ))}
              </select>
              {availableDeals.length === 0 && deals.length > 0 && (
                <p className="mt-1 text-xs text-slate-400 dark:text-white/40">All deals already have a room; selecting one will open its existing room.</p>
              )}
            </div>
            <div>
              <label className={labelCls} htmlFor="room-name">Room name (optional)</label>
              <input id="room-name" value={roomName} onChange={(e) => setRoomName(e.target.value)} placeholder="Defaults to the deal name" className={inputCls} />
            </div>
          </div>
          {createError && <p className="mt-3 text-sm text-red-600 dark:text-red-300">{createError}</p>}
          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" disabled={!dealId || creating} onClick={() => void createRoom()} className="btn btn-primary min-h-[44px]">
              {creating ? "Creating..." : "Create room"}
            </button>
            <button type="button" onClick={() => setShowCreate(false)} className="btn btn-secondary min-h-[44px]">
              Cancel
            </button>
          </div>
        </div>
      )}

      {rooms.length === 0 ? (
        <EmptyState
          title="No data rooms yet"
          message="Create a data room for a deal to share diligence documents with controlled guest access."
          actionLabel="New Data Room"
          onAction={() => setShowCreate(true)}
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {rooms.map((room) => {
            const pct = typeof room.completenessPct === "number" ? room.completenessPct : 0;
            return (
              <Link key={room.id} href={`/data-rooms/${room.id}`} className={`${cardCls} block transition hover:border-[#b8975a]/60`}>
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-display text-xl font-semibold text-[#0d1f3c] dark:text-white">{room.name}</h3>
                  {room.openQaCount > 0 && (
                    <span className="shrink-0 rounded-full bg-[#b8975a] px-2 py-0.5 text-xs font-bold text-[#0d1f3c]">{room.openQaCount} open Q&amp;A</span>
                  )}
                </div>
                <p className="mt-1 truncate text-sm text-slate-500 dark:text-white/60">{room.dealName || "—"}</p>
                <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-white/10">
                  <div className="h-full bg-[#b8975a]" style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
                </div>
                <p className="mt-2 text-sm text-slate-600 dark:text-white/70">
                  {pct}% complete · {room.checklistSatisfied} of {room.checklistTotal} items
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-400 dark:text-white/40">
                  <span>{room.documentCount} document{room.documentCount === 1 ? "" : "s"}</span>
                  <span>Updated {room.updatedAt ? fmtDate(room.updatedAt) : "—"}</span>
                  {room.status !== "active" && <span className="font-semibold uppercase tracking-wide">{room.status}</span>}
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

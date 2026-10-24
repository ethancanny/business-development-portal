"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Button, EmptyState, ErrorState, SkeletonRows } from "@/components/ui";
import { fmtDate, fmtRelTime } from "@/lib/format";
import DocumentUploader from "@/components/DocumentUploader";
import SigningActions from "@/components/signing/EnvelopeStatus";
import DealBanner from "@/components/identity/DealBanner";
import CompanyMark from "@/components/identity/CompanyMark";
import ConfirmDealDialog from "@/components/identity/ConfirmDealDialog";

interface RoomRow {
  id: string;
  dealId: string;
  companyId: string | null;
  /** Deal Identity enrichment from the room GET. */
  logoVersion?: number;
  accentColor?: string;
  codename?: string;
  dealName: string;
  name: string;
  provider: string;
  status: string;
  domainAllowlist: string[];
  usPersonsOnly?: boolean;
  restrictedAccess?: boolean;
  industry?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}
interface FolderRow {
  id: string;
  roomId: string;
  parentId: string | null;
  name: string;
  sort: number;
  isTemplate: boolean;
  createdAt: string;
}
interface IndexDoc {
  documentId: string;
  name: string;
  mime: string;
  sizeBytes: number;
  version: number;
  uploadedAt: string;
}
interface ChecklistItem {
  id: string;
  roomId: string;
  folderId: string | null;
  label: string;
  required: boolean;
  status: "missing" | "received" | "waived" | "na";
  documentId: string | null;
  sort: number;
  createdAt: string;
  updatedAt: string;
}
interface GuestRow {
  id: string;
  roomId: string;
  email: string;
  name: string;
  accessLevel: "view" | "download";
  expiresAt: string;
  revokedAt: string | null;
  createdBy: string;
  lastAccessedAt: string | null;
  createdAt: string;
  active: boolean;
}
interface QaMessage {
  id: string;
  author: string;
  authorKind: string;
  body: string;
  createdAt: string;
}
interface QaThread {
  id: string;
  roomId: string;
  documentId: string | null;
  documentName: string;
  title: string;
  status: string;
  createdBy: string;
  createdByKind: string;
  createdAt: string;
  updatedAt: string;
  messages: QaMessage[];
}
interface DetailPayload {
  room: RoomRow;
  folders: { folder: FolderRow; documents: IndexDoc[] }[];
  unfiled: IndexDoc[];
  checklist: ChecklistItem[];
  completeness: { total: number; satisfied: number; pct: number; missing: ChecklistItem[] };
  openQaCount: number;
  guests: GuestRow[];
  provider: { provider: string; configured: boolean; setupRequired: boolean; detail: string; missingScopes?: string[] };
}
interface AccessEntry {
  id: string;
  documentId: string | null;
  documentName: string;
  actor: string;
  actorKind: string;
  action: string;
  detail: string;
  createdAt: string;
}

const cardCls =
  "rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-[#132847]/60 sm:p-6";
const inputCls =
  "w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-[#0d1f3c] outline-none placeholder:text-slate-300 focus:border-[#b8975a] dark:border-white/10 dark:bg-[#132847]/60 dark:text-white dark:placeholder:text-white/30";
const labelCls =
  "mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-white/40";

function fmtBytes(n: number): string {
  if (!n || n <= 0) return "0 B";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export default function DataRoomDetail({ roomId }: { roomId: string }) {
  const [detail, setDetail] = useState<DetailPayload | null>(null);
  const [threads, setThreads] = useState<QaThread[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const [nameDraft, setNameDraft] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [allowlistDraft, setAllowlistDraft] = useState("");
  const [savingAllowlist, setSavingAllowlist] = useState(false);
  const [headerMsg, setHeaderMsg] = useState("");

  const [uploadFolderId, setUploadFolderId] = useState("");
  const [newFolderName, setNewFolderName] = useState("");
  const [addingFolder, setAddingFolder] = useState(false);

  const [newCheckLabel, setNewCheckLabel] = useState("");
  const [newCheckFolder, setNewCheckFolder] = useState("");
  const [newCheckRequired, setNewCheckRequired] = useState(true);
  const [addingCheck, setAddingCheck] = useState(false);

  const [guestEmail, setGuestEmail] = useState("");
  const [guestName, setGuestName] = useState("");
  const [guestLevel, setGuestLevel] = useState<"view" | "download">("view");
  const [guestDays, setGuestDays] = useState(30);
  const [creatingGuest, setCreatingGuest] = useState(false);
  /** Wrong-deal protection: guest-link creation goes through the
   *  ConfirmDealDialog first (Deal Identity, Oct 24, 2026). */
  const [confirmGuest, setConfirmGuest] = useState(false);
  const [guestError, setGuestError] = useState("");
  const [oneTimeLink, setOneTimeLink] = useState("");
  const [copied, setCopied] = useState(false);

  const [newQTitle, setNewQTitle] = useState("");
  const [newQBody, setNewQBody] = useState("");
  const [asking, setAsking] = useState(false);
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});

  const [accessEntries, setAccessEntries] = useState<AccessEntry[] | null>(null);
  const [accessStatus, setAccessStatus] = useState<string>("");
  const [accessNote, setAccessNote] = useState("");
  const [accessLoading, setAccessLoading] = useState(false);

  const loadDetail = useCallback(async () => {
    const res = await fetch(`/api/platform/datarooms/${encodeURIComponent(roomId)}`, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as DetailPayload;
    setDetail(data);
    setNameDraft(data.room?.name ?? "");
    setAllowlistDraft((data.room?.domainAllowlist ?? []).join(", "));
    return data;
  }, [roomId]);

  const loadQa = useCallback(async () => {
    const res = await fetch(`/api/platform/datarooms/${encodeURIComponent(roomId)}/qa`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as { threads?: QaThread[] };
    setThreads(Array.isArray(data.threads) ? data.threads : []);
  }, [roomId]);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      await Promise.all([loadDetail(), loadQa().catch(() => setThreads([]))]);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [loadDetail, loadQa]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const folderNameById = useMemo(() => {
    const m = new Map<string, string>();
    detail?.folders.forEach((f) => m.set(f.folder.id, f.folder.name));
    return m;
  }, [detail]);

  const allDocs = useMemo(() => {
    if (!detail) return [] as IndexDoc[];
    const list: IndexDoc[] = [];
    detail.folders.forEach((f) => list.push(...f.documents));
    list.push(...detail.unfiled);
    return list;
  }, [detail]);

  const patchRoom = async (body: Record<string, unknown>) => {
    const res = await fetch(`/api/platform/datarooms/${encodeURIComponent(roomId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    await loadDetail();
  };

  const saveName = async () => {
    if (!nameDraft.trim()) return;
    setSavingName(true);
    setHeaderMsg("");
    try {
      await patchRoom({ name: nameDraft.trim() });
      setHeaderMsg("Saved.");
    } catch {
      setHeaderMsg("Could not save the name.");
    } finally {
      setSavingName(false);
    }
  };

  const saveAllowlist = async () => {
    setSavingAllowlist(true);
    setHeaderMsg("");
    try {
      const domains = allowlistDraft.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
      await patchRoom({ domainAllowlist: domains });
      setHeaderMsg("Allowlist saved.");
    } catch {
      setHeaderMsg("Could not save the allowlist.");
    } finally {
      setSavingAllowlist(false);
    }
  };

  const toggleStatus = async () => {
    if (!detail) return;
    const next = detail.room.status === "active" ? "archived" : "active";
    try {
      await patchRoom({ status: next });
    } catch {
      setHeaderMsg("Could not change status.");
    }
  };

  const addFolder = async () => {
    if (!newFolderName.trim() || addingFolder) return;
    setAddingFolder(true);
    try {
      const res = await fetch(`/api/platform/datarooms/${encodeURIComponent(roomId)}/folders`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newFolderName.trim() }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setNewFolderName("");
      await loadDetail();
    } catch {
      /* keep name for retry */
    } finally {
      setAddingFolder(false);
    }
  };

  const patchChecklist = async (itemId: string, body: Record<string, unknown>) => {
    const res = await fetch(`/api/platform/datarooms/${encodeURIComponent(roomId)}/checklist/${encodeURIComponent(itemId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    await loadDetail();
  };

  const addChecklist = async () => {
    if (!newCheckLabel.trim() || addingCheck) return;
    setAddingCheck(true);
    try {
      const res = await fetch(`/api/platform/datarooms/${encodeURIComponent(roomId)}/checklist`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: newCheckLabel.trim(), folderId: newCheckFolder || undefined, required: newCheckRequired }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setNewCheckLabel("");
      await loadDetail();
    } catch {
      /* keep label */
    } finally {
      setAddingCheck(false);
    }
  };

  const createGuest = async () => {
    if (!guestEmail.trim() || creatingGuest) return;
    setCreatingGuest(true);
    setGuestError("");
    setOneTimeLink("");
    setCopied(false);
    try {
      const res = await fetch(`/api/platform/datarooms/${encodeURIComponent(roomId)}/guests`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: guestEmail.trim(), name: guestName.trim() || undefined, accessLevel: guestLevel, expiresInDays: guestDays }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { guest?: GuestRow; link?: string };
      if (data.link) {
        const origin = typeof window !== "undefined" ? window.location.origin : "";
        setOneTimeLink(`${origin}${data.link}`);
      }
      setGuestEmail("");
      setGuestName("");
      await loadDetail();
    } catch {
      setGuestError("Could not create the guest link. Check the email and try again.");
    } finally {
      setCreatingGuest(false);
    }
  };

  const copyLink = async () => {
    if (!oneTimeLink) return;
    try {
      await navigator.clipboard.writeText(oneTimeLink);
      setCopied(true);
    } catch {
      const el = document.getElementById("one-time-link") as HTMLInputElement | null;
      if (el) {
        el.select();
        document.execCommand("copy");
        setCopied(true);
      }
    }
  };

  const revokeGuest = async (guestId: string) => {
    try {
      const res = await fetch(`/api/platform/datarooms/${encodeURIComponent(roomId)}/guests/${encodeURIComponent(guestId)}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await loadDetail();
    } catch {
      /* leave as-is */
    }
  };

  const askQuestion = async () => {
    if (!newQTitle.trim() || !newQBody.trim() || asking) return;
    setAsking(true);
    try {
      const res = await fetch(`/api/platform/datarooms/${encodeURIComponent(roomId)}/qa`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: newQTitle.trim(), body: newQBody.trim() }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setNewQTitle("");
      setNewQBody("");
      await loadQa();
    } catch {
      /* keep drafts */
    } finally {
      setAsking(false);
    }
  };

  const replyThread = async (threadId: string) => {
    const body = (replyDrafts[threadId] || "").trim();
    if (!body) return;
    try {
      const res = await fetch(`/api/platform/datarooms/${encodeURIComponent(roomId)}/qa/${encodeURIComponent(threadId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setReplyDrafts((prev) => ({ ...prev, [threadId]: "" }));
      await loadQa();
    } catch {
      /* keep draft */
    }
  };

  const setThreadStatus = async (threadId: string, status: "open" | "closed") => {
    try {
      const res = await fetch(`/api/platform/datarooms/${encodeURIComponent(roomId)}/qa/${encodeURIComponent(threadId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await loadQa();
      await loadDetail().catch(() => {});
    } catch {
      /* ignore */
    }
  };

  const loadAccessLog = async (fresh: boolean) => {
    setAccessLoading(true);
    try {
      const res = await fetch(`/api/platform/datarooms/${encodeURIComponent(roomId)}/access-log${fresh ? "?fresh=1" : ""}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { status?: string; note?: string; entries?: AccessEntry[] };
      setAccessStatus(data.status || "ok");
      setAccessNote(data.note || "");
      setAccessEntries(Array.isArray(data.entries) ? data.entries : []);
    } catch {
      setAccessStatus("error");
      setAccessNote("Could not load the access log.");
      setAccessEntries([]);
    } finally {
      setAccessLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <SkeletonRows rows={6} />
      </div>
    );
  }
  if (error || !detail) {
    return <ErrorState title="Could not load this data room" message="The room could not be loaded. Try again in a moment." onRetry={() => void loadAll()} />;
  }

  const { room, completeness, provider, guests } = detail;
  const pct = completeness?.pct ?? 0;

  // Checklist grouping
  const groups = new Map<string, ChecklistItem[]>();
  for (const item of detail.checklist) {
    const key = item.folderId ? folderNameById.get(item.folderId) || "Folder" : "General";
    const arr = groups.get(key) ?? [];
    arr.push(item);
    groups.set(key, arr);
  }

  const renderDocRow = (doc: IndexDoc) => (
    <li key={doc.documentId} className="flex flex-wrap items-center gap-2 py-2.5">
      <Link href={`/documents?doc=${encodeURIComponent(doc.documentId)}`} className="min-w-0 flex-1 truncate text-sm font-medium text-[#0d1f3c] hover:text-[#b8975a] dark:text-white">
        {doc.name}
      </Link>
      <span className="text-xs text-slate-400 dark:text-white/40">{doc.mime || "—"}</span>
      <span className="text-xs text-slate-400 dark:text-white/40">{fmtBytes(doc.sizeBytes)}</span>
      <span className="text-xs text-slate-400 dark:text-white/40">v{doc.version}</span>
      <span className="text-xs text-slate-400 dark:text-white/40">{doc.uploadedAt ? fmtDate(doc.uploadedAt) : ""}</span>
      <span className="flex gap-1.5">
        <a href={`/api/platform/documents/${encodeURIComponent(doc.documentId)}/file?roomId=${encodeURIComponent(roomId)}`} target="_blank" rel="noreferrer" className="btn btn-secondary btn-sm min-h-[44px]">
          View
        </a>
        <a href={`/api/platform/documents/${encodeURIComponent(doc.documentId)}/file?dl=1&roomId=${encodeURIComponent(roomId)}`} className="btn btn-ghost btn-sm min-h-[44px]">
          Download
        </a>
      </span>
      <SigningActions documentId={doc.documentId} documentName={doc.name} />
    </li>
  );

  return (
    <div className="space-y-5">
      {/* Deal Identity banner for the room's deal/company. */}
      <DealBanner
        companyId={room.companyId ?? undefined}
        dealId={room.dealId}
      />
      {/* Header */}
      <section className={cardCls}>
        {provider?.setupRequired && (
          <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
            <p className="font-semibold">Storage setup required</p>
            <p className="mt-1">{provider.detail}</p>
            {provider.missingScopes && provider.missingScopes.length > 0 && (
              <p className="mt-1 text-xs">Missing scopes: {provider.missingScopes.join(", ")}</p>
            )}
          </div>
        )}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <label className={labelCls} htmlFor="room-name">Room name</label>
            <div className="flex flex-wrap gap-2">
              <input id="room-name" value={nameDraft} onChange={(e) => setNameDraft(e.target.value)} className={`${inputCls} min-w-0 flex-1 sm:max-w-md`} />
              <Button onClick={() => void saveName()} disabled={savingName} className="min-h-[44px]">
                {savingName ? "Saving..." : "Save"}
              </Button>
            </div>
            <p className="mt-2 flex items-center gap-2 text-sm text-slate-500 dark:text-white/60">
              {room.companyId && (
                <CompanyMark
                  companyId={room.companyId}
                  name={room.dealName}
                  logoVersion={room.logoVersion ?? 0}
                  size={20}
                />
              )}
              <span className="min-w-0 truncate">{room.dealName}</span>
            </p>
            <p className="mt-1 text-xs text-slate-400 dark:text-white/40">
              Storage: {provider?.provider || room.provider} · Status: {room.status} · Created {room.createdAt ? fmtDate(room.createdAt) : "—"}
            </p>
            {(room.usPersonsOnly || room.restrictedAccess) && (
              <p className="mt-2 flex flex-wrap gap-1.5">
                {room.usPersonsOnly && (
                  <span className="rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-semibold text-red-700 dark:bg-red-500/20 dark:text-red-200">
                    U.S. persons only
                  </span>
                )}
                {room.restrictedAccess && (
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
                    Restricted access — approved parties only
                  </span>
                )}
              </p>
            )}
            {headerMsg && <p className="mt-2 text-xs text-slate-500 dark:text-white/60">{headerMsg}</p>}
          </div>
          <Button variant="secondary" onClick={() => void toggleStatus()} className="min-h-[44px]">
            {room.status === "active" ? "Archive" : "Reactivate"}
          </Button>
        </div>

        <div className="mt-5 border-t border-slate-100 pt-4 dark:border-white/5">
          <label className={labelCls} htmlFor="room-allowlist">Domain allowlist (comma-separated)</label>
          <div className="flex flex-wrap gap-2">
            <input id="room-allowlist" value={allowlistDraft} onChange={(e) => setAllowlistDraft(e.target.value)} placeholder="example.com, partner.com" className={`${inputCls} min-w-0 flex-1`} />
            <Button variant="secondary" onClick={() => void saveAllowlist()} disabled={savingAllowlist} className="min-h-[44px]">
              {savingAllowlist ? "Saving..." : "Save allowlist"}
            </Button>
          </div>
          <p className="mt-1 text-xs text-slate-400 dark:text-white/40">Leave empty to allow any guest email domain. Guests must still use their one-time link.</p>
        </div>

        <div className="mt-5 border-t border-slate-100 pt-4 dark:border-white/5">
          <p className={labelCls}>Export controls</p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant={room.usPersonsOnly ? "primary" : "secondary"}
              onClick={() => void patchRoom({ usPersonsOnly: !room.usPersonsOnly }).catch(() => setHeaderMsg("Could not save export controls."))}
              className="min-h-[44px]"
            >
              {room.usPersonsOnly ? "✓ " : ""}U.S. persons only
            </Button>
            <Button
              variant={room.restrictedAccess ? "primary" : "secondary"}
              onClick={() => void patchRoom({ restrictedAccess: !room.restrictedAccess }).catch(() => setHeaderMsg("Could not save export controls."))}
              className="min-h-[44px]"
            >
              {room.restrictedAccess ? "✓ " : ""}Restricted access
            </Button>
          </div>
          <p className="mt-1 text-xs text-slate-400 dark:text-white/40">
            Flagged rooms log every access — internal views included.
            Restricted rooms refuse guest invites to anyone who is not
            an approved party (a Directory contact, a portal login, or
            an allowlisted domain).
          </p>
        </div>
      </section>

      {/* Completeness */}
      <section className={cardCls}>
        <h2 className="text-sm font-bold uppercase tracking-wide text-[#0d1f3c] dark:text-white">Completeness</h2>
        <div className="mt-3 flex flex-wrap items-end gap-4">
          <span className="font-display text-5xl font-semibold text-[#0d1f3c] dark:text-white">{pct}%</span>
          <span className="pb-2 text-sm text-slate-500 dark:text-white/60">
            {completeness.satisfied} of {completeness.total} items satisfied
          </span>
        </div>
        <div className="mt-3 h-3 overflow-hidden rounded-full bg-slate-100 dark:bg-white/10">
          <div className="h-full bg-[#b8975a]" style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
        </div>
        {completeness.missing && completeness.missing.length > 0 ? (
          <div className="mt-4">
            <p className={labelCls}>Missing items</p>
            <ul className="divide-y divide-slate-100 dark:divide-white/5">
              {completeness.missing.map((m) => (
                <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                  <span className="text-[#0d1f3c] dark:text-white">{m.label}</span>
                  <span className="text-xs text-slate-400 dark:text-white/40">{m.folderId ? folderNameById.get(m.folderId) || "Folder" : "General"}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="mt-3 text-sm text-slate-500 dark:text-white/60">Nothing missing — the checklist is complete.</p>
        )}
      </section>

      {/* Folders & documents */}
      <section className={cardCls}>
        <h2 className="text-sm font-bold uppercase tracking-wide text-[#0d1f3c] dark:text-white">Folders &amp; documents</h2>

        <div className="mt-4 flex flex-wrap gap-2">
          <input value={newFolderName} onChange={(e) => setNewFolderName(e.target.value)} placeholder="New folder name" className={`${inputCls} min-w-0 flex-1 sm:max-w-xs`} aria-label="New folder name" />
          <Button variant="secondary" onClick={() => void addFolder()} disabled={addingFolder || !newFolderName.trim()} className="min-h-[44px]">
            Add folder
          </Button>
        </div>

        <div className="mt-5 rounded-2xl border border-slate-100 p-4 dark:border-white/5">
          <label className={labelCls} htmlFor="upload-folder">Upload to folder</label>
          <select id="upload-folder" value={uploadFolderId} onChange={(e) => setUploadFolderId(e.target.value)} className={`${inputCls} sm:max-w-xs`}>
            <option value="">Unfiled</option>
            {detail.folders.map(({ folder }) => (
              <option key={folder.id} value={folder.id}>
                {folder.name}
              </option>
            ))}
          </select>
          <div className="mt-3">
            <DocumentUploader
              roomId={roomId}
              folderId={uploadFolderId || undefined}
              onUploaded={() => void loadDetail()}
              exportWarning={
                room.industry === "Aerospace & Defense"
                  ? "Aerospace & Defense room — do not upload ITAR-, EAR-, or CUI-controlled documents unless export controls are confirmed for everyone with access to this room."
                  : undefined
              }
            />
          </div>
        </div>

        <div className="mt-5 space-y-6">
          {detail.folders.map(({ folder, documents }) => (
            <div key={folder.id}>
              <h3 className="font-display text-lg font-semibold text-[#0d1f3c] dark:text-white">{folder.name}</h3>
              {documents.length === 0 ? (
                <p className="mt-1 text-sm text-slate-400 dark:text-white/40">No documents in this folder yet.</p>
              ) : (
                <ul className="divide-y divide-slate-100 dark:divide-white/5">{documents.map(renderDocRow)}</ul>
              )}
            </div>
          ))}
          <div>
            <h3 className="font-display text-lg font-semibold text-[#0d1f3c] dark:text-white">Unfiled</h3>
            {detail.unfiled.length === 0 ? (
              <p className="mt-1 text-sm text-slate-400 dark:text-white/40">No unfiled documents.</p>
            ) : (
              <ul className="divide-y divide-slate-100 dark:divide-white/5">{detail.unfiled.map(renderDocRow)}</ul>
            )}
          </div>
        </div>
      </section>

      {/* Checklist */}
      <section className={cardCls}>
        <h2 className="text-sm font-bold uppercase tracking-wide text-[#0d1f3c] dark:text-white">Checklist</h2>
        {detail.checklist.length === 0 ? (
          <p className="mt-3 text-sm text-slate-400 dark:text-white/40">No checklist items yet.</p>
        ) : (
          <div className="mt-3 space-y-5">
            {Array.from(groups.entries()).map(([groupName, items]) => (
              <div key={groupName}>
                <p className={labelCls}>{groupName}</p>
                <ul className="space-y-3">
                  {items.map((item) => {
                    const folderDocs = item.folderId ? detail.folders.find((f) => f.folder.id === item.folderId)?.documents ?? [] : [];
                    const docOptions = [...folderDocs, ...detail.unfiled];
                    // Dedupe options by documentId
                    const seen = new Set<string>();
                    const uniqueOptions = docOptions.filter((d) => {
                      if (seen.has(d.documentId)) return false;
                      seen.add(d.documentId);
                      return true;
                    });
                    return (
                      <li key={item.id} className="flex flex-col gap-2 rounded-xl border border-slate-100 px-3 py-3 dark:border-white/5 sm:flex-row sm:items-center">
                        <span className="min-w-0 flex-1 text-sm font-medium text-[#0d1f3c] dark:text-white">
                          {item.label}
                          {item.required && <span className="ml-2 text-xs text-slate-400 dark:text-white/40">Required</span>}
                        </span>
                        <select
                          value={item.status}
                          onChange={(e) => void patchChecklist(item.id, { status: e.target.value })}
                          className={`${inputCls} sm:w-36`}
                          aria-label={`Status for ${item.label}`}
                        >
                          <option value="missing">Missing</option>
                          <option value="received">Received</option>
                          <option value="waived">Waived</option>
                          <option value="na">N/A</option>
                        </select>
                        <select
                          value={item.documentId || ""}
                          onChange={(e) => void patchChecklist(item.id, { documentId: e.target.value || null })}
                          className={`${inputCls} sm:w-56`}
                          aria-label={`Document for ${item.label}`}
                        >
                          <option value="">No document</option>
                          {uniqueOptions.map((d) => (
                            <option key={d.documentId} value={d.documentId}>
                              {d.name}
                            </option>
                          ))}
                          {item.documentId && !uniqueOptions.some((d) => d.documentId === item.documentId) && (
                            <option value={item.documentId}>{allDocs.find((d) => d.documentId === item.documentId)?.name || item.documentId}</option>
                          )}
                        </select>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        )}
        <div className="mt-5 flex flex-col gap-2 border-t border-slate-100 pt-4 dark:border-white/5 sm:flex-row sm:items-end">
          <div className="min-w-0 flex-1">
            <label className={labelCls} htmlFor="check-label">New item label</label>
            <input id="check-label" value={newCheckLabel} onChange={(e) => setNewCheckLabel(e.target.value)} placeholder="e.g. Last 3 years tax returns" className={inputCls} />
          </div>
          <div className="sm:w-48">
            <label className={labelCls} htmlFor="check-folder">Folder</label>
            <select id="check-folder" value={newCheckFolder} onChange={(e) => setNewCheckFolder(e.target.value)} className={inputCls}>
              <option value="">General</option>
              {detail.folders.map(({ folder }) => (
                <option key={folder.id} value={folder.id}>
                  {folder.name}
                </option>
              ))}
            </select>
          </div>
          <label className="flex min-h-[44px] items-center gap-2 text-sm text-slate-600 dark:text-white/70">
            <input type="checkbox" checked={newCheckRequired} onChange={(e) => setNewCheckRequired(e.target.checked)} className="h-4 w-4" />
            Required
          </label>
          <Button onClick={() => void addChecklist()} disabled={addingCheck || !newCheckLabel.trim()} className="min-h-[44px]">
            Add
          </Button>
        </div>
      </section>

      {/* Guests */}
      <section className={cardCls}>
        <h2 className="text-sm font-bold uppercase tracking-wide text-[#0d1f3c] dark:text-white">Guests</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label className={labelCls} htmlFor="guest-email">Email</label>
            <input id="guest-email" value={guestEmail} onChange={(e) => setGuestEmail(e.target.value)} placeholder="guest@example.com" className={inputCls} />
          </div>
          <div>
            <label className={labelCls} htmlFor="guest-name">Name</label>
            <input id="guest-name" value={guestName} onChange={(e) => setGuestName(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className={labelCls} htmlFor="guest-level">Access level</label>
            <select id="guest-level" value={guestLevel} onChange={(e) => setGuestLevel(e.target.value as "view" | "download")} className={inputCls}>
              <option value="view">View only</option>
              <option value="download">View + download</option>
            </select>
          </div>
          <div>
            <label className={labelCls} htmlFor="guest-days">Expires in (days)</label>
            <input id="guest-days" type="number" min={1} max={365} value={guestDays} onChange={(e) => setGuestDays(Number(e.target.value) || 30)} className={inputCls} />
          </div>
        </div>
        {guestError && <p className="mt-3 text-sm text-red-600 dark:text-red-300">{guestError}</p>}
        <div className="mt-3">
          <Button onClick={() => setConfirmGuest(true)} disabled={creatingGuest || !guestEmail.trim()} className="min-h-[44px]">
            {creatingGuest ? "Creating..." : "Create guest link"}
          </Button>
        </div>

        {oneTimeLink && (
          <div className="mt-4 rounded-xl border border-[#b8975a]/50 bg-[#b8975a]/10 px-4 py-3">
            <p className="text-sm font-semibold text-[#0d1f3c] dark:text-white">Guest link — shown once</p>
            <p className="mt-1 text-xs text-slate-500 dark:text-white/60">This link is shown once. Copy it now and send it to the guest.</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <input id="one-time-link" readOnly value={oneTimeLink} className={`${inputCls} min-w-0 flex-1`} onFocus={(e) => e.target.select()} />
              <Button variant="secondary" onClick={() => void copyLink()} className="min-h-[44px]">
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>
          </div>
        )}

        {guests.length === 0 ? (
          <p className="mt-4 text-sm text-slate-400 dark:text-white/40">No guests yet.</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-slate-400 dark:text-white/40">
                  <th className="px-2 py-2">Email</th>
                  <th className="px-2 py-2">Name</th>
                  <th className="px-2 py-2">Level</th>
                  <th className="px-2 py-2">Expires</th>
                  <th className="px-2 py-2">State</th>
                  <th className="px-2 py-2">Last accessed</th>
                  <th className="px-2 py-2">Action</th>
                </tr>
              </thead>
              <tbody>
                {guests.map((g) => {
                  const state = g.revokedAt ? "Revoked" : g.active ? "Active" : "Expired";
                  return (
                    <tr key={g.id} className="border-t border-slate-100 dark:border-white/5">
                      <td className="px-2 py-2.5 text-[#0d1f3c] dark:text-white">{g.email}</td>
                      <td className="px-2 py-2.5 text-slate-500 dark:text-white/60">{g.name || "—"}</td>
                      <td className="px-2 py-2.5 capitalize text-slate-500 dark:text-white/60">{g.accessLevel}</td>
                      <td className="px-2 py-2.5 text-slate-500 dark:text-white/60">{g.expiresAt ? fmtDate(g.expiresAt) : "—"}</td>
                      <td className="px-2 py-2.5 text-slate-500 dark:text-white/60">{state}</td>
                      <td className="px-2 py-2.5 text-slate-500 dark:text-white/60">{g.lastAccessedAt ? fmtDate(g.lastAccessedAt) : "Never"}</td>
                      <td className="px-2 py-2.5">
                        {g.active && (
                          <button type="button" onClick={() => void revokeGuest(g.id)} className="btn btn-danger btn-sm min-h-[44px]">
                            Revoke
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Q&A */}
      <section className={cardCls}>
        <h2 className="text-sm font-bold uppercase tracking-wide text-[#0d1f3c] dark:text-white">Q&amp;A {detail.openQaCount > 0 ? `(${detail.openQaCount} open)` : ""}</h2>
        {threads.length === 0 ? (
          <p className="mt-3 text-sm text-slate-400 dark:text-white/40">No questions yet.</p>
        ) : (
          <div className="mt-4 space-y-5">
            {threads.map((thread) => (
              <div key={thread.id} className="rounded-xl border border-slate-100 px-4 py-3 dark:border-white/5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-[#0d1f3c] dark:text-white">{thread.title}</span>
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold capitalize text-slate-600 dark:bg-white/10 dark:text-white/70">{thread.status}</span>
                  <span className="text-xs text-slate-400 dark:text-white/40">Asked by {thread.createdBy} · {thread.createdAt ? fmtRelTime(thread.createdAt) : ""}</span>
                  <span className="ml-auto">
                    {thread.status === "closed" ? (
                      <button type="button" onClick={() => void setThreadStatus(thread.id, "open")} className="btn btn-secondary btn-sm min-h-[44px]">
                        Reopen
                      </button>
                    ) : (
                      <button type="button" onClick={() => void setThreadStatus(thread.id, "closed")} className="btn btn-ghost btn-sm min-h-[44px]">
                        Close
                      </button>
                    )}
                  </span>
                </div>
                {thread.documentName && <p className="mt-1 text-xs text-slate-400 dark:text-white/40">About: {thread.documentName}</p>}
                <div className="mt-3 space-y-2.5">
                  {(thread.messages || []).map((m) => (
                    <div key={m.id} className="text-sm">
                      <span className="font-semibold text-[#0d1f3c] dark:text-white">{m.author}</span>{" "}
                      <span className="text-xs text-slate-400 dark:text-white/40">{m.createdAt ? fmtRelTime(m.createdAt) : ""}</span>
                      <p className="mt-0.5 whitespace-pre-wrap text-slate-600 dark:text-white/75">{m.body}</p>
                    </div>
                  ))}
                </div>
                <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                  <textarea
                    value={replyDrafts[thread.id] || ""}
                    onChange={(e) => setReplyDrafts((prev) => ({ ...prev, [thread.id]: e.target.value }))}
                    placeholder="Write a reply..."
                    rows={2}
                    className={`${inputCls} min-w-0 flex-1`}
                    aria-label={`Reply to ${thread.title}`}
                  />
                  <Button variant="secondary" onClick={() => void replyThread(thread.id)} disabled={!(replyDrafts[thread.id] || "").trim()} className="min-h-[44px]">
                    Reply
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="mt-5 border-t border-slate-100 pt-4 dark:border-white/5">
          <p className={labelCls}>New question</p>
          <div className="space-y-2">
            <input value={newQTitle} onChange={(e) => setNewQTitle(e.target.value)} placeholder="Question title" className={inputCls} />
            <textarea value={newQBody} onChange={(e) => setNewQBody(e.target.value)} placeholder="Details..." rows={3} className={inputCls} />
            <Button onClick={() => void askQuestion()} disabled={asking || !newQTitle.trim() || !newQBody.trim()} className="min-h-[44px]">
              {asking ? "Posting..." : "Post question"}
            </Button>
          </div>
        </div>
      </section>

      {/* Access log */}
      <section className={cardCls}>
        <h2 className="text-sm font-bold uppercase tracking-wide text-[#0d1f3c] dark:text-white">Access log</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => void loadAccessLog(false)} disabled={accessLoading} className="min-h-[44px]">
            Load access log
          </Button>
          <Button variant="ghost" onClick={() => void loadAccessLog(true)} disabled={accessLoading} className="min-h-[44px]">
            Refresh
          </Button>
          {accessLoading && <span className="self-center text-sm text-slate-400 dark:text-white/40">Loading...</span>}
        </div>
        {accessEntries !== null && (
          <div className="mt-4">
            {accessStatus === "setup_required" ? (
              <p className="text-sm text-amber-700 dark:text-amber-300">{accessNote || "Access logging needs setup for this storage provider."}</p>
            ) : accessEntries.length === 0 ? (
              <p className="text-sm text-slate-400 dark:text-white/40">{accessNote || "No access recorded yet."}</p>
            ) : (
              <ul className="divide-y divide-slate-100 dark:divide-white/5">
                {accessEntries.map((e) => (
                  <li key={e.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
                    <span className="text-xs text-slate-400 dark:text-white/40">{e.createdAt ? fmtDate(e.createdAt) : ""}</span>
                    <span className="font-medium text-[#0d1f3c] dark:text-white">{e.actor}</span>
                    <span className="text-slate-500 dark:text-white/60">{e.action}</span>
                    {e.documentName && <span className="text-slate-500 dark:text-white/60">{e.documentName}</span>}
                    {e.detail && <span className="text-xs text-slate-400 dark:text-white/40">{e.detail}</span>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        {allDocs.length === 0 && detail.checklist.length === 0 && (
          <div className="mt-4">
            <EmptyState title="This room is empty" message="Upload documents and build the checklist to get started." />
          </div>
        )}
      </section>

      {/* Wrong-deal protection for the guest invite / share action. */}
      <ConfirmDealDialog
        open={confirmGuest}
        actionLabel="Invite guest to this data room"
        companyId={room.companyId ?? undefined}
        companyName={room.dealName}
        codename={room.codename}
        logoVersion={room.logoVersion ?? 0}
        detail={`Guest: ${guestEmail.trim()} · ${guestLevel === "download" ? "View + download" : "View only"} · expires in ${guestDays} days`}
        busy={creatingGuest}
        confirmLabel="Create guest link"
        onConfirm={() => {
          setConfirmGuest(false);
          void createGuest();
        }}
        onCancel={() => setConfirmGuest(false)}
      />
    </div>
  );
}

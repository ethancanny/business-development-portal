"use client";

import { useCallback, useRef, useState } from "react";

export interface DocumentRow {
  id: string;
  name: string;
  mime: string;
  sizeBytes: number;
  storageUrl?: string;
  source?: string;
  companyId: string | null;
  companyName?: string;
  dealId: string | null;
  dealName?: string;
  personId: string | null;
  tags: string[];
  contentHash?: string;
  extractionStatus?: string;
  currentVersion: number;
  legacyAttachmentId?: string | null;
  createdAt: string;
  updatedAt: string;
}

interface UploadResult {
  document: DocumentRow;
  version: number;
  duplicateOf: { id: string; name: string } | null;
}

interface QueueItem {
  id: string;
  file: File;
  progress: number;
  status: "pending" | "uploading" | "done" | "error" | "cancelled";
  error?: string;
  duplicateOf?: { id: string; name: string } | null;
  uploadId?: string;
}

function fmtBytes(n: number): string {
  if (!n || n <= 0) return "0 B";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

let seq = 0;
function nextId(): string {
  seq += 1;
  return `up-${Date.now()}-${seq}`;
}

export default function DocumentUploader({
  roomId,
  folderId,
  documentId,
  dealId,
  companyId,
  tags,
  onUploaded,
  exportWarning,
}: {
  roomId?: string;
  folderId?: string;
  documentId?: string;
  dealId?: string;
  companyId?: string;
  tags?: string[];
  onUploaded?: (result: UploadResult) => void;
  /** Export-control gate (Step 1): when set, uploads stay disabled
   * until the user explicitly confirms the controls warning. */
  exportWarning?: string;
}) {
  const [warningAcked, setWarningAcked] = useState(false);
  const [items, setItems] = useState<QueueItem[]>([]);
  const [dragging, setDragging] = useState(false);
  const browseRef = useRef<HTMLInputElement | null>(null);
  const photoRef = useRef<HTMLInputElement | null>(null);
  const cancelledRef = useRef<Set<string>>(new Set());
  const uploadIdsRef = useRef<Map<string, string>>(new Map());

  const patchItem = useCallback((id: string, patch: Partial<QueueItem>) => {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  }, []);

  const uploadOne = useCallback(
    async (itemId: string, file: File) => {
      patchItem(itemId, { status: "uploading", progress: 0, error: undefined });
      let uploadId: string | null = null;
      try {
        const beginRes = await fetch("/api/platform/datarooms/uploads", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            filename: file.name,
            mime: file.type || "application/octet-stream",
            totalSize: file.size,
            roomId,
            folderId,
            documentId,
            dealId,
            companyId,
            tags,
          }),
        });
        if (!beginRes.ok) throw new Error(`Could not start upload (${beginRes.status})`);
        const begin = (await beginRes.json()) as { uploadId: string; chunkSize: number };
        uploadId = begin.uploadId;
        uploadIdsRef.current.set(itemId, uploadId);
        patchItem(itemId, { uploadId });
        const chunkSize = begin.chunkSize && begin.chunkSize > 0 ? begin.chunkSize : 1024 * 1024;

        if (cancelledRef.current.has(itemId)) throw new Error("cancelled");

        let offset = 0;
        const total = file.size;
        if (total === 0) {
          patchItem(itemId, { progress: 100 });
        }
        while (offset < total) {
          if (cancelledRef.current.has(itemId)) throw new Error("cancelled");
          const slice = file.slice(offset, Math.min(offset + chunkSize, total));
          const putRes = await fetch(
            `/api/platform/datarooms/uploads/${encodeURIComponent(uploadId)}?offset=${offset}`,
            { method: "PUT", body: slice }
          );
          if (putRes.status === 409) {
            const j = (await putRes.json().catch(() => null)) as { expectedOffset?: number } | null;
            if (j && typeof j.expectedOffset === "number") {
              offset = j.expectedOffset;
              patchItem(itemId, { progress: total ? Math.round((offset / total) * 100) : 0 });
              continue;
            }
            throw new Error("Upload conflict (409)");
          }
          if (!putRes.ok) throw new Error(`Chunk upload failed (${putRes.status})`);
          const j = (await putRes.json().catch(() => null)) as { receivedBytes?: number } | null;
          if (j && typeof j.receivedBytes === "number") offset = j.receivedBytes;
          else offset += slice.size;
          patchItem(itemId, { progress: total ? Math.min(100, Math.round((offset / total) * 100)) : 100 });
        }

        if (cancelledRef.current.has(itemId)) throw new Error("cancelled");

        const compRes = await fetch(`/api/platform/datarooms/uploads/${encodeURIComponent(uploadId)}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "complete" }),
        });
        if (!compRes.ok) throw new Error(`Could not complete upload (${compRes.status})`);
        const result = (await compRes.json()) as UploadResult;
        patchItem(itemId, { status: "done", progress: 100, duplicateOf: result.duplicateOf ?? null });
        if (onUploaded) onUploaded(result);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg === "cancelled" || cancelledRef.current.has(itemId)) {
          patchItem(itemId, { status: "cancelled", error: undefined });
        } else {
          patchItem(itemId, { status: "error", error: msg });
        }
      }
    },
    [roomId, folderId, documentId, dealId, companyId, tags, onUploaded, patchItem]
  );

  const enqueue = useCallback(
    (files: FileList | File[]) => {
      const arr = Array.from(files);
      if (arr.length === 0) return;
      const newItems: QueueItem[] = arr.map((file) => ({ id: nextId(), file, progress: 0, status: "pending" as const }));
      setItems((prev) => [...prev, ...newItems]);
      // Sequential uploads
      void (async () => {
        for (const it of newItems) {
          if (cancelledRef.current.has(it.id)) continue;
          await uploadOne(it.id, it.file);
        }
      })();
    },
    [uploadOne]
  );

  const cancelItem = useCallback(
    async (item: QueueItem) => {
      cancelledRef.current.add(item.id);
      const uid = uploadIdsRef.current.get(item.id) || item.uploadId;
      patchItem(item.id, { status: "cancelled" });
      if (uid) {
        try {
          await fetch(`/api/platform/datarooms/uploads/${encodeURIComponent(uid)}`, { method: "DELETE" });
        } catch {
          /* best effort */
        }
      }
    },
    [patchItem]
  );

  if (exportWarning && !warningAcked) {
    return (
      <div className="rounded-2xl border-2 border-amber-300 bg-amber-50 px-5 py-6 dark:border-amber-500/40 dark:bg-amber-500/10">
        <p className="text-sm font-semibold text-amber-800 dark:text-amber-200">
          Export-control warning
        </p>
        <p className="mt-1 text-sm text-amber-700 dark:text-amber-200/80">
          {exportWarning}
        </p>
        <button
          type="button"
          onClick={() => setWarningAcked(true)}
          className="btn btn-primary btn-sm mt-3 min-h-[44px]"
        >
          Controls confirmed — enable uploads
        </button>
      </div>
    );
  }

  return (
    <div>
      <div
        role="button"
        tabIndex={0}
        aria-label="Upload files"
        onClick={() => browseRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            browseRef.current?.click();
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (e.dataTransfer.files && e.dataTransfer.files.length) enqueue(e.dataTransfer.files);
        }}
        className={`cursor-pointer rounded-2xl border-2 border-dashed px-5 py-8 text-center transition ${
          dragging
            ? "border-[#b8975a] bg-[#b8975a]/10"
            : "border-slate-300 bg-slate-50/60 hover:border-[#b8975a]/70 dark:border-white/15 dark:bg-white/5"
        }`}
      >
        <p className="text-sm font-semibold text-[#0d1f3c] dark:text-white">Drag files here or click to browse</p>
        <p className="mt-1 text-xs text-slate-400 dark:text-white/40">Files upload in chunks and can be resumed if interrupted.</p>
      </div>

      <input
        ref={browseRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files) enqueue(e.target.files);
          e.target.value = "";
        }}
      />

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <label className="btn btn-secondary btn-sm min-h-[44px] cursor-pointer items-center">
          Take photo
          <input
            ref={photoRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => {
              if (e.target.files) enqueue(e.target.files);
              e.target.value = "";
            }}
          />
        </label>
        <button type="button" onClick={() => browseRef.current?.click()} className="btn btn-primary btn-sm min-h-[44px]">
          Browse files
        </button>
      </div>

      {items.length > 0 && (
        <ul className="mt-4 space-y-3">
          {items.map((item) => (
            <li key={item.id} className="rounded-xl border border-slate-200 px-3.5 py-3 dark:border-white/10">
              <div className="flex flex-wrap items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-[#0d1f3c] dark:text-white">{item.file.name}</span>
                <span className="text-xs text-slate-400 dark:text-white/40">{fmtBytes(item.file.size)}</span>
                <span className="text-xs font-semibold text-slate-500 dark:text-white/60">
                  {item.status === "done" ? "Done" : item.status === "error" ? "Failed" : item.status === "cancelled" ? "Cancelled" : `${item.progress}%`}
                </span>
                {(item.status === "uploading" || item.status === "pending") && (
                  <button type="button" onClick={() => void cancelItem(item)} className="btn btn-ghost btn-sm min-h-[44px]">
                    Cancel
                  </button>
                )}
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-white/10">
                <div className="h-full bg-[#b8975a] transition-all" style={{ width: `${item.progress}%` }} />
              </div>
              {item.error && <p className="mt-2 text-xs text-red-600 dark:text-red-300">{item.error}</p>}
              {item.duplicateOf && (
                <p className="mt-2 text-xs font-medium text-amber-700 dark:text-amber-300">
                  Duplicate warning: this file matches an existing document &ldquo;{item.duplicateOf.name}&rdquo;.
                </p>
              )}
              {item.status === "done" && !item.duplicateOf && (
                <p className="mt-2 text-xs text-emerald-700 dark:text-emerald-300">Uploaded successfully.</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

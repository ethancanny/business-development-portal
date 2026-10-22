"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Button, CardSkeleton, EmptyState, ErrorState } from "@/components/ui";
import { fmtDate, fmtRelTime } from "@/lib/format";
import DocumentUploader from "@/components/DocumentUploader";

interface DocumentRow {
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
interface VersionRow {
  id: string;
  documentId: string;
  version: number;
  sizeBytes: number;
  mime: string;
  contentHash: string;
  uploadedBy: string;
  note: string;
  createdAt: string;
}
interface DocDetail {
  document: DocumentRow;
  versions: VersionRow[];
  rooms: { roomId: string; roomName: string; folderId: string | null }[];
  textStatus: string;
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

const LIMIT = 25;

export default function DocumentsLibrary() {
  const [q, setQ] = useState("");
  const [mimeFilter, setMimeFilter] = useState("");
  const [tagFilter, setTagFilter] = useState("");
  const [items, setItems] = useState<DocumentRow[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [showDuplicates, setShowDuplicates] = useState(false);
  const [dupData, setDupData] = useState<{ byHash: { hash: string; documents: DocumentRow[] }[]; byName: { name: string; documents: DocumentRow[] }[] } | null>(null);
  const [dupLoading, setDupLoading] = useState(false);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<DocDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [tagsDraft, setTagsDraft] = useState("");
  const [savingTags, setSavingTags] = useState(false);
  const [textPreview, setTextPreview] = useState<{ status: string; text: string; note?: string } | null>(null);
  const [textLoading, setTextLoading] = useState(false);

  const loadList = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const params = new URLSearchParams();
      if (q.trim()) params.set("q", q.trim());
      if (mimeFilter.trim()) params.set("mime", mimeFilter.trim());
      if (tagFilter.trim()) params.set("tag", tagFilter.trim());
      params.set("limit", String(LIMIT));
      params.set("offset", String(offset));
      const res = await fetch(`/api/platform/documents?${params.toString()}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { items?: DocumentRow[]; total?: number };
      setItems(Array.isArray(data.items) ? data.items : []);
      setTotal(typeof data.total === "number" ? data.total : 0);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [q, mimeFilter, tagFilter, offset]);

  // Debounced reload when filters change (reset offset handled by callers)
  useEffect(() => {
    const t = window.setTimeout(() => void loadList(), 250);
    return () => window.clearTimeout(t);
  }, [loadList]);

  const loadDetail = useCallback(async (id: string) => {
    setDetailLoading(true);
    setTextPreview(null);
    try {
      const res = await fetch(`/api/platform/documents/${encodeURIComponent(id)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as DocDetail;
      setDetail(data);
      setTagsDraft((data.document?.tags ?? []).join(", "));
      // Auto text preview for non-previewable types
      const mime = data.document?.mime || "";
      const previewable = mime === "application/pdf" || mime.startsWith("image/");
      if (!previewable) {
        setTextLoading(true);
        try {
          const tr = await fetch(`/api/platform/documents/${encodeURIComponent(id)}/text`);
          if (tr.ok) {
            const tj = (await tr.json()) as { status: string; text: string; note?: string };
            setTextPreview(tj);
          }
        } catch {
          /* leave null */
        } finally {
          setTextLoading(false);
        }
      }
    } catch {
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  // Initial ?doc= and ?q=
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const docParam = params.get("doc");
    const qParam = params.get("q");
    if (qParam) setQ(qParam);
    if (docParam) {
      setSelectedId(docParam);
      void loadDetail(docParam);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openDoc = (id: string) => {
    setSelectedId(id);
    setShowDuplicates(false);
    void loadDetail(id);
  };

  const loadDuplicates = useCallback(async () => {
    setDupLoading(true);
    try {
      const res = await fetch("/api/platform/documents/duplicates");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { byHash?: { hash: string; documents: DocumentRow[] }[]; byName?: { name: string; documents: DocumentRow[] }[] };
      setDupData({ byHash: Array.isArray(data.byHash) ? data.byHash : [], byName: Array.isArray(data.byName) ? data.byName : [] });
    } catch {
      setDupData({ byHash: [], byName: [] });
    } finally {
      setDupLoading(false);
    }
  }, []);

  useEffect(() => {
    if (showDuplicates) void loadDuplicates();
  }, [showDuplicates, loadDuplicates]);

  const saveTags = async () => {
    if (!detail) return;
    setSavingTags(true);
    try {
      const tags = tagsDraft.split(",").map((s) => s.trim()).filter(Boolean);
      const res = await fetch(`/api/platform/documents/${encodeURIComponent(detail.document.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tags }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await loadDetail(detail.document.id);
      await loadList();
    } catch {
      /* ignore */
    } finally {
      setSavingTags(false);
    }
  };

  const deleteDoc = async () => {
    if (!detail) return;
    if (!window.confirm(`Delete "${detail.document.name}"? This is a soft delete.`)) return;
    try {
      const res = await fetch(`/api/platform/documents/${encodeURIComponent(detail.document.id)}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setDetail(null);
      setSelectedId(null);
      await loadList();
    } catch {
      /* ignore */
    }
  };

  const rerunExtraction = async () => {
    if (!detail) return;
    try {
      await fetch(`/api/platform/documents/${encodeURIComponent(detail.document.id)}/extract`, { method: "POST" });
      await loadDetail(detail.document.id);
    } catch {
      /* ignore */
    }
  };

  const restoreVersion = async (version: number) => {
    if (!detail) return;
    try {
      const res = await fetch(`/api/platform/documents/${encodeURIComponent(detail.document.id)}/restore`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await loadDetail(detail.document.id);
      await loadList();
    } catch {
      /* ignore */
    }
  };

  const fetchText = async () => {
    if (!detail) return;
    setTextLoading(true);
    try {
      const res = await fetch(`/api/platform/documents/${encodeURIComponent(detail.document.id)}/text`);
      if (res.ok) setTextPreview((await res.json()) as { status: string; text: string; note?: string });
    } catch {
      /* ignore */
    } finally {
      setTextLoading(false);
    }
  };

  const doc = detail?.document;
  const isPreviewable = doc ? doc.mime === "application/pdf" || (doc.mime || "").startsWith("image/") : false;

  return (
    <div>
      {/* Toolbar */}
      <div className={cardCls}>
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <label className={labelCls} htmlFor="doc-search">Search</label>
            <input
              id="doc-search"
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setOffset(0);
              }}
              placeholder="Search documents..."
              className={inputCls}
            />
          </div>
          <div>
            <label className={labelCls} htmlFor="doc-mime">Mime type</label>
            <input
              id="doc-mime"
              value={mimeFilter}
              onChange={(e) => {
                setMimeFilter(e.target.value);
                setOffset(0);
              }}
              placeholder="e.g. application/pdf"
              className={inputCls}
            />
          </div>
          <div>
            <label className={labelCls} htmlFor="doc-tag">Tag</label>
            <input
              id="doc-tag"
              value={tagFilter}
              onChange={(e) => {
                setTagFilter(e.target.value);
                setOffset(0);
              }}
              placeholder="Filter by tag"
              className={inputCls}
            />
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button
            variant={showDuplicates ? "primary" : "secondary"}
            onClick={() => setShowDuplicates((s) => !s)}
            className="min-h-[44px]"
          >
            Duplicates
          </Button>
          <Button onClick={() => setShowUpload((s) => !s)} className="min-h-[44px]">
            Upload
          </Button>
          <span className="ml-auto self-center text-xs text-slate-400 dark:text-white/40">
            {total} document{total === 1 ? "" : "s"}
          </span>
        </div>
        {showUpload && (
          <div className="mt-4 border-t border-slate-100 pt-4 dark:border-white/5">
            <DocumentUploader
              onUploaded={(result) => {
                void loadList();
                if (result.document?.id) openDoc(result.document.id);
              }}
            />
          </div>
        )}
      </div>

      {/* Duplicates view */}
      {showDuplicates ? (
        <div className={`${cardCls} mt-5`}>
          <h2 className="font-display text-xl font-semibold text-[#0d1f3c] dark:text-white">Duplicates</h2>
          {dupLoading ? (
            <div className="mt-4">
              <CardSkeleton lines={4} />
            </div>
          ) : !dupData || (dupData.byHash.length === 0 && dupData.byName.length === 0) ? (
            <p className="mt-3 text-sm text-slate-400 dark:text-white/40">No duplicates found.</p>
          ) : (
            <div className="mt-4 space-y-6">
              <div>
                <h3 className="text-sm font-bold uppercase tracking-wide text-[#0d1f3c] dark:text-white">Identical files</h3>
                {dupData.byHash.length === 0 ? (
                  <p className="mt-2 text-sm text-slate-400 dark:text-white/40">None.</p>
                ) : (
                  <div className="mt-2 space-y-3">
                    {dupData.byHash.map((g) => (
                      <div key={g.hash} className="rounded-xl border border-slate-100 px-3 py-2 dark:border-white/5">
                        <p className="truncate text-xs text-slate-400 dark:text-white/40">Hash: {g.hash}</p>
                        <ul className="mt-1 space-y-1">
                          {g.documents.map((d) => (
                            <li key={d.id}>
                              <button type="button" onClick={() => openDoc(d.id)} className="text-sm font-medium text-[#0d1f3c] hover:text-[#b8975a] dark:text-white">
                                {d.name}
                              </button>{" "}
                              <span className="text-xs text-slate-400 dark:text-white/40">{fmtBytes(d.sizeBytes)} · v{d.currentVersion}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div>
                <h3 className="text-sm font-bold uppercase tracking-wide text-[#0d1f3c] dark:text-white">Same name, different content</h3>
                {dupData.byName.length === 0 ? (
                  <p className="mt-2 text-sm text-slate-400 dark:text-white/40">None.</p>
                ) : (
                  <div className="mt-2 space-y-3">
                    {dupData.byName.map((g) => (
                      <div key={g.name} className="rounded-xl border border-slate-100 px-3 py-2 dark:border-white/5">
                        <p className="text-sm font-semibold text-[#0d1f3c] dark:text-white">{g.name}</p>
                        <ul className="mt-1 space-y-1">
                          {g.documents.map((d) => (
                            <li key={d.id}>
                              <button type="button" onClick={() => openDoc(d.id)} className="text-sm font-medium text-[#0d1f3c] hover:text-[#b8975a] dark:text-white">
                                {d.name}
                              </button>{" "}
                              <span className="text-xs text-slate-400 dark:text-white/40">{fmtBytes(d.sizeBytes)} · {d.updatedAt ? fmtDate(d.updatedAt) : ""}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      ) : (
        <>
          {/* List */}
          <div className="mt-5">
            {loading ? (
              <div className="space-y-3" aria-busy="true">
                {Array.from({ length: 4 }).map((_, i) => (
                  <CardSkeleton key={i} lines={2} />
                ))}
              </div>
            ) : error ? (
              <ErrorState title="Could not load documents" message="The documents library could not be loaded. Try again." onRetry={() => void loadList()} />
            ) : items.length === 0 ? (
              <EmptyState title="No documents found" message="No documents match this search. Upload a document or clear the filters." actionLabel="Upload" onAction={() => setShowUpload(true)} />
            ) : (
              <>
                <div className={`${cardCls} !p-0 overflow-hidden`}>
                  <ul className="divide-y divide-slate-100 dark:divide-white/5">
                    {items.map((d) => (
                      <li key={d.id}>
                        <button type="button" onClick={() => openDoc(d.id)} className={`flex w-full min-h-[44px] flex-col gap-1 px-5 py-3.5 text-left transition hover:bg-[#f0f4fa] dark:hover:bg-white/5 sm:flex-row sm:items-center sm:gap-3 ${selectedId === d.id ? "bg-[#b8975a]/10" : ""}`}>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-semibold text-[#0d1f3c] dark:text-white">{d.name}</span>
                            <span className="block truncate text-xs text-slate-400 dark:text-white/40">
                              {[d.dealName, d.companyName].filter(Boolean).join(" · ") || "No deal/company"}
                            </span>
                          </span>
                          <span className="flex flex-wrap items-center gap-2 text-xs text-slate-400 dark:text-white/40">
                            <span>{d.mime || "—"}</span>
                            <span>{fmtBytes(d.sizeBytes)}</span>
                            <span>v{d.currentVersion}</span>
                            {d.extractionStatus && <span className="rounded-full bg-slate-100 px-2 py-0.5 font-semibold capitalize dark:bg-white/10 dark:text-white/70">{d.extractionStatus}</span>}
                            <span>{d.updatedAt ? fmtRelTime(d.updatedAt) : ""}</span>
                          </span>
                          {d.tags && d.tags.length > 0 && (
                            <span className="flex flex-wrap gap-1">
                              {d.tags.map((t) => (
                                <span key={t} className="rounded-full border border-slate-200 px-2 py-0.5 text-[11px] text-slate-500 dark:border-white/10 dark:text-white/60">
                                  {t}
                                </span>
                              ))}
                            </span>
                          )}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="mt-4 flex items-center justify-between gap-2">
                  <Button variant="secondary" disabled={offset === 0} onClick={() => setOffset((o) => Math.max(0, o - LIMIT))} className="min-h-[44px]">
                    Prev
                  </Button>
                  <span className="text-xs text-slate-400 dark:text-white/40">
                    Showing {items.length ? offset + 1 : 0}–{offset + items.length} of {total}
                  </span>
                  <Button variant="secondary" disabled={offset + items.length >= total} onClick={() => setOffset((o) => o + LIMIT)} className="min-h-[44px]">
                    Next
                  </Button>
                </div>
              </>
            )}
          </div>

          {/* Detail panel */}
          {selectedId && (
            <div className={`${cardCls} mt-5`}>
              {detailLoading ? (
                <CardSkeleton lines={5} />
              ) : !doc ? (
                <ErrorState title="Could not load this document" message="The document detail could not be loaded." onRetry={() => selectedId && void loadDetail(selectedId)} />
              ) : (
                <div>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h2 className="font-display text-2xl font-semibold text-[#0d1f3c] dark:text-white">{doc.name}</h2>
                      <p className="mt-1 text-sm text-slate-500 dark:text-white/60">
                        {[doc.dealName, doc.companyName].filter(Boolean).join(" · ") || ""}
                      </p>
                    </div>
                    <button type="button" onClick={() => { setSelectedId(null); setDetail(null); }} className="btn btn-ghost btn-sm min-h-[44px]">
                      Close
                    </button>
                  </div>

                  <dl className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {[
                      ["Type", doc.mime || "—"],
                      ["Size", fmtBytes(doc.sizeBytes)],
                      ["Version", `v${doc.currentVersion}`],
                      ["Extraction", doc.extractionStatus || detail.textStatus || "—"],
                      ["Source", doc.source || "—"],
                      ["Created", doc.createdAt ? fmtDate(doc.createdAt) : "—"],
                      ["Updated", doc.updatedAt ? fmtDate(doc.updatedAt) : "—"],
                      ["Company", doc.companyName || "—"],
                      ["Deal", doc.dealName || "—"],
                    ].map(([k, v]) => (
                      <div key={k}>
                        <dt className={labelCls}>{k}</dt>
                        <dd className="text-sm text-[#0d1f3c] dark:text-white">{v}</dd>
                      </div>
                    ))}
                  </dl>

                  {detail.rooms && detail.rooms.length > 0 && (
                    <div className="mt-4">
                      <p className={labelCls}>In rooms</p>
                      <div className="flex flex-wrap gap-1.5">
                        {detail.rooms.map((r) => (
                          <Link key={`${r.roomId}-${r.folderId || ""}`} href={`/data-rooms/${r.roomId}`} className="chip">
                            {r.roomName}
                          </Link>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="mt-4">
                    <label className={labelCls} htmlFor="doc-tags">Tags (comma-separated)</label>
                    <div className="flex flex-wrap gap-2">
                      <input id="doc-tags" value={tagsDraft} onChange={(e) => setTagsDraft(e.target.value)} className={`${inputCls} min-w-0 flex-1`} placeholder="cim, financials, tax" />
                      <Button variant="secondary" onClick={() => void saveTags()} disabled={savingTags} className="min-h-[44px]">
                        {savingTags ? "Saving..." : "Save tags"}
                      </Button>
                    </div>
                    {doc.tags && doc.tags.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {doc.tags.map((t) => (
                          <span key={t} className="rounded-full border border-slate-200 px-2 py-0.5 text-[11px] text-slate-500 dark:border-white/10 dark:text-white/60">
                            {t}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Preview */}
                  <div className="mt-5">
                    <p className={labelCls}>Preview</p>
                    {isPreviewable ? (
                      doc.mime === "application/pdf" ? (
                        <iframe title={doc.name} src={`/api/platform/documents/${encodeURIComponent(doc.id)}/file`} className="h-[520px] w-full rounded-xl border border-slate-200 dark:border-white/10" />
                      ) : (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={`/api/platform/documents/${encodeURIComponent(doc.id)}/file`} alt={doc.name} className="max-h-[520px] w-full rounded-xl border border-slate-200 object-contain dark:border-white/10" />
                      )
                    ) : (
                      <div>
                        {textLoading ? (
                          <p className="text-sm text-slate-400 dark:text-white/40">Loading text preview...</p>
                        ) : textPreview ? (
                          textPreview.text ? (
                            <pre className="max-h-[520px] overflow-auto whitespace-pre-wrap rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs leading-relaxed text-[#0d1f3c] dark:border-white/10 dark:bg-white/5 dark:text-white/85">{textPreview.text}</pre>
                          ) : (
                            <p className="text-sm text-slate-500 dark:text-white/60">{textPreview.note || `No extracted text available (status: ${textPreview.status}).`}</p>
                          )
                        ) : (
                          <Button variant="secondary" onClick={() => void fetchText()} className="min-h-[44px]">
                            Load text preview
                          </Button>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="mt-4 flex flex-wrap gap-2">
                    <a href={`/api/platform/documents/${encodeURIComponent(doc.id)}/file?dl=1`} className="btn btn-primary min-h-[44px]">
                      Download
                    </a>
                    <Button variant="secondary" onClick={() => void rerunExtraction()} className="min-h-[44px]">
                      Re-run extraction
                    </Button>
                    <Button variant="danger" onClick={() => void deleteDoc()} className="min-h-[44px]">
                      Delete
                    </Button>
                  </div>

                  {/* Versions */}
                  <div className="mt-6">
                    <h3 className="text-sm font-bold uppercase tracking-wide text-[#0d1f3c] dark:text-white">Versions</h3>
                    {detail.versions.length === 0 ? (
                      <p className="mt-2 text-sm text-slate-400 dark:text-white/40">No versions recorded.</p>
                    ) : (
                      <ul className="mt-2 divide-y divide-slate-100 dark:divide-white/5">
                        {detail.versions.map((v) => {
                          const isCurrent = v.version === doc.currentVersion;
                          return (
                            <li key={v.id} className="flex flex-wrap items-center gap-2 py-2.5 text-sm">
                              <span className="font-semibold text-[#0d1f3c] dark:text-white">v{v.version}</span>
                              <span className="text-xs text-slate-400 dark:text-white/40">{fmtBytes(v.sizeBytes)}</span>
                              <span className="text-xs text-slate-400 dark:text-white/40">{v.uploadedBy || "—"}</span>
                              <span className="text-xs text-slate-400 dark:text-white/40">{v.createdAt ? fmtDate(v.createdAt) : ""}</span>
                              {v.note && <span className="text-xs text-slate-500 dark:text-white/60">{v.note}</span>}
                              {isCurrent && <span className="rounded-full bg-[#b8975a] px-2 py-0.5 text-xs font-bold text-[#0d1f3c]">Current</span>}
                              <span className="ml-auto flex gap-1.5">
                                <a href={`/api/platform/documents/${encodeURIComponent(doc.id)}/file?version=${v.version}`} target="_blank" rel="noreferrer" className="btn btn-secondary btn-sm min-h-[44px]">
                                  View
                                </a>
                                {!isCurrent && (
                                  <Button size="sm" variant="ghost" onClick={() => void restoreVersion(v.version)} className="min-h-[44px]">
                                    Restore
                                  </Button>
                                )}
                              </span>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>

                  <div className="mt-6 border-t border-slate-100 pt-4 dark:border-white/5">
                    <p className={labelCls}>Upload new version</p>
                    <DocumentUploader
                      documentId={doc.id}
                      onUploaded={() => {
                        void loadDetail(doc.id);
                        void loadList();
                      }}
                    />
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

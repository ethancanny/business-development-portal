"use client";

/**
 * Directory detail slide-over (Phase 2, Oct 21, 2026).
 *
 * Pull-up / slide-over panel for one unified directory record
 * (core.people or core.organizations): full record, type-tag editor,
 * edit form, linked deals, the legacy investor block (investment
 * fields projected from the old Investors tab), an email-links
 * section, source + last-updated, and the shared Comments thread.
 */

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import CompanyMark from "@/components/identity/CompanyMark";
import ConfirmDealDialog from "@/components/identity/ConfirmDealDialog";
import PersonAvatar from "@/components/PersonAvatar";
import { ErrorState, SkeletonRows } from "@/components/ui";
import Comments from "@/components/Comments";
import CapitalProfileTab from "@/components/directory/CapitalProfileTab";
import {
  DIRECTORY_TYPES,
  KindBadge,
  TypeBadge,
  typeLabel,
  isOverdueItem,
  type DirectoryDetailPayload,
  type DirectoryKind,
  type RelationshipProfile,
  type TimelineItem,
} from "@/components/DirectoryUnified";
import { fmtDate } from "@/lib/format";

interface EmailLink {
  id: string;
  emailRef?: string | null;
  subject?: string | null;
  fromAddr?: string | null;
  emailDate?: string | null;
  personId?: string | null;
  organizationId?: string | null;
  companyId?: string | null;
  note?: string | null;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-white/40">
        {label}
      </p>
      <div className="mt-0.5 break-words text-sm font-medium text-[#0d1f3c] dark:text-white">
        {children}
      </div>
    </div>
  );
}

const inputCls =
  "w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-[#0d1f3c] outline-none placeholder:text-slate-300 focus:border-[#b8975a] dark:border-white/10 dark:bg-white/5 dark:text-white dark:placeholder:text-white/30";
const labelCls =
  "mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-white/40";

function normalizeEmailLinks(data: unknown): EmailLink[] {
  if (Array.isArray(data)) return data as EmailLink[];
  if (data && typeof data === "object") {
    const obj = data as Record<string, unknown>;
    if (Array.isArray(obj.items)) return obj.items as EmailLink[];
    if (Array.isArray(obj.links)) return obj.links as EmailLink[];
    if (Array.isArray(obj.emailLinks)) return obj.emailLinks as EmailLink[];
  }
  return [];
}

export default function DirectoryDetail({
  kind,
  id,
  onClose,
  onChanged,
}: {
  kind: DirectoryKind;
  id: string;
  onClose: () => void;
  onChanged?: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [payload, setPayload] = useState<DirectoryDetailPayload | null>(null);
  const [reloadTick, setReloadTick] = useState(0);
  // Capital profile tab (Investors & Capital Redesign Step 1, Oct 25,
  // 2026): investors live only in the Directory — every person and
  // organization record carries this tab alongside its record view.
  const [tab, setTab] = useState<"record" | "capital">("record");

  // Edit form state (seeded from the loaded record).
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    name: "",
    title: "",
    email: "",
    phone: "",
    organizationName: "",
    website: "",
    notes: "",
  });
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");

  const [typeToAdd, setTypeToAdd] = useState("");
  const [typeBusy, setTypeBusy] = useState(false);

  const [emailLinks, setEmailLinks] = useState<EmailLink[]>([]);
  const [emailForm, setEmailForm] = useState({
    emailRef: "",
    subject: "",
    fromAddr: "",
    emailDate: "",
    note: "",
  });
  const [emailBusy, setEmailBusy] = useState(false);
  const [emailMsg, setEmailMsg] = useState("");

  /* ---- CRM Phase 1: relationship + timeline ---- */
  const [relForm, setRelForm] = useState<{
    tier: string; stage: string; cadenceDays: string; owner: string;
    source: string; introducedByPersonId: string; commPrefs: string;
    adCertifications: string; adItar: string; adClearance: string; adPrimeCustomers: string;
    importantDates: { label: string; date: string }[];
  }>({ tier: "", stage: "New", cadenceDays: "", owner: "", source: "", introducedByPersonId: "", commPrefs: "", adCertifications: "", adItar: "", adClearance: "", adPrimeCustomers: "", importantDates: [] });
  const [relTags, setRelTags] = useState<string[]>([]);
  const [tagDraft, setTagDraft] = useState("");
  const [relSaving, setRelSaving] = useState(false);
  const [relMsg, setRelMsg] = useState("");
  const [introQ, setIntroQ] = useState("");
  const [introResults, setIntroResults] = useState<{ id: string; name: string }[]>([]);
  const [introName, setIntroName] = useState("");
  const [timeline, setTimeline] = useState<TimelineItem[]>([]);
  const [timelineFilter, setTimelineFilter] = useState("All");
  const [timelineOffset, setTimelineOffset] = useState(0);
  const [timelineHasMore, setTimelineHasMore] = useState(false);
  const [timelineBusy, setTimelineBusy] = useState(false);
  const [openTasks, setOpenTasks] = useState<TimelineItem[]>([]);
  const [relatedPeople, setRelatedPeople] = useState<{ id: string; name: string; sub?: string }[]>([]);

  const [confirmingDelete, setConfirmingDelete] = useState(false);
  /** Wrong-deal protection (Deal Identity, Oct 24, 2026): deleting an
   *  ORGANIZATION record goes through the naming dialog. */
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteMsg, setDeleteMsg] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(false);
    setTab("record");
    setEditing(false);
    setSaveMsg("");
    setConfirmingDelete(false);
    setDeleteMsg("");
    (async () => {
      try {
        const r = await fetch(
          `/api/platform/directory/record/${kind}/${encodeURIComponent(id)}`
        );
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const data = (await r.json()) as DirectoryDetailPayload;
        if (cancelled) return;
        if (!data || !data.record) throw new Error("bad payload");
        setPayload({
          record: data.record,
          types: Array.isArray(data.types) ? data.types : [],
          linkedDeals: Array.isArray(data.linkedDeals) ? data.linkedDeals : [],
          legacyInvestor: data.legacyInvestor ?? null,
          relationship: data.relationship ?? null,
          tags: Array.isArray(data.tags) ? data.tags : [],
        });
        // Seed the relationship editor from the detail payload.
        const rel = data.relationship ?? null;
        setRelForm({
          tier: rel?.tier ?? "",
          stage: rel?.stage ?? "New",
          cadenceDays: rel?.cadenceDays != null ? String(rel.cadenceDays) : "",
          owner: rel?.owner ?? "",
          source: rel?.source ?? "",
          introducedByPersonId: rel?.introducedByPersonId ?? "",
          commPrefs: rel?.commPrefs ?? "",
          adCertifications: rel?.adCertifications ?? "",
          adItar: rel?.adItar ?? "",
          adClearance: rel?.adClearance ?? "",
          adPrimeCustomers: rel?.adPrimeCustomers ?? "",
          importantDates: Array.isArray(rel?.importantDates) ? rel!.importantDates : [],
        });
        setRelTags(Array.isArray(data.tags) ? data.tags : []);
        setRelMsg("");
        const rec = data.record;
        setForm({
          name: rec.name || "",
          title: rec.title || "",
          email: rec.email || "",
          phone: rec.phone || "",
          organizationName: rec.organizationName || "",
          website: rec.website || "",
          notes: rec.notes || "",
        });
      } catch {
        if (!cancelled) setError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [kind, id, reloadTick]);

  const loadEmailLinks = async () => {
    try {
      const qs =
        kind === "person"
          ? `?personId=${encodeURIComponent(id)}`
          : `?organizationId=${encodeURIComponent(id)}`;
      const r = await fetch(`/api/platform/directory/email-links${qs}`);
      if (!r.ok) return;
      const all = normalizeEmailLinks(await r.json());
      // The endpoint may return every link; keep only this record's.
      const mine = all.filter((l) =>
        kind === "person"
          ? !l.personId || l.personId === id
          : !l.organizationId || l.organizationId === id
      );
      // If the endpoint ignored the filter and returned other records'
      // links too, the strict pass above could keep unscoped rows —
      // prefer exact matches when any exist.
      const exact = all.filter((l) =>
        kind === "person" ? l.personId === id : l.organizationId === id
      );
      setEmailLinks(exact.length > 0 || all.length > 0 ? (exact.length > 0 ? exact : mine) : []);
    } catch {
      /* email links are an enhancement — never break the record */
    }
  };

  useEffect(() => {
    void loadEmailLinks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, id]);

  /* ---- CRM Phase 1 data: timeline / tasks / related people ---- */
  const TIMELINE_FILTERS: { label: string; kinds: string; type?: string }[] = [
    { label: "All", kinds: "" },
    { label: "Interactions", kinds: "interaction" },
    { label: "Calls", kinds: "interaction", type: "call" },
    { label: "Meetings", kinds: "interaction", type: "meeting" },
    { label: "Emails", kinds: "email" },
    { label: "Tasks", kinds: "task" },
    { label: "Documents", kinds: "document" },
    { label: "Events", kinds: "event" },
  ];

  const fetchTimeline = async (offset: number, append: boolean) => {
    const f = TIMELINE_FILTERS.find((x) => x.label === timelineFilter) ?? TIMELINE_FILTERS[0];
    setTimelineBusy(true);
    try {
      const params = new URLSearchParams({ limit: "20", offset: String(offset) });
      if (f.kinds) params.set("kinds", f.kinds);
      const r = await fetch(
        `/api/platform/directory/record/${kind}/${encodeURIComponent(id)}/timeline?${params.toString()}`
      );
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data: unknown = await r.json().catch(() => null);
      const raw: TimelineItem[] =
        data && typeof data === "object" && Array.isArray((data as { items?: unknown }).items)
          ? ((data as { items: TimelineItem[] }).items)
          : Array.isArray(data) ? (data as TimelineItem[]) : [];
      const items = f.type
        ? raw.filter((it) => !it.type || it.type === f.type)
        : raw;
      setTimelineHasMore(raw.length >= 20);
      setTimelineOffset(offset);
      setTimeline((prev) => (append ? [...prev, ...items] : items));
    } catch {
      if (!append) setTimeline([]);
      setTimelineHasMore(false);
    } finally { setTimelineBusy(false); }
  };

  useEffect(() => {
    if (!payload) return;
    void fetchTimeline(0, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, id, timelineFilter, payload?.record?.id]);

  useEffect(() => {
    if (!payload) return;
    let cancelled = false;
    (async () => {
      try {
        const params = new URLSearchParams({ kinds: "task", limit: "50", offset: "0" });
        const r = await fetch(
          `/api/platform/directory/record/${kind}/${encodeURIComponent(id)}/timeline?${params.toString()}`
        );
        if (!r.ok || cancelled) return;
        const data: unknown = await r.json().catch(() => null);
        const items: TimelineItem[] =
          data && typeof data === "object" && Array.isArray((data as { items?: unknown }).items)
            ? ((data as { items: TimelineItem[] }).items)
            : [];
        if (!cancelled) setOpenTasks(items.filter((it) => it.done !== true));
      } catch { /* side panel is an enhancement */ }
    })();
    return () => { cancelled = true; };
  }, [kind, id, payload]);

  // Related people: same organization (people) / people at org (orgs),
  // plus the introduced-by person when set.
  useEffect(() => {
    if (!payload) return;
    let cancelled = false;
    (async () => {
      const out: { id: string; name: string; sub?: string }[] = [];
      const orgName = kind === "person" ? payload.record.organizationName : payload.record.name;
      if (orgName) {
        try {
          const params = new URLSearchParams({ kind: "person", q: String(orgName), limit: "20", offset: "0" });
          const r = await fetch(`/api/platform/directory?${params.toString()}`);
          if (r.ok) {
            const data: unknown = await r.json().catch(() => null);
            const items = data && typeof data === "object" && Array.isArray((data as { items?: unknown }).items)
              ? ((data as { items: Array<Record<string, unknown>> }).items) : [];
            for (const it of items) {
              if (String(it.id) === id) continue;
              const matchesOrg = kind === "organization"
                || String(it.organizationName ?? "").toLowerCase() === String(orgName).toLowerCase();
              if (matchesOrg) out.push({ id: String(it.id), name: String(it.name ?? ""), sub: String(it.title ?? "") || undefined });
              if (out.length >= 8) break;
            }
          }
        } catch { /* related people are an enhancement */ }
      }
      const introId = payload.relationship?.introducedByPersonId;
      if (introId && !cancelled) {
        try {
          const r = await fetch(`/api/platform/directory/record/person/${encodeURIComponent(introId)}`);
          if (r.ok) {
            const d: unknown = await r.json().catch(() => null);
            const rec = d && typeof d === "object" ? (d as { record?: { name?: string } }).record : null;
            if (rec?.name) {
              setIntroName(rec.name);
              if (!out.some((o) => o.id === introId)) out.unshift({ id: introId, name: rec.name, sub: "Introduced by" });
            }
          }
        } catch { /* optional */ }
      }
      if (!cancelled) setRelatedPeople(out);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, id, payload?.record?.id]);

  // Introduced-by search
  useEffect(() => {
    const q = introQ.trim();
    if (!q) { setIntroResults([]); return; }
    let cancelled = false;
    const t = window.setTimeout(() => {
      (async () => {
        try {
          const params = new URLSearchParams({ kind: "person", q, limit: "8", offset: "0" });
          const r = await fetch(`/api/platform/directory?${params.toString()}`);
          if (!r.ok || cancelled) return;
          const data: unknown = await r.json().catch(() => null);
          const items = data && typeof data === "object" && Array.isArray((data as { items?: unknown }).items)
            ? ((data as { items: Array<Record<string, unknown>> }).items) : [];
          if (!cancelled) setIntroResults(items.map((it) => ({ id: String(it.id), name: String(it.name ?? "") })).filter((x) => x.id && x.id !== id));
        } catch { /* best-effort */ }
      })();
    }, 200);
    return () => { cancelled = true; window.clearTimeout(t); };
  }, [introQ, id]);

  const saveRelationship = async () => {
    if (relSaving) return;
    setRelSaving(true);
    setRelMsg("");
    try {
      const patch: Record<string, unknown> = {
        tier: relForm.tier,
        stage: relForm.stage,
        cadenceDays: relForm.cadenceDays.trim() === "" ? null : Number(relForm.cadenceDays),
        owner: relForm.owner,
        source: relForm.source,
        introducedByPersonId: relForm.introducedByPersonId || null,
        commPrefs: relForm.commPrefs,
        adCertifications: relForm.adCertifications,
        adItar: relForm.adItar,
        adClearance: relForm.adClearance,
        adPrimeCustomers: relForm.adPrimeCustomers,
        importantDates: relForm.importantDates.filter((d) => d.label.trim() || d.date),
        tags: relTags,
      };
      const r = await fetch(
        `/api/platform/directory/record/${kind}/${encodeURIComponent(id)}/relationship`,
        { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) }
      );
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data: unknown = await r.json().catch(() => null);
      const rel = (data && typeof data === "object"
        ? ((data as { relationship?: RelationshipProfile }).relationship ?? (data as RelationshipProfile))
        : null) as RelationshipProfile | null;
      setPayload((prev) => prev ? {
        ...prev,
        relationship: rel && typeof rel === "object" && "tier" in rel ? rel : prev.relationship,
        tags: relTags,
      } : prev);
      setRelMsg("Relationship saved.");
      if (onChanged) onChanged();
    } catch {
      setRelMsg("Could not save the relationship — please try again.");
    } finally { setRelSaving(false); }
  };

  const record = payload?.record ?? null;
  const types = payload?.types ?? [];
  const linkedDeals = payload?.linkedDeals ?? [];
  const legacy = payload?.legacyInvestor ?? null;

  const changeType = async (type: string, action: "add" | "remove") => {
    if (!type || typeBusy) return;
    setTypeBusy(true);
    try {
      const r = await fetch("/api/platform/directory/types", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entityKind: kind, entityId: id, type, action }),
      });
      if (r.ok) {
        setPayload((p) => {
          if (!p) return p;
          const next =
            action === "add"
              ? p.types.indexOf(type) >= 0
                ? p.types
                : [...p.types, type]
              : p.types.filter((t) => t !== type);
          return { ...p, types: next };
        });
        if (action === "add") setTypeToAdd("");
        if (onChanged) onChanged();
      }
    } catch {
      /* leave tags as-is on failure */
    } finally {
      setTypeBusy(false);
    }
  };

  const saveEdit = async () => {
    if (!form.name.trim() || saving) return;
    setSaving(true);
    setSaveMsg("");
    try {
      const r = await fetch("/api/platform/directory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id,
          kind,
          name: form.name.trim(),
          title: form.title.trim() || undefined,
          email: form.email.trim() || undefined,
          phone: form.phone.trim() || undefined,
          organizationName: form.organizationName.trim() || undefined,
          website: form.website.trim() || undefined,
          notes: form.notes,
        }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setSaveMsg("Saved.");
      setEditing(false);
      setReloadTick((t) => t + 1);
      if (onChanged) onChanged();
    } catch {
      setSaveMsg("Could not save — please try again.");
    } finally {
      setSaving(false);
    }
  };

  const addEmailLink = async () => {
    if (emailBusy) return;
    if (!emailForm.subject.trim() && !emailForm.emailRef.trim()) {
      setEmailMsg("Add a subject or an email reference first.");
      return;
    }
    setEmailBusy(true);
    setEmailMsg("");
    try {
      const r = await fetch("/api/platform/directory/email-links", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          emailRef: emailForm.emailRef.trim(),
          subject: emailForm.subject.trim(),
          fromAddr: emailForm.fromAddr.trim(),
          emailDate: emailForm.emailDate || undefined,
          personId: kind === "person" ? id : undefined,
          organizationId: kind === "organization" ? id : undefined,
          note: emailForm.note.trim(),
        }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setEmailForm({ emailRef: "", subject: "", fromAddr: "", emailDate: "", note: "" });
      setEmailMsg("Email link added.");
      await loadEmailLinks();
    } catch {
      setEmailMsg("Could not add the email link.");
    } finally {
      setEmailBusy(false);
    }
  };

  const deleteThisRecord = async () => {
    if (deleting) return;
    setDeleting(true);
    setDeleteMsg("");
    try {
      const r = await fetch(
        `/api/platform/directory/record/${kind}/${encodeURIComponent(id)}`,
        { method: "DELETE" }
      );
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      if (onChanged) onChanged();
      onClose();
    } catch {
      setDeleteMsg("Could not delete — please try again.");
      setDeleting(false);
    }
  };

  const availableTypes = DIRECTORY_TYPES.filter((t) => types.indexOf(t.id) < 0);
  const websiteHref = record?.website
    ? /^https?:\/\//i.test(record.website)
      ? record.website
      : `https://${record.website}`
    : "";

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true">
      <button
        type="button"
        aria-label="Close record"
        onClick={onClose}
        className="absolute inset-0 h-full w-full bg-[#0d1f3c]/50"
      />
      <aside className="absolute inset-y-0 right-0 flex w-full max-w-[560px] flex-col bg-white shadow-2xl dark:bg-[#0f2242]">
        <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-3.5 dark:border-white/10">
          <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-white/40">
            Directory record
          </p>
          <button
            type="button"
            onClick={onClose}
            className="btn btn-secondary btn-sm"
          >
            Close
          </button>
        </div>

        <div
          className="flex flex-wrap gap-1.5 border-b border-slate-100 px-5 py-2.5 dark:border-white/10"
          role="tablist"
          aria-label="Record sections"
        >
          <button
            type="button"
            role="tab"
            aria-selected={tab === "record"}
            onClick={() => setTab("record")}
            className={`chip ${tab === "record" ? "chip-active" : ""}`}
          >
            Record
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "capital"}
            onClick={() => setTab("capital")}
            className={`chip ${tab === "capital" ? "chip-active" : ""}`}
          >
            Capital profile
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
          {tab === "capital" ? (
            <CapitalProfileTab recordId={id} kind={kind} onChanged={onChanged} />
          ) : loading ? (
            <SkeletonRows rows={6} />
          ) : error || !record ? (
            <ErrorState
              title="Could not load this record"
              message="The record could not be loaded — the database may be unavailable. Try again in a moment."
              onRetry={() => setReloadTick((t) => t + 1)}
            />
          ) : (
            <>
              {/* Header */}
              <div className="flex flex-wrap items-center gap-2">
                <KindBadge kind={kind} />
                {types.map((t) => (
                  <TypeBadge key={t} typeId={t} />
                ))}
                {payload?.relationship?.tier && (
                  <span className="chip">Tier {payload.relationship.tier}</span>
                )}
                {payload?.relationship?.stage && (
                  <span className="chip">{payload.relationship.stage}</span>
                )}
                {payload?.relationship?.owner && (
                  <span className="chip">Owner: {payload.relationship.owner}</span>
                )}
              </div>
              <h3 className="mt-3 flex items-center gap-3 text-2xl font-bold text-[#0d1f3c] dark:text-white">
                {kind === "organization" ? (
                  <CompanyMark
                    companyId={record.id}
                    name={record.name}
                    logoVersion={typeof record.logoVersion === "number" ? record.logoVersion : 0}
                    size={40}
                  />
                ) : (
                  <PersonAvatar
                    name={record.name}
                    photoUrl={record.photoUrl || undefined}
                    size={40}
                  />
                )}
                <span className="min-w-0 break-words">{record.name}</span>
              </h3>
              {(record.title || record.organizationName) && (
                <p className="mt-0.5 text-sm text-slate-500 dark:text-white/60">
                  {[record.title, record.organizationName]
                    .filter((s) => s && String(s).trim())
                    .join(" · ")}
                </p>
              )}
              {kind === "person" && record.photoUrl && (
                <img
                  src={record.photoUrl}
                  alt=""
                  loading="lazy"
                  className="mt-3 h-20 w-20 rounded-2xl object-cover ring-1 ring-slate-200 dark:ring-white/10"
                />
              )}
              <p className="mt-2 text-xs text-slate-400 dark:text-white/40">
                {record.source ? `Source: ${record.source}` : "Source: —"}
                {record.updatedAt
                  ? ` · Last updated ${fmtDate(record.updatedAt)}`
                  : ""}
              </p>
              {(payload?.relationship?.lastTouchAt || payload?.relationship?.nextTouchDue) && (
                <p className="mt-1 text-xs text-slate-500 dark:text-white/55">
                  {payload.relationship.lastTouchAt
                    ? `Last touch ${fmtDate(payload.relationship.lastTouchAt)}`
                    : "No touches yet"}
                  {payload.relationship.nextTouchDue ? (
                    <>
                      {" · Next due "}
                      <span className={payload.relationship && isOverdueItem(payload.relationship) ? "font-semibold text-red-600 dark:text-red-300" : ""}>
                        {fmtDate(payload.relationship.nextTouchDue)}
                        {payload.relationship && isOverdueItem(payload.relationship) ? " (overdue)" : ""}
                      </span>
                    </>
                  ) : ""}
                  {typeof payload.relationship.touchCount90d === "number"
                    ? ` · ${payload.relationship.touchCount90d} touches / 90d`
                    : ""}
                  {typeof payload.relationship.openTaskCount === "number"
                    ? ` · ${payload.relationship.openTaskCount} open tasks`
                    : ""}
                </p>
              )}

              {/* Facts */}
              <div className="mt-5 grid grid-cols-2 gap-4">
                <Field label="Email">
                  {record.email ? (
                    <a
                      href={`mailto:${record.email}`}
                      className="underline decoration-[#b8975a] decoration-2 underline-offset-2"
                    >
                      {record.email}
                    </a>
                  ) : (
                    "—"
                  )}
                </Field>
                <Field label="Phone">
                  {record.phone ? (
                    <a href={`tel:${String(record.phone).replace(/[^+\d]/g, "")}`}>
                      {record.phone}
                    </a>
                  ) : (
                    "—"
                  )}
                </Field>
                {kind === "organization" && (
                  <Field label="Website">
                    {record.website ? (
                      <a
                        href={websiteHref}
                        target="_blank"
                        rel="noreferrer"
                        className="underline decoration-[#b8975a] decoration-2 underline-offset-2"
                      >
                        {String(record.website).replace(/^https?:\/\//i, "")}
                      </a>
                    ) : (
                      "—"
                    )}
                  </Field>
                )}
                {kind === "person" && record.organizationName && (
                  <Field label="Organization">{record.organizationName}</Field>
                )}
              </div>

              {record.notes && (
                <div className="mt-5">
                  <p className={labelCls}>Notes</p>
                  <div className="max-h-56 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-sm leading-relaxed text-slate-600 dark:bg-white/[0.04] dark:text-white/75">
                    {record.notes}
                  </div>
                </div>
              )}


              {/* Relationship panel (CRM Phase 1) */}
              <div className="mt-6 border-t border-slate-100 pt-4 dark:border-white/10">
                <p className={labelCls}>Relationship</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className={labelCls} htmlFor="rel-tier">Tier</label>
                    <select id="rel-tier" value={relForm.tier} onChange={(e) => setRelForm({ ...relForm, tier: e.target.value })} className={inputCls}>
                      <option value="">—</option><option value="A">A</option><option value="B">B</option><option value="C">C</option>
                    </select>
                  </div>
                  <div>
                    <label className={labelCls} htmlFor="rel-stage">Stage</label>
                    <select id="rel-stage" value={relForm.stage} onChange={(e) => setRelForm({ ...relForm, stage: e.target.value })} className={inputCls}>
                      {["New", "Engaged", "Active", "Dormant"].map((st) => <option key={st} value={st}>{st}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className={labelCls} htmlFor="rel-cadence">Cadence (days)</label>
                    <input id="rel-cadence" type="number" min={1} value={relForm.cadenceDays} onChange={(e) => setRelForm({ ...relForm, cadenceDays: e.target.value })} placeholder="Tier default" className={inputCls} />
                  </div>
                  <div>
                    <label className={labelCls} htmlFor="rel-owner">Owner</label>
                    <input id="rel-owner" value={relForm.owner} onChange={(e) => setRelForm({ ...relForm, owner: e.target.value })} className={inputCls} />
                  </div>
                  <div>
                    <label className={labelCls} htmlFor="rel-source">Source</label>
                    <input id="rel-source" value={relForm.source} onChange={(e) => setRelForm({ ...relForm, source: e.target.value })} className={inputCls} />
                  </div>
                  <div>
                    <label className={labelCls} htmlFor="rel-comm">Communication preferences</label>
                    <input id="rel-comm" value={relForm.commPrefs} onChange={(e) => setRelForm({ ...relForm, commPrefs: e.target.value })} className={inputCls} />
                  </div>
                  <div>
                    <label className={labelCls} htmlFor="rel-ad-certifications">Certifications</label>
                    <input id="rel-ad-certifications" value={relForm.adCertifications} onChange={(e) => setRelForm({ ...relForm, adCertifications: e.target.value })} placeholder="e.g. AS9100, ISO 9001, CMMC" className={inputCls} />
                  </div>
                  <div>
                    <label className={labelCls} htmlFor="rel-ad-itar">ITAR</label>
                    <input id="rel-ad-itar" value={relForm.adItar} onChange={(e) => setRelForm({ ...relForm, adItar: e.target.value })} placeholder="e.g. Registered" className={inputCls} />
                  </div>
                  <div>
                    <label className={labelCls} htmlFor="rel-ad-clearance">Clearance level</label>
                    <input id="rel-ad-clearance" value={relForm.adClearance} onChange={(e) => setRelForm({ ...relForm, adClearance: e.target.value })} placeholder="e.g. Secret" className={inputCls} />
                  </div>
                  <div>
                    <label className={labelCls} htmlFor="rel-ad-prime-customers">Prime customers</label>
                    <input id="rel-ad-prime-customers" value={relForm.adPrimeCustomers} onChange={(e) => setRelForm({ ...relForm, adPrimeCustomers: e.target.value })} placeholder="e.g. Raytheon" className={inputCls} />
                  </div>
                </div>
                <div className="mt-3">
                  <label className={labelCls} htmlFor="rel-intro">Introduced by</label>
                  {relForm.introducedByPersonId ? (
                    <p className="flex min-h-[44px] items-center gap-2 text-sm text-[#0d1f3c] dark:text-white">
                      <span className="flex-1">{introName || relForm.introducedByPersonId}</span>
                      <button type="button" onClick={() => { setRelForm({ ...relForm, introducedByPersonId: "" }); setIntroName(""); }} className="btn btn-ghost btn-sm">Clear</button>
                    </p>
                  ) : (
                    <>
                      <input id="rel-intro" value={introQ} onChange={(e) => setIntroQ(e.target.value)} placeholder="Search people…" className={inputCls} />
                      {introResults.length > 0 && (
                        <ul className="mt-1 overflow-hidden rounded-xl border border-slate-200 dark:border-white/10">
                          {introResults.map((r) => (
                            <li key={r.id}>
                              <button type="button" onClick={() => { setRelForm({ ...relForm, introducedByPersonId: r.id }); setIntroName(r.name); setIntroQ(""); setIntroResults([]); }} className="flex min-h-[44px] w-full items-center px-3 py-2 text-left text-sm text-[#0d1f3c] hover:bg-slate-50 dark:text-white dark:hover:bg-white/5">{r.name}</button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </>
                  )}
                </div>
                <div className="mt-3">
                  <p className={labelCls}>Important dates</p>
                  <div className="space-y-2">
                    {relForm.importantDates.map((d, i) => (
                      <div key={i} className="flex gap-2">
                        <input value={d.label} onChange={(e) => setRelForm({ ...relForm, importantDates: relForm.importantDates.map((x, xi) => xi === i ? { ...x, label: e.target.value } : x) })} placeholder="Label (e.g. Birthday)" className={`${inputCls} flex-1`} />
                        <input type="date" value={d.date} onChange={(e) => setRelForm({ ...relForm, importantDates: relForm.importantDates.map((x, xi) => xi === i ? { ...x, date: e.target.value } : x) })} className={`${inputCls} w-40`} />
                        <button type="button" aria-label="Remove date" onClick={() => setRelForm({ ...relForm, importantDates: relForm.importantDates.filter((_, xi) => xi !== i) })} className="btn btn-ghost btn-sm min-h-[44px]">×</button>
                      </div>
                    ))}
                    <button type="button" onClick={() => setRelForm({ ...relForm, importantDates: [...relForm.importantDates, { label: "", date: "" }] })} className="btn btn-secondary btn-sm min-h-[44px]">Add date</button>
                  </div>
                </div>
                <div className="mt-3">
                  <p className={labelCls}>Tags</p>
                  <div className="flex flex-wrap gap-1.5">
                    {relTags.map((t) => (
                      <span key={t} className="inline-flex items-center gap-1 rounded-full bg-[#0d1f3c] py-1 pl-2.5 pr-1.5 text-xs font-semibold text-white dark:bg-[#b8975a] dark:text-[#0d1f3c]">
                        {t}
                        <button type="button" aria-label={`Remove tag ${t}`} onClick={() => setRelTags(relTags.filter((x) => x !== t))} className="flex h-5 w-5 items-center justify-center rounded-full bg-white/20 text-[11px]">×</button>
                      </span>
                    ))}
                  </div>
                  <div className="mt-2 flex gap-2">
                    <input value={tagDraft} onChange={(e) => setTagDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); const t = tagDraft.trim(); if (t && !relTags.includes(t)) setRelTags([...relTags, t]); setTagDraft(""); } }} placeholder="Add a tag + Enter" className={`${inputCls} flex-1`} />
                    <button type="button" onClick={() => { const t = tagDraft.trim(); if (t && !relTags.includes(t)) setRelTags([...relTags, t]); setTagDraft(""); }} className="btn btn-secondary btn-sm min-h-[44px]">Add tag</button>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <button type="button" disabled={relSaving} onClick={() => void saveRelationship()} className="btn btn-primary btn-sm min-h-[44px]">{relSaving ? "Saving…" : "Save relationship"}</button>
                  {relMsg && <span className="text-xs text-slate-500 dark:text-white/55">{relMsg}</span>}
                </div>
              </div>

              {/* Type tag editor */}
              <div className="mt-6 border-t border-slate-100 pt-4 dark:border-white/10">
                <p className={labelCls}>Types</p>
                <div className="flex flex-wrap gap-1.5">
                  {types.length === 0 && (
                    <span className="text-sm text-slate-400 dark:text-white/40">
                      No types yet.
                    </span>
                  )}
                  {types.map((t) => (
                    <span
                      key={t}
                      className="inline-flex items-center gap-1 rounded-full bg-[#0d1f3c] py-1 pl-2.5 pr-1.5 text-xs font-semibold text-white dark:bg-[#b8975a] dark:text-[#0d1f3c]"
                    >
                      {typeLabel(t)}
                      <button
                        type="button"
                        aria-label={`Remove ${typeLabel(t)}`}
                        disabled={typeBusy}
                        onClick={() => void changeType(t, "remove")}
                        className="flex h-5 w-5 items-center justify-center rounded-full bg-white/20 text-[11px] leading-none"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
                <div className="mt-2.5 flex flex-wrap gap-2">
                  <select
                    value={typeToAdd}
                    onChange={(e) => setTypeToAdd(e.target.value)}
                    className="min-h-[44px] flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-[#0d1f3c] outline-none focus:border-[#b8975a] dark:border-white/10 dark:bg-white/5 dark:text-white"
                  >
                    <option value="">Add a type…</option>
                    {availableTypes.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    disabled={!typeToAdd || typeBusy}
                    onClick={() => void changeType(typeToAdd, "add")}
                    className="btn btn-primary btn-sm min-h-[44px]"
                  >
                    Add type
                  </button>
                </div>
              </div>

              {/* Edit form */}
              <div className="mt-6 border-t border-slate-100 pt-4 dark:border-white/10">
                <div className="flex items-center justify-between gap-3">
                  <p className={labelCls}>Edit record</p>
                  {!editing && (
                    <button
                      type="button"
                      onClick={() => setEditing(true)}
                      className="btn btn-secondary btn-sm"
                    >
                      Edit
                    </button>
                  )}
                </div>
                {editing && (
                  <div className="space-y-3">
                    <div>
                      <label className={labelCls} htmlFor="dir-edit-name">Name</label>
                      <input
                        id="dir-edit-name"
                        value={form.name}
                        onChange={(e) => setForm({ ...form, name: e.target.value })}
                        className={inputCls}
                      />
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div>
                        <label className={labelCls} htmlFor="dir-edit-title">Title</label>
                        <input
                          id="dir-edit-title"
                          value={form.title}
                          onChange={(e) => setForm({ ...form, title: e.target.value })}
                          className={inputCls}
                        />
                      </div>
                      <div>
                        <label className={labelCls} htmlFor="dir-edit-org">
                          {kind === "person" ? "Organization" : "Organization / firm"}
                        </label>
                        <input
                          id="dir-edit-org"
                          value={form.organizationName}
                          onChange={(e) =>
                            setForm({ ...form, organizationName: e.target.value })
                          }
                          className={inputCls}
                        />
                      </div>
                      <div>
                        <label className={labelCls} htmlFor="dir-edit-email">Email</label>
                        <input
                          id="dir-edit-email"
                          value={form.email}
                          onChange={(e) => setForm({ ...form, email: e.target.value })}
                          className={inputCls}
                        />
                      </div>
                      <div>
                        <label className={labelCls} htmlFor="dir-edit-phone">Phone</label>
                        <input
                          id="dir-edit-phone"
                          value={form.phone}
                          onChange={(e) => setForm({ ...form, phone: e.target.value })}
                          className={inputCls}
                        />
                      </div>
                    </div>
                    {kind === "organization" && (
                      <div>
                        <label className={labelCls} htmlFor="dir-edit-website">Website</label>
                        <input
                          id="dir-edit-website"
                          value={form.website}
                          onChange={(e) => setForm({ ...form, website: e.target.value })}
                          className={inputCls}
                        />
                      </div>
                    )}
                    <div>
                      <label className={labelCls} htmlFor="dir-edit-notes">Notes</label>
                      <textarea
                        id="dir-edit-notes"
                        value={form.notes}
                        onChange={(e) => setForm({ ...form, notes: e.target.value })}
                        rows={4}
                        className={inputCls}
                      />
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        disabled={saving || !form.name.trim()}
                        onClick={() => void saveEdit()}
                        className="btn btn-primary btn-sm min-h-[44px]"
                      >
                        {saving ? "Saving…" : "Save changes"}
                      </button>
                      <button
                        type="button"
                        disabled={saving}
                        onClick={() => setEditing(false)}
                        className="btn btn-ghost btn-sm min-h-[44px]"
                      >
                        Cancel
                      </button>
                      {saveMsg && (
                        <span className="text-xs text-slate-500 dark:text-white/55">
                          {saveMsg}
                        </span>
                      )}
                    </div>
                  </div>
                )}
                {!editing && saveMsg && (
                  <p className="text-xs text-slate-500 dark:text-white/55">{saveMsg}</p>
                )}
              </div>

              {/* Linked deals */}
              <div className="mt-6 border-t border-slate-100 pt-4 dark:border-white/10">
                <p className={labelCls}>Linked deals · {linkedDeals.length}</p>
                {linkedDeals.length === 0 ? (
                  <p className="text-sm text-slate-400 dark:text-white/40">
                    No linked deals yet.
                  </p>
                ) : (
                  <ul className="divide-y divide-slate-100 dark:divide-white/5">
                    {linkedDeals.map((d) => (
                      <li key={d.dealId}>
                        <Link
                          href={`/deals/${d.dealId}`}
                          className="group flex min-h-[44px] flex-wrap items-center gap-2 py-2"
                        >
                          <span className="min-w-0 flex-1 truncate text-sm font-medium text-[#0d1f3c] group-hover:underline group-hover:decoration-[#b8975a] group-hover:decoration-2 group-hover:underline-offset-2 dark:text-white">
                            {d.dealName}
                          </span>
                          {d.role && (
                            <span className="badge badge-neutral shrink-0">{d.role}</span>
                          )}
                          {d.status && (
                            <span className="badge badge-neutral shrink-0">{d.status}</span>
                          )}
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </div>


              {/* Timeline (CRM Phase 1) */}
              <div className="mt-6 border-t border-slate-100 pt-4 dark:border-white/10">
                <p className={labelCls}>Timeline</p>
                <div className="mb-3 flex flex-wrap gap-1.5">
                  {TIMELINE_FILTERS.map((f) => (
                    <button key={f.label} type="button" onClick={() => setTimelineFilter(f.label)} aria-pressed={timelineFilter === f.label} className={`chip min-h-[36px] ${timelineFilter === f.label ? "chip-active" : ""}`}>{f.label}</button>
                  ))}
                </div>
                {timelineBusy && timeline.length === 0 ? (
                  <SkeletonRows rows={3} />
                ) : timeline.length === 0 ? (
                  <p className="text-sm text-slate-400 dark:text-white/40">Nothing on the timeline yet.</p>
                ) : (
                  <ul className="space-y-2">
                    {timeline.map((it) => {
                      const inner = (
                        <>
                          <p className="text-sm font-medium text-[#0d1f3c] dark:text-white">{it.title}</p>
                          <p className="mt-0.5 text-xs text-slate-400 dark:text-white/40">
                            {[it.kind, it.type, it.ts ? fmtDate(it.ts) : null].filter(Boolean).join(" · ")}
                          </p>
                          {it.detail && <p className="mt-1 whitespace-pre-wrap text-xs text-slate-500 dark:text-white/55">{it.detail}</p>}
                        </>
                      );
                      return (
                        <li key={it.key} className="rounded-xl border border-slate-100 p-3 dark:border-white/10">
                          {it.href ? <Link href={it.href} className="block hover:underline">{inner}</Link> : inner}
                        </li>
                      );
                    })}
                  </ul>
                )}
                {timelineHasMore && (
                  <button type="button" disabled={timelineBusy} onClick={() => void fetchTimeline(timelineOffset + 20, true)} className="btn btn-secondary btn-sm mt-3 min-h-[44px]">
                    {timelineBusy ? "Loading…" : "Load more"}
                  </button>
                )}
              </div>

              {/* Open tasks (side panel, CRM Phase 1) */}
              <div className="mt-6 border-t border-slate-100 pt-4 dark:border-white/10">
                <p className={labelCls}>Open tasks · {openTasks.length}</p>
                {openTasks.length === 0 ? (
                  <p className="text-sm text-slate-400 dark:text-white/40">No tasks on the timeline.</p>
                ) : (
                  <ul className="space-y-1.5">
                    {openTasks.map((t) => (
                      <li key={t.key} className="flex flex-wrap items-baseline gap-2 text-sm text-[#0d1f3c] dark:text-white">
                        <span className="min-w-0 flex-1">{t.title}</span>
                        {t.ts && <span className="text-xs text-slate-400 dark:text-white/40">{fmtDate(t.ts)}</span>}
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* Related people / people at org (CRM Phase 1) */}
              <div className="mt-6 border-t border-slate-100 pt-4 dark:border-white/10">
                <p className={labelCls}>{kind === "organization" ? "People at organization" : "Related people"} · {relatedPeople.length}</p>
                {relatedPeople.length === 0 ? (
                  <p className="text-sm text-slate-400 dark:text-white/40">No related people found.</p>
                ) : (
                  <ul className="space-y-1.5">
                    {relatedPeople.map((rp) => (
                      <li key={rp.id} className="flex flex-wrap items-baseline gap-2 text-sm">
                        <span className="font-medium text-[#0d1f3c] dark:text-white">{rp.name}</span>
                        {rp.sub && <span className="text-xs text-slate-400 dark:text-white/40">{rp.sub}</span>}
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* Legacy investor block */}
              {legacy && (
                <div className="mt-6 border-t border-slate-100 pt-4 dark:border-white/10">
                  <p className={labelCls}>Investor details (from Investment Database)</p>
                  <div className="grid grid-cols-2 gap-4">
                    {legacy.investmentType && (
                      <Field label="Investment type">{legacy.investmentType}</Field>
                    )}
                    {legacy.industryFocus && (
                      <Field label="Industry focus">{legacy.industryFocus}</Field>
                    )}
                    {legacy.ebitdaSize && (
                      <Field label="EBITDA size">{legacy.ebitdaSize}</Field>
                    )}
                    {legacy.checkSize && (
                      <Field label="Check size">{legacy.checkSize}</Field>
                    )}
                    {legacy.status && <Field label="Status">{legacy.status}</Field>}
                    {legacy.website && (
                      <Field label="Website">
                        <a
                          href={
                            /^https?:\/\//i.test(legacy.website)
                              ? legacy.website
                              : `https://${legacy.website}`
                          }
                          target="_blank"
                          rel="noreferrer"
                          className="underline decoration-[#b8975a] decoration-2 underline-offset-2"
                        >
                          {String(legacy.website).replace(/^https?:\/\//i, "")}
                        </a>
                      </Field>
                    )}
                  </div>
                  {legacy.comments && (
                    <div className="mt-3 whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-sm leading-relaxed text-slate-600 dark:bg-white/[0.04] dark:text-white/75">
                      {legacy.comments}
                    </div>
                  )}
                </div>
              )}

              {/* Email links */}
              <div className="mt-6 border-t border-slate-100 pt-4 dark:border-white/10">
                <p className={labelCls}>Linked emails · {emailLinks.length}</p>
                {emailLinks.length === 0 ? (
                  <p className="text-sm text-slate-400 dark:text-white/40">
                    No emails linked yet.
                  </p>
                ) : (
                  <ul className="mb-4 space-y-2">
                    {emailLinks.map((l) => (
                      <li
                        key={l.id}
                        className="rounded-xl border border-slate-100 p-3 dark:border-white/10"
                      >
                        <p className="text-sm font-medium text-[#0d1f3c] dark:text-white">
                          {l.subject || "(no subject)"}
                        </p>
                        <p className="mt-0.5 text-xs text-slate-400 dark:text-white/40">
                          {[l.fromAddr, l.emailDate ? fmtDate(l.emailDate) : null]
                            .filter(Boolean)
                            .join(" · ")}
                        </p>
                        {l.note && (
                          <p className="mt-1 text-xs text-slate-500 dark:text-white/55">
                            {l.note}
                          </p>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                <div className="space-y-2.5">
                  <input
                    value={emailForm.subject}
                    onChange={(e) => setEmailForm({ ...emailForm, subject: e.target.value })}
                    placeholder="Email subject"
                    className={inputCls}
                  />
                  <div className="grid gap-2.5 sm:grid-cols-2">
                    <input
                      value={emailForm.fromAddr}
                      onChange={(e) => setEmailForm({ ...emailForm, fromAddr: e.target.value })}
                      placeholder="From (email address)"
                      className={inputCls}
                    />
                    <input
                      type="date"
                      value={emailForm.emailDate}
                      onChange={(e) => setEmailForm({ ...emailForm, emailDate: e.target.value })}
                      className={inputCls}
                    />
                  </div>
                  <input
                    value={emailForm.emailRef}
                    onChange={(e) => setEmailForm({ ...emailForm, emailRef: e.target.value })}
                    placeholder="Email reference (message id — optional)"
                    className={inputCls}
                  />
                  <input
                    value={emailForm.note}
                    onChange={(e) => setEmailForm({ ...emailForm, note: e.target.value })}
                    placeholder="Note (optional)"
                    className={inputCls}
                  />
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      disabled={emailBusy}
                      onClick={() => void addEmailLink()}
                      className="btn btn-secondary btn-sm min-h-[44px]"
                    >
                      {emailBusy ? "Adding…" : "Link email"}
                    </button>
                    {emailMsg && (
                      <span className="text-xs text-slate-500 dark:text-white/55">
                        {emailMsg}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Comments */}
              <div className="mt-6 border-t border-slate-100 pt-4 dark:border-white/10">
                <Comments entityKind={kind} entityId={id} />
              </div>

              {/* Delete record (soft delete — Phase 8, Item 0) */}
              <div className="mt-6 border-t border-slate-100 pt-4 dark:border-white/10">
                <p className={labelCls}>Danger zone</p>
                {!confirmingDelete ? (
                  <button
                    type="button"
                    onClick={() =>
                      kind === "organization"
                        ? setShowDeleteDialog(true)
                        : setConfirmingDelete(true)
                    }
                    className="btn btn-ghost btn-sm min-h-[44px] text-red-600 dark:text-red-300"
                  >
                    Delete record
                  </button>
                ) : (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs text-slate-500 dark:text-white/55">
                      Delete this record? It is soft-deleted and can be restored.
                    </span>
                    <button
                      type="button"
                      disabled={deleting}
                      onClick={() => void deleteThisRecord()}
                      className="btn btn-primary btn-sm min-h-[44px]"
                    >
                      {deleting ? "Deleting…" : "Confirm delete"}
                    </button>
                    <button
                      type="button"
                      disabled={deleting}
                      onClick={() => setConfirmingDelete(false)}
                      className="btn btn-ghost btn-sm min-h-[44px]"
                    >
                      Cancel
                    </button>
                  </div>
                )}
                {deleteMsg && (
                  <p className="mt-1 text-xs text-red-600 dark:text-red-300">{deleteMsg}</p>
                )}
              </div>
            </>
          )}
        </div>
      </aside>

      {/* Wrong-deal protection for organization deletes. */}
      {showDeleteDialog && record && (
        <ConfirmDealDialog
          open
          actionLabel="Delete record"
          companyId={id}
          companyName={record.name}
          logoVersion={typeof record.logoVersion === "number" ? record.logoVersion : 0}
          detail="Soft delete — the record can be restored."
          danger
          busy={deleting}
          confirmLabel="Delete record"
          onConfirm={() => {
            setShowDeleteDialog(false);
            void deleteThisRecord();
          }}
          onCancel={() => setShowDeleteDialog(false)}
        />
      )}
    </div>
  );
}

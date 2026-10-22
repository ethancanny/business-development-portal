"use client";

/**
 * Site visits — visit log with attendees, facility condition score,
 * capacity/utilization notes and observations. Photos are referenced
 * by data room document id only; no files are uploaded here.
 */

import { useState } from "react";
import { Button, EmptyState } from "@/components/ui";
import {
  api,
  cardCls,
  inputCls,
  labelCls,
  selectCls,
  fmtDateShort,
  splitList,
  type TabProps,
} from "@/components/diligence/types";

export default function SiteVisitsTab({ workspaceId, bundle, reload }: TabProps) {
  const [form, setForm] = useState({
    visitDate: "",
    attendees: "",
    facilityConditionScore: "",
    utilizationEstimate: "",
    capacityNotes: "",
    observations: "",
    photoDocumentIds: "",
  });
  const [adding, setAdding] = useState(false);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");

  const visits = bundle.siteVisits;
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));

  const add = async () => {
    if (adding) return;
    setAdding(true);
    setError("");
    try {
      await api(`/api/platform/diligence/workspaces/${encodeURIComponent(workspaceId)}/site-visits`, {
        method: "POST",
        body: JSON.stringify({
          visitDate: form.visitDate || null,
          attendees: splitList(form.attendees),
          observations: form.observations,
          photoDocumentIds: splitList(form.photoDocumentIds),
          facilityConditionScore:
            form.facilityConditionScore === ""
              ? null
              : Number(form.facilityConditionScore),
          capacityNotes: form.capacityNotes,
          utilizationEstimate: form.utilizationEstimate,
        }),
      });
      setForm({
        visitDate: "",
        attendees: "",
        facilityConditionScore: "",
        utilizationEstimate: "",
        capacityNotes: "",
        observations: "",
        photoDocumentIds: "",
      });
      await reload();
    } catch {
      setError("Could not record that site visit. Please try again.");
    } finally {
      setAdding(false);
    }
  };

  const remove = async (visitId: string) => {
    setBusyId(visitId);
    setError("");
    try {
      await api(`/api/platform/diligence/site-visits/${encodeURIComponent(visitId)}`, {
        method: "DELETE",
      });
      await reload();
    } catch {
      setError("Could not delete that site visit. Please try again.");
    } finally {
      setBusyId("");
    }
  };

  return (
    <div className="space-y-5">
      {error && (
        <p className="rounded-xl bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-300">
          {error}
        </p>
      )}

      <div className={cardCls}>
        <h3 className="font-display text-lg font-semibold text-[#0d1f3c] dark:text-white">
          Site visits
        </h3>
        {visits.length === 0 ? (
          <div className="mt-3">
            <EmptyState
              title="No site visits recorded"
              message="Log the first visit below once the team has been on site."
            />
          </div>
        ) : (
          <ul className="mt-3 divide-y divide-slate-100 dark:divide-white/5">
            {visits.map((v) => (
              <li key={v.id} className="py-4">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-semibold text-[#0d1f3c] dark:text-white">
                    {fmtDateShort(v.visitDate)}
                  </p>
                  {v.facilityConditionScore !== null && (
                    <span className="badge badge-neutral">
                      Facility condition {v.facilityConditionScore}/5
                    </span>
                  )}
                  {v.utilizationEstimate && (
                    <span className="badge badge-neutral">
                      Utilization: {v.utilizationEstimate}
                    </span>
                  )}
                </div>
                {v.attendees.length > 0 && (
                  <p className="mt-1 text-sm text-slate-600 dark:text-white/70">
                    Attendees: {v.attendees.join(", ")}
                  </p>
                )}
                {v.observations && (
                  <p className="mt-1.5 whitespace-pre-wrap text-sm text-slate-600 dark:text-white/70">
                    {v.observations}
                  </p>
                )}
                {v.capacityNotes && (
                  <p className="mt-1 text-sm text-slate-600 dark:text-white/70">
                    <span className="font-medium">Capacity:</span> {v.capacityNotes}
                  </p>
                )}
                {v.photoDocumentIds.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {v.photoDocumentIds.map((id) => (
                      <span key={id} className="chip" title="Data room document id">
                        📷 {id}
                      </span>
                    ))}
                  </div>
                )}
                <div className="mt-2.5">
                  <button
                    type="button"
                    className="btn btn-danger btn-sm"
                    disabled={busyId === v.id}
                    onClick={() => void remove(v.id)}
                  >
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className={cardCls}>
        <h3 className="font-display text-lg font-semibold text-[#0d1f3c] dark:text-white">
          Log a site visit
        </h3>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <label className={labelCls}>Visit date</label>
            <input type="date" className={inputCls} value={form.visitDate} onChange={(e) => set({ visitDate: e.target.value })} />
          </div>
          <div>
            <label className={labelCls}>Facility condition (1–5)</label>
            <select className={selectCls} value={form.facilityConditionScore} onChange={(e) => set({ facilityConditionScore: e.target.value })}>
              <option value="">Not scored</option>
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={String(n)}>
                  {n}
                </option>
              ))}
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className={labelCls}>Attendees (comma-separated)</label>
            <input className={inputCls} value={form.attendees} onChange={(e) => set({ attendees: e.target.value })} placeholder="Ethan Canny, plant manager, …" />
          </div>
          <div>
            <label className={labelCls}>Utilization estimate</label>
            <input className={inputCls} value={form.utilizationEstimate} onChange={(e) => set({ utilizationEstimate: e.target.value })} placeholder="e.g. ~60% of nameplate capacity" />
          </div>
          <div>
            <label className={labelCls}>Photo document ids (comma-separated)</label>
            <input className={inputCls} value={form.photoDocumentIds} onChange={(e) => set({ photoDocumentIds: e.target.value })} placeholder="doc_…, doc_…" />
          </div>
          <p className="text-xs text-slate-500 dark:text-white/50 sm:col-span-2">
            Photos live in the data room / documents library — upload them
            there and reference their document ids here. No files are uploaded
            from this form.
          </p>
          <div className="sm:col-span-2">
            <label className={labelCls}>Capacity notes</label>
            <textarea className={`${inputCls} min-h-[60px]`} value={form.capacityNotes} onChange={(e) => set({ capacityNotes: e.target.value })} />
          </div>
          <div className="sm:col-span-2">
            <label className={labelCls}>Observations</label>
            <textarea className={`${inputCls} min-h-[90px]`} value={form.observations} onChange={(e) => set({ observations: e.target.value })} placeholder="Condition, housekeeping, safety, deferred maintenance, expansion room…" />
          </div>
        </div>
        <div className="mt-4">
          <Button onClick={() => void add()} loading={adding}>
            Log site visit
          </Button>
        </div>
      </div>
    </div>
  );
}

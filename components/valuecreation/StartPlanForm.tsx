"use client";

/**
 * Start-a-value-creation-plan form (Phase 6), extracted from the
 * /value-creation index page for the navigation restructure so the
 * Due Diligence hub's "New plan" dialog renders the exact same flow:
 * company picker (GET /api/platform/companies), plan start date,
 * optional plan name → POST /api/platform/value-creation/plans →
 * onCreated(companyId). Behavior is unchanged from the original
 * inline form, including its error copy.
 */

import { useState } from "react";
import { Button } from "@/components/ui";
import CompanyPicker from "@/components/valuecreation/CompanyPicker";
import {
  API,
  api,
  inputCls,
  labelCls,
  todayIso,
  type CompanyOption,
} from "@/components/valuecreation/types";

export default function StartPlanForm({
  onCreated,
}: {
  onCreated: (companyId: string) => void;
}) {
  const [company, setCompany] = useState<CompanyOption | null>(null);
  const [startDate, setStartDate] = useState(todayIso());
  const [planName, setPlanName] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");

  const create = async () => {
    if (!company || creating) return;
    setCreating(true);
    setCreateError("");
    try {
      await api(`${API}/plans`, {
        method: "POST",
        body: JSON.stringify({
          companyId: company.id,
          name: planName.trim() || undefined,
          planStartDate: startDate || undefined,
        }),
      });
      onCreated(company.id);
    } catch {
      setCreateError(
        "Could not start a plan for that company. It may already have one — open it from the list below."
      );
      setCreating(false);
    }
  };

  return (
    <div>
      {createError && (
        <p
          role="alert"
          className="mt-3 rounded-xl bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-300"
        >
          {createError}
        </p>
      )}
      <div className="mt-4 grid gap-3 md:grid-cols-[1fr_220px_1fr_auto] md:items-end">
        <CompanyPicker label="Company" value={company} onChange={setCompany} />
        <div>
          <label className={labelCls}>Plan start date</label>
          <input
            type="date"
            className={`${inputCls} min-h-[44px]`}
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
          />
        </div>
        <div>
          <label className={labelCls}>Plan name (optional)</label>
          <input
            className={`${inputCls} min-h-[44px]`}
            value={planName}
            onChange={(e) => setPlanName(e.target.value)}
            placeholder="Defaults to a standard plan name"
          />
        </div>
        <Button
          onClick={() => void create()}
          loading={creating}
          disabled={!company}
        >
          {creating ? "Starting…" : "Start plan"}
        </Button>
      </div>
    </div>
  );
}

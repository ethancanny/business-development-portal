"use client";

/**
 * Capital profile tab (Investors & Capital Redesign Step 1, Oct 25, 2026).
 *
 * The Directory-side home of a record's capital profile: investors live
 * only in the Directory, and this tab edits the capital profile
 * extension (keyed by the record id) through the capital module's API —
 * GET/PUT /api/platform/capital/investors/[id] and
 * POST /api/platform/capital/investors/[id]/touch. Directory UI composes
 * the capital API client-side; no server coupling is added.
 *
 * Field handling mirrors components/capital/InvestorDetail.tsx exactly:
 * the profile upsert replaces the whole profile, so Save always sends
 * EVERY field (existing + the Step 1 additions: geography,
 * accreditedStatus, relationshipOwner, investsInTypes, checkByType).
 * Investment-type labels come from the BD type config (bootstrap), with
 * a local label map for the four known keys as fallback.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Button, ErrorState, SkeletonRows } from "@/components/ui";
import {
  API,
  INVESTOR_STATUSES,
  INVESTOR_TYPES,
  ApiError,
  api,
  fmtDateShort,
  fmtMoneyN,
  fmtUpdated,
  inputCls,
  labelCls,
  parseNum,
  selectCls,
  type InvestorDetailData,
  type InvestorProfile,
} from "@/components/capital/types";
import {
  fetchBdBootstrap,
  type BdTypeConfig,
} from "@/components/InvestmentTypeBits";
import { INVESTMENT_TYPE_LABELS, PARTNER_NAMES } from "@/lib/types";

/* ------------------------- extended profile ------------------------- */

/** InvestorProfile plus the Step 1 type-awareness fields. */
interface ExtProfile extends InvestorProfile {
  geography?: string;
  accreditedStatus?: string;
  relationshipOwner?: string;
  investsInTypes?: string[];
  checkByType?: Record<string, { min: number | null; max: number | null }>;
}

/** A raise participation as returned on the investor detail —
 * tolerant of both the commitment shape (amount/kind/stage) and the
 * Step 1 link-record shape (indicated/soft/hard/funded). */
interface RaiseParticipation {
  id?: string;
  dealId: string;
  dealName?: string;
  companyName?: string;
  amount?: number;
  kind?: string;
  stage?: string;
  indicated?: number | null;
  soft?: number | null;
  hard?: number | null;
  funded?: number | null;
}

interface TypeOption {
  key: string;
  label: string;
  enabled: boolean;
}

const FALLBACK_TYPE_OPTIONS: TypeOption[] = Object.entries(
  INVESTMENT_TYPE_LABELS
).map(([key, label]) => ({ key, label, enabled: true }));

const ACCREDITED_OPTIONS: Array<{ key: string; label: string }> = [
  { key: "", label: "Not recorded" },
  { key: "accredited", label: "Accredited" },
  { key: "not_accredited", label: "Not accredited" },
  { key: "unknown", label: "Unknown" },
];

/* ------------------------------ form ------------------------------ */

interface ProfileForm {
  investorType: string;
  status: string;
  introSource: string;
  lastTouchAt: string;
  thesisSectors: string;
  dealSizeMin: string;
  dealSizeMax: string;
  checkSizeMin: string;
  checkSizeMax: string;
  structurePrefs: string;
  notes: string;
  geography: string;
  accreditedStatus: string;
  relationshipOwner: string;
  investsInTypes: string[];
  /** Editable per-type check range text, keyed by type key. */
  checkByType: Record<string, { min: string; max: string }>;
}

const numText = (v: number | null | undefined): string =>
  v === null || v === undefined ? "" : String(v);

function formFromProfile(p: ExtProfile | null | undefined): ProfileForm {
  const checkByType: ProfileForm["checkByType"] = {};
  const raw = p?.checkByType ?? {};
  for (const key of Object.keys(raw)) {
    checkByType[key] = {
      min: numText(raw[key]?.min),
      max: numText(raw[key]?.max),
    };
  }
  return {
    investorType: p?.investorType ?? "",
    status: p?.status ?? "exploring",
    introSource: p?.introSource ?? "",
    lastTouchAt: p?.lastTouchAt ? p.lastTouchAt.slice(0, 10) : "",
    thesisSectors: (p?.thesisSectors ?? []).join(", "),
    dealSizeMin: numText(p?.dealSizeMin),
    dealSizeMax: numText(p?.dealSizeMax),
    checkSizeMin: numText(p?.checkSizeMin),
    checkSizeMax: numText(p?.checkSizeMax),
    structurePrefs: p?.structurePrefs ?? "",
    notes: p?.notes ?? "",
    geography: p?.geography ?? "",
    accreditedStatus: p?.accreditedStatus ?? "",
    relationshipOwner: p?.relationshipOwner ?? "",
    investsInTypes: [...(p?.investsInTypes ?? [])],
    checkByType,
  };
}

/** Full-profile PUT body — every field, always (upsert semantics). */
function bodyFromForm(form: ProfileForm): Record<string, unknown> {
  const checkByType: Record<string, { min: number | null; max: number | null }> =
    {};
  for (const key of Object.keys(form.checkByType)) {
    const entry = form.checkByType[key];
    const min = parseNum(entry.min);
    const max = parseNum(entry.max);
    // Keep an entry when the type is checked or a range was entered /
    // already existed, so unchecking a type never silently drops a
    // stored range.
    if (form.investsInTypes.indexOf(key) >= 0 || min !== null || max !== null) {
      checkByType[key] = { min, max };
    }
  }
  return {
    investorType: form.investorType,
    status: form.status,
    introSource: form.introSource.trim(),
    lastTouchAt: form.lastTouchAt || null,
    thesisSectors: form.thesisSectors
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    dealSizeMin: parseNum(form.dealSizeMin),
    dealSizeMax: parseNum(form.dealSizeMax),
    checkSizeMin: parseNum(form.checkSizeMin),
    checkSizeMax: parseNum(form.checkSizeMax),
    structurePrefs: form.structurePrefs.trim(),
    notes: form.notes.trim(),
    geography: form.geography.trim(),
    accreditedStatus: form.accreditedStatus,
    relationshipOwner: form.relationshipOwner,
    investsInTypes: [...form.investsInTypes],
    checkByType,
  };
}

const DEFAULT_FORM = formFromProfile(null);

/* ---------------------------- component ---------------------------- */

export default function CapitalProfileTab({
  recordId,
  onChanged,
}: {
  recordId: string;
  /** Record kind — the tab renders for people and organizations alike;
   *  the capital API is keyed by the record id either way. */
  kind?: "person" | "organization";
  onChanged?: () => void;
}) {
  const [detail, setDetail] = useState<InvestorDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  /** GET 404 (e.g. an organization id the person-keyed endpoint does
   *  not know) reads as "no capital profile yet", not an error. */
  const [notFound, setNotFound] = useState(false);
  const [form, setForm] = useState<ProfileForm | null>(null);
  const [saving, setSaving] = useState(false);
  const [creating, setCreating] = useState(false);
  const [touchBusy, setTouchBusy] = useState(false);
  const [saveNote, setSaveNote] = useState("");
  const [error, setError] = useState("");
  const [typeOptions, setTypeOptions] =
    useState<TypeOption[]>(FALLBACK_TYPE_OPTIONS);

  // Investment-type labels from the BD type config when available.
  useEffect(() => {
    let cancelled = false;
    void fetchBdBootstrap().then((b) => {
      if (cancelled) return;
      const types: BdTypeConfig[] | undefined = b?.config?.types;
      if (types && types.length > 0) {
        setTypeOptions(
          types.map((t) => ({ key: t.key, label: t.label, enabled: t.enabled }))
        );
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadFailed(false);
    setNotFound(false);
    try {
      const raw = await api<
        InvestorDetailData & { detail?: InvestorDetailData }
      >(`${API}/investors/${encodeURIComponent(recordId)}`);
      // Tolerate both the flat detail shape and a { detail } wrapper.
      const data = raw.detail ?? raw;
      setDetail(data);
      setForm(formFromProfile(data.profile as ExtProfile));
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        setNotFound(true);
        setDetail(null);
        setForm(null);
      } else {
        setLoadFailed(true);
      }
    } finally {
      setLoading(false);
    }
  }, [recordId]);

  useEffect(() => {
    void load();
  }, [load]);

  const createProfile = async () => {
    if (creating) return;
    setCreating(true);
    setError("");
    try {
      await api(`${API}/investors/${encodeURIComponent(recordId)}`, {
        method: "PUT",
        body: JSON.stringify(bodyFromForm({ ...DEFAULT_FORM })),
      });
      await load();
      onChanged?.();
    } catch {
      setError(
        "Could not create the capital profile. Please try again."
      );
    } finally {
      setCreating(false);
    }
  };

  const save = async () => {
    if (!form || saving) return;
    setSaving(true);
    setError("");
    setSaveNote("");
    try {
      await api(`${API}/investors/${encodeURIComponent(recordId)}`, {
        method: "PUT",
        body: JSON.stringify(bodyFromForm(form)),
      });
      setSaveNote("Capital profile saved.");
      await load();
      onChanged?.();
    } catch {
      setError("Could not save the capital profile. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const logTouch = async () => {
    if (touchBusy) return;
    setTouchBusy(true);
    setError("");
    try {
      await api(`${API}/investors/${encodeURIComponent(recordId)}/touch`, {
        method: "POST",
      });
      await load();
      onChanged?.();
    } catch {
      setError("Could not log the touch. Please try again.");
    } finally {
      setTouchBusy(false);
    }
  };

  if (loading) return <SkeletonRows rows={5} />;
  if (loadFailed)
    return (
      <ErrorState
        title="Could not load the capital profile"
        message="The capital profile could not be loaded — the database may be unavailable. Try again in a moment."
        onRetry={() => void load()}
      />
    );

  const profile = (detail?.profile ?? null) as ExtProfile | null;
  const commitments = (detail?.commitments ??
    []) as unknown as RaiseParticipation[];
  const hasProfile = !notFound && !!profile?.exists;

  const raisesList =
    commitments.length > 0 ? (
      <div className="mt-6 border-t border-slate-100 pt-4 dark:border-white/10">
        <p className={labelCls}>In these raises · {commitments.length}</p>
        <ul className="divide-y divide-slate-100 dark:divide-white/5">
          {commitments.map((c, i) => {
            const parts: string[] = [];
            if (typeof c.indicated === "number")
              parts.push(`Indicated ${fmtMoneyN(c.indicated)}`);
            if (typeof c.soft === "number")
              parts.push(`Soft ${fmtMoneyN(c.soft)}`);
            if (typeof c.hard === "number")
              parts.push(`Hard ${fmtMoneyN(c.hard)}`);
            if (typeof c.funded === "number")
              parts.push(`Funded ${fmtMoneyN(c.funded)}`);
            if (parts.length === 0 && typeof c.amount === "number")
              parts.push(fmtMoneyN(c.amount));
            if (c.kind) parts.push(c.kind);
            return (
              <li key={c.id ?? `${c.dealId}-${i}`}>
                <Link
                  href={`/investors-capital/${encodeURIComponent(c.dealId)}`}
                  className="group flex min-h-[44px] flex-wrap items-center gap-2 py-2"
                >
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-[#0d1f3c] group-hover:underline group-hover:decoration-[#b8975a] group-hover:decoration-2 group-hover:underline-offset-2 dark:text-white">
                    {c.dealName || c.companyName || "Deal"}
                  </span>
                  {parts.length > 0 && (
                    <span className="tnum text-xs text-slate-500 dark:text-white/55">
                      {parts.join(" · ")}
                    </span>
                  )}
                  {c.stage && (
                    <span className="badge badge-neutral shrink-0">{c.stage}</span>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    ) : null;

  /* ------------------------- no profile yet ------------------------- */
  if (!hasProfile) {
    return (
      <div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-white/10 dark:bg-white/[0.03]">
          <h4 className="font-display text-lg font-semibold text-[#0d1f3c] dark:text-white">
            No capital profile yet
          </h4>
          <p className="mt-1 text-sm text-slate-500 dark:text-white/55">
            This record has no capital profile. Create one to track investor
            type, check size, sectors, accreditation, and which investment
            types they invest in.
          </p>
          {error && (
            <p
              role="alert"
              className="mt-3 rounded-xl bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-300"
            >
              {error}
            </p>
          )}
          <div className="mt-4">
            <Button
              onClick={() => void createProfile()}
              loading={creating}
              className="min-h-[44px]"
            >
              {creating ? "Creating…" : "Create capital profile"}
            </Button>
          </div>
        </div>
        {raisesList}
      </div>
    );
  }

  if (!form) return <SkeletonRows rows={5} />;

  const set = (patch: Partial<ProfileForm>) =>
    setForm((f) => (f ? { ...f, ...patch } : f));

  const toggleType = (key: string) =>
    setForm((f) => {
      if (!f) return f;
      const active = f.investsInTypes.indexOf(key) >= 0;
      return {
        ...f,
        investsInTypes: active
          ? f.investsInTypes.filter((k) => k !== key)
          : [...f.investsInTypes, key],
        checkByType: {
          ...f.checkByType,
          [key]: f.checkByType[key] ?? { min: "", max: "" },
        },
      };
    });

  const setTypeRange = (key: string, field: "min" | "max", value: string) =>
    setForm((f) =>
      f
        ? {
            ...f,
            checkByType: {
              ...f.checkByType,
              [key]: {
                min: f.checkByType[key]?.min ?? "",
                max: f.checkByType[key]?.max ?? "",
                [field]: value,
              },
            },
          }
        : f
    );

  // Configured types + any key already on the profile, so a stored
  // type is never hidden by config drift.
  const allTypeOptions: TypeOption[] = [...typeOptions];
  for (const key of [
    ...form.investsInTypes,
    ...Object.keys(form.checkByType),
  ]) {
    if (!allTypeOptions.some((t) => t.key === key)) {
      allTypeOptions.push({
        key,
        label:
          INVESTMENT_TYPE_LABELS[
            key as keyof typeof INVESTMENT_TYPE_LABELS
          ] ?? key,
        enabled: true,
      });
    }
  }

  const ownerOptions: string[] = [...PARTNER_NAMES];
  if (form.relationshipOwner && ownerOptions.indexOf(form.relationshipOwner) < 0) {
    ownerOptions.push(form.relationshipOwner);
  }

  const lastTouchDisplay = form.lastTouchAt
    ? fmtDateShort(form.lastTouchAt)
    : "No touch logged yet";

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h4 className="font-display text-lg font-semibold text-[#0d1f3c] dark:text-white">
            Capital profile
          </h4>
          <p className="mt-0.5 text-xs text-slate-400 dark:text-white/40">
            Canny Capital&apos;s own investor record
            {profile?.updatedAt
              ? ` · updated ${fmtUpdated(profile.updatedAt)}`
              : ""}
          </p>
        </div>
        <span
          className={`badge ${
            profile?.status === "committed"
              ? "badge-fit"
              : profile?.status === "passed"
                ? "badge-danger"
                : "badge-neutral"
          }`}
        >
          {INVESTOR_STATUSES.find((s) => s.key === form.status)?.label ??
            form.status}
        </span>
      </div>

      {error && (
        <p
          role="alert"
          className="mt-3 rounded-xl bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-300"
        >
          {error}
        </p>
      )}

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div>
          <label className={labelCls} htmlFor="cap-type">Investor type</label>
          <select
            id="cap-type"
            className={`${selectCls} min-h-[44px]`}
            value={form.investorType}
            onChange={(e) => set({ investorType: e.target.value })}
          >
            <option value="">—</option>
            {INVESTOR_TYPES.map((t) => (
              <option key={t.key} value={t.key}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelCls} htmlFor="cap-status">Status</label>
          <select
            id="cap-status"
            className={`${selectCls} min-h-[44px]`}
            value={form.status}
            onChange={(e) => set({ status: e.target.value })}
          >
            {INVESTOR_STATUSES.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelCls} htmlFor="cap-accredited">
            Accredited status
          </label>
          <select
            id="cap-accredited"
            className={`${selectCls} min-h-[44px]`}
            value={form.accreditedStatus}
            onChange={(e) => set({ accreditedStatus: e.target.value })}
          >
            {ACCREDITED_OPTIONS.map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelCls} htmlFor="cap-owner">
            Relationship owner
          </label>
          <select
            id="cap-owner"
            className={`${selectCls} min-h-[44px]`}
            value={form.relationshipOwner}
            onChange={(e) => set({ relationshipOwner: e.target.value })}
          >
            <option value="">Unassigned</option>
            {ownerOptions.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelCls} htmlFor="cap-geography">Geography</label>
          <input
            id="cap-geography"
            className={`${inputCls} min-h-[44px]`}
            value={form.geography}
            onChange={(e) => set({ geography: e.target.value })}
            placeholder="Arizona, National…"
          />
        </div>
        <div>
          <label className={labelCls} htmlFor="cap-intro">Intro source</label>
          <input
            id="cap-intro"
            className={`${inputCls} min-h-[44px]`}
            value={form.introSource}
            onChange={(e) => set({ introSource: e.target.value })}
          />
        </div>
        <div className="sm:col-span-2">
          <label className={labelCls}>Last touch</label>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-[#0d1f3c] dark:text-white">
              {lastTouchDisplay}
            </span>
            <button
              type="button"
              disabled={touchBusy}
              onClick={() => void logTouch()}
              className="btn btn-secondary btn-sm min-h-[44px]"
            >
              {touchBusy ? "Logging…" : "Log touch"}
            </button>
          </div>
        </div>
        <div className="sm:col-span-2">
          <label className={labelCls} htmlFor="cap-sectors">
            Thesis sectors (comma-separated)
          </label>
          <input
            id="cap-sectors"
            className={`${inputCls} min-h-[44px]`}
            value={form.thesisSectors}
            onChange={(e) => set({ thesisSectors: e.target.value })}
            placeholder="Healthcare, Aerospace & Defense…"
          />
        </div>
        <div>
          <label className={labelCls} htmlFor="cap-deal-min">
            Deal size min ($)
          </label>
          <input
            id="cap-deal-min"
            inputMode="numeric"
            className={`${inputCls} min-h-[44px]`}
            value={form.dealSizeMin}
            onChange={(e) => set({ dealSizeMin: e.target.value })}
          />
        </div>
        <div>
          <label className={labelCls} htmlFor="cap-deal-max">
            Deal size max ($)
          </label>
          <input
            id="cap-deal-max"
            inputMode="numeric"
            className={`${inputCls} min-h-[44px]`}
            value={form.dealSizeMax}
            onChange={(e) => set({ dealSizeMax: e.target.value })}
          />
        </div>
        <div>
          <label className={labelCls} htmlFor="cap-check-min">
            Check size min ($)
          </label>
          <input
            id="cap-check-min"
            inputMode="numeric"
            className={`${inputCls} min-h-[44px]`}
            value={form.checkSizeMin}
            onChange={(e) => set({ checkSizeMin: e.target.value })}
          />
        </div>
        <div>
          <label className={labelCls} htmlFor="cap-check-max">
            Check size max ($)
          </label>
          <input
            id="cap-check-max"
            inputMode="numeric"
            className={`${inputCls} min-h-[44px]`}
            value={form.checkSizeMax}
            onChange={(e) => set({ checkSizeMax: e.target.value })}
          />
        </div>
        <div className="sm:col-span-2">
          <label className={labelCls} htmlFor="cap-structure">
            Structure preferences
          </label>
          <input
            id="cap-structure"
            className={`${inputCls} min-h-[44px]`}
            value={form.structurePrefs}
            onChange={(e) => set({ structurePrefs: e.target.value })}
            placeholder="Common, preferred, deal-by-deal…"
          />
        </div>
        <div className="sm:col-span-2">
          <label className={labelCls} htmlFor="cap-notes">Notes</label>
          <textarea
            id="cap-notes"
            className={`${inputCls} min-h-[72px]`}
            value={form.notes}
            onChange={(e) => set({ notes: e.target.value })}
          />
        </div>
      </div>

      {/* Invests in these types + per-type check ranges */}
      <div className="mt-5 border-t border-slate-100 pt-4 dark:border-white/10">
        <p className={labelCls}>Invests in these types</p>
        <div className="space-y-2.5">
          {allTypeOptions.map((t) => {
            const checked = form.investsInTypes.indexOf(t.key) >= 0;
            const range = form.checkByType[t.key] ?? { min: "", max: "" };
            return (
              <div key={t.key}>
                <label className="flex min-h-[44px] cursor-pointer items-center gap-2.5 text-sm font-medium text-[#0d1f3c] dark:text-white">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleType(t.key)}
                    className="h-4 w-4 shrink-0 accent-[#b8975a]"
                  />
                  <span>{t.label}</span>
                  {!t.enabled && (
                    <span className="badge badge-neutral">Disabled in Settings</span>
                  )}
                </label>
                {checked && (
                  <div className="grid gap-3 pb-1 pl-7 sm:grid-cols-2">
                    <div>
                      <label className={labelCls} htmlFor={`cap-ct-min-${t.key}`}>
                        {t.label} check min ($)
                      </label>
                      <input
                        id={`cap-ct-min-${t.key}`}
                        inputMode="numeric"
                        className={`${inputCls} min-h-[44px]`}
                        value={range.min}
                        onChange={(e) => setTypeRange(t.key, "min", e.target.value)}
                      />
                    </div>
                    <div>
                      <label className={labelCls} htmlFor={`cap-ct-max-${t.key}`}>
                        {t.label} check max ($)
                      </label>
                      <input
                        id={`cap-ct-max-${t.key}`}
                        inputMode="numeric"
                        className={`${inputCls} min-h-[44px]`}
                        value={range.max}
                        onChange={(e) => setTypeRange(t.key, "max", e.target.value)}
                      />
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <Button
          onClick={() => void save()}
          loading={saving}
          className="min-h-[44px]"
        >
          {saving ? "Saving…" : "Save capital profile"}
        </Button>
        {saveNote && (
          <span className="text-sm text-emerald-700 dark:text-emerald-300">
            {saveNote}
          </span>
        )}
      </div>

      {raisesList}
    </div>
  );
}

"use client";

/**
 * New investment form (Oct 24, 2026) — the type-first create/edit
 * form for deals, replacing the stacked edit form that used to live
 * inside DealModal. DealModal renders this component for both create
 * and edit, and the deal detail page edits through DealModal — so
 * the form and the detail page can never disagree (§5 parity).
 *
 * Layout: ~1100px dialog; type selector cards first; collapsible
 * sections down the middle with a section rail on the left; a sticky
 * live summary on the right (valuation estimate for LBO / Add-on,
 * round math for Early Stage) that collapses to a bottom bar on
 * mobile. Metric sections render FROM bd.metric_definitions
 * (config.section, assigned by the bd-form-sections-v1 migration and
 * editable in Settings) — no per-type field lists are hard-coded.
 *
 * Losslessness: record fields are all kept in form state and always
 * submitted (hidden sections included); bd metrics are submitted
 * only for the current type's applicable definitions, and the
 * deal-metrics endpoint only touches keys it is sent — values for a
 * previous type stay on record, unrendered, exactly as before.
 */

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  EARLY_STAGE_STAGES,
  INVESTMENT_TYPE_LABELS,
  PARTNER_NAMES,
  PLATFORM_LBO_STAGES,
  stageForTypeChange,
  type Deal,
  type DealDrivers,
  type Executive,
  type InvestmentTypeKey,
  type MiMultiple,
} from "@/lib/types";
import {
  TypeBadge,
  applicableDefs,
  fetchBdBootstrap,
  metricRawValue,
  stagesForType,
  type BdBootstrap,
  type BdMetricDefinition,
} from "@/components/InvestmentTypeBits";
import { CompLogSection, EstimateBody } from "@/components/Modals";
import { fmtMoney, uniqueStrings } from "@/lib/format";
import {
  DRIVER_DEFS,
  estimateMultiple,
  type MarketRates,
} from "@/lib/valuation";
import {
  TYPE_CARD_BLURBS,
  blendedMultiple,
  computeRoundMath,
  formSections,
  headlineMultiple,
} from "@/lib/bd/sections";

const inputCls =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-[#b8975a] focus:outline-none dark:border-white/15 dark:bg-[#0d1f3c] dark:text-[#e8dfc8] dark:placeholder:text-white/30";
const labelCls = "mb-1 block text-xs font-medium text-slate-600 dark:text-[#c8bfa8]";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className={labelCls}>{label}</label>
      {children}
    </div>
  );
}

const DRIVER_KEYS_SHORT: Array<keyof DealDrivers> = [
  "concentration",
  "ownerDependence",
  "financials",
];

export interface DealFormProps {
  deal: Deal | null; // null = create new
  executives?: Executive[];
  allDeals?: Deal[];
  /** Pipeline's active type chip, preselected for a new deal. */
  initialType?: string;
  onClose: () => void;
  onSaved: () => void;
}

export default function DealForm({
  deal,
  executives = [],
  allDeals = [],
  initialType,
  onClose,
  onSaved,
}: DealFormProps) {
  const router = useRouter();
  const isNew = !deal;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    companyName: deal?.companyName ?? "",
    industry: deal?.industry ?? "",
    stage: deal?.stage ?? ("Sourced" as Deal["stage"]),
    investmentType: (deal?.investmentType ??
      (initialType as InvestmentTypeKey) ??
      "platform_lbo") as InvestmentTypeKey,
    parentDealId: deal?.parentDealId ?? "",
    sourcedFromType: deal?.sourcedFromType ?? "",
    sourcedFromId: deal?.sourcedFromId ?? "",
    dealValue: deal?.dealValue?.toString() ?? "",
    contactName: deal?.contactName ?? "",
    contactEmail: deal?.contactEmail ?? "",
    notes: deal?.notes ?? "",
    owner: deal?.owner ?? "",
    city: deal?.city ?? "",
    website: deal?.website ?? "",
    codename: deal?.codename ?? "",
    codenameExternal: deal?.codenameExternal !== false,
    operatorIds: deal?.operatorIds ?? [],
    revenue: deal?.revenue != null ? String(deal.revenue) : "",
    ebitda: deal?.ebitda != null ? String(deal.ebitda) : "",
    askingPrice: deal?.askingPrice != null ? String(deal.askingPrice) : "",
    growthPct: deal?.growthPct != null ? String(deal.growthPct) : "",
    topCustomerPct: deal?.metrics?.topCustomerPct != null ? String(deal.metrics.topCustomerPct) : "",
    top3Pct: deal?.metrics?.top3Pct != null ? String(deal.metrics.top3Pct) : "",
    recurringPct: deal?.metrics?.recurringPct != null ? String(deal.metrics.recurringPct) : "",
    ownerHoursPerWeek: deal?.metrics?.ownerHoursPerWeek != null ? String(deal.metrics.ownerHoursPerWeek) : "",
    broker: deal?.broker ?? "",
    source: deal?.source ?? "",
    passReason: deal?.passReason ?? "",
    links: (deal?.links ?? [])
      .map((l) => ({ label: l.label ?? "", url: l.url ?? "" }))
      .concat([{ label: "", url: "" }]),
    drivers: { ...(deal?.drivers ?? {}) } as DealDrivers,
    cashAmt: deal?.structure?.cashAmt != null ? String(deal.structure.cashAmt) : "",
    sellerAmt: deal?.structure?.sellerAmt != null ? String(deal.structure.sellerAmt) : "",
    earnoutAmt: deal?.structure?.earnoutAmt != null ? String(deal.structure.earnoutAmt) : "",
    rolloverAmt: deal?.structure?.rolloverAmt != null ? String(deal.structure.rolloverAmt) : "",
    sellerRatePct: deal?.structure?.sellerRatePct != null ? String(deal.structure.sellerRatePct) : "",
    sellerTermYrs: deal?.structure?.sellerTermYrs != null ? String(deal.structure.sellerTermYrs) : "",
    earnoutMetric: deal?.structure?.earnoutMetric ?? "",
    earnoutPeriodYrs: deal?.structure?.earnoutPeriodYrs != null ? String(deal.structure.earnoutPeriodYrs) : "",
    earnoutProbPct: deal?.structure?.earnoutProbPct != null ? String(deal.structure.earnoutProbPct) : "",
    rolloverVestYrs: deal?.structure?.rolloverVestYrs != null ? String(deal.structure.rolloverVestYrs) : "",
    rolloverProbPct: deal?.structure?.rolloverProbPct != null ? String(deal.structure.rolloverProbPct) : "",
  });

  const setLink = (i: number, k: "label" | "url", v: string) =>
    setForm((f) => ({ ...f, links: f.links.map((l, j) => (j === i ? { ...l, [k]: v } : l)) }));
  const addLinkRow = () => setForm((f) => ({ ...f, links: [...f.links, { label: "", url: "" }] }));
  const removeLinkRow = (i: number) =>
    setForm((f) => ({ ...f, links: f.links.filter((_, j) => j !== i) }));

  const opsTouched = useRef(false);
  const toggleOperator = (id: string) => {
    opsTouched.current = true;
    setForm((f) => ({
      ...f,
      operatorIds: f.operatorIds.includes(id)
        ? f.operatorIds.filter((x) => x !== id)
        : [...f.operatorIds, id],
    }));
  };
  const [opSearch, setOpSearch] = useState("");

  const set = (k: keyof typeof form) => (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
  ) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const setDriver = (key: keyof DealDrivers, v: string) =>
    setForm((f) => ({ ...f, drivers: { ...f.drivers, [key]: v as DealDrivers[typeof key] } }));

  /* ---- Market multiples / rates for the live estimate ---- */
  const [multiples, setMultiples] = useState<MiMultiple[]>([]);
  const [rates, setRates] = useState<MarketRates>({});
  const loadMultiples = () => {
    fetch("/api/market/multiples")
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => setMultiples(Array.isArray(d) ? d : []))
      .catch(() => {});
    fetch("/api/market/rates")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setRates({ prime: d?.prime?.value ?? null, sba: d?.sba?.value ?? null }))
      .catch(() => {});
  };
  useEffect(() => {
    loadMultiples();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---- bd config + this deal's structured metrics (cached once) ---- */
  const [bd, setBd] = useState<BdBootstrap | null>(null);
  const [metricForm, setMetricForm] = useState<Record<string, string>>({});
  const metricsSeeded = useRef(false);
  useEffect(() => {
    void fetchBdBootstrap().then((b) => {
      setBd(b);
      if (b && deal && !metricsSeeded.current) {
        metricsSeeded.current = true;
        const existing = b.metricsByDeal[deal.id] ?? {};
        const seed: Record<string, string> = {};
        for (const def of b.config.definitions) {
          seed[def.key] = metricRawValue(def, existing[def.key]);
        }
        setMetricForm(seed);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stageOptionsFor = (typeKey: string): string[] => {
    const fromCfg = bd ? stagesForType(bd.config, typeKey) : [];
    if (fromCfg.length) return fromCfg;
    return typeKey === "early_stage" ? [...EARLY_STAGE_STAGES] : [...PLATFORM_LBO_STAGES];
  };

  /* ---- Type switching: warn about entered fields that will hide ---- */
  const [typeWarning, setTypeWarning] = useState<{ from: string; labels: string[] } | null>(null);
  const hiddenLabelsFor = (fromType: string, toType: string): string[] => {
    if (!bd || fromType === toType) return [];
    const labels: string[] = [];
    const newKeys = new Set(
      applicableDefs(bd.config, toType as InvestmentTypeKey, form.industry).map((d) => d.key)
    );
    for (const d of applicableDefs(bd.config, fromType as InvestmentTypeKey, form.industry)) {
      if (!newKeys.has(d.key) && (metricForm[d.key] ?? "").trim() !== "") {
        labels.push(d.label);
      }
    }
    const hasDrivers = (Object.keys(form.drivers) as Array<keyof DealDrivers>).some(
      (k) => form.drivers[k]
    );
    const hasStructure = [
      form.cashAmt, form.sellerAmt, form.earnoutAmt, form.rolloverAmt,
      form.sellerRatePct, form.sellerTermYrs, form.earnoutPeriodYrs,
      form.earnoutProbPct, form.rolloverVestYrs, form.rolloverProbPct,
    ].some((v) => v.trim() !== "") || form.earnoutMetric !== "";
    const hasMeasured = [form.topCustomerPct, form.top3Pct, form.recurringPct, form.ownerHoursPerWeek].some(
      (v) => v.trim() !== ""
    );
    if (toType === "early_stage") {
      if (hasDrivers) labels.push("Qualitative drivers");
      if (hasMeasured) labels.push("Measured metrics");
      if (hasStructure) labels.push("Deal structure");
    }
    if (fromType === "early_stage" && form.sourcedFromId) labels.push("Sourced from");
    if (fromType !== "add_on" && toType === "add_on") {
      /* parent picker appears; nothing hides */
    }
    return labels;
  };
  const onTypeChange = (next: InvestmentTypeKey) => {
    const labels = hiddenLabelsFor(form.investmentType, next);
    setTypeWarning(
      labels.length
        ? { from: INVESTMENT_TYPE_LABELS[form.investmentType], labels }
        : null
    );
    setForm((f) => ({
      ...f,
      investmentType: next,
      stage: stageForTypeChange(f.stage, stageOptionsFor(next)),
    }));
  };

  /* ---- Duplicate check: pipeline (instant) + Directory (debounced) ---- */
  const norm = (v: string) => v.toLowerCase().replace(/[^a-z0-9]/g, "");
  const pipelineDupe = (() => {
    const q = norm(form.companyName);
    if (q.length <= 2) return null;
    return (
      allDeals.find(
        (d) =>
          d.id !== deal?.id &&
          (norm(d.companyName) === q || norm(d.companyName).includes(q) || q.includes(norm(d.companyName)))
      ) ?? null
    );
  })();
  const [dirDupes, setDirDupes] = useState<string[]>([]);
  const dupeTimer = useRef<number | null>(null);
  const lastDupeQuery = useRef("");
  useEffect(() => {
    const name = form.companyName.trim();
    if (!isNew && deal && name === deal.companyName) {
      setDirDupes([]);
      return;
    }
    if (name.length < 3) {
      setDirDupes([]);
      return;
    }
    if (dupeTimer.current) window.clearTimeout(dupeTimer.current);
    dupeTimer.current = window.setTimeout(() => {
      if (lastDupeQuery.current === name) return;
      lastDupeQuery.current = name;
      fetch(`/api/platform/search?q=${encodeURIComponent(name)}&type=company&limit=5`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          const hits = (d?.results ?? []) as Array<{ id: string; title: string }>;
          const q = norm(name);
          setDirDupes(
            hits
              .filter((h) => {
                const t = norm(h.title);
                return t === q || t.includes(q) || q.includes(t);
              })
              .map((h) => h.title)
          );
        })
        .catch(() => {});
    }, 400);
    return () => {
      if (dupeTimer.current) window.clearTimeout(dupeTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.companyName]);

  /* ---- Derived record (drives the live estimate) ---- */
  const structureFromForm = () => ({
    cashAmt: form.cashAmt.trim() === "" ? null : Number(form.cashAmt),
    sellerAmt: form.sellerAmt.trim() === "" ? null : Number(form.sellerAmt),
    earnoutAmt: form.earnoutAmt.trim() === "" ? null : Number(form.earnoutAmt),
    rolloverAmt: form.rolloverAmt.trim() === "" ? null : Number(form.rolloverAmt),
    sellerRatePct: form.sellerRatePct.trim() === "" ? null : Number(form.sellerRatePct),
    sellerTermYrs: form.sellerTermYrs.trim() === "" ? null : Number(form.sellerTermYrs),
    earnoutMetric: form.earnoutMetric || undefined,
    earnoutPeriodYrs: form.earnoutPeriodYrs.trim() === "" ? null : Number(form.earnoutPeriodYrs),
    earnoutProbPct: form.earnoutProbPct.trim() === "" ? null : Number(form.earnoutProbPct),
    rolloverVestYrs: form.rolloverVestYrs.trim() === "" ? null : Number(form.rolloverVestYrs),
    rolloverProbPct: form.rolloverProbPct.trim() === "" ? null : Number(form.rolloverProbPct),
    cashPct: deal?.structure?.cashPct ?? null,
    sellerPct: deal?.structure?.sellerPct ?? null,
    earnoutPct: deal?.structure?.earnoutPct ?? null,
    rolloverPct: deal?.structure?.rolloverPct ?? null,
  });
  const metricsFromForm = () => ({
    topCustomerPct: form.topCustomerPct.trim() === "" ? null : Number(form.topCustomerPct),
    top3Pct: form.top3Pct.trim() === "" ? null : Number(form.top3Pct),
    recurringPct: form.recurringPct.trim() === "" ? null : Number(form.recurringPct),
    ownerHoursPerWeek: form.ownerHoursPerWeek.trim() === "" ? null : Number(form.ownerHoursPerWeek),
  });
  const formDeal: Deal = {
    id: deal?.id ?? "new",
    companyName: form.companyName,
    industry: form.industry,
    stage: form.stage,
    investmentType: form.investmentType,
    parentDealId: form.parentDealId || null,
    sourcedFromType: (form.sourcedFromType || null) as Deal["sourcedFromType"],
    sourcedFromId: form.sourcedFromId || null,
    codename: form.codename,
    codenameExternal: form.codenameExternal,
    website: form.website,
    dealValue: Number(form.dealValue) || 0,
    revenue: form.revenue.trim() === "" ? null : Number(form.revenue) || null,
    ebitda: form.ebitda.trim() === "" ? null : Number(form.ebitda) || null,
    askingPrice: form.askingPrice.trim() === "" ? null : Number(form.askingPrice) || null,
    growthPct: form.growthPct.trim() === "" ? null : Number(form.growthPct),
    broker: form.broker,
    source: form.source,
    passReason: form.passReason,
    contactName: "",
    contactEmail: "",
    notes: "",
    owner: form.owner,
    city: form.city,
    lat: null,
    lng: null,
    links: [],
    operatorIds: form.operatorIds,
    drivers: form.drivers,
    structure: structureFromForm(),
    metrics: metricsFromForm(),
    createdAt: deal?.createdAt ?? "",
    updatedAt: deal?.updatedAt ?? "",
  };
  const est = estimateMultiple(formDeal, multiples, rates);

  /* ---- Definitions by form section ---- */
  const applicable = bd
    ? applicableDefs(bd.config, form.investmentType, form.industry)
    : [];
  const fallbackSection = (d: BdMetricDefinition): string =>
    d.appliesTo.startsWith("sector:")
      ? "sector_pack"
      : form.investmentType === "platform_lbo"
        ? "lbo_metrics"
        : form.investmentType === "add_on"
          ? "addon_metrics"
          : "traction";
  const defsForSection = (key: string): BdMetricDefinition[] =>
    applicable.filter((d) => (d.config.section ?? fallbackSection(d)) === key);
  const sectorPackApplies = defsForSection("sector_pack").length > 0;
  const sections = formSections(form.investmentType, sectorPackApplies);

  /* ---- Early Stage round math (live, display-derived) ---- */
  const mnum = (key: string): number | null => {
    const v = (metricForm[key] ?? "").trim();
    if (v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const roundMath = computeRoundMath({
    instrument: metricForm.instrument ?? "",
    preMoney: mnum("pre_money"),
    valuationCap: mnum("valuation_cap"),
    discountPct: mnum("discount_pct"),
    roundSize: mnum("round_size"),
    checkSize: mnum("check_size"),
    arr: mnum("arr"),
    revenue: form.revenue.trim() === "" ? null : Number(form.revenue),
  });

  /* ---- Add-on platform comparison ---- */
  const parentDeal = allDeals.find((x) => x.id === form.parentDealId) ?? null;
  const parentPrice = parentDeal ? parentDeal.askingPrice || parentDeal.dealValue || null : null;
  const parentMultiple = parentDeal ? headlineMultiple(parentPrice, parentDeal.ebitda) : null;
  const addonPrice = form.askingPrice.trim() === "" ? Number(form.dealValue) || null : Number(form.askingPrice);
  const addonHeadline = headlineMultiple(addonPrice, form.ebitda.trim() === "" ? null : Number(form.ebitda));
  const blended = parentDeal
    ? blendedMultiple(parentPrice, parentDeal.ebitda, addonPrice, form.ebitda.trim() === "" ? null : Number(form.ebitda))
    : null;

  const onParentChange = (id: string) => {
    setForm((f) => {
      const parent = allDeals.find((x) => x.id === id);
      return {
        ...f,
        parentDealId: id,
        // Paired operators default to the platform's until Ethan edits them.
        operatorIds:
          parent && !opsTouched.current ? [...(parent.operatorIds ?? [])] : f.operatorIds,
      };
    });
  };

  /* ---- Completion indicators ---- */
  const filled = (vals: Array<string | number | boolean | null | undefined>) =>
    vals.filter((v) => v !== null && v !== undefined && String(v).trim() !== "").length;
  const sectionCount = (key: string): { n: number; total: number } | null => {
    switch (key) {
      case "basics": {
        const base = [form.companyName, form.industry, form.city, form.revenue, form.ebitda, form.askingPrice, form.dealValue, form.website, form.codename];
        const esDefs = defsForSection("es_basics");
        return {
          n: filled(base) + esDefs.filter((d) => (metricForm[d.key] ?? "").trim() !== "").length,
          total: base.length + esDefs.length,
        };
      }
      case "parent":
        return { n: form.parentDealId ? 1 : 0, total: 1 };
      case "drivers": {
        const short = form.investmentType === "add_on";
        const driverKeys: Array<keyof DealDrivers> = short
          ? DRIVER_KEYS_SHORT
          : DRIVER_DEFS.map((d) => d.key);
        // Growth outlook renders only in the full (non-add-on) drivers
        // section, so it counts only there.
        return {
          n:
            driverKeys.filter((k) => form.drivers[k]).length +
            (!short && form.growthPct.trim() !== "" ? 1 : 0),
          total: driverKeys.length + (short ? 0 : 1),
        };
      }
      case "measured":
        return {
          n: filled([form.topCustomerPct, form.top3Pct, form.recurringPct, form.ownerHoursPerWeek]),
          total: 4,
        };
      case "structure":
        return {
          n: filled([form.cashAmt, form.sellerAmt, form.earnoutAmt, form.rolloverAmt, form.sellerRatePct, form.sellerTermYrs, form.earnoutMetric, form.earnoutPeriodYrs, form.earnoutProbPct, form.rolloverVestYrs, form.rolloverProbPct]),
          total: 11,
        };
      case "sourced_from":
        return { n: form.sourcedFromId ? 1 : 0, total: 1 };
      case "source":
        return {
          n: filled([form.broker, form.source, form.contactName, form.contactEmail, form.owner, form.notes]) +
            (form.operatorIds.length ? 1 : 0) +
            (form.links.some((l) => l.url.trim() !== "") ? 1 : 0),
          total: 8,
        };
      default: {
        const defs = defsForSection(key);
        if (!defs.length) return null;
        return {
          n: defs.filter((d) => (metricForm[d.key] ?? "").trim() !== "").length,
          total: defs.length,
        };
      }
    }
  };

  /* ---- Collapsible sections + rail ---- */
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({});
  const isOpen = (key: string) => openSections[key] !== false;
  const toggleSection = (key: string) =>
    setOpenSections((s) => ({ ...s, [key]: !isOpen(key) }));
  const sectionRefs = useRef<Record<string, HTMLElement | null>>({});
  const scrollToSection = (key: string) => {
    setOpenSections((s) => ({ ...s, [key]: true }));
    requestAnimationFrame(() => {
      sectionRefs.current[key]?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };
  const [mobileSummaryOpen, setMobileSummaryOpen] = useState(false);

  /* ---- Save ---- */
  const save = async (mode: "save" | "saveAndOpen") => {
    if (!form.companyName.trim()) {
      setError("Company name is required");
      return;
    }
    if (form.investmentType === "add_on" && !form.parentDealId) {
      setError("Add-on deals require a parent platform deal — pick one in the Parent platform section.");
      scrollToSection("parent");
      return;
    }
    setBusy(true);
    setError("");
    const payload = {
      ...form,
      investmentType: form.investmentType,
      parentDealId: form.parentDealId || null,
      sourcedFromType: form.sourcedFromType || null,
      sourcedFromId: form.sourcedFromId || null,
      codename: form.codename.trim(),
      codenameExternal: form.codenameExternal,
      website: form.website.trim(),
      dealValue: Number(form.dealValue) || 0,
      links: form.links.filter((l) => l.url.trim() !== ""),
      operatorIds: form.operatorIds,
      revenue: form.revenue.trim() === "" ? null : Number(form.revenue) || null,
      ebitda: form.ebitda.trim() === "" ? null : Number(form.ebitda) || null,
      askingPrice: form.askingPrice.trim() === "" ? null : Number(form.askingPrice) || null,
      growthPct: form.growthPct.trim() === "" ? null : Number(form.growthPct),
      drivers: form.drivers,
      structure: structureFromForm(),
      metrics: metricsFromForm(),
    };
    let res = await fetch(isNew ? "/api/deals" : `/api/deals/${deal!.id}`, {
      method: isNew ? "POST" : "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    // Phase 10 stage gates: a blocked stage change names the unmet
    // conditions; the user may override with a reason (audit-logged
    // server-side) or cancel and fix the conditions.
    if (res.status === 409 && !isNew) {
      const d = await res.json().catch(() => ({}));
      if (d.error === "stage_gate_blocked") {
        const list = (Array.isArray(d.unmet) ? d.unmet : [])
          .map((u: { label?: string }) => `• ${u.label ?? ""}`)
          .join("\n");
        const reason = window.prompt(
          `This stage change is blocked — unmet conditions:\n${list}\n\nEnter a reason to override (recorded in the audit trail), or cancel:`,
          ""
        );
        if (reason && reason.trim()) {
          res = await fetch(`/api/deals/${deal!.id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...payload, gateOverride: { reason: reason.trim() } }),
          });
        }
      }
    }
    if (!res.ok) {
      setBusy(false);
      const d = await res.json().catch(() => ({}));
      setError(d.message || d.error || "Failed to save");
      return;
    }
    let savedId = deal?.id ?? null;
    if (isNew) {
      const created = (await res.clone().json().catch(() => null)) as { id?: string } | null;
      savedId = created?.id ?? null;
    }
    // Structured type/sector metrics ride along. Values are sent ONLY
    // for the current type's applicable definitions; previously
    // stored values for other types are never deleted by a save.
    if (savedId && bd) {
      const values: Record<string, string> = {};
      for (const d of applicableDefs(bd.config, form.investmentType, form.industry)) {
        values[d.key] = metricForm[d.key] ?? "";
      }
      // Early Stage: persist the live-computed ownership when the
      // field itself was left blank and the round math derives one.
      if (
        form.investmentType === "early_stage" &&
        roundMath.ownershipPct !== null &&
        !(values.ownership_pct ?? "").trim()
      ) {
        values.ownership_pct = String(Math.round(roundMath.ownershipPct * 100) / 100);
      }
      const mres = await fetch("/api/platform/investment-types/deal-metrics", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dealId: savedId, values }),
      });
      if (!mres.ok) {
        setBusy(false);
        const md = await mres.json().catch(() => ({}));
        setError(
          `Deal saved, but its type metrics failed: ${md.error ?? mres.status}. Reopen and save again to retry.`
        );
        return;
      }
    }
    setBusy(false);
    if (mode === "saveAndOpen" && isNew && savedId) {
      onSaved();
      router.push(`/deals/${savedId}`);
      return;
    }
    onSaved();
  };

  /* ---- Render helpers ---- */
  const renderMetricDef = (d: BdMetricDefinition) => (
    <Field key={d.key} label={`${d.label}${d.required ? " *" : ""}`}>
      {d.dataType === "bool" ? (
        <select
          className={inputCls}
          value={metricForm[d.key] ?? ""}
          onChange={(e) => setMetricForm((m) => ({ ...m, [d.key]: e.target.value }))}
        >
          <option value="">—</option>
          <option value="yes">Yes</option>
          <option value="no">No</option>
        </select>
      ) : d.dataType === "enum" ? (
        <select
          className={inputCls}
          value={metricForm[d.key] ?? ""}
          onChange={(e) => setMetricForm((m) => ({ ...m, [d.key]: e.target.value }))}
        >
          <option value="">—</option>
          {(d.config.options ?? []).map((o) => (
            <option key={o} value={o}>{o}</option>
          ))}
        </select>
      ) : (
        <input
          type={d.dataType === "date" ? "date" : d.dataType === "text" ? "text" : "number"}
          step="any"
          className={inputCls}
          value={metricForm[d.key] ?? ""}
          onChange={(e) => setMetricForm((m) => ({ ...m, [d.key]: e.target.value }))}
          placeholder="—"
        />
      )}
    </Field>
  );

  const metricGrid = (key: string) => {
    const defs = defsForSection(key);
    if (!defs.length) return null;
    return <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{defs.map(renderMetricDef)}</div>;
  };

  const typeOptions = (bd?.config.types ?? [])
    .filter((t) => t.enabled || t.key === form.investmentType)
    .map((t) => ({ key: t.key as InvestmentTypeKey, label: t.label }));
  const visibleTypes = bd
    ? typeOptions
    : (Object.keys(INVESTMENT_TYPE_LABELS) as InvestmentTypeKey[])
        .filter((k) => k !== "minority_growth")
        .map((k) => ({ key: k, label: INVESTMENT_TYPE_LABELS[k] }));

  const summaryBody = (
    <div className="flex flex-col gap-3 text-sm">
      {form.investmentType === "early_stage" ? (
        <>
          <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400 dark:text-white/40">
            Round math — live estimate
          </p>
          {roundMath.postMoney !== null ? (
            <div className="flex flex-col gap-1.5">
              <p className="flex justify-between gap-2"><span className="text-slate-500 dark:text-white/50">Post-money</span><strong>{fmtMoney(Math.round(roundMath.postMoney))}</strong></p>
              <p className="flex justify-between gap-2"><span className="text-slate-500 dark:text-white/50">Our check</span><strong>{mnum("check_size") !== null ? fmtMoney(mnum("check_size")!) : "—"}</strong></p>
              <p className="flex justify-between gap-2"><span className="text-slate-500 dark:text-white/50">Our ownership</span><strong>{roundMath.ownershipPct !== null ? `${roundMath.ownershipPct.toFixed(1)}%` : "—"}</strong></p>
              <p className="flex justify-between gap-2"><span className="text-slate-500 dark:text-white/50">Implied revenue ×</span><strong>{roundMath.impliedRevenueMultiple !== null ? `${roundMath.impliedRevenueMultiple.toFixed(1)}×` : "—"}</strong></p>
              <p className="text-[11px] leading-snug text-slate-400 dark:text-white/40">
                From the round terms as entered (cap less discount for a SAFE / note; pre-money + round for a priced round). Estimates, not stored terms.
              </p>
            </div>
          ) : (
            <p className="text-xs text-slate-400 dark:text-white/40">
              Enter a valuation cap (SAFE / note) or pre-money (priced round) plus the round size to see post-money and ownership.
            </p>
          )}
        </>
      ) : (
        <>
          <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400 dark:text-white/40">
            Valuation estimate — live
          </p>
          {est ? (
            <div className="flex flex-col gap-1.5">
              <p className="flex justify-between gap-2"><span className="text-slate-500 dark:text-white/50">Headline</span><strong>{((est.headlineLow + est.headlineHigh) / 2).toFixed(2)}×</strong></p>
              <p className="flex justify-between gap-2"><span className="text-slate-500 dark:text-white/50">Market multiple</span><strong>{est.marketMid.toFixed(2)}×</strong></p>
              <p className="flex justify-between gap-2"><span className="text-slate-500 dark:text-white/50">Effective</span><strong>{est.effMid.toFixed(2)}×</strong></p>
              <p className="flex justify-between gap-2"><span className="text-slate-500 dark:text-white/50">Market effective est.</span><strong>{est.estimateEffMid.toFixed(2)}×</strong></p>
              {est.largestDriver && (
                <p className="text-[11px] leading-snug text-slate-400 dark:text-white/40">
                  Largest driver: {est.largestDriver.label} ({est.largestDriver.adj > 0 ? "+" : "−"}{Math.abs(est.largestDriver.adj).toFixed(2)}×) · Lens: {est.lens}
                </p>
              )}
            </div>
          ) : (
            <p className="text-xs text-slate-400 dark:text-white/40">
              Needs an industry that matches Market Intel plus revenue/EBITDA on the deal.
            </p>
          )}
          {form.investmentType === "add_on" && parentDeal && (
            <div className="flex flex-col gap-1.5 border-t border-slate-100 pt-2 dark:border-white/10">
              <p className="flex justify-between gap-2"><span className="text-slate-500 dark:text-white/50">Platform ({parentDeal.companyName})</span><strong>{parentMultiple !== null ? `${parentMultiple.toFixed(2)}×` : "—"}</strong></p>
              <p className="flex justify-between gap-2"><span className="text-slate-500 dark:text-white/50">This add-on</span><strong>{addonHeadline !== null ? `${addonHeadline.toFixed(2)}×` : "—"}</strong></p>
              <p className="flex justify-between gap-2"><span className="text-slate-500 dark:text-white/50">Blended pro forma</span><strong>{blended !== null ? `${blended.toFixed(2)}×` : "—"}</strong></p>
            </div>
          )}
        </>
      )}
    </div>
  );

  const panelRef = useRef<HTMLDivElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    panelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCloseRef.current();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const title = isNew
    ? `New ${INVESTMENT_TYPE_LABELS[form.investmentType]}`
    : deal!.companyName;

  const renderSectionBody = (key: string) => {
    switch (key) {
      case "parent":
        return (
          <Field label="Parent platform *">
            <select
              className={inputCls}
              value={form.parentDealId}
              onChange={(e) => onParentChange(e.target.value)}
            >
              <option value="">Select the platform this bolts onto…</option>
              {allDeals
                .filter(
                  (x) =>
                    (x.investmentType ?? "platform_lbo") === "platform_lbo" &&
                    x.id !== deal?.id
                )
                .map((x) => {
                  const m = headlineMultiple(x.askingPrice || x.dealValue || null, x.ebitda);
                  return (
                    <option key={x.id} value={x.id}>
                      {x.companyName}{m !== null ? ` — ${m.toFixed(2)}×` : ""}
                    </option>
                  );
                })}
            </select>
            <p className="mt-1 text-[11px] text-slate-400 dark:text-white/40">
              Required for add-ons. Paired operators default to the platform&rsquo;s until you change them.
            </p>
          </Field>
        );
      case "basics":
        return (
          <div className="flex flex-col gap-3">
            <Field label="Company name *">
              <input className={inputCls} value={form.companyName} onChange={set("companyName")} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label={form.investmentType === "early_stage" ? "Sector / industry" : "Industry"}>
                <input className={inputCls} value={form.industry} onChange={set("industry")} />
              </Field>
              <Field label="City">
                <input className={inputCls} value={form.city} onChange={set("city")} placeholder="e.g. Scottsdale, AZ" />
              </Field>
            </div>
            {defsForSection("es_basics").length > 0 && (
              <div className="grid grid-cols-2 gap-2">{defsForSection("es_basics").map(renderMetricDef)}</div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <Field label="Website">
                <input className={inputCls} value={form.website} onChange={set("website")} placeholder="https://…" />
              </Field>
              <Field label="Codename">
                <input className={inputCls} value={form.codename} onChange={set("codename")} placeholder="Shown on external surfaces" />
              </Field>
            </div>
            <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-600 dark:text-[#c8bfa8]">
              <input
                type="checkbox"
                checked={form.codenameExternal}
                onChange={(e) => setForm((f) => ({ ...f, codenameExternal: e.target.checked }))}
                className="h-4 w-4 accent-[#b8975a]"
              />
              Use the codename (and hide the logo) on external surfaces — calendar invites, shared links, guest views, reports
            </label>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Revenue (USD)">
                <input type="number" min="0" className={inputCls} value={form.revenue} onChange={set("revenue")} placeholder="—" />
              </Field>
              <Field label="EBITDA / SDE (USD)">
                <input type="number" min="0" className={inputCls} value={form.ebitda} onChange={set("ebitda")} placeholder="—" />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Asking price (USD)">
                <input type="number" min="0" className={inputCls} value={form.askingPrice} onChange={set("askingPrice")} placeholder="—" />
              </Field>
              <Field label="Deal value (USD)">
                <input type="number" min="0" className={inputCls} value={form.dealValue} onChange={set("dealValue")} />
              </Field>
            </div>
          </div>
        );
      case "valuation":
        return (
          <div className="flex flex-col gap-3">
            {est ? (
              <EstimateBody est={est} />
            ) : (
              <p className="text-xs text-slate-400 dark:text-white/40">
                Needs an industry that matches Market Intel plus revenue/EBITDA on the deal.
              </p>
            )}
            {form.investmentType === "add_on" && (
              <div className="rounded-xl border border-slate-200 px-3 py-2 text-xs dark:border-white/10">
                <p className="font-semibold text-slate-700 dark:text-[#e8dfc8]">Against the platform</p>
                <p className="mt-1 text-slate-500 dark:text-white/50">
                  {parentDeal ? (
                    <>
                      {parentDeal.companyName} headline {parentMultiple !== null ? `${parentMultiple.toFixed(2)}×` : "—"} · this add-on {addonHeadline !== null ? `${addonHeadline.toFixed(2)}×` : "—"} · blended pro forma {blended !== null ? `${blended.toFixed(2)}×` : "—"} (combined price ÷ combined EBITDA, display-derived).
                    </>
                  ) : (
                    "Pick the parent platform above to compare multiples and see the blended pro forma."
                  )}
                </p>
              </div>
            )}
          </div>
        );
      case "drivers": {
        const defs = form.investmentType === "add_on"
          ? DRIVER_DEFS.filter((d) => (DRIVER_KEYS_SHORT as string[]).includes(d.key))
          : DRIVER_DEFS;
        return (
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {defs.map((def) => (
                <label key={def.key} className="block">
                  <span className={labelCls}>{def.label}</span>
                  <select
                    className={inputCls}
                    value={form.drivers[def.key] ?? ""}
                    onChange={(e) => setDriver(def.key, e.target.value)}
                  >
                    <option value="">Not noted yet</option>
                    <option value="neg">{def.negLabel} (−{def.weight.toFixed(2)}×)</option>
                    <option value="neu">{def.neuLabel} (no change)</option>
                    <option value="pos">{def.posLabel} (+{def.weight.toFixed(2)}×)</option>
                  </select>
                </label>
              ))}
            </div>
            {form.investmentType !== "add_on" && (
              <div className="flex flex-wrap items-end gap-3">
                <div className="w-52">
                  <Field label="Growth outlook — projected growth %/yr">
                    <input type="number" step="1" className={inputCls} value={form.growthPct} onChange={set("growthPct")} placeholder="e.g. 10" />
                  </Field>
                </div>
                <p className="pb-2 text-xs text-slate-500 dark:text-white/50">
                  Growth gets its own adjustment, separate from the drivers: about +0.5× per 10 points of projected growth, −0.5× per 10 points of decline (clamped at ±1.25×).
                </p>
              </div>
            )}
          </div>
        );
      }
      case "measured":
        return (
          <div className="flex flex-col gap-2">
            <p className="text-xs text-slate-500 dark:text-white/50">
              From the CIM / diligence. Each one replaces its dropdown above with a continuous adjustment that scales with the actual number and the deal&rsquo;s size.
            </p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Field label="Top customer % of revenue">
                <input type="number" min="0" max="100" className={inputCls} value={form.topCustomerPct} onChange={set("topCustomerPct")} placeholder="—" />
              </Field>
              <Field label="Top 3 customers %">
                <input type="number" min="0" max="100" className={inputCls} value={form.top3Pct} onChange={set("top3Pct")} placeholder="—" />
              </Field>
              <Field label="Recurring / contracted %">
                <input type="number" min="0" max="100" className={inputCls} value={form.recurringPct} onChange={set("recurringPct")} placeholder="—" />
              </Field>
              <Field label="Owner hours / week">
                <input type="number" min="0" max="80" className={inputCls} value={form.ownerHoursPerWeek} onChange={set("ownerHoursPerWeek")} placeholder="—" />
              </Field>
            </div>
          </div>
        );
      case "structure":
        return (
          <div className="flex flex-col gap-3">
            <p className="text-xs text-slate-500 dark:text-white/50">
              Stated amounts ($) — the headline price is their sum; leave all blank to assume the industry-typical mix.
            </p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Field label="Cash $">
                <input type="number" min="0" className={inputCls} value={form.cashAmt} onChange={set("cashAmt")} placeholder="—" />
              </Field>
              <Field label="Seller note $">
                <input type="number" min="0" className={inputCls} value={form.sellerAmt} onChange={set("sellerAmt")} placeholder="—" />
              </Field>
              <Field label="Earnout $">
                <input type="number" min="0" className={inputCls} value={form.earnoutAmt} onChange={set("earnoutAmt")} placeholder="—" />
              </Field>
              <Field label="Rollover $">
                <input type="number" min="0" className={inputCls} value={form.rolloverAmt} onChange={set("rolloverAmt")} placeholder="—" />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Seller note rate % (if known)">
                <input type="number" min="0" step="0.1" className={inputCls} value={form.sellerRatePct} onChange={set("sellerRatePct")} placeholder="—" />
              </Field>
              <Field label="Seller note term, years">
                <input type="number" min="0" step="0.5" className={inputCls} value={form.sellerTermYrs} onChange={set("sellerTermYrs")} placeholder="—" />
              </Field>
            </div>
            <p className="text-xs font-medium text-slate-600 dark:text-[#c8bfa8]">
              Earnout &amp; rollover terms — accounting style (probability-weighted, discounted at the SBA rate)
            </p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <Field label="Earnout metric">
                <select className={inputCls} value={form.earnoutMetric} onChange={set("earnoutMetric")}>
                  <option value="">—</option>
                  <option value="EBITDA">EBITDA</option>
                  <option value="Revenue">Revenue</option>
                  <option value="Gross profit">Gross profit</option>
                  <option value="Other">Other</option>
                </select>
              </Field>
              <Field label="Earnout period (yrs)">
                <input type="number" min="0" step="0.5" className={inputCls} value={form.earnoutPeriodYrs} onChange={set("earnoutPeriodYrs")} placeholder="2" />
              </Field>
              <Field label="Expected payout %">
                <input type="number" min="0" max="100" className={inputCls} value={form.earnoutProbPct} onChange={set("earnoutProbPct")} placeholder="70" />
              </Field>
              <Field label="Rollover vesting (yrs)">
                <input type="number" min="0" step="0.5" className={inputCls} value={form.rolloverVestYrs} onChange={set("rolloverVestYrs")} placeholder="—" />
              </Field>
              <Field label="Rollover retention %">
                <input type="number" min="0" max="100" className={inputCls} value={form.rolloverProbPct} onChange={set("rolloverProbPct")} placeholder="100" />
              </Field>
            </div>
            <p className="text-[11px] text-slate-400 dark:text-white/30">
              The headline is the stated total — add $100K of earnout and the headline rises $100K. The effective multiple discounts it back down, piece by piece, for expected payout and time value: cash at face value, rollover ~90¢, an earnout ~60¢. A seller note defaults to ~95¢ — but record its rate and term and it&rsquo;s priced properly against the SBA rate from Market Intel (prime + 3.00%).
            </p>
          </div>
        );
      case "round": {
        const grid = metricGrid("round");
        return (
          <div className="flex flex-col gap-3">
            {grid}
            {(roundMath.postMoney !== null || roundMath.ownershipPct !== null || roundMath.impliedRevenueMultiple !== null) && (
              <div className="flex flex-wrap gap-2 text-xs">
                {roundMath.postMoney !== null && (
                  <span className="rounded-full bg-[#0d1f3c] px-2.5 py-1 font-semibold text-white dark:bg-[#b8975a] dark:text-[#0d1f3c]">
                    Post-money ≈ {fmtMoney(Math.round(roundMath.postMoney))}
                  </span>
                )}
                {roundMath.ownershipPct !== null && (
                  <span className="rounded-full bg-slate-100 px-2.5 py-1 font-semibold text-slate-700 dark:bg-white/10 dark:text-[#e8dfc8]">
                    Our ownership ≈ {roundMath.ownershipPct.toFixed(1)}%
                  </span>
                )}
                {roundMath.impliedRevenueMultiple !== null && (
                  <span className="rounded-full bg-slate-100 px-2.5 py-1 font-semibold text-slate-700 dark:bg-white/10 dark:text-[#e8dfc8]">
                    Implied revenue multiple ≈ {roundMath.impliedRevenueMultiple.toFixed(1)}×
                  </span>
                )}
              </div>
            )}
            <p className="text-[11px] text-slate-400 dark:text-white/40">
              Calculated live from the terms above — post-money is the cap less any discount plus the round for a SAFE / note, or pre-money plus the round for a priced round. Ownership left blank is filled from this math on save.
            </p>
          </div>
        );
      }
      case "sourced_from":
        return (
          <Field label="Sourced from (flywheel)">
            <select
              className={inputCls}
              value={form.sourcedFromType && form.sourcedFromId ? `${form.sourcedFromType}:${form.sourcedFromId}` : ""}
              onChange={(e) => {
                const [t, id] = e.target.value.split(":");
                setForm((f) => ({ ...f, sourcedFromType: (t ?? "") as typeof f.sourcedFromType, sourcedFromId: id ?? "" }));
              }}
            >
              <option value="">—</option>
              {bd && bd.sourcedFromOptions.portfolioCompanies.length > 0 && (
                <optgroup label="Portfolio companies">
                  {bd.sourcedFromOptions.portfolioCompanies.map((o) => (
                    <option key={o.id} value={`company:${o.id}`}>{o.label}</option>
                  ))}
                </optgroup>
              )}
              {bd && bd.sourcedFromOptions.marketInsights.length > 0 && (
                <optgroup label="Market insights">
                  {bd.sourcedFromOptions.marketInsights.map((o) => (
                    <option key={o.id} value={`insight:${o.id}`}>{o.label}</option>
                  ))}
                </optgroup>
              )}
            </select>
          </Field>
        );
      case "source":
        return (
          <div className="flex flex-col gap-3">
            <Field label="Stage">
              <select className={inputCls} value={form.stage} onChange={set("stage")}>
                {stageOptionsFor(form.investmentType).map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
                {!stageOptionsFor(form.investmentType).includes(form.stage) && (
                  <option value={form.stage}>{form.stage}</option>
                )}
              </select>
            </Field>
            {form.stage === "Passed" && (
              <Field label="Pass reason">
                <select className={inputCls} value={form.passReason ?? ""} onChange={set("passReason")}>
                  <option value="">Select a reason…</option>
                  <option value="Valuation / price">Valuation / price</option>
                  <option value="Margins / fit">Margins / fit</option>
                  <option value="Size / scale">Size / scale</option>
                  <option value="Timing / readiness">Timing / readiness</option>
                  <option value="Financials / diligence">Financials / diligence</option>
                  <option value="Seller circumstances">Seller circumstances</option>
                  <option value="Lost to another buyer">Lost to another buyer</option>
                  <option value="Financing">Financing</option>
                  <option value="Other">Other</option>
                </select>
              </Field>
            )}
            <div className="grid grid-cols-2 gap-3">
              <Field label="Broker / intermediary">
                <input className={inputCls} value={form.broker} onChange={set("broker")} placeholder="—" />
              </Field>
              <Field label="Source">
                <select className={inputCls} value={form.source} onChange={set("source")}>
                  <option value="">—</option>
                  <option value="Proprietary">Proprietary</option>
                  <option value="Intermediated">Intermediated</option>
                  <option value="Referral">Referral</option>
                  <option value="Inbound">Inbound</option>
                </select>
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Contact name">
                <input className={inputCls} value={form.contactName} onChange={set("contactName")} />
              </Field>
              <Field label="Contact email">
                <input type="email" className={inputCls} value={form.contactEmail} onChange={set("contactEmail")} />
              </Field>
            </div>
            <Field label="Claimed by">
              <select className={inputCls} value={form.owner} onChange={set("owner")}>
                <option value="">Unclaimed</option>
                {PARTNER_NAMES.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </Field>
            <Field label="Paired operators">
              {executives.length === 0 ? (
                <p className="text-xs text-slate-400 dark:text-white/40">
                  No executives yet — add candidates in Executive Sourcing first.
                </p>
              ) : (
                <div className="flex flex-col gap-1">
                  <input
                    className={inputCls}
                    value={opSearch}
                    onChange={(e) => setOpSearch(e.target.value)}
                    placeholder="Search operators…"
                  />
                  <div className="flex max-h-40 flex-col gap-1 overflow-y-auto rounded-lg border border-slate-300 p-2 dark:border-white/15">
                    {executives
                      .filter(
                        (e) =>
                          opSearch.trim() === "" ||
                          e.name.toLowerCase().includes(opSearch.trim().toLowerCase()) ||
                          (e.industries ?? []).some((ind) => ind.toLowerCase().includes(opSearch.trim().toLowerCase()))
                      )
                      .map((e) => {
                        const isMatch =
                          form.industry.trim() !== "" &&
                          (e.industries ?? []).some(
                            (ind) => ind.toLowerCase() === form.industry.trim().toLowerCase()
                          );
                        return (
                          <label
                            key={e.id}
                            className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-slate-100 dark:hover:bg-white/5"
                          >
                            <input
                              type="checkbox"
                              checked={form.operatorIds.includes(e.id)}
                              onChange={() => toggleOperator(e.id)}
                              className="h-4 w-4 accent-[#b8975a]"
                            />
                            <span className="text-slate-800 dark:text-[#e8dfc8]">{e.name}</span>
                            {isMatch && (
                              <span className="shrink-0 rounded-full bg-emerald-100 px-1.5 py-px text-[10px] font-bold text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300">
                                ✓ industry match
                              </span>
                            )}
                            {e.industries && e.industries.length > 0 && (
                              <span className="truncate text-xs text-slate-400 dark:text-white/40">
                                {uniqueStrings(e.industries).join(", ")}
                              </span>
                            )}
                          </label>
                        );
                      })}
                  </div>
                </div>
              )}
            </Field>
            <Field label="Notes">
              <textarea className={inputCls} rows={3} value={form.notes} onChange={set("notes")} />
            </Field>
            <Field label="Links (CIM, data room, website…)">
              <div className="flex flex-col gap-2">
                {form.links.map((l, i) => (
                  <div key={i} className="flex gap-2">
                    <input className={inputCls} value={l.label} onChange={(e) => setLink(i, "label", e.target.value)} placeholder="Label" />
                    <input className={`${inputCls} flex-[2]`} value={l.url} onChange={(e) => setLink(i, "url", e.target.value)} placeholder="https://…" />
                    <button
                      type="button"
                      onClick={() => removeLinkRow(i)}
                      className="shrink-0 rounded-lg px-2 text-sm text-slate-400 hover:bg-red-50 hover:text-red-600 dark:text-white/40 dark:hover:bg-red-500/15 dark:hover:text-red-300"
                      aria-label="Remove link"
                    >
                      ✕
                    </button>
                  </div>
                ))}
                <button type="button" onClick={addLinkRow} className="btn btn-ghost btn-sm self-start">
                  + Add link
                </button>
              </div>
            </Field>
            {!isNew && deal && (form.stage === "Passed" || form.stage === "Closed Won") && (
              <CompLogSection deal={formDeal} onLogged={loadMultiples} />
            )}
          </div>
        );
      default:
        return metricGrid(key);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-2 dark:bg-black/60 sm:p-4"
      onClick={onClose}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="flex max-h-[94vh] w-full max-w-[1100px] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl focus:outline-none dark:border-white/10 dark:bg-[#132847] dark:shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-3 dark:border-white/10">
          <div className="flex min-w-0 items-center gap-2">
            <h2 className="truncate text-lg font-bold text-slate-900 dark:text-white">{title}</h2>
            {!isNew && <TypeBadge type={form.investmentType} />}
          </div>
          <button
            onClick={onClose}
            className="rounded-lg px-2 py-1 text-xl leading-none text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:text-white/50 dark:hover:bg-white/10 dark:hover:text-white"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {/* Step 1 — type first */}
        <div className="border-b border-slate-100 px-5 py-3 dark:border-white/10">
          <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400 dark:text-white/40">
            Investment type
          </p>
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
            {visibleTypes.map((t) => {
              const selected = form.investmentType === t.key;
              return (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => onTypeChange(t.key)}
                  aria-pressed={selected}
                  className={`rounded-xl border px-3 py-2 text-left transition-colors ${
                    selected
                      ? "border-[#0d1f3c] bg-[#0d1f3c] text-white ring-1 ring-[#b8975a] dark:border-[#b8975a] dark:bg-[#b8975a] dark:text-[#0d1f3c]"
                      : "border-slate-200 bg-white text-slate-700 hover:border-[#b8975a]/60 dark:border-white/15 dark:bg-white/5 dark:text-[#e8dfc8]"
                  }`}
                >
                  <span className="block text-sm font-semibold">{t.label}</span>
                  <span className={`mt-0.5 block text-[11px] leading-snug ${selected ? "text-white/70 dark:text-[#0d1f3c]/70" : "text-slate-400 dark:text-white/40"}`}>
                    {TYPE_CARD_BLURBS[t.key] ?? ""}
                  </span>
                </button>
              );
            })}
          </div>
          {typeWarning && (
            <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-500/10 dark:text-amber-200">
              Switching from {typeWarning.from}: these entered fields will be hidden for the new type — their values are kept on record, not deleted: {typeWarning.labels.join(", ")}.
            </p>
          )}
          {error && (
            <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-500/15 dark:text-red-300">{error}</p>
          )}
          {pipelineDupe && (
            <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-500/15 dark:text-amber-200">
              Possible duplicate: &ldquo;{pipelineDupe.companyName}&rdquo; is already in the pipeline ({pipelineDupe.stage}).
            </p>
          )}
          {!pipelineDupe && dirDupes.length > 0 && (
            <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-500/15 dark:text-amber-200">
              Also in the Directory: {dirDupes.join(", ")} — check it isn&rsquo;t the same company before adding a new one.
            </p>
          )}
        </div>

        <div className="flex min-h-0 flex-1">
          {/* Section rail (desktop) */}
          <nav className="hidden w-44 shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-slate-100 px-2 py-3 dark:border-white/10 lg:flex" aria-label="Form sections">
            {sections.map((s) => {
              const c = sectionCount(s.key);
              return (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => scrollToSection(s.key)}
                  className="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-xs font-medium text-slate-600 hover:bg-slate-100 dark:text-[#c8bfa8] dark:hover:bg-white/5"
                >
                  <span className="truncate">{s.title}</span>
                  {c && (
                    <span className={`shrink-0 rounded-full px-1.5 py-px text-[10px] font-bold ${c.n >= c.total ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300" : c.n > 0 ? "bg-[#b8975a]/15 text-[#8a6f3c] dark:text-[#d4b37a]" : "bg-slate-100 text-slate-400 dark:bg-white/10 dark:text-white/40"}`}>
                      {c.n}/{c.total}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>

          {/* Form column */}
          <div className="min-w-0 flex-1 overflow-y-auto px-5 py-4">
            <div className="flex flex-col gap-3">
              {sections.map((s) => {
                const c = sectionCount(s.key);
                const open = isOpen(s.key);
                return (
                  <section
                    key={s.key}
                    ref={(el) => {
                      sectionRefs.current[s.key] = el;
                    }}
                    className="scroll-mt-2 rounded-xl border border-slate-200 dark:border-white/10"
                  >
                    <button
                      type="button"
                      onClick={() => toggleSection(s.key)}
                      aria-expanded={open}
                      className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left"
                    >
                      <span className="text-sm font-semibold text-slate-900 dark:text-white">{s.title}</span>
                      <span className="flex items-center gap-2">
                        {c && (
                          <span className={`rounded-full px-1.5 py-px text-[10px] font-bold ${c.n >= c.total ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300" : c.n > 0 ? "bg-[#b8975a]/15 text-[#8a6f3c] dark:text-[#d4b37a]" : "bg-slate-100 text-slate-400 dark:bg-white/10 dark:text-white/40"}`}>
                            {c.n}/{c.total}
                          </span>
                        )}
                        <span className="text-xs text-slate-400 dark:text-white/40">{open ? "▾" : "▸"}</span>
                      </span>
                    </button>
                    {open && <div className="px-3 pb-3">{renderSectionBody(s.key)}</div>}
                  </section>
                );
              })}
            </div>
          </div>

          {/* Live summary (desktop, sticky rail) */}
          <aside className="hidden w-72 shrink-0 overflow-y-auto border-l border-slate-100 px-4 py-4 dark:border-white/10 lg:block">
            <div className="sticky top-0">{summaryBody}</div>
          </aside>
        </div>

        {/* Live summary (mobile, collapsible bottom bar) */}
        <div className="border-t border-slate-100 dark:border-white/10 lg:hidden">
          <button
            type="button"
            onClick={() => setMobileSummaryOpen((v) => !v)}
            aria-expanded={mobileSummaryOpen}
            className="flex w-full items-center justify-between px-5 py-2 text-xs font-semibold text-slate-700 dark:text-[#e8dfc8]"
          >
            <span>{form.investmentType === "early_stage" ? "Round math — live" : "Valuation estimate — live"}</span>
            <span>{mobileSummaryOpen ? "▾" : "▸"}</span>
          </button>
          {mobileSummaryOpen && <div className="max-h-56 overflow-y-auto px-5 pb-3">{summaryBody}</div>}
        </div>

        <div className="flex gap-2 border-t border-slate-100 px-5 py-3 dark:border-white/10">
          <button
            onClick={() => void save("save")}
            disabled={busy}
            data-loading={busy || undefined}
            className="btn btn-primary flex-1"
          >
            {busy ? "Saving…" : isNew ? "Save" : "Save changes"}
          </button>
          {isNew && (
            <button
              onClick={() => void save("saveAndOpen")}
              disabled={busy}
              className="btn btn-secondary flex-1"
            >
              Save and open
            </button>
          )}
          <button onClick={onClose} className="btn btn-secondary">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

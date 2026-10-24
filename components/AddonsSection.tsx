"use client";

/**
 * Platform add-ons (Investment Types Step 1, Oct 23, 2026): on a
 * platform company's profile, the add-on deals whose parent platform
 * is this company's deal, plus the pro forma blended multiple
 * (value-weighted headline multiples of platform + add-ons —
 * display-derived, never stored). Renders nothing when none of the
 * company's linked deals is a Platform LBO.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import type { Deal, MiMultiple } from "@/lib/types";
import { fmtMoney } from "@/lib/format";
import {
  estimateMultiple,
  resolveDealValue,
  type MarketRates,
} from "@/lib/valuation";
import { StageChip } from "@/components/SectorChip";

export default function AddonsSection({ dealIds }: { dealIds: string[] }) {
  const [deals, setDeals] = useState<Deal[] | null>(null);
  const [multiples, setMultiples] = useState<MiMultiple[]>([]);
  const [rates, setRates] = useState<MarketRates>({});

  useEffect(() => {
    let live = true;
    fetch("/api/deals")
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => {
        if (live) setDeals(Array.isArray(d) ? d : []);
      })
      .catch(() => {
        if (live) setDeals([]);
      });
    fetch("/api/market/multiples")
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => {
        if (live) setMultiples(Array.isArray(d) ? d : []);
      })
      .catch(() => {});
    fetch("/api/market/rates")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (live) {
          setRates({
            prime: d?.prime?.value ?? null,
            sba: d?.sba?.value ?? null,
          });
        }
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  if (!deals) return null;
  const platform = deals.find(
    (d) =>
      dealIds.includes(d.id) &&
      (d.investmentType ?? "platform_lbo") === "platform_lbo"
  );
  if (!platform) return null;

  const addons = deals.filter((d) => d.parentDealId === platform.id);
  const headlineMid = (d: Deal): number | null => {
    const e = estimateMultiple(d, multiples, rates);
    return e ? (e.headlineLow + e.headlineHigh) / 2 : null;
  };
  let blended: string | null = null;
  if (addons.length > 0) {
    let num = 0;
    let den = 0;
    for (const d of [platform, ...addons]) {
      const m = headlineMid(d);
      const v = resolveDealValue(d, multiples, rates).value;
      if (m !== null && v) {
        num += v * m;
        den += v;
      }
    }
    blended = den > 0 ? `${(num / den).toFixed(1)}×` : null;
  }

  return (
    <section className="card-surface p-5" aria-label="Add-ons">
      <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-[#0d1f3c] dark:text-white">
        Add-ons
      </h2>
      {addons.length === 0 ? (
        <p className="text-sm text-caption">
          No add-ons linked yet — set an add-on deal&apos;s parent
          platform to this deal and it will appear here with the pro
          forma blended multiple.
        </p>
      ) : (
        <>
          <ul className="divide-y divide-slate-100 dark:divide-white/5">
            {addons.map((d) => {
              const rv = resolveDealValue(d, multiples, rates);
              const m = headlineMid(d);
              return (
                <li
                  key={d.id}
                  className="flex items-center justify-between gap-3 py-2"
                >
                  <span className="min-w-0">
                    <Link
                      href={`/deals/${d.id}`}
                      className="font-semibold text-slate-900 hover:underline dark:text-white"
                    >
                      {d.companyName}
                    </Link>
                    <span className="ml-2">
                      <StageChip stage={d.stage} />
                    </span>
                  </span>
                  <span className="whitespace-nowrap text-sm text-slate-600 dark:text-[#c8bfa8]">
                    {rv.value !== null ? fmtMoney(rv.value) : "—"}
                    {m !== null ? ` · ${m.toFixed(1)}×` : ""}
                  </span>
                </li>
              );
            })}
          </ul>
          <p className="mt-3 text-sm text-slate-600 dark:text-[#c8bfa8]">
            Pro forma blended multiple:{" "}
            <span className="font-semibold text-slate-900 dark:text-white">
              {blended ?? "—"}
            </span>{" "}
            <span className="text-xs text-slate-400 dark:text-white/40">
              (value-weighted across platform + add-ons, at headline
              multiples)
            </span>
          </p>
        </>
      )}
    </section>
  );
}

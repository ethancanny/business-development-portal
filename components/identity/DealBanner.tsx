"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import CompanyMark from "./CompanyMark";
import { TypeBadge } from "@/components/InvestmentTypeBits";
import type { InvestmentTypeKey } from "@/lib/types";
import {
  accentForSurface,
  resolveDisplayIdentity,
} from "@/lib/identity/shared";

interface BannerDeal {
  id: string;
  companyId: string;
  name: string;
  stage: string;
  investmentType: string;
  codename: string;
  codenameExternal: boolean;
}

interface SwitcherItem {
  dealId: string;
  companyId: string;
  name: string;
  stage: string;
  codename: string;
  logoVersion: number;
  accentColor: string;
}

interface BannerPayload {
  company: {
    id: string;
    name: string;
    logoVersion: number;
    accentColor: string;
  } | null;
  deal: BannerDeal | null;
  switcher: SwitcherItem[];
}

/**
 * The slim sticky deal banner (Deal Identity System, Oct 24, 2026):
 * mounted at the top of every company/deal-tied page. Shows the
 * company mark, the internal identity (real name + codename beside
 * it — this is an internal surface), investment-type badge, stage,
 * and a link back to the company profile. The quick switcher jumps
 * to another active deal while staying in the same section by
 * swapping the company/deal id in the current route.
 *
 * Data: one fetch on mount (banner payload endpoint), no polling.
 * The accent color tints the banner's top strip.
 */
export default function DealBanner({
  companyId,
  dealId,
}: {
  companyId?: string;
  dealId?: string;
}) {
  const [data, setData] = useState<BannerPayload | null>(null);
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;
    const qs = new URLSearchParams();
    if (companyId) qs.set("companyId", companyId);
    if (dealId) qs.set("dealId", dealId);
    fetch(`/api/platform/identity/banner?${qs.toString()}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!cancelled && j) setData(j as BannerPayload);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [companyId, dealId]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open ]);

  if (!data || (!data.company && !data.deal)) return null;
  const company = data.company;
  const deal = data.deal;
  const display = resolveDisplayIdentity(
    {
      name: deal?.name ?? company?.name ?? "",
      codename: deal?.codename,
      codenameExternal: deal?.codenameExternal,
    },
    "internal"
  );
  const accent = company?.accentColor
    ? accentForSurface(company.accentColor, "onLight")
    : null;
  const currentCompanyId = company?.id ?? deal?.companyId ?? companyId ?? "";

  const jump = (item: SwitcherItem) => {
    setOpen(false);
    if (!pathname) return;
    let next = pathname;
    if (currentCompanyId && next.includes(currentCompanyId)) {
      next = next.replace(currentCompanyId, item.companyId);
    } else if (deal?.id && next.includes(deal.id)) {
      next = next.replace(deal.id, item.dealId);
    } else if (next.startsWith("/companies/")) {
      next = `/companies/${item.companyId}`;
    } else if (next.startsWith("/deals/")) {
      next = `/deals/${item.dealId}`;
    }
    if (next !== pathname) router.push(next);
  };

  return (
    <div
      className="sticky top-0 z-30 -mx-4 mb-4 border-b border-slate-200 bg-white/95 px-4 backdrop-blur dark:border-white/10 dark:bg-[#0b1526]/95 sm:-mx-6 sm:px-6"
      style={accent ? { borderTop: `3px solid ${accent}` } : undefined}
    >
      <div className="mx-auto flex h-11 w-full max-w-5xl items-center gap-2.5">
        <CompanyMark
          companyId={currentCompanyId}
          name={display.displayName}
          logoVersion={company?.logoVersion ?? 0}
          size={24}
        />
        <div className="flex min-w-0 items-baseline gap-2">
          <Link
            href={`/companies/${currentCompanyId}`}
            className="truncate text-sm font-semibold text-[#0d1f3c] hover:underline dark:text-white"
          >
            {display.displayName}
          </Link>
          {display.secondaryName && (
            <span className="hidden shrink-0 rounded bg-gold-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-gold-800 dark:bg-gold-500/15 dark:text-gold-300 sm:inline">
              {display.secondaryName}
            </span>
          )}
        </div>
        {deal && (
          <>
            <TypeBadge type={(deal.investmentType || "platform_lbo") as InvestmentTypeKey} />
            <span className="badge badge-neutral hidden sm:inline-flex">{deal.stage}</span>
          </>
        )}
        <div className="relative ml-auto shrink-0" ref={menuRef}>
          <button
            type="button"
            className="btn-secondary text-xs"
            aria-haspopup="listbox"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
          >
            Switch deal ▾
          </button>
          {open && (
            <div
              role="listbox"
              aria-label="Switch to another active deal"
              className="absolute right-0 top-full z-40 mt-1 max-h-80 w-72 overflow-y-auto rounded-xl border border-slate-200 bg-white p-1 shadow-lg dark:border-white/10 dark:bg-[#101b30]"
            >
              {data.switcher.length === 0 && (
                <p className="px-2 py-2 text-xs text-caption">No other active deals.</p>
              )}
              {data.switcher.map((item) => (
                <button
                  key={item.dealId}
                  type="button"
                  role="option"
                  aria-selected={item.companyId === currentCompanyId}
                  onClick={() => jump(item)}
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-slate-50 dark:hover:bg-white/5"
                >
                  <CompanyMark
                    companyId={item.companyId}
                    name={item.name}
                    logoVersion={item.logoVersion}
                    size={20}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-slate-900 dark:text-white">
                      {item.name}
                      {item.codename && (
                        <span className="ml-1.5 text-[10px] font-semibold uppercase tracking-wide text-gold-700 dark:text-gold-400">
                          {item.codename}
                        </span>
                      )}
                    </span>
                    <span className="block text-[11px] text-caption">{item.stage}</span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

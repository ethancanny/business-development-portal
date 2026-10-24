import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { ensurePlatform } from "@/lib/platform/service";
import { logUsage } from "@/lib/platform/usage";
import { getCalendarEvents } from "@/lib/calendar-db";
import {
  GENERATED_EVENT_SOURCES,
  colorForKind,
} from "@/lib/calgen/registry";
import {
  ensureFreshGeneratedEvents,
  listGeneratedEvents,
} from "@/lib/calgen/service";

/**
 * Phase 2 — merged calendar read: legacy Outlook mirror events +
 * portal-generated events (tasks & follow-ups today; diligence
 * milestones, deadlines, reporting, covenants, capital calls,
 * closings, investor/board meetings and data-room expirations as
 * those modules register generators).
 *
 * GET ?from=<ISO>&to=<ISO>&types=<csv kinds>&dealId=<id>
 * Returns { items, layers }. Selected columns only; usage logged.
 * Refresh-on-open: ensureFreshGeneratedEvents() regenerates the
 * generated layer when its newest row is >15m stale (config rule).
 */

export interface PlatformEventItem {
  id: string;
  origin: "outlook" | "generated";
  title: string;
  start: string;
  end: string | null;
  allDay: boolean;
  kind: string; // layer kind: 'outlook' or a calgen source kind
  color: string;
  dealId: string | null;
  href: string;
  status: string;
  meta?: Record<string, unknown>;
  /** Deal Identity enrichment for deal-linked events. */
  companyId?: string | null;
  logoVersion?: number;
}

const OUTLOOK_LAYER = { kind: "outlook", label: "Outlook calendar", color: "#0d1f3c" };

export async function GET(req: NextRequest) {
  if (!getSessionUser()) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await ensurePlatform();
  const sp = req.nextUrl.searchParams;
  const now = Date.now();
  const from = sp.get("from") ?? new Date(now - 7 * 86400000).toISOString();
  const to = sp.get("to") ?? new Date(now + 28 * 86400000).toISOString();
  const types = (sp.get("types") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const dealId = (sp.get("dealId") ?? "").trim();
  const wantOutlook = types.length === 0 || types.includes("outlook");
  const genTypes = types.filter((t) => t !== "outlook");

  try {
    await ensureFreshGeneratedEvents();

    const items: PlatformEventItem[] = [];

    if (wantOutlook) {
      const events = await getCalendarEvents(from, to);
      for (const e of events) {
        if (dealId) continue; // Outlook mirror rows carry no deal link.
        items.push({
          id: `outlook:${e.eventId}`,
          origin: "outlook",
          title: e.title,
          start: e.startsAt,
          end: e.endsAt || null,
          allDay: e.allDay,
          kind: "outlook",
          color: OUTLOOK_LAYER.color,
          dealId: null,
          // calendar_events' link field is web_url (the Outlook web
          // link); fall back to the calendar page when absent.
          href: e.webUrl || "/calendar",
          status: e.dismissed ? "dismissed" : "",
        });
      }
    }

    const generated = await listGeneratedEvents({
      from,
      to,
      types: genTypes,
      dealId: dealId || undefined,
      limit: 500,
    });
    for (const g of generated) {
      items.push({
        id: `generated:${g.id}`,
        origin: "generated",
        title: g.title,
        start: g.startsAt,
        end: g.endsAt,
        allDay: g.allDay,
        kind: g.sourceKind,
        color: colorForKind(g.sourceKind),
        dealId: g.dealId,
        href: g.href || "/calendar",
        status: g.status,
        meta: g.meta,
      });
    }

    // Deal Identity: attach company id + logo version to deal-linked
    // events so the calendar renders the company mark. Decorative —
    // failures leave events unmarked.
    try {
      const dealIds = Array.from(
        new Set(items.map((i) => i.dealId).filter(Boolean) as string[])
      );
      if (dealIds.length) {
        const { identitySummariesForDeals } = await import(
          "@/lib/identity/service"
        );
        const summaries = await identitySummariesForDeals(dealIds);
        for (const item of items) {
          if (!item.dealId) continue;
          const s = summaries.get(item.dealId);
          if (s) {
            item.companyId = s.companyId;
            item.logoVersion = s.logoVersion;
          }
        }
      }
    } catch {
      /* identity enrichment is decorative */
    }

    items.sort((a, b) => a.start.localeCompare(b.start));

    const layers = [
      OUTLOOK_LAYER,
      ...GENERATED_EVENT_SOURCES.map((s) => ({
        kind: s.kind as string,
        label: s.label,
        color: s.color,
      })),
    ];

    logUsage(
      "calendar_platform_events",
      items.length,
      JSON.stringify(items).length
    );
    return NextResponse.json(
      { items, layers },
      { headers: { "Cache-Control": "private, max-age=60" } }
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

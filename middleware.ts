import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Public routes: login page, auth API (login needs no session), and brand assets.
  // Market ingest endpoints use their own CRON_SECRET auth (Vercel Cron has no session cookie).
  // Microsoft Graph webhook + watchdog: no session cookie exists on those
  // calls; both routes enforce their own auth (webhook clientState secret;
  // ensure requires session or Bearer CRON_SECRET).
  const PUBLIC_API_PREFIXES = [
    "/api/auth",
    "/api/market/ingest",
    "/api/market/listings/import",
    "/api/calendar/microsoft/webhook",
    "/api/calendar/microsoft/ensure",
    "/api/push/check",
    // News summary pass: the agent runner has no session cookie; both
    // routes enforce session-or-CRON_SECRET auth themselves.
    "/api/market/news/pending",
    "/api/market/news/summary",
    "/api/market/news/reclassify",
    // Data room guest links (Phase 3): no session cookie exists for an
    // external guest; the /api/guest routes authenticate the one-time
    // room token themselves (hash lookup + expiry + revocation +
    // allowlist) on every call.
    "/api/guest",
  ];
  // PWA assets: browsers fetch the manifest, icons, splash images and the
  // service worker outside the page's auth context (notably iOS), and the
  // offline page must render without a session.
  const PUBLIC_PWA = [
    "/manifest.webmanifest",
    "/sw.js",
    "/offline",
    "/apple-touch-icon",
    "/apple-touch-icon-v2",
    "/apple-touch-icon-v3",
    "/apple-touch-icon-v4",
    "/apple-touch-icon-v5",
    "/apple-touch-icon-v6",
    "/apple-touch-icon-v7",
    "/apple-touch-icon-v8",
  ];
  const PUBLIC_ASSETS = [
    "/canny-logo.png",
    "/canny-logo-white.png",
    "/canny-favicon.png",
    "/arizona-desert-landscape.jpg",
    "/arizona-desert-hero.jpg",
  ];
  if (
    pathname === "/login" ||
    // Guest data-room page: the token in the path IS the credential;
    // the page loads its data through the token-checked /api/guest API.
    pathname.startsWith("/room/") ||
    PUBLIC_API_PREFIXES.some((p) => pathname.startsWith(p)) ||
    PUBLIC_ASSETS.includes(pathname) ||
    PUBLIC_PWA.includes(pathname) ||
    pathname.startsWith("/icon-") ||
    pathname.startsWith("/splash/")
  ) {
    return NextResponse.next();
  }

  const token = req.cookies.get("deal_portal_token")?.value;
  if (!token) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.redirect(new URL("/login", req.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

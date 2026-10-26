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
    // Report recipient links (Part 12): same pattern as /api/guest —
    // the /api/report-guest routes authenticate the delivery token
    // themselves (hash lookup + expiry + revocation) on every call.
    "/api/report-guest",
    // E-signature signer links (in-house signing): same pattern as
    // /api/guest — the /api/sign routes authenticate the signer token
    // themselves (hash lookup + envelope state) on every call. The
    // session cookie is never read on signer routes.
    "/api/sign",
    // Report open pixel (Send anywhere, Oct 25, 2026): same pattern —
    // /api/track authenticates the delivery token itself (hash lookup
    // + expiry + revocation) on every call; an email client fetching
    // the pixel has no session cookie.
    "/api/track",
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
    // Report recipient page (Part 12): same pattern — the token in the
    // path IS the credential; data loads via /api/report-guest.
    pathname.startsWith("/report/") ||
    // Signer page (in-house signing): same pattern — the token in
    // the path IS the credential; data loads via /api/sign.
    pathname.startsWith("/sign/") ||
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

  // Phase 9: company-scoped guest sessions (portfolio-company
  // management logins) are confined to their own surfaces.
  // DECODE-ONLY: the JWT payload is read WITHOUT signature
  // verification and claims are used ONLY to restrict access here —
  // never to grant it. All granting authorization remains route-level
  // via verified sessions (lib/auth.ts) + DB scope
  // (lib/platform/permissions.ts). Tokens without guest claims pass
  // through exactly as before; any decode error falls through to the
  // existing behavior.
  try {
    const parts = token.split(".");
    if (parts.length === 3) {
      const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
      const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
      const json = decodeURIComponent(
        atob(padded)
          .split("")
          .map(
            (c) => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2)
          )
          .join("")
      );
      const payload = JSON.parse(json) as {
        role?: unknown;
        companyIds?: unknown;
      };
      if (payload.role === "guest" && Array.isArray(payload.companyIds)) {
        const allowed =
          pathname.startsWith("/my-company") ||
          pathname.startsWith("/api/portmgmt") ||
          pathname.startsWith("/api/platform/monitoring") ||
          pathname.startsWith("/api/auth");
        if (!allowed) {
          if (pathname.startsWith("/api/")) {
            return NextResponse.json(
              { error: "scoped_access" },
              { status: 403 }
            );
          }
          return NextResponse.redirect(new URL("/my-company", req.url));
        }
      }
    }
  } catch {
    /* decode failure: fall through to the default behavior */
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

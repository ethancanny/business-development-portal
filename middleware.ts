import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Public routes: login page, auth API (login needs no session), and brand assets
  const PUBLIC_ASSETS = [
    "/canny-logo.png",
    "/canny-logo-white.png",
    "/canny-favicon.png",
    "/arizona-desert-landscape.jpg",
    "/arizona-desert-hero.jpg",
  ];
  if (
    pathname === "/login" ||
    pathname.startsWith("/api/auth") ||
    PUBLIC_ASSETS.includes(pathname)
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

import type { Metadata, Viewport } from "next";
import { Cormorant_Garamond, Inter } from "next/font/google";
import "./globals.css";
import SiteHeader from "@/components/SiteHeader";
import ThemeProvider, { ThemeInitScript } from "@/components/ThemeProvider";
import PwaShell from "@/components/PwaShell";
import MobileNav from "@/components/MobileNav";
import Fab from "@/components/Fab";
import LockScreen from "@/components/LockScreen";

// Premium redesign (Oct 14, 2026): serif display + clean sans, loaded
// once at the root and shared via CSS variables (see tailwind.config).
const fontDisplay = Cormorant_Garamond({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-display",
  display: "swap",
});
const fontSans = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Business Development Portal | Canny Capital Partners",
  description: "Track acquisition deals and executive sourcing pipelines",
  // The web app manifest comes from app/manifest.ts (auto-linked by Next
  // at /manifest.webmanifest).
  appleWebApp: {
    capable: true,
    title: "Canny Capital Portal",
    statusBarStyle: "black-translucent",
  },
  icons: {
    icon: "https://cannycapitalpartners.com/canny-favicon.png",
    apple: "/apple-touch-icon-v3",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  // Header navy in both schemes — the header itself is navy regardless
  // of the app's day/night theme (mobile polish, Oct 14 2026).
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#0d1f3c" },
    { media: "(prefers-color-scheme: dark)", color: "#0d1f3c" },
  ],
};

/** iPhone splash screens (apple-touch-startup-image), rendered by
 * app/splash/[size]/route.ts at each device's pixel size. */
const SPLASH_LINKS: { media: string; size: string }[] = [
  {
    media:
      "(device-width: 390px) and (device-height: 844px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)",
    size: "1170x2532",
  },
  {
    media:
      "(device-width: 430px) and (device-height: 932px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)",
    size: "1290x2796",
  },
  {
    media:
      "(device-width: 393px) and (device-height: 852px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)",
    size: "1179x2556",
  },
];

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`dark ${fontDisplay.variable} ${fontSans.variable}`}>
      <head>
        <ThemeInitScript />
        {SPLASH_LINKS.map((s) => (
          <link
            key={s.size}
            rel="apple-touch-startup-image"
            media={s.media}
            href={`/splash/${s.size}`}
          />
        ))}
      </head>
      <body className="bg-slate-100 font-sans text-slate-900 antialiased dark:bg-[#0d1f3c] dark:text-[#e8dfc8]">
        {/* Status-bar underlay (mobile polish §1): with
            black-translucent the app draws under the iOS status bar;
            this fixed navy strip (pointer-events-none, above content
            and sheets, below the z-100 lock screen) keeps scrolled
            content from ever showing behind the clock/battery. */}
        <div
          aria-hidden
          className="pointer-events-none fixed inset-x-0 top-0 z-[95] bg-[#0d1f3c]"
          style={{ height: "env(safe-area-inset-top)" }}
        />
        <ThemeProvider>
          <SiteHeader />
          <div className="page-pad">{children}</div>
          <PwaShell />
          <Fab />
          <MobileNav />
          <LockScreen />
        </ThemeProvider>
      </body>
    </html>
  );
}

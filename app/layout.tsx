import type { Metadata, Viewport } from "next";
import "./globals.css";
import SiteHeader from "@/components/SiteHeader";
import ThemeProvider, { ThemeInitScript } from "@/components/ThemeProvider";
import PwaShell from "@/components/PwaShell";
import MobileNav from "@/components/MobileNav";
import Fab from "@/components/Fab";
import LockScreen from "@/components/LockScreen";

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
    apple: "/apple-touch-icon",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0d1f3c",
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
    <html lang="en" className="dark">
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
      <body className="bg-slate-100 text-slate-900 antialiased dark:bg-[#0d1f3c] dark:text-[#e8dfc8]">
        <ThemeProvider>
          <SiteHeader />
          {children}
          <PwaShell />
          <Fab />
          <MobileNav />
          <LockScreen />
        </ThemeProvider>
      </body>
    </html>
  );
}

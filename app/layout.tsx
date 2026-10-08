import type { Metadata } from "next";
import "./globals.css";
import SiteHeader from "@/components/SiteHeader";
import ThemeProvider, { ThemeInitScript } from "@/components/ThemeProvider";

export const metadata: Metadata = {
  title: "Business Development Portal | Canny Capital Partners",
  description: "Track acquisition deals and executive sourcing pipelines",
  icons: {
    icon: "/canny-favicon.png",
  },
  themeColor: "#0d1f3c",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <head>
        <ThemeInitScript />
      </head>
      <body className="bg-slate-100 text-slate-900 antialiased dark:bg-[#0d1f3c] dark:text-[#e8dfc8]">
        <ThemeProvider>
          <SiteHeader />
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}

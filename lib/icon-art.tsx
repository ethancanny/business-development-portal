import { ImageResponse } from "next/og";

/**
 * App-icon artwork (Ethan, Oct 15, 2026 — his design): a deep-navy
 * gradient square with the firm's serif C large in white and a
 * short gold rule beneath it. Ethan supplied the design as a raster
 * with hand-drawn edges and asked for the C "smoothened out" — so
 * the glyph is set in Cormorant Garamond 600 (the portal's display
 * serif, a clean vector outline) rather than traced from the image.
 *
 * The font is fetched as TTF from Google Fonts at render time and
 * cached at module scope. If the fetch ever fails, the icon still
 * renders with a generic serif fallback rather than erroring.
 * (Supersedes the v2–v7 photo + framed-mark artwork.)
 */
const NAVY_DEEP = "#0a1730";
const GOLD = "#b8975a";

type IconFont = {
  name: string;
  data: ArrayBuffer;
  weight: 600;
  style: "normal";
};

let fontPromise: Promise<IconFont[] | null> | null = null;

function loadFonts(): Promise<IconFont[] | null> {
  if (!fontPromise) {
    fontPromise = (async () => {
      try {
        // An old-Safari UA makes Google Fonts serve TTF URLs
        // (satori cannot consume woff2 in this version).
        const css = await (
          await fetch(
            "https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@600&display=swap",
            {
              headers: {
                "User-Agent":
                  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_9_3) AppleWebKit/537.75.14 (KHTML, like Gecko) Version/7.0.3 Safari/7046A194A",
              },
            }
          )
        ).text();
        const m = css.match(/url\((https:[^)]+)\)/);
        if (!m) return null;
        const data = await (await fetch(m[1])).arrayBuffer();
        return [
          { name: "Cormorant Garamond", data, weight: 600, style: "normal" },
        ] as IconFont[];
      } catch {
        return null;
      }
    })();
  }
  return fontPromise;
}

export async function iconResponse(
  size: number,
  emblemScale = 1
): Promise<ImageResponse> {
  const fonts = await loadFonts();
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: NAVY_DEEP,
          backgroundImage:
            "radial-gradient(ellipse 130% 100% at 50% 68%, #1d3563 0%, #13294e 48%, #0a1730 100%)",
        }}
      >
        <span
          style={{
            fontFamily: fonts ? "Cormorant Garamond" : "serif",
            fontWeight: 600,
            fontSize: Math.round(size * 0.56 * emblemScale),
            color: "#ffffff",
            lineHeight: 1,
          }}
        >
          C
        </span>
        <div
          style={{
            width: Math.round(size * 0.14 * emblemScale),
            height: Math.max(2, Math.round(size * 0.006 * emblemScale)),
            backgroundColor: GOLD,
            marginTop: Math.round(size * 0.055 * emblemScale),
            display: "flex",
          }}
        />
      </div>
    ),
    {
      width: size,
      height: size,
      fonts: fonts ?? undefined,
      headers: {
        "Cache-Control":
          "public, max-age=86400, stale-while-revalidate=604800",
      },
    }
  );
}

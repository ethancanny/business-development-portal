import { ImageResponse } from "next/og";

/**
 * App-icon artwork (Ethan, Oct 14–15, 2026 — final): the cacti /
 * night-sky photo filling the square (cover), DIMMED under a navy
 * veil, with the firm's own mark over it in white — the serif C in
 * its square frame, lifted from the Canny logo and inverted to
 * white per Ethan's reference image ("This is the C that i want
 * with the box around it! Just make it white").
 *
 * The C is set in Cormorant Garamond 600 (the portal's display
 * serif), fetched as TTF from Google Fonts at render time and
 * cached at module scope. If the font fetch ever fails, the icon
 * still renders with a generic serif fallback rather than erroring.
 */
const PHOTO = "https://cannycapitalpartners.com/arizona-desert-landscape.jpg";
const NAVY = "#0d1f3c";
const DIM = "rgba(5,10,22,0.70)";

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
  const box = Math.round(size * 0.64 * emblemScale);
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          position: "relative",
          backgroundColor: NAVY,
        }}
      >
        <img
          src={PHOTO}
          width={size}
          height={size}
          style={{ objectFit: "cover" }}
        />
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: size,
            height: size,
            backgroundColor: DIM,
            display: "flex",
          }}
        />
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: size,
            height: size,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div
            style={{
              width: box,
              height: box,
              borderWidth: Math.max(2, Math.round(box * 0.026)),
              borderStyle: "solid",
              borderColor: "#ffffff",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <span
              style={{
                fontFamily: fonts ? "Cormorant Garamond" : "serif",
                fontWeight: 600,
                fontSize: Math.round(box * 0.684),
                color: "#ffffff",
                lineHeight: 1,
                marginTop: Math.round(box * -0.034),
              }}
            >
              C
            </span>
          </div>
        </div>
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

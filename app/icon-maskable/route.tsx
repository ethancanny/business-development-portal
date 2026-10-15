import { ImageResponse } from "next/og";

/**
 * 512×512 maskable PWA icon: PURELY the cacti / night-sky photo,
 * zoomed out — the full image fit inside the square ("contain"), so
 * Android's circle/squircle crop still shows the whole scene; navy
 * night fills the letterbox and any crop margin (Ethan, Oct 14 2026:
 * the home-screen cover is just the photo, almost the full image).
 * No wordmark. Rendered at request time by next/og.
 */
const PHOTO = "https://cannycapitalpartners.com/arizona-desert-landscape.jpg";
const NAVY = "#0d1f3c";

export async function GET() {
  const size = 512;
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          backgroundColor: NAVY,
          backgroundImage: `url(${PHOTO})`,
          backgroundSize: "contain",
          backgroundPosition: "center",
          backgroundRepeat: "no-repeat",
        }}
      />
    ),
    {
      width: size,
      height: size,
      headers: {
        "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
      },
    }
  );
}

import { ImageResponse } from "next/og";

/**
 * 180×180 Apple touch icon (iOS Home Screen): PURELY the cacti /
 * night-sky photo, zoomed out — the (nearly) full image fit inside
 * the square, navy night filling the letterbox (Ethan, Oct 14 2026).
 * iOS applies its own corner rounding. No wordmark. Rendered at
 * request time by next/og.
 */
const PHOTO = "https://cannycapitalpartners.com/arizona-desert-landscape.jpg";
const NAVY = "#0d1f3c";

export async function GET() {
  const size = 180;
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          backgroundColor: NAVY,
        }}
      >
      <img
        src={PHOTO}
        width={size}
        height={size}
        style={{ objectFit: "cover" }}
      />
      </div>
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

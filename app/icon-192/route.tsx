import { ImageResponse } from "next/og";

/**
 * 192×192 PWA icon: PURELY the cacti / night-sky photo, zoomed out —
 * the (nearly) full image fit inside the square, navy night filling
 * the letterbox (Ethan, Oct 14 2026: the home-screen cover should
 * "just be the night sky image with the cacti — almost the full
 * image, kind of zoomed out"). No wordmark. Rendered at request time
 * by next/og because binaries can't go through the push channel.
 */
const PHOTO = "https://cannycapitalpartners.com/arizona-desert-landscape.jpg";
const NAVY = "#0d1f3c";

export async function GET() {
  const size = 192;
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

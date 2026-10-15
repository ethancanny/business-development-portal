import { ImageResponse } from "next/og";

/**
 * iOS splash screens (apple-touch-startup-image). The [size] param is
 * "<width>x<height>" in device pixels, e.g. /splash/1170x2532.
 * Purely the cacti / night-sky photo, full-bleed — no logo, no rule, no
 * navy treatment (Ethan, Oct 14 2026: "make the app background purely
 * the cacti with the night sky... and the splash screen as well").
 * Navy remains only as the paint color behind the image while it loads.
 */
const PHOTO = "https://cannycapitalpartners.com/arizona-desert-landscape.jpg";
const NAVY = "#0d1f3c";

function parseSize(raw: string): { w: number; h: number } {
  const m = /^(\d{3,4})x(\d{3,4})$/.exec(raw);
  const clamp = (n: number) => Math.min(3000, Math.max(320, n));
  if (!m) return { w: 1170, h: 2532 };
  return { w: clamp(parseInt(m[1], 10)), h: clamp(parseInt(m[2], 10)) };
}

export async function GET(
  _req: Request,
  { params }: { params: { size: string } }
) {
  const { w, h } = parseSize(params.size);
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          backgroundColor: NAVY,
          backgroundImage: `url(${PHOTO})`,
          backgroundSize: "cover",
          backgroundPosition: "center",
        }}
      />
    ),
    {
      width: w,
      height: h,
      headers: {
        "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
      },
    }
  );
}

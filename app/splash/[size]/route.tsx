import { ImageResponse } from "next/og";

/**
 * iOS splash screens (apple-touch-startup-image). The [size] param is
 * "<width>x<height>" in device pixels, e.g. /splash/1170x2532.
 * Renders the night-sky photo full-bleed over navy with the wordmark
 * centered — matching the app's background color (#0d1f3c), which is
 * also the Android splash background via the manifest.
 */
const PHOTO = "https://cannycapitalpartners.com/arizona-desert-landscape.jpg";
const LOGO = "https://cannycapitalpartners.com/canny-logo-white.png";
const NAVY = "#0d1f3c";
const LOGO_RATIO = 503 / 89;

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
  const logoW = Math.round(w * 0.52);
  const logoH = Math.round(logoW / LOGO_RATIO);
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
          backgroundColor: NAVY,
          backgroundImage: `url(${PHOTO})`,
          backgroundSize: "cover",
          backgroundPosition: "center",
        }}
      >
        <img src={LOGO} width={logoW} height={logoH} />
        <div
          style={{
            marginTop: 28,
            width: Math.round(w * 0.18),
            height: 3,
            backgroundColor: "#b8975a",
          }}
        />
      </div>
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

import { ImageResponse } from "next/og";

/**
 * 512×512 maskable PWA icon. Android may crop the canvas to a circle,
 * so the photo is inset on a solid-navy field and the wordmark is kept
 * inside the center ~55% — well within the maskable safe zone.
 */
const PHOTO = "https://cannycapitalpartners.com/arizona-desert-landscape.jpg";
const LOGO = "https://cannycapitalpartners.com/canny-logo-white.png";
const NAVY = "#0d1f3c";
const LOGO_RATIO = 503 / 89;

export async function GET() {
  const size = 512;
  const inset = Math.round(size * 0.1); // navy border behind the photo edges
  const logoW = Math.round(size * 0.52);
  const logoH = Math.round(logoW / LOGO_RATIO);
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          backgroundColor: NAVY,
          padding: inset,
        }}
      >
        <div
          style={{
            width: "100%",
            height: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            backgroundImage: `url(${PHOTO})`,
            backgroundSize: "cover",
            backgroundPosition: "center",
          }}
        >
          <img src={LOGO} width={logoW} height={logoH} />
        </div>
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

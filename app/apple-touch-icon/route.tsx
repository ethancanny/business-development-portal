import { ImageResponse } from "next/og";

/**
 * 180×180 Apple touch icon (iOS Home Screen): wordmark over the
 * night-sky photo. iOS applies its own corner rounding, so the art is
 * full-bleed like the standard PWA icons.
 */
const PHOTO = "https://cannycapitalpartners.com/arizona-desert-landscape.jpg";
const LOGO = "https://cannycapitalpartners.com/canny-logo-white.png";
const NAVY = "#0d1f3c";
const LOGO_RATIO = 503 / 89;

export async function GET() {
  const size = 180;
  const logoW = Math.round(size * 0.62);
  const logoH = Math.round(logoW / LOGO_RATIO);
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: NAVY,
          backgroundImage: `url(${PHOTO})`,
          backgroundSize: "cover",
          backgroundPosition: "center",
        }}
      >
        <img src={LOGO} width={logoW} height={logoH} />
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

import { ImageResponse } from "next/og";

/**
 * 512×512 PWA icon: the Canny wordmark centered over the night-sky
 * saguaro photo (the login backdrop, hosted on the main site).
 * ?variant=navy renders the plain-navy fallback (logo over solid navy).
 * Rendered with next/og (satori) — the logo is ~62% of the canvas wide
 * so it sits comfortably inside the icon's safe area.
 */
const PHOTO = "https://cannycapitalpartners.com/arizona-desert-landscape.jpg";
const LOGO = "https://cannycapitalpartners.com/canny-logo-white.png";
const NAVY = "#0d1f3c";
const LOGO_RATIO = 503 / 89; // width / height of canny-logo-white.png

export async function GET(req: Request) {
  const navy = new URL(req.url).searchParams.get("variant") === "navy";
  const size = 512;
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
          ...(navy
            ? {}
            : {
                backgroundImage: `url(${PHOTO})`,
                backgroundSize: "cover",
                backgroundPosition: "center",
              }),
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

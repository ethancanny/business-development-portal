import { ImageResponse } from "next/og";

/**
 * App-icon artwork (Ethan, Oct 14, 2026 — final): the cacti /
 * night-sky photo filling the square (cover), DIMMED under a navy
 * veil, with the bold geometric C from Ethan's reference icon laid
 * over it in plain white. No wordmark, no gold, no letterbox bars.
 *
 * The C is an annulus sector drawn as an SVG path (satori renders
 * arc commands correctly — verified against a local render before
 * shipping). Glyph diameter ~56% of the icon; the maskable variant
 * shrinks it into the maskable safe zone.
 */
const PHOTO = "https://cannycapitalpartners.com/arizona-desert-landscape.jpg";
const NAVY = "#0d1f3c";
const DIM = "rgba(5,10,22,0.70)";

function cPath(
  cx: number,
  cy: number,
  R: number,
  r: number,
  halfGapDeg: number
): string {
  const rad = (d: number) => (d * Math.PI) / 180;
  const pt = (rad2: number, a: number): [number, number] => [
    cx + rad2 * Math.cos(a),
    cy + rad2 * Math.sin(a),
  ];
  const a1 = rad(halfGapDeg);
  const a2 = rad(360 - halfGapDeg);
  const [x1, y1] = pt(R, a1);
  const [x2, y2] = pt(R, a2);
  const [x3, y3] = pt(r, a2);
  const [x4, y4] = pt(r, a1);
  const f = (n: number) => Math.round(n * 100) / 100;
  return `M ${f(x1)} ${f(y1)} A ${R} ${R} 0 1 1 ${f(x2)} ${f(y2)} L ${f(x3)} ${f(
    y3
  )} A ${r} ${r} 0 1 0 ${f(x4)} ${f(y4)} Z`;
}

export function iconResponse(size: number, glyphScale = 1): ImageResponse {
  // Glyph geometry in a 100-unit viewBox: outer R 28, inner r 14.5
  // (stroke ≈ 24% of diameter), opening of 68° facing east.
  const R = 28 * glyphScale;
  const r = 14.5 * glyphScale;
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
          <svg width={size} height={size} viewBox="0 0 100 100">
            <path d={cPath(50, 50, R, r, 34)} fill="#ffffff" />
          </svg>
        </div>
      </div>
    ),
    {
      width: size,
      height: size,
      headers: {
        "Cache-Control":
          "public, max-age=86400, stale-while-revalidate=604800",
      },
    }
  );
}

/**
 * Deal identity — shared, client-safe helpers (Deal Identity System,
 * Oct 24, 2026). NO server imports in this module: it is imported by
 * client components and by server code alike.
 *
 * The system in one paragraph: a company's logo lives ONCE in object
 * storage under company-logos/<entityId>/v<version>/… (bytes never in
 * the database); every surface renders it through <CompanyMark> or
 * falls back to a monogram whose color is derived deterministically
 * from the company ID. A deal may carry a codename: internal surfaces
 * show the real name with the codename beside it; external surfaces
 * (guest views, shared links, generated reports, invites/emails to
 * others) show the codename ONLY and hide the logo entirely, unless
 * the deal's external-override toggle is off. resolveDisplayIdentity
 * is the single resolver every surface must use.
 */

/** Rendition sizes generated at logo ingest. */
export const LOGO_SIZES = [64, 128, 256] as const;
export type LogoSize = (typeof LOGO_SIZES)[number];

/** Public URL of a company's logo rendition (versioned → immutable). */
export function logoRenditionUrl(
  entityId: string,
  size: LogoSize,
  version: number
): string {
  return `/api/platform/companies/${encodeURIComponent(entityId)}/logo/${size}?v=${version}`;
}

/** Pick the smallest rendition that covers a display size (2x for retina). */
export function renditionFor(displayPx: number): LogoSize {
  const want = displayPx * 2;
  for (const s of LOGO_SIZES) if (s >= want) return s;
  return 256;
}

/** Up-to-two-letter initials for a monogram badge. */
export function initialsFor(name: string): string {
  const clean = (name || "")
    .replace(/[^A-Za-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .filter((w) => !/^(llc|inc|corp|co|the|of|and|lp|llp)$/i.test(w));
  const words = clean.length ? clean : (name || "").split(/\s+/).filter(Boolean);
  const out = words
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
  return out || "•";
}

/**
 * Monogram palette: deep, saturated colors that keep white initials
 * at ≥ 4.5:1 contrast. The pick is a stable hash of the company ID,
 * so a company keeps its color everywhere, forever.
 */
export const MONOGRAM_PALETTE = [
  "#0d1f3c", // portal navy
  "#3b5b84", // A&D steel blue
  "#2f7f79", // healthcare teal
  "#96602f", // adv. manufacturing bronze (darkened for contrast)
  "#6f6124", // trades olive (darkened)
  "#7a4e7e", // hospitality plum
  "#31517d",
  "#4a3f78",
  "#28536b",
  "#5d4037",
  "#37474f",
  "#6a1b4d",
] as const;

export function hashString(s: string): number {
  // FNV-1a 32-bit.
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function monogramColor(entityId: string): string {
  const key = (entityId || "").trim();
  if (!key) return MONOGRAM_PALETTE[0];
  return MONOGRAM_PALETTE[hashString(key) % MONOGRAM_PALETTE.length];
}

/* ------------------------------------------------------------------ */
/* Accent color: stored base + contrast-safe derivatives               */
/* ------------------------------------------------------------------ */

export function normalizeHex(input: string): string | null {
  const m = /^#?([0-9a-fA-F]{6})$/.exec((input || "").trim());
  if (!m) return null;
  return `#${m[1].toLowerCase()}`;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const n = parseInt(hex.slice(1), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function rgbToHex(r: number, g: number, b: number): string {
  const c = (v: number) =>
    Math.max(0, Math.min(255, Math.round(v)))
      .toString(16)
      .padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

function luminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  const f = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

export function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

function shiftLightness(hex: string, delta: number): string {
  const { r, g, b } = hexToRgb(hex);
  const f = (v: number) =>
    delta >= 0 ? v + (255 - v) * delta : v * (1 + delta);
  return rgbToHex(f(r), f(g), f(b));
}

/**
 * Contrast-safe accent derivative for a rendering context. The stored
 * base color is never mutated; this adjusts lightness until text in
 * the given foreground reaches 4.5:1 against it — used for the header
 * strip / card edge treatments where a label may sit on the accent.
 * mode "onLight": the accent renders ON a light surface (strip/edge —
 * decorative, returned mostly as-is but darkened if it would vanish).
 * mode "onDark": same against dark surfaces (lightened if too dark).
 */
export function accentForSurface(
  base: string,
  mode: "onLight" | "onDark"
): string {
  const hex = normalizeHex(base) ?? "#0d1f3c";
  const surface = mode === "onLight" ? "#ffffff" : "#0b1220";
  // Decorative strips/edges need presence, not text contrast: keep the
  // base unless it nearly disappears into the surface.
  if (contrastRatio(hex, surface) >= 1.6) return hex;
  let out = hex;
  for (let i = 0; i < 12; i++) {
    out = shiftLightness(out, mode === "onLight" ? -0.18 : 0.18);
    if (contrastRatio(out, surface) >= 1.6) break;
  }
  return out;
}

/**
 * Text color to place ON the accent color (e.g. a label chip filled
 * with the accent): returns white or ink, adjusting the accent itself
 * via accentTextPair when neither reaches 4.5:1.
 */
export function accentTextPair(base: string): { bg: string; fg: string } {
  const hex = normalizeHex(base) ?? "#0d1f3c";
  if (contrastRatio(hex, "#ffffff") >= 4.5) return { bg: hex, fg: "#ffffff" };
  if (contrastRatio(hex, "#0d1f3c") >= 4.5) return { bg: hex, fg: "#0d1f3c" };
  // Neither works (mid-luminance color): darken until white passes.
  let out = hex;
  for (let i = 0; i < 16; i++) {
    out = shiftLightness(out, -0.12);
    if (contrastRatio(out, "#ffffff") >= 4.5) break;
  }
  return { bg: out, fg: "#ffffff" };
}

/* ------------------------------------------------------------------ */
/* The one identity resolver                                           */
/* ------------------------------------------------------------------ */

export interface IdentityInput {
  name: string;
  codename?: string | null;
  /** TRUE (default) = codename applies on external surfaces when set.
   *  FALSE = per-deal override: the real name shows externally too. */
  codenameExternal?: boolean | null;
}

export type IdentityContext = "internal" | "external";

export interface ResolvedIdentity {
  /** The name to render in this context. */
  displayName: string;
  /** Secondary label (internal surfaces: the codename beside the real
   *  name). Null when nothing extra should be shown. */
  secondaryName: string | null;
  /** Whether any company mark (logo OR monogram) may render. */
  showLogo: boolean;
  /** True when the codename rule is actively hiding identity. */
  codenameActive: boolean;
}

export function resolveDisplayIdentity(
  input: IdentityInput,
  context: IdentityContext
): ResolvedIdentity {
  const name = (input.name || "").trim();
  const codename = (input.codename || "").trim();
  const applies = codename.length > 0 && input.codenameExternal !== false;
  if (context === "external" && applies) {
    return {
      displayName: codename,
      secondaryName: null,
      showLogo: false,
      codenameActive: true,
    };
  }
  return {
    displayName: name,
    secondaryName:
      context === "internal" && codename ? codename : null,
    showLogo: true,
    codenameActive: false,
  };
}

/** Storage-key tree for a logo version (assertSafeKey-compatible). */
export function logoKeyPrefix(entityId: string, version: number): string {
  return `company-logos/${entityId}/v${version}`;
}

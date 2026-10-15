import { iconResponse } from "@/lib/icon-art";

/**
 * 180×180 Apple touch icon (iOS Home Screen): the cacti / night-sky
 * photo, dimmed, with the bold white geometric C over it (Ethan,
 * Oct 14 2026). Artwork lives in lib/icon-art.tsx.
 */
export async function GET() {
  return iconResponse(180);
}

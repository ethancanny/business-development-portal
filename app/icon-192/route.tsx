import { iconResponse } from "@/lib/icon-art";

/** 192×192 PWA icon — artwork in lib/icon-art.tsx. */
export async function GET() {
  return iconResponse(192);
}

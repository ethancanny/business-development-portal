import { iconResponse } from "@/lib/icon-art";

/** 512×512 PWA icon — artwork in lib/icon-art.tsx. */
export async function GET() {
  return iconResponse(512);
}

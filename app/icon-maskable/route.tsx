import { iconResponse } from "@/lib/icon-art";

/** 512×512 maskable icon — glyph shrunk into the safe zone. */
export async function GET() {
  return iconResponse(512, 0.82);
}

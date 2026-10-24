import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { ensurePlatform } from "@/lib/platform/service";
import { getStorageProvider } from "@/lib/storage";
import {
  getTemplateById,
  setTemplateDocx,
} from "@/lib/docgen/templates";

/**
 * Upload a .docx template file for a template (multipart, field
 * "file"). The file's {{placeholders}} are filled at generation time
 * inside word/document.xml. Uploading is a content change: the
 * template version bumps and it returns to draft (re-approval
 * required before it can generate).
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const user = getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await ensurePlatform();
  const existing = await getTemplateById(params.id);
  if (!existing) {
    return NextResponse.json(
      { error: "template_not_found" },
      { status: 404 }
    );
  }
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!file || typeof file === "string") {
    return NextResponse.json(
      { error: "file_required" },
      { status: 400 }
    );
  }
  const filename = (file as File).name || "template.docx";
  if (!/\.docx$/i.test(filename)) {
    return NextResponse.json(
      { error: "docx_required", detail: "Template files must be .docx." },
      { status: 400 }
    );
  }
  const bytes = Buffer.from(await (file as File).arrayBuffer());
  if (!bytes.length || bytes.length > 10 * 1024 * 1024) {
    return NextResponse.json(
      { error: "file_size_invalid" },
      { status: 400 }
    );
  }
  // A .docx is a zip — reject anything else early.
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    return NextResponse.json(
      { error: "invalid_docx", detail: "The uploaded file is not a valid .docx package." },
      { status: 400 }
    );
  }
  const storageKey = `templates/${params.id}/template.docx`;
  await getStorageProvider().put(storageKey, bytes);
  const template = await setTemplateDocx(params.id, {
    storageKey,
    filename,
  });
  if (!template) {
    return NextResponse.json(
      { error: "template_not_found" },
      { status: 404 }
    );
  }
  void user;
  return NextResponse.json({ template });
}

import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { ensurePlatform } from "@/lib/platform/service";
import { ensureDataRoom } from "@/lib/dataroom/schema";
import {
  abortUploadSession,
  appendUploadChunk,
  completeUploadSession,
  getUploadSession,
} from "@/lib/dataroom/uploads";
import { runDueJobs } from "@/lib/platform/jobs";

export const maxDuration = 60;

function actorOf(user: { name: string; email: string }): string {
  return user.name || user.email;
}

/** Append one chunk: PUT with the raw bytes and ?offset=<bytes so far>. */
export async function PUT(
  req: NextRequest,
  { params }: { params: { uploadId: string } }
) {
  const user = getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await ensurePlatform();
  await ensureDataRoom();
  const offsetRaw = Number(req.nextUrl.searchParams.get("offset") ?? 0);
  const offset = isFinite(offsetRaw) ? Math.floor(offsetRaw) : 0;
  const data = Buffer.from(await req.arrayBuffer());
  try {
    const { receivedBytes } = await appendUploadChunk(
      params.uploadId,
      offset,
      data,
      actorOf(user)
    );
    return NextResponse.json({ receivedBytes });
  } catch (err) {
    const expected = (err as { expected?: number }).expected;
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : String(err),
        expectedOffset: typeof expected === "number" ? expected : undefined,
      },
      { status: 409 }
    );
  }
}

/** POST {action:"complete"} finalizes the upload into a document. */
export async function POST(
  req: NextRequest,
  { params }: { params: { uploadId: string } }
) {
  const user = getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await ensurePlatform();
  await ensureDataRoom();
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  if (body.action !== "complete") {
    return NextResponse.json(
      { error: 'Only action "complete" is supported' },
      { status: 400 }
    );
  }
  try {
    const { document, version, duplicateOf } = await completeUploadSession(
      params.uploadId,
      actorOf(user)
    );
    // Part 5B: if document intelligence is enabled for the deal this
    // document's room belongs to, queue a key-terms extraction.
    // Best-effort — never blocks or fails the upload.
    try {
      const { maybeEnqueueForDocument } = await import(
        "@/lib/docint/service"
      );
      await maybeEnqueueForDocument(document.id, actorOf(user));
    } catch {
      /* doc intelligence is additive; upload success stands */
    }
    // Drain the extraction job inline (serverless background work).
    await runDueJobs(3).catch(() => 0);
    return NextResponse.json(
      {
        document,
        version,
        duplicateOf: duplicateOf
          ? { id: duplicateOf.id, name: duplicateOf.name }
          : null,
      },
      { status: 201 }
    );
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 }
    );
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { uploadId: string } }
) {
  const user = getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await ensurePlatform();
  await ensureDataRoom();
  const session = await getUploadSession(params.uploadId);
  if (!session) {
    return NextResponse.json({ error: "Upload session not found" }, { status: 404 });
  }
  await abortUploadSession(params.uploadId, actorOf(user));
  return NextResponse.json({ ok: true });
}

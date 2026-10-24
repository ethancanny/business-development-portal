import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { ensurePlatform } from "@/lib/platform/service";
import { DocGenError } from "@/lib/docgen/generate";
import {
  getContractDetail,
  softDeleteContract,
  updateContract,
} from "@/lib/docgen/contracts";
import type {
  ContractKeyDates,
  ContractSigner,
  ContractStatus,
} from "@/lib/docgen/schema";

/** One contract: full detail (GET: record + versions + events +
 * envelope state), edit (PATCH: status flow, signers, key dates,
 * counterparty fields), soft-delete (DELETE). */
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  if (!getSessionUser()) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await ensurePlatform();
  const detail = await getContractDetail(params.id);
  if (!detail) {
    return NextResponse.json(
      { error: "contract_not_found" },
      { status: 404 }
    );
  }
  return NextResponse.json(detail, {
    headers: { "Cache-Control": "private, no-store" },
  });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const user = getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await ensurePlatform();
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v : undefined);
  const kd =
    body.keyDates && typeof body.keyDates === "object"
      ? (body.keyDates as Record<string, unknown>)
      : null;
  const dateOrNull = (v: unknown) =>
    v === null ? null : typeof v === "string" ? v.slice(0, 10) || null : undefined;
  try {
    const contract = await updateContract(
      params.id,
      {
        title: str(body.title),
        counterpartyName: str(body.counterpartyName),
        counterpartyEmail: str(body.counterpartyEmail),
        counterpartyTitle: str(body.counterpartyTitle),
        counterpartyCompany: str(body.counterpartyCompany),
        status: str(body.status) as ContractStatus | undefined,
        keyDates: kd
          ? ({
              exclusivityExpiry: dateOrNull(kd.exclusivityExpiry),
              closing: dateOrNull(kd.closing),
              renewal: dateOrNull(kd.renewal),
            } as Partial<ContractKeyDates>)
          : undefined,
        signers: Array.isArray(body.signers)
          ? (body.signers as ContractSigner[])
          : undefined,
      },
      user.name || user.email
    );
    if (!contract) {
      return NextResponse.json(
        { error: "contract_not_found" },
        { status: 404 }
      );
    }
    return NextResponse.json({ contract });
  } catch (err) {
    if (err instanceof DocGenError) {
      return NextResponse.json({ error: err.error }, { status: 400 });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const user = getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await ensurePlatform();
  const ok = await softDeleteContract(params.id, user.name || user.email);
  if (!ok) {
    return NextResponse.json(
      { error: "contract_not_found" },
      { status: 404 }
    );
  }
  return NextResponse.json({ ok: true });
}

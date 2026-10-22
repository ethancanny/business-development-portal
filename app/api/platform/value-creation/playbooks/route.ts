import { NextRequest, NextResponse } from "next/server";
import { authed, ok, readBody, serviceError } from "@/lib/valuecreation/http";
import {
  createPlaybook,
  listPlaybooks,
  type PlaybookStep,
} from "@/lib/valuecreation/service";

export async function GET(): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const playbooks = await listPlaybooks();
    return ok({ playbooks });
  } catch (err) {
    return serviceError(err, "playbooks-list");
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const body = await readBody(req);
    const playbook = await createPlaybook(
      {
        name: typeof body.name === "string" ? body.name : undefined,
        category: typeof body.category === "string" ? body.category : undefined,
        description:
          typeof body.description === "string" ? body.description : undefined,
        steps: Array.isArray(body.steps)
          ? (body.steps as PlaybookStep[])
          : undefined,
      },
      gate.user.name
    );
    return ok({ playbook }, 201);
  } catch (err) {
    return serviceError(err, "playbook-create");
  }
}

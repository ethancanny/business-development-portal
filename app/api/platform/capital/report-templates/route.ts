import { NextRequest, NextResponse } from "next/server";
import {
  authed,
  ok,
  readBody,
  serviceError,
  sStr,
} from "@/lib/capital/http";
import {
  listReportTemplates,
  createReportTemplate,
} from "@/lib/capital/reporting";

/**
 * Report templates.
 * GET  — live templates (system templates seeded by the schema first)
 * POST — create {name, kind, body}
 */
export async function GET(): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const templates = await listReportTemplates();
    return ok({ templates });
  } catch (err) {
    return serviceError(err, "report-templates-get");
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const body = await readBody(req);
    const template = await createReportTemplate({
      name: sStr(body.name),
      kind: sStr(body.kind),
      body: sStr(body.body),
    });
    return ok({ template }, 201);
  } catch (err) {
    return serviceError(err, "report-templates-post");
  }
}

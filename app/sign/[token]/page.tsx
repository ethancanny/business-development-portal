"use client";

/**
 * Standalone signer page (/sign/[token]) — no portal chrome (the
 * AppShell bypass for /sign/* mirrors /room/* and /report/*; this
 * page renders standalone regardless). The token in the path IS the
 * credential; all data loads through the token-checked /api/sign
 * API, which never reads the session cookie.
 */

import { useParams } from "next/navigation";
import SignerFlow from "@/components/signing/SignerFlow";

export default function SignerPage() {
  const params = useParams<{ token: string }>();
  const token = typeof params?.token === "string" ? params.token : "";
  if (!token) return null;
  return <SignerFlow token={token} />;
}

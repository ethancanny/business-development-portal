import { lookup } from "node:dns/promises";
import { createHmac, timingSafeEqual } from "node:crypto";
import { MAX_LOGO_BYTES } from "./logo";

/**
 * Server-side fetching for logo auto-fetch, with SSRF hygiene:
 * http/https only, the hostname must resolve exclusively to public
 * addresses (private / loopback / link-local / reserved are refused),
 * redirects are followed manually so every hop is re-validated, and
 * size + time are capped. Candidate URLs are handed to the browser
 * only as HMAC-signed tokens, so the preview proxy and the confirm
 * step can never be pointed at an arbitrary URL.
 */

const FETCH_TIMEOUT_MS = 6000;
const MAX_HOMEPAGE_BYTES = 512 * 1024;

function isPrivateIp(ip: string): boolean {
  if (ip.includes(":")) {
    const v = ip.toLowerCase();
    return (
      v === "::1" ||
      v.startsWith("fe80:") ||
      v.startsWith("fc") ||
      v.startsWith("fd") ||
      v === "::" ||
      v.startsWith("::ffff:127.") ||
      v.startsWith("::ffff:10.") ||
      v.startsWith("::ffff:192.168.")
    );
  }
  const parts = ip.split(".").map((p) => Number(p));
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p))) return true;
  const [a, b] = parts;
  return (
    a === 10 ||
    a === 127 ||
    a === 0 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254) ||
    (a === 100 && b >= 64 && b <= 127) ||
    a >= 224
  );
}

async function assertPublicHost(hostname: string): Promise<void> {
  const host = hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) {
    throw new Error("Refusing non-public host");
  }
  const records = await lookup(host, { all: true });
  if (!records.length) throw new Error(`Host does not resolve: ${host}`);
  for (const r of records) {
    if (isPrivateIp(r.address)) {
      throw new Error(`Refusing non-public address for ${host}`);
    }
  }
}

export interface FetchedBytes {
  data: Buffer;
  contentType: string;
  finalUrl: string;
}

/** Fetch a URL with SSRF guards; follows ≤4 redirects, re-validating
 *  each hop. `maxBytes` caps the body. */
export async function guardedFetch(
  urlStr: string,
  opts: { maxBytes?: number; accept?: string } = {}
): Promise<FetchedBytes> {
  const maxBytes = opts.maxBytes ?? MAX_LOGO_BYTES;
  let current = urlStr;
  for (let hop = 0; hop <= 4; hop++) {
    const u = new URL(current);
    if (u.protocol !== "http:" && u.protocol !== "https:") {
      throw new Error("Only http/https URLs are allowed");
    }
    await assertPublicHost(u.hostname);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(u, {
        redirect: "manual",
        signal: ctrl.signal,
        headers: {
          "User-Agent":
            "Mozilla/5.0 (compatible; CannyCapitalPortal/1.0; logo fetch)",
          Accept: opts.accept ?? "*/*",
        },
      });
    } finally {
      clearTimeout(timer);
    }
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) throw new Error(`Redirect without location from ${u.hostname}`);
      current = new URL(loc, u).toString();
      continue;
    }
    if (!res.ok) throw new Error(`Fetch failed (${res.status}) for ${u.hostname}`);
    const declared = Number(res.headers.get("content-length") ?? 0);
    if (declared > maxBytes) throw new Error("Response too large");
    const data = Buffer.from(await res.arrayBuffer());
    if (data.length > maxBytes) throw new Error("Response too large");
    return {
      data,
      contentType: res.headers.get("content-type") ?? "",
      finalUrl: current,
    };
  }
  throw new Error("Too many redirects");
}

/* ------------------------------------------------------------------ */
/* Signed candidate tokens                                             */
/* ------------------------------------------------------------------ */

function candidateSecret(): string {
  return process.env.JWT_SECRET || "deal-portal-identity";
}

export function signCandidateUrl(url: string): string {
  const payload = Buffer.from(url, "utf8").toString("base64url");
  const sig = createHmac("sha256", candidateSecret())
    .update(payload)
    .digest("base64url");
  return `${payload}.${sig}`;
}

export function verifyCandidateToken(token: string): string | null {
  const [payload, sig] = (token || "").split(".");
  if (!payload || !sig) return null;
  const expected = createHmac("sha256", candidateSecret())
    .update(payload)
    .digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const url = Buffer.from(payload, "base64url").toString("utf8");
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return url;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Candidate discovery                                                 */
/* ------------------------------------------------------------------ */

export interface LogoCandidate {
  /** Signed token — the only handle the client ever sees. */
  token: string;
  kind: "icon" | "apple-touch-icon" | "og:image" | "logo-path" | "favicon";
  /** Host + filename shown in the picker (never the full raw URL). */
  label: string;
}

export function normalizeDomain(input: string): string | null {
  let s = (input || "").trim().toLowerCase();
  if (!s) return null;
  if (!/^https?:\/\//.test(s)) s = `https://${s}`;
  try {
    const u = new URL(s);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    const host = u.hostname.replace(/^www\./, "");
    if (!host.includes(".") || isPrivateIp(host)) return null;
    return host;
  } catch {
    return null;
  }
}

function labelFor(url: string): string {
  try {
    const u = new URL(url);
    const file = u.pathname.split("/").filter(Boolean).pop() || u.hostname;
    return `${u.hostname} · ${file}`;
  } catch {
    return url;
  }
}

/**
 * Gather logo candidates for a domain: the homepage's declared icons
 * and og:image first (highest fidelity), then the conventional paths.
 * Existence is NOT probed here for the conventional paths beyond what
 * the preview step shows — the picker renders each candidate through
 * the signed proxy and broken ones simply fail to render; the confirm
 * step re-fetches and validates bytes before anything is stored.
 */
export async function discoverLogoCandidates(
  domain: string
): Promise<LogoCandidate[]> {
  const found: Array<{ url: string; kind: LogoCandidate["kind"] }> = [];
  const seen = new Set<string>();
  const add = (url: string, kind: LogoCandidate["kind"]) => {
    try {
      const abs = new URL(url, `https://${domain}/`).toString();
      if (!seen.has(abs)) {
        seen.add(abs);
        found.push({ url: abs, kind });
      }
    } catch {
      /* ignore malformed */
    }
  };

  try {
    const home = await guardedFetch(`https://${domain}/`, {
      maxBytes: MAX_HOMEPAGE_BYTES,
      accept: "text/html",
    });
    const html = home.data.toString("utf8");
    const linkRe = /<link\b[^>]*>/gi;
    let m: RegExpExecArray | null;
    while ((m = linkRe.exec(html))) {
      const tag = m[0];
      const rel = /rel\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1]?.toLowerCase() ?? "";
      const href = /href\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1];
      if (!href) continue;
      if (rel.includes("apple-touch-icon")) add(href, "apple-touch-icon");
      else if (rel.includes("icon")) add(href, "icon");
    }
    const og =
      /<meta\b[^>]*property\s*=\s*["']og:image["'][^>]*>/i.exec(html)?.[0] ??
      /<meta\b[^>]*content\s*=\s*["']([^"']+)["'][^>]*property\s*=\s*["']og:image["']/i.exec(html)?.[0];
    const ogUrl =
      og && /content\s*=\s*["']([^"']+)["']/i.exec(og)?.[1];
    if (ogUrl) add(ogUrl, "og:image");
    // Obvious in-page logo images (header logos etc.).
    const imgRe = /<img\b[^>]*src\s*=\s*["']([^"']+)["'][^>]*>/gi;
    let im: RegExpExecArray | null;
    let scanned = 0;
    while ((im = imgRe.exec(html)) && scanned < 40) {
      scanned++;
      const src = im[1];
      if (/logo/i.test(src) && /\.(png|jpe?g|svg)(\?|$)/i.test(src)) {
        add(src, "logo-path");
      }
    }
  } catch {
    /* homepage unreachable — conventional paths below still offered */
  }

  add("/apple-touch-icon.png", "apple-touch-icon");
  add("/favicon.ico", "favicon");
  add("/logo.png", "logo-path");
  add("/logo.svg", "logo-path");

  return found.slice(0, 12).map((c) => ({
    token: signCandidateUrl(c.url),
    kind: c.kind,
    label: labelFor(c.url),
  }));
}

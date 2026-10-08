import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { cookies } from "next/headers";
import type { Partner } from "./types";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me-in-production";
export const AUTH_COOKIE = "deal_portal_token";
const TOKEN_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

interface SeedPartner extends Partner {
  // bcrypt hash of the partner's password (hashed with bcryptjs)
  passwordHash: string;
}

// Partner login account. Password is stored as a bcrypt hash, never plaintext.
// Credentials: ethan@cannycapitalpartners.com / Accounting$5
// Hash is generated at startup with bcryptjs; replace with a real user store for production.
const PARTNERS: SeedPartner[] = [
  {
    id: "partner-ethan",
    name: "Ethan Canny",
    email: "ethan@cannycapitalpartners.com",
    passwordHash: bcrypt.hashSync("Accounting$5", 10),
  },
];

export interface AuthUser {
  id: string;
  name: string;
  email: string;
}

export async function verifyCredentials(
  email: string,
  password: string
): Promise<AuthUser | null> {
  const partner = PARTNERS.find(
    (p) => p.email.toLowerCase() === email.trim().toLowerCase()
  );
  if (!partner) return null;
  const ok = await bcrypt.compare(password, partner.passwordHash);
  if (!ok) return null;
  return { id: partner.id, name: partner.name, email: partner.email };
}

export function signToken(user: AuthUser): string {
  return jwt.sign(user, JWT_SECRET, { expiresIn: TOKEN_TTL_SECONDS });
}

export function verifyToken(token: string): AuthUser | null {
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (
      typeof decoded === "object" &&
      decoded !== null &&
      "id" in decoded &&
      "email" in decoded
    ) {
      return decoded as AuthUser;
    }
    return null;
  } catch {
    return null;
  }
}

/** Read the session user from the httpOnly auth cookie (server-side only). */
export function getSessionUser(): AuthUser | null {
  const token = cookies().get(AUTH_COOKIE)?.value;
  if (!token) return null;
  return verifyToken(token);
}

export function authCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    path: "/",
    maxAge: TOKEN_TTL_SECONDS,
    secure: process.env.NODE_ENV === "production",
  };
}

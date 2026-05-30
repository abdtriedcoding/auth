/**
 * src/lib/auth.ts
 *
 * Everything non-action lives here. The goal is that you can read this file
 * top-to-bottom and understand the entire session story: validation, JWT
 * signing/verifying, the session cookie, and the DAL helper that protected
 * pages call.
 *
 * Trust boundary: Next.js. The JWT is signed and verified here with a server
 * secret. The cookie is `httpOnly` so client JS cannot read or forge it.
 */

import { jwtVerify, SignJWT } from "jose";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { z } from "zod";
import type { Id } from "../../convex/_generated/dataModel";

export const SESSION_COOKIE = "session";

// 7 days. Stateless JWT — there is no server-side revocation, only expiry.
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

/**
 * Validation runs at the trust boundary (Server Action). Reject malformed
 * input before it ever reaches Convex or the password hasher.
 */
export const credentialsSchema = z.object({
  email: z.email("Invalid email"),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

export type SessionPayload = { userId: Id<"users">; email: string };

/**
 * Lazily load the secret so a missing AUTH_SECRET surfaces a clear error at
 * first auth attempt instead of at module import.
 */
function getSecret(): Uint8Array {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 32) {
    throw new Error(
      "AUTH_SECRET must be set in .env.local and be at least 32 characters. " +
        "Generate one with: openssl rand -base64 32",
    );
  }
  return new TextEncoder().encode(s);
}

/**
 * Sign the JWT and stamp it into the session cookie. Only callable from a
 * Server Action or Route Handler — Server Components cannot mutate cookies.
 */
export async function createSessionCookie(
  payload: SessionPayload,
): Promise<void> {
  const token = await new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE_SECONDS}s`)
    .sign(getSecret());

  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true, // browser JS cannot read the cookie → XSS can't steal the token
    secure: process.env.NODE_ENV === "production", // HTTPS-only in prod
    sameSite: "lax", // blocks cross-site POST CSRF, allows top-level link nav
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
}

export async function clearSessionCookie(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
}

/**
 * The DAL — Data Access Layer call protected pages make to learn who is
 * signed in. Wrapped in React `cache()` so it dedupes per render: a layout
 * and its child page both calling `verifySession()` only verify the JWT once.
 *
 * Fails closed: any invalid/expired/tampered token returns null.
 */
export const verifySession = cache(async (): Promise<SessionPayload | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, getSecret());
    return {
      userId: payload.userId as Id<"users">,
      email: payload.email as string,
    };
  } catch {
    return null;
  }
});

/**
 * For Server Components that *require* a signed-in user. `redirect()` throws
 * a NEXT_REDIRECT error — never wrap this in try/catch.
 */
export async function requireSession(): Promise<SessionPayload> {
  const session = await verifySession();
  if (!session) redirect("/signin");
  return session;
}

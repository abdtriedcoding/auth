/**
 * src/lib/auth-shared.ts — the primitives both strategies use.
 *
 * Lives in its own file so `auth-jwt.ts` and `auth-session.ts` can import
 * it without producing a circular dependency through `auth.ts` (which
 * imports both strategies to build `currentStrategy`).
 */
import { z } from "zod";
import type { Id } from "../../convex/_generated/dataModel";

export const SESSION_COOKIE = "session";

// One source of truth for "how long a session lives." Both the cookie
// `maxAge` (browser-side) and the `expiresAt` row field (server-side)
// derive from this so they cannot drift.
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7; // 7 days

export const credentialsSchema = z.object({
  email: z.email("Invalid email"),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

export type SessionPayload = { userId: Id<"users">; email: string };

/**
 * Discriminated union — explicit `ok` flag makes the success/failure shape
 * impossible to confuse and surfaces error messages cleanly to the form.
 */
export type AuthResult =
  | { ok: true; session: SessionPayload }
  | { ok: false; error: string };

/**
 * Both strategies expose these four methods. The Server Actions and the
 * DAL only ever talk through this surface — flipping AUTH_STRATEGY swaps
 * the implementation behind it without touching any caller.
 */
export type SessionStrategy = {
  signUp(creds: { email: string; password: string }): Promise<AuthResult>;
  signIn(creds: { email: string; password: string }): Promise<AuthResult>;
  signOut(): Promise<void>;
  getSession(): Promise<SessionPayload | null>;
};

/**
 * AUTH_SECRET is only required by the JWT strategy. The session strategy
 * doesn't sign anything so it can run with no secret. We still validate
 * shape when it IS set so a misconfigured secret fails loudly rather than
 * silently truncating cookies.
 */
export function getSecret(): Uint8Array {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 32) {
    throw new Error(
      "AUTH_SECRET must be set in .env.local and be at least 32 characters " +
        "(only required when AUTH_STRATEGY=jwt). " +
        "Generate one with: openssl rand -base64 32",
    );
  }
  return new TextEncoder().encode(s);
}

export function cookieOptions() {
  return {
    httpOnly: true, // browser JS cannot read it → XSS can't steal the token
    secure: process.env.NODE_ENV === "production", // HTTPS-only in prod
    sameSite: "lax" as const, // blocks cross-site POST CSRF
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  };
}

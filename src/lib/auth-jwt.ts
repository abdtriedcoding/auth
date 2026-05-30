/**
 * src/lib/auth-jwt.ts — the JWT (stateless) auth strategy.
 *
 * The cookie value is a signed JWT carrying { userId, email }. Verifying a
 * session is a single in-process JWT signature check — no database
 * round-trip on read.
 *
 * Trade-offs vs the session strategy:
 *   + Read = CPU only, no DB call → very fast at scale.
 *   - No server-side revocation: signing someone out only deletes the
 *     cookie on THEIR browser. A copy of the JWT remains valid until
 *     `exp` (7 days here).
 *   - Payload changes (e.g. user renamed) don't reflect until the JWT
 *     is reissued on the next sign-in.
 */

import { fetchAction } from "convex/nextjs";
import { ConvexError } from "convex/values";
import { jwtVerify, SignJWT } from "jose";
import { cookies } from "next/headers";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import {
  cookieOptions,
  getSecret,
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
  type SessionPayload,
  type SessionStrategy,
} from "./auth-shared";

async function writeJwtCookie(payload: SessionPayload): Promise<void> {
  const token = await new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE_SECONDS}s`)
    .sign(getSecret());

  (await cookies()).set(SESSION_COOKIE, token, cookieOptions());
}

export const jwtStrategy: SessionStrategy = {
  async signUp(creds) {
    let result: { userId: Id<"users">; email: string };
    try {
      result = await fetchAction(api.auth.signUp, creds);
    } catch (e) {
      return {
        ok: false,
        error: e instanceof ConvexError ? String(e.data) : "Sign up failed",
      };
    }
    await writeJwtCookie(result);
    return { ok: true, session: result };
  },

  async signIn(creds) {
    const result = await fetchAction(api.auth.signIn, creds);
    if (!result) return { ok: false, error: "Invalid email or password" };
    await writeJwtCookie(result);
    return { ok: true, session: result };
  },

  async signOut() {
    // Stateless — nothing server-side to delete. Just remove the cookie.
    (await cookies()).delete(SESSION_COOKIE);
  },

  async getSession() {
    const token = (await cookies()).get(SESSION_COOKIE)?.value;
    if (!token) return null;
    try {
      const { payload } = await jwtVerify(token, getSecret());
      return {
        userId: payload.userId as Id<"users">,
        email: payload.email as string,
      };
    } catch {
      // Bad signature, expired, malformed (e.g. a stale session-strategy
      // opaque token left over from a strategy flip) → fail closed.
      return null;
    }
  },
};

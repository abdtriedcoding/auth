/**
 * src/lib/auth-session.ts — the database-backed (stateful) session strategy.
 *
 * The cookie value is an opaque 32-byte random token (~43 chars base64url).
 * It carries no information by itself — it's a database key. Every
 * protected page load is one indexed Convex query to translate the token
 * into { userId, email }.
 *
 * Trade-offs vs the JWT strategy:
 *   + Server-side revocation: sign-out deletes the row, the token is
 *     immediately useless even if it was stolen and copied elsewhere.
 *   + Payload changes (e.g. user renamed) reflect on the next request —
 *     no waiting for token expiry.
 *   - One DB read per protected request. Indexed and cheap, but real.
 *   - Sessions table grows; a daily cron sweeps expired rows.
 */
import crypto from "node:crypto";
import { fetchAction, fetchMutation, fetchQuery } from "convex/nextjs";
import { ConvexError } from "convex/values";
import { cookies } from "next/headers";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import {
  cookieOptions,
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
  type SessionStrategy,
} from "./auth-shared";

/**
 * 32 bytes from a CSPRNG, encoded as URL-safe base64 (~43 chars). That's
 * 256 bits of entropy — guessing one in a finite universe is infeasible.
 */
function newToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

function expiresAtFromNow(): number {
  return Date.now() + SESSION_MAX_AGE_SECONDS * 1000;
}

async function writeOpaqueCookie(token: string): Promise<void> {
  (await cookies()).set(SESSION_COOKIE, token, cookieOptions());
}

export const sessionStrategy: SessionStrategy = {
  async signUp(creds) {
    const token = newToken();
    const expiresAt = expiresAtFromNow();
    let result: { userId: Id<"users">; email: string };
    try {
      // The Convex signUp action inserts the user AND the session row in
      // the same call, so we can't end up with a user but no session.
      // Crucially this means there is NO public "createSession(userId)"
      // endpoint that would let an attacker mint a session for someone
      // else's account.
      result = await fetchAction(api.auth.signUp, {
        ...creds,
        session: { token, expiresAt },
      });
    } catch (e) {
      return {
        ok: false,
        error: e instanceof ConvexError ? String(e.data) : "Sign up failed",
      };
    }
    await writeOpaqueCookie(token);
    return { ok: true, session: result };
  },

  async signIn(creds) {
    const token = newToken();
    const expiresAt = expiresAtFromNow();
    const result = await fetchAction(api.auth.signIn, {
      ...creds,
      session: { token, expiresAt },
    });
    if (!result) return { ok: false, error: "Invalid email or password" };
    await writeOpaqueCookie(token);
    return { ok: true, session: result };
  },

  async signOut() {
    const token = (await cookies()).get(SESSION_COOKIE)?.value;
    if (token) {
      // Must delete the row, not just the cookie — otherwise an attacker
      // who already grabbed a copy of the cookie can keep using the
      // session until expiry. This is the headline advantage over JWT.
      await fetchMutation(api.sessions.deleteByToken, { token });
    }
    (await cookies()).delete(SESSION_COOKIE);
  },

  async getSession() {
    const token = (await cookies()).get(SESSION_COOKIE)?.value;
    if (!token) return null;
    // Returns null for: token not found, session expired, user deleted —
    // all surfaced as a single "not signed in" state with no enumeration.
    const row = await fetchQuery(api.sessions.getByToken, { token });
    return row ? { userId: row.userId, email: row.email } : null;
  },
};

/**
 * src/lib/auth.ts — the unified entry point for auth.
 *
 * Two strategies live in `auth-jwt.ts` and `auth-session.ts`. This file
 * picks one based on the AUTH_STRATEGY env var and exposes a small set of
 * helpers that the Server Actions, proxy, and protected pages all use
 * without ever mentioning a strategy name.
 *
 *   AUTH_STRATEGY=jwt      → stateless, signed token in the cookie
 *   AUTH_STRATEGY=session  → opaque token in the cookie, row in Convex
 *
 * To flip strategies: edit .env.local, restart `npm run dev`. The rest of
 * the application is unaware of which one is active.
 */
import { redirect } from "next/navigation";
import { cache } from "react";
import { jwtStrategy } from "./auth-jwt";
import { sessionStrategy } from "./auth-session";
import type { SessionPayload, SessionStrategy } from "./auth-shared";

// Re-exports so callers only ever import from `@/lib/auth`.
export {
  type AuthResult,
  credentialsSchema,
  SESSION_COOKIE,
  type SessionPayload,
  type SessionStrategy,
} from "./auth-shared";

const RAW_STRATEGY = process.env.AUTH_STRATEGY ?? "jwt";

if (RAW_STRATEGY !== "jwt" && RAW_STRATEGY !== "session") {
  // Fail loud at module load — silently defaulting after a typo would be
  // worse than crashing the dev server with a clear message.
  throw new Error(
    `AUTH_STRATEGY must be "jwt" or "session" (got "${RAW_STRATEGY}"). ` +
      "Set it in .env.local.",
  );
}

export const AUTH_STRATEGY: "jwt" | "session" = RAW_STRATEGY;

/**
 * The active strategy. Server Actions and the DAL talk to this and only
 * this — the underlying jwt/session split is invisible to them.
 */
export const currentStrategy: SessionStrategy =
  AUTH_STRATEGY === "session" ? sessionStrategy : jwtStrategy;

/**
 * Returns the current session, or null if the visitor isn't signed in.
 *
 * Named to match the convention in NextAuth/Auth.js (`auth()` / Better
 * Auth's `getSession()`) — it's the one helper protected pages, Server
 * Actions, and Route Handlers reach for to learn who is signed in.
 *
 * Wrapped in React `cache()` so the work happens at most once per render
 * even if both the layout and the page call it.
 *
 * Fails closed for every kind of failure (no cookie, expired, bad
 * signature, deleted user, stale value from a strategy flip).
 */
export const getSession = cache(async (): Promise<SessionPayload | null> => {
  return currentStrategy.getSession();
});

/**
 * Same as `getSession()` but redirects to /signin when not signed in,
 * so callers can rely on a non-null return.
 *
 * Use in Server Components that REQUIRE a signed-in user. `redirect()`
 * throws a NEXT_REDIRECT error — never wrap this call in try/catch.
 *
 * Naming mirrors common conventions (`requireAuth` / `requireUser` in
 * Better Auth- and Lucia-style codebases).
 */
export async function requireAuth(): Promise<SessionPayload> {
  const session = await getSession();
  if (!session) redirect("/signin");
  return session;
}

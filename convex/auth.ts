/**
 * convex/auth.ts — runs in the Node.js runtime ("use node") because bcrypt
 * is a CPU-bound primitive we want close to where the password hash lives.
 *
 * The public auth endpoints exposed by Convex:
 *   - signUp   register a new user (optionally mint a session row)
 *   - signIn   verify a password   (optionally mint a session row)
 *
 * Sign-out lives on `api.sessions.deleteByToken` because deletion needs no
 * password — the token IS the credential. Keeping that endpoint with the
 * other session CRUD avoids a one-line wrapper here.
 *
 * "Optionally mint a session row" is how we support both auth strategies
 * without a separate Convex API for each one. When the Next.js strategy is
 * JWT, the `session` arg is omitted and Convex only does the password
 * work. When the strategy is session-based, Next.js passes
 * `{ token, expiresAt }` and Convex inserts the row in the SAME action
 * that verified the password — keeping the "you can only get a session
 * for an account whose password you know" invariant atomic.
 */
"use node";

import bcrypt from "bcryptjs";
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { action } from "./_generated/server";

const BCRYPT_COST = 10;

// Real-looking bcrypt hash for timing-constant signIn when no user matches.
const DUMMY_HASH = `$2a$${BCRYPT_COST}$${"x".repeat(53)}`;

type AuthResult = { userId: Id<"users">; email: string };

// Validator for the optional session-creation payload. Used by both
// signUp and signIn — defining once keeps the API uniform.
const sessionArg = v.optional(
  v.object({
    token: v.string(),
    expiresAt: v.number(),
  }),
);

export const signUp = action({
  args: {
    email: v.string(),
    password: v.string(),
    session: sessionArg,
  },
  handler: async (ctx, { email, password, session }): Promise<AuthResult> => {
    const normalized = email.trim().toLowerCase();

    const existing = await ctx.runQuery(internal.users.getByEmail, {
      email: normalized,
    });
    if (existing) throw new ConvexError("Email already in use");

    const passwordHash = await bcrypt.hash(password, BCRYPT_COST);
    const userId = await ctx.runMutation(internal.users.insertUser, {
      email: normalized,
      passwordHash,
    });

    if (session) {
      await ctx.runMutation(internal.sessions.insert, {
        userId,
        token: session.token,
        expiresAt: session.expiresAt,
      });
    }

    return { userId, email: normalized };
  },
});

export const signIn = action({
  args: {
    email: v.string(),
    password: v.string(),
    session: sessionArg,
  },
  handler: async (
    ctx,
    { email, password, session },
  ): Promise<AuthResult | null> => {
    const normalized = email.trim().toLowerCase();

    const user = await ctx.runQuery(internal.users.getByEmail, {
      email: normalized,
    });

    const hashToCompare = user?.passwordHash ?? DUMMY_HASH;
    const ok = await bcrypt.compare(password, hashToCompare);

    if (!user || !ok) return null;

    if (session) {
      await ctx.runMutation(internal.sessions.insert, {
        userId: user._id,
        token: session.token,
        expiresAt: session.expiresAt,
      });
    }

    return { userId: user._id, email: user.email };
  },
});

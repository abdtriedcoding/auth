/**
 * convex/sessions.ts — server-side session storage.
 *
 * The trust pattern: the `insert` mutation is INTERNAL so it can only be
 * called from another Convex function — specifically from `auth.signUp` /
 * `auth.signIn`, after they have verified the password. This prevents the
 * "anyone can mint a session for any userId" bypass that would happen if
 * insert were public.
 *
 * `getByToken` and `deleteByToken` are public because the token IS the
 * credential — anyone holding the cookie value is, by definition, the
 * session owner. The token is 32 random bytes, so it's not guessable.
 */
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, mutation, query } from "./_generated/server";

const CLEANUP_BATCH_SIZE = 100;

export const insert = internalMutation({
  args: {
    userId: v.id("users"),
    token: v.string(),
    expiresAt: v.number(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("sessions", args);
  },
});

/**
 * Look up a session by its token, join to the user, return a slim payload.
 * Returns null for: token not found, session expired, or user deleted.
 * The three cases are indistinguishable from outside — by design — so the
 * endpoint doesn't leak which sessions or users exist.
 */
export const getByToken = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const session = await ctx.db
      .query("sessions")
      .withIndex("by_token", (q) => q.eq("token", token))
      .unique();
    if (!session) return null;
    if (session.expiresAt <= Date.now()) return null;
    const user = await ctx.db.get(session.userId);
    if (!user) return null;
    return {
      userId: session.userId,
      email: user.email,
      expiresAt: session.expiresAt,
    };
  },
});

export const deleteByToken = mutation({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const session = await ctx.db
      .query("sessions")
      .withIndex("by_token", (q) => q.eq("token", token))
      .unique();
    if (session) await ctx.db.delete(session._id);
  },
});

/**
 * Daily cleanup, called from convex/crons.ts.
 *
 * Pattern from the project's Convex guidelines: take a bounded batch via an
 * index (NEVER .filter()), delete the rows, and if we filled the batch
 * reschedule ourselves so the next invocation continues — that way each
 * run stays within transaction limits even if there are millions of
 * expired sessions.
 */
export const deleteExpired = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const expired = await ctx.db
      .query("sessions")
      .withIndex("by_expiresAt", (q) => q.lt("expiresAt", now))
      .take(CLEANUP_BATCH_SIZE);

    for (const row of expired) {
      await ctx.db.delete(row._id);
    }

    if (expired.length === CLEANUP_BATCH_SIZE) {
      await ctx.scheduler.runAfter(0, internal.sessions.deleteExpired, {});
    }
  },
});

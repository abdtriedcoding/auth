"use node";

import bcrypt from "bcryptjs";
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { action } from "./_generated/server";

const BCRYPT_COST = 10;

// A real-looking bcrypt hash used only to keep signIn timing roughly constant
// when the email doesn't exist — without this an attacker can enumerate users
// by measuring how fast we respond.
const DUMMY_HASH = `$2a$${BCRYPT_COST}$${"x".repeat(53)}`;

type AuthResult = { userId: Id<"users">; email: string };

export const signUp = action({
  args: { email: v.string(), password: v.string() },
  handler: async (ctx, { email, password }): Promise<AuthResult> => {
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

    return { userId, email: normalized };
  },
});

export const signIn = action({
  args: { email: v.string(), password: v.string() },
  handler: async (ctx, { email, password }): Promise<AuthResult | null> => {
    const normalized = email.trim().toLowerCase();

    const user = await ctx.runQuery(internal.users.getByEmail, {
      email: normalized,
    });

    const hashToCompare = user?.passwordHash ?? DUMMY_HASH;
    const ok = await bcrypt.compare(password, hashToCompare);

    if (!user || !ok) return null;
    return { userId: user._id, email: user.email };
  },
});

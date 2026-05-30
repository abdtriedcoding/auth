/**
 * src/app/actions.ts
 *
 * The three Server Actions the auth forms call. This is the *only* place in
 * the Next.js side that mutates the session cookie — keeping it small makes
 * the flow easy to trace.
 *
 *   form → action → validate → Convex → cookie → redirect
 */
"use server";

import { fetchAction } from "convex/nextjs";
import { ConvexError } from "convex/values";
import { redirect } from "next/navigation";
import {
  clearSessionCookie,
  createSessionCookie,
  credentialsSchema,
} from "@/lib/auth";
import { api } from "../../convex/_generated/api";

export type FormState = { error?: string };

export async function signUpAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = credentialsSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  let result: { userId: string; email: string };
  try {
    // The Convex action hashes the password and inserts the user. The
    // plaintext password leaves Next.js but never gets stored — only the
    // bcrypt hash lands in the database, and the hash never comes back out.
    result = await fetchAction(api.auth.signUp, parsed.data);
  } catch (e) {
    // ConvexError("Email already in use") is the typed error the action
    // throws; everything else is unexpected.
    if (e instanceof ConvexError) return { error: String(e.data) };
    return { error: "Sign up failed. Please try again." };
  }

  await createSessionCookie({
    userId: result.userId as never,
    email: result.email,
  });

  // redirect() throws a NEXT_REDIRECT control-flow error — call it OUTSIDE
  // try/catch or the catch will swallow the redirect and the browser will
  // sit on the form page.
  redirect("/dashboard");
}

export async function signInAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = credentialsSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  const result = await fetchAction(api.auth.signIn, parsed.data);
  // Generic message on purpose — never tell the caller whether it was the
  // email or the password that was wrong, otherwise we leak account existence.
  if (!result) return { error: "Invalid email or password" };

  await createSessionCookie({
    userId: result.userId as never,
    email: result.email,
  });
  redirect("/dashboard");
}

/**
 * Stateless JWT means sign-out is purely a cookie delete — there's no
 * server-side session to destroy. The token itself remains valid until
 * expiry; revocation would require a sessions table.
 */
export async function signOutAction(): Promise<void> {
  await clearSessionCookie();
  redirect("/signin");
}

/**
 * src/app/actions.ts
 *
 * The three Server Actions the auth forms call. With the strategy layer
 * in place, these stay strategy-agnostic — Zod-validate the form, ask the
 * current strategy to do the work, redirect on success or return an
 * error string for the form.
 *
 *   form → action → validate → currentStrategy.* → redirect
 */
"use server";

import { redirect } from "next/navigation";
import { credentialsSchema, currentStrategy } from "@/lib/auth";

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

  const result = await currentStrategy.signUp(parsed.data);
  if (!result.ok) return { error: result.error };

  // redirect() throws a NEXT_REDIRECT control-flow error — keep it OUTSIDE
  // any try/catch or the catch swallows the redirect.
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

  const result = await currentStrategy.signIn(parsed.data);
  if (!result.ok) return { error: result.error };

  redirect("/dashboard");
}

export async function signOutAction(): Promise<void> {
  await currentStrategy.signOut();
  redirect("/signin");
}

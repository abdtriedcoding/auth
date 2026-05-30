"use client";

import { useActionState } from "react";
import { type FormState, signUpAction } from "@/app/actions";

const initialState: FormState = {};

export function SignUpForm() {
  const [state, formAction, pending] = useActionState(
    signUpAction,
    initialState,
  );

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1 text-sm">
        Email
        <input
          name="email"
          type="email"
          required
          autoComplete="email"
          className="h-10 rounded-md border border-zinc-300 dark:border-zinc-700 bg-transparent px-3"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        Password
        <input
          name="password"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          className="h-10 rounded-md border border-zinc-300 dark:border-zinc-700 bg-transparent px-3"
        />
        <span className="text-xs text-zinc-500">Minimum 8 characters.</span>
      </label>

      {state.error && (
        <p className="text-sm text-red-600 dark:text-red-400" role="alert">
          {state.error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="h-10 rounded-full bg-foreground text-background font-medium transition-colors hover:bg-[#383838] dark:hover:bg-[#ccc] disabled:opacity-60"
      >
        {pending ? "Creating account…" : "Create account"}
      </button>
    </form>
  );
}

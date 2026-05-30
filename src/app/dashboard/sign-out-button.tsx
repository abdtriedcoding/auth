"use client";

import { signOutAction } from "@/app/actions";

// A tiny client component just so the button can submit a form that invokes
// a Server Action via the normal POST path. Could be a server component too,
// but co-locating keeps it readable.
export function SignOutButton() {
  return (
    <form action={signOutAction}>
      <button
        type="submit"
        className="h-9 rounded-full border border-zinc-300 dark:border-zinc-700 px-4 text-sm font-medium hover:bg-zinc-100 dark:hover:bg-zinc-900"
      >
        Sign out
      </button>
    </form>
  );
}

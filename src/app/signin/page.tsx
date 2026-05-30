import Link from "next/link";
import { redirect } from "next/navigation";
import { verifySession } from "@/lib/auth";
import { SignInForm } from "./form";

export default async function SignInPage() {
  // Already signed in? Skip the form.
  if (await verifySession()) redirect("/dashboard");

  return (
    <div className="flex flex-1 items-center justify-center px-6 py-16">
      <div className="w-full max-w-sm flex flex-col gap-6">
        <header className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Welcome back.
          </p>
        </header>

        <SignInForm />

        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          No account?{" "}
          <Link href="/signup" className="font-medium underline">
            Sign up
          </Link>
        </p>
      </div>
    </div>
  );
}

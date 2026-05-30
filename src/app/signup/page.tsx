import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { SignUpForm } from "./form";

export default async function SignUpPage() {
  if (await getSession()) redirect("/dashboard");

  return (
    <div className="flex flex-1 items-center justify-center px-6 py-16">
      <div className="w-full max-w-sm flex flex-col gap-6">
        <header className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">
            Create account
          </h1>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Use any email — nothing is sent.
          </p>
        </header>

        <SignUpForm />

        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Already have an account?{" "}
          <Link href="/signin" className="font-medium underline">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}

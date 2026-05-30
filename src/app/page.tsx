import Link from "next/link";
import { getSession } from "@/lib/auth";

export default async function Home() {
  const session = await getSession();

  return (
    <div className="flex flex-col flex-1 items-center justify-center bg-zinc-50 font-sans dark:bg-black">
      <main className="flex flex-1 w-full max-w-3xl flex-col items-center justify-center gap-8 py-32 px-16">
        <h1 className="max-w-md text-4xl font-semibold leading-tight tracking-tight text-center text-black dark:text-zinc-50">
          Custom Email/Password Auth
        </h1>
        <p className="max-w-md text-lg leading-8 text-center text-zinc-600 dark:text-zinc-400">
          A learning project: JWT in an httpOnly cookie, bcrypt in a Convex
          action, validation at the boundary, no auth library.
        </p>

        <div className="flex flex-col gap-3 sm:flex-row">
          {session ? (
            <Link
              href="/dashboard"
              className="flex h-12 items-center justify-center rounded-full bg-foreground px-6 text-background transition-colors hover:bg-[#383838] dark:hover:bg-[#ccc]"
            >
              Go to dashboard
            </Link>
          ) : (
            <>
              <Link
                href="/signin"
                className="flex h-12 items-center justify-center rounded-full bg-foreground px-6 text-background transition-colors hover:bg-[#383838] dark:hover:bg-[#ccc]"
              >
                Sign in
              </Link>
              <Link
                href="/signup"
                className="flex h-12 items-center justify-center rounded-full border border-solid border-black/[.08] px-6 transition-colors hover:border-transparent hover:bg-black/[.04] dark:border-white/[.145] dark:hover:bg-[#1a1a1a]"
              >
                Create account
              </Link>
            </>
          )}
        </div>
      </main>
    </div>
  );
}

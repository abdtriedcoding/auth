import { fetchQuery } from "convex/nextjs";
import { requireAuth } from "@/lib/auth";
import { api } from "../../../convex/_generated/api";
import { SignOutButton } from "./sign-out-button";

export default async function DashboardPage() {
  // The DAL call. `requireAuth` either returns a verified session or
  // calls redirect('/signin'). proxy.ts already bounced out obvious
  // unauthenticated requests; this is the security boundary.
  const { email } = await requireAuth();

  // Server-rendered Convex call. No client subscription here — the page is
  // re-fetched on navigation, which is enough for a tasks list demo.
  const tasks = await fetchQuery(api.tasks.get);

  return (
    <div className="flex flex-1 flex-col gap-8 px-6 py-12 max-w-2xl mx-auto w-full">
      <header className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Signed in as {email}
          </p>
        </div>
        <SignOutButton />
      </header>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">Tasks</h2>
        <ul className="flex flex-col gap-2">
          {tasks.map((t) => (
            <li
              key={t._id}
              className="rounded-md border border-zinc-200 dark:border-zinc-800 px-3 py-2"
            >
              {t.text}
            </li>
          ))}
        </ul>
        {tasks.length === 0 && (
          <p className="text-sm text-zinc-500">No tasks yet.</p>
        )}
      </section>
    </div>
  );
}

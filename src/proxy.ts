/**
 * src/proxy.ts
 *
 * Next.js 16 renamed `middleware.ts` → `proxy.ts`. It runs on every request
 * that matches `config.matcher` BEFORE the route is rendered.
 *
 * This is an *optimistic* check: we only look at whether the session cookie
 * is present, not whether the JWT inside it is valid. The signature check
 * happens later in `verifySession()` on the actual page. The point of the
 * proxy is UX — bouncing obviously-logged-out users to /signin without
 * having to spin up a Server Component first.
 */
import { type NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth";

const PROTECTED_PREFIXES = ["/dashboard"];

export function proxy(request: NextRequest) {
  const isProtected = PROTECTED_PREFIXES.some((p) =>
    request.nextUrl.pathname.startsWith(p),
  );
  if (!isProtected) return NextResponse.next();

  if (!request.cookies.get(SESSION_COOKIE)) {
    const url = request.nextUrl.clone();
    url.pathname = "/signin";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*"],
};

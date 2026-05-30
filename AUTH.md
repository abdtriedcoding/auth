# Custom Email/Password Authentication — Feature Docs

A from-scratch auth system on **Next.js 16 (App Router) + Convex DB**. No NextAuth, no Clerk, no Better Auth — every primitive (hashing, JWT signing, cookie semantics, session retrieval, protected routes) is hand-written so the flow is fully traceable.

This document is the single reference for the feature: what was built, how each flow works, what corners were intentionally cut, and what's worth adding next.

---

## 1. What we built

| Capability | Where it lives |
| --- | --- |
| Sign up (email + password) | `src/app/signup/` → `signUpAction` in `src/app/actions.ts` → `api.auth.signUp` in `convex/auth.ts` |
| Sign in | `src/app/signin/` → `signInAction` → `api.auth.signIn` |
| Sign out | `signOutAction` → cookie delete |
| JWT session | `jose` HS256 token in an `httpOnly` cookie, 7-day expiry |
| Session retrieval | `verifySession()` DAL in `src/lib/auth.ts` (wrapped in React `cache()`) |
| Protected routes | `requireSession()` on the page + optimistic check in `src/proxy.ts` |
| Password hashing | `bcryptjs`, cost factor 10, runs inside a Convex Node action |
| Validation | `zod` schemas at the Server Action boundary |
| User persistence | `users` table in Convex with a `by_email` index |

---

## 2. Folder layout

```
src/
  lib/
    auth.ts                  # Zod schemas, JWT sign/verify, cookie config,
                             # verifySession() DAL, requireSession() helper
  app/
    actions.ts               # "use server": signUpAction, signInAction, signOutAction
    page.tsx                 # public landing
    signin/
      page.tsx               # server component
      form.tsx               # "use client": useActionState form
    signup/
      page.tsx
      form.tsx
    dashboard/
      page.tsx               # protected; calls requireSession(); shows tasks
      sign-out-button.tsx    # "use client": form calling signOutAction
    ConvexClientProvider.tsx # existing Convex client wrapper
    layout.tsx               # existing root layout
  proxy.ts                   # Next.js 16 proxy (renamed from middleware) —
                             # optimistic cookie-presence redirect

convex/
  schema.ts                  # users + tasks tables
  users.ts                   # internal getByEmail / insertUser
  auth.ts                    # "use node": signUp + signIn actions (bcryptjs)
  tasks.ts                   # demo query, surfaced on /dashboard
```

**Design rule we kept:** few files, dense files. The whole story is in `src/lib/auth.ts` + `src/app/actions.ts` + the three Convex files. No utility folders, no `helpers/`, no `services/`.

---

## 3. Tech stack & library choices

| Concern | Library | Why |
| --- | --- | --- |
| Password hashing | **`bcryptjs`** | Pure-JS port of bcrypt; runs fine in Convex's Node action runtime. Industry standard. Cost 10 (~100ms) — slow enough to frustrate brute force, fast enough not to hit Convex action timeouts. |
| JWT signing/verifying | **`jose`** | Modern, well-maintained, Web Crypto-based, the de-facto choice in the App Router auth docs. We use HS256 with a 32-byte shared secret (`AUTH_SECRET`). |
| Input validation | **`zod`** v4 | Runs at the trust boundary (Server Action) so malformed input never reaches Convex or the hasher. |
| Calling Convex from Next.js server | **`convex/nextjs`** (`fetchAction`, `fetchQuery`) | Idiomatic server-side Convex calls from Server Actions and Server Components. |

Versions installed: `bcryptjs@3.0.3`, `jose@6.2.3`, `zod@4.4.3`, `convex@1.39.1`, `next@16.2.6`.

---

## 4. Database schema (Convex)

```ts
// convex/schema.ts
users: defineTable({
  email: v.string(),         // stored lowercased; the unique handle
  passwordHash: v.string(),  // bcrypt hash; never leaves Convex
}).index("by_email", ["email"]),

tasks: defineTable({
  text: v.string(),
  isCompleted: v.boolean(),
}),
```

- `_id` and `_creationTime` are Convex system fields, automatically added.
- We **store email lowercased** at write time so `Foo@x.com` and `foo@x.com` cannot create duplicate accounts. Display case is lost — acceptable for a learning project.
- `passwordHash` is never returned by any Convex function called from outside Convex. The bcrypt comparison happens *inside* the `signIn` action; only the resulting `{ userId, email }` crosses the wire.
- The `tasks` table is unrelated to auth — it's the existing demo data used on `/dashboard` to show "a protected page that loads data" end-to-end.

---

## 5. Architecture & trust boundary

```
┌────────────── Next.js (trust boundary) ──────────────┐    ┌─── Convex ───┐
│                                                      │    │              │
│  Browser ── form POST ──> Server Action              │    │  schema      │
│                              │                       │    │   users      │
│                              ├─ Zod validate         │    │              │
│                              ├─ fetchAction ─────────┼────┼─> auth.ts    │
│                              │                       │    │   (use node) │
│                              │                       │    │   bcryptjs   │
│                              │                       │    │     │        │
│                              │                       │    │     v        │
│                              │                       │    │  users.ts    │
│                              │                       │    │  internal-   │
│                              │  <─── userId, email ──┼────┼─ Query /     │
│                              │                       │    │  internal-   │
│                              │                       │    │  Mutation    │
│                              ├─ mint JWT (jose)      │    └──────────────┘
│                              ├─ cookies().set(...)   │
│                              └─ redirect /dashboard  │
│                                                      │
│  Protected page ─> verifySession() ─> cookies().get  │
│                    └─ jose.verify ─> { userId, email}│
│                                                      │
│  proxy.ts ─> optimistic cookie-presence check        │
│              └─> redirect /signin if missing         │
└──────────────────────────────────────────────────────┘
```

**Where does trust live?** In the Next.js server.

- The JWT is signed and verified entirely there with `AUTH_SECRET`.
- The cookie is `httpOnly`, so browser JS cannot read or forge it.
- Convex is treated as **storage + a place to run bcrypt** (because bcryptjs needs a Node runtime, and Convex actions provide one).
- We did **not** wire up `convex/auth.config.ts` / JWKS / `ConvexProviderWithAuth`. That route is more "correct" for production but adds RS256 keys, a `/.well-known/jwks.json` endpoint, and a `useAuth` hook — obscuring the auth fundamentals the project is teaching.

**Consequence:** `auth.signUp` and `auth.signIn` are *public* Convex actions (anyone with the deployment URL can call them — which is fine for sign-up/sign-in, those are inherently public). The actual user CRUD (`users.getByEmail`, `users.insertUser`) is **`internalQuery`/`internalMutation`** and is only reachable from inside Convex.

---

## 6. Flow walkthroughs

### 6.1 Sign-up flow

1. `POST` from `<SignUpForm />` (a `"use client"` component using `useActionState`) hits `signUpAction` in `src/app/actions.ts`.
2. Zod parses `{ email, password }`. If invalid → return `{ error: "..." }` and the form re-renders with the message.
3. `fetchAction(api.auth.signUp, parsed.data)` calls the Convex action.
   - The action lowercases the email.
   - Looks up duplicates via `internal.users.getByEmail`. If hit → throws `ConvexError("Email already in use")`.
   - Hashes the password with bcrypt cost 10.
   - Calls `internal.users.insertUser`.
   - Returns `{ userId, email }`.
4. Back in the Server Action: `createSessionCookie({ userId, email })` signs the JWT and writes the `session` cookie.
5. `redirect("/dashboard")` — sent **outside** the `try/catch` because `redirect()` throws an internal `NEXT_REDIRECT` error; catching it would silently break the redirect.

### 6.2 Sign-in flow

1. Same form pattern.
2. `fetchAction(api.auth.signIn, parsed.data)` in Convex:
   - Looks up by email (lowercased).
   - **Timing-equalized**: if no user, still bcrypt-compares against a dummy hash so attackers can't enumerate accounts by measuring response time.
   - Returns `{ userId, email }` or `null`.
3. If `null` → `{ error: "Invalid email or password" }`. We deliberately don't tell the caller *which* was wrong, since that leaks account existence.
4. Otherwise mint JWT → set cookie → redirect.

### 6.3 Session retrieval (every protected render)

The DAL lives in `src/lib/auth.ts`:

```ts
export const verifySession = cache(async (): Promise<SessionPayload | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, getSecret());
    return { userId: payload.userId as Id<"users">, email: payload.email as string };
  } catch {
    return null;  // fail closed on tampered/expired tokens
  }
});
```

- `cache()` from `react` dedupes the call per render — even if a layout *and* its child page both call `verifySession()`, the JWT is verified once.
- `requireSession()` is the variant that calls `redirect("/signin")` when missing — used by `/dashboard/page.tsx`.

Because we put `email` *inside* the JWT, "who am I" reads zero rows from the database on every page load. The token is the source of truth for the session.

### 6.4 Proxy flow (Next.js 16 — formerly middleware)

```ts
// src/proxy.ts
export const config = { matcher: ["/dashboard/:path*"] };
```

- Next.js 16 renamed `middleware.ts` → `proxy.ts`. It runs on the Node.js runtime by default (no more Edge constraint).
- Our proxy does **only** an optimistic check — does the `session` cookie exist? If not, redirect to `/signin`. It does **not** verify the JWT signature.
- The actual security check is `verifySession()` on the protected page itself. The proxy is for UX (don't even attempt to render the protected route for obviously-unauthenticated users).
- This is the pattern the Next.js auth guide recommends in v16: cheap proxy + thorough DAL.

### 6.5 Sign-out flow

```ts
export async function signOutAction(): Promise<void> {
  await clearSessionCookie();
  redirect("/signin");
}
```

That's the entire implementation. Stateless JWT means there's no server-side session to destroy — we just remove the cookie from this browser and the user is logged out *for this device*.

The token itself remains technically valid until expiry — see Drawbacks #1.

---

## 7. Security considerations

| Threat | Mitigation in this code |
| --- | --- |
| **XSS stealing the session token** | Cookie is `httpOnly` → not readable by JavaScript. |
| **CSRF on auth endpoints** | Cookie is `sameSite: 'lax'` → blocks cross-site POSTs. Server Actions are POST-based and same-origin. |
| **Token tampering / forged JWTs** | Verified with `jose.jwtVerify(token, AUTH_SECRET)`. Any signature mismatch returns `null` → treated as anonymous. |
| **Brute-force password guessing** | bcrypt cost 10 (~100ms per attempt). Slow enough that offline cracking is expensive too. |
| **Account enumeration via timing** | Sign-in compares against a dummy bcrypt hash when the email is unknown, so response time is roughly constant. |
| **Account enumeration via error messages** | Sign-in only ever returns `"Invalid email or password"`. The two failure modes are indistinguishable to the caller. |
| **Password hash leakage** | `passwordHash` never leaves Convex. The bcrypt compare runs inside the Convex action; only `{ userId, email }` is returned. |
| **Bad input reaching the database** | Zod parses every form payload at the Server Action boundary before anything else runs. |
| **Direct database access** | `users.getByEmail` and `users.insertUser` are `internalQuery`/`internalMutation` — unreachable from the public internet. |
| **Transport** | Cookie is `secure: true` in production (HTTPS only). Not enforced in dev so localhost works. |
| **Secret strength** | `AUTH_SECRET` is required to be ≥ 32 characters; the code throws a clear error otherwise. Generate with `openssl rand -base64 32` or the equivalent PowerShell one-liner. |

---

## 8. Drawbacks / known limitations

> These are **intentional** trade-offs for an educational project, not bugs. Each one is the price of staying simple.

1. **No revocation.** A stateless JWT is valid until it expires. Sign-out deletes the cookie on *this* browser, but if the token was copied elsewhere it still works for up to 7 days. **Real-world fix:** a `sessions` table — the cookie stores a session id, every request looks it up, sign-out deletes the row.

2. **No refresh / sliding window.** The session is a single 7-day JWT. The user gets logged out exactly 7 days after sign-in regardless of activity. **Real-world fix:** issue a short-lived access token + long-lived refresh token, refresh transparently on each request.

3. **No rate limiting.** `api.auth.signIn` is a public Convex action. An attacker can hit it directly with the deployment URL, bypassing any Next.js-side rate limit. bcrypt cost 10 slows them down but does not stop them. **Real-world fix:** a token-bucket counter keyed by IP + email in a small Convex table, rejecting requests above a threshold.

4. **No email verification.** Sign-up trusts that the email belongs to whoever typed it. **Real-world fix:** issue a tokenized verification link, gate sign-in (or some features) on `emailVerifiedAt`.

5. **No password reset.** A forgotten password is unrecoverable. **Real-world fix:** a "forgot password" flow that emails a short-lived single-use reset token.

6. **Email case is normalized at write.** `Foo@x.com` is stored as `foo@x.com`. The user's original case is not preserved. Fine for learning, slightly user-hostile in production.

7. **Race window on sign-up duplicate check.** The "is this email already taken?" lookup and the insert happen in two separate `ctx.run*` calls. Two simultaneous sign-ups with the same email could both pass the check and both insert. The probability is extremely low in practice. **Real-world fix:** Convex doesn't support unique constraints; the safer pattern is an idempotent insert + post-write reconciliation, or fronting writes with a single mutation that does both reads and writes in one transaction (which we couldn't do here because we need `bcrypt` from the Node runtime, and the mutation runtime is V8).

8. **No `convex/auth.config.ts` / JWKS / `ConvexProviderWithAuth`.** Convex's `ctx.auth.getUserIdentity()` will always return `null` here. That means any *reactive client-side* Convex query cannot be scoped to the signed-in user — the trust boundary is one-way (Next.js → Convex). On `/dashboard` we sidestep this by server-rendering the tasks list via `fetchQuery`. **Real-world fix:** if you want reactive per-user client queries, switch to the JWKS-backed integration.

9. **No multi-factor auth, no OAuth providers, no remember-me, no device list, no session "log out everywhere" button.** Out of scope.

10. **Single secret, no rotation.** `AUTH_SECRET` is the only key. Rotating it invalidates every existing session. Real systems use a key set (`kid` in the JWT header) so old tokens can verify while new ones use the new key.

---

## 9. Potential future improvements (in rough priority order)

1. **DB-backed sessions** for revocation + "log out everywhere" + device-list UI.
2. **Email verification** with a Convex action that sends the verification email and a `usersVerificationTokens` table.
3. **Password reset** flow (same shape as #2).
4. **Rate limiting** on `auth.signIn` and `auth.signUp` — Convex table-based counters.
5. **Switch to Convex `auth.config.ts` + JWKS** so reactive client queries can be user-scoped. Requires generating an RS256 keypair, exposing `/.well-known/jwks.json` from a Next.js Route Handler, configuring `convex/auth.config.ts`, and wiring `ConvexProviderWithAuth`.
6. **Refresh tokens with sliding expiry** for longer sessions without sacrificing security.
7. **MFA (TOTP)** via `otpauth`.
8. **OAuth providers** (Google, GitHub) — the same JWT/cookie pattern can layer underneath.
9. **Audit log** of sign-in / sign-out / password change events.
10. **Secret rotation** with a small key set indexed by `kid` in the JWT header.

---

## 10. Running it locally

**Prereqs:** Node 18+, the project's `node_modules/` installed, a Convex dev deployment provisioned (`npx convex dev` already run at least once so `_generated/` exists).

```powershell
# 1. AUTH_SECRET in .env.local (already set by the assistant in this project).
#    Regenerate any time with:
[Convert]::ToBase64String((1..32 | %{ Get-Random -Max 256 }))

# 2. Keep Convex sync running in one terminal — it watches convex/*.ts and
#    regenerates _generated/ as you edit:
npx convex dev

# 3. In a second terminal:
npm run dev
```

Open <http://localhost:3000>.

### End-to-end check

1. `/` → "Sign in" and "Create account" CTAs.
2. `/signup` → make `test@example.com` / `password123`. Auto-redirects to `/dashboard` greeting you by email and showing the tasks list.
3. DevTools → Application → Cookies → `session` cookie present, `HttpOnly`, `SameSite=Lax`.
4. Sign out → back to `/signin`. Manually visit `/dashboard` → bounced (`proxy.ts` catches it).
5. Sign in with the wrong password → "Invalid email or password" inline error, no cookie set.
6. Sign in with the right password → `/dashboard` again.
7. Try signing up the same email twice → "Email already in use" inline error.

---

## 11. Where to read what

If you want to understand the system, this is the reading order:

1. **`src/lib/auth.ts`** — every primitive in one file. Zod, JWT, cookie config, DAL.
2. **`src/app/actions.ts`** — three Server Actions that wire forms to those primitives + Convex.
3. **`convex/auth.ts`** — bcrypt hashing and verifying inside Convex actions.
4. **`convex/users.ts`** — the only direct DB code.
5. **`src/proxy.ts`** — the optimistic guard.
6. **`src/app/dashboard/page.tsx`** — the canonical protected route, showing how `requireSession()` + a Convex server-rendered query slot together.

If you can read those six files top-to-bottom, you understand the whole system.

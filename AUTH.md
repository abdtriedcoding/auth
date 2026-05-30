# Custom Email/Password Authentication — Feature Docs

A from-scratch auth system on **Next.js 16 (App Router) + Convex DB**. No NextAuth, no Clerk, no Better Auth — every primitive (hashing, JWT signing, cookie semantics, session retrieval, protected routes) is hand-written so the flow is fully traceable.

**Two interchangeable strategies** live side-by-side:

- `AUTH_STRATEGY=jwt` — stateless: cookie holds a signed JWT, no DB read on session verification.
- `AUTH_STRATEGY=session` — stateful: cookie holds an opaque random token, every protected page does one Convex lookup against a `sessions` table.

Switching is a one-line edit to `.env.local` + a dev-server restart. The rest of the application (Server Actions, proxy, protected pages) is unaware of which is active.

---

## 1. What's in the box

| Capability | Where it lives |
| --- | --- |
| Sign up (email + password) | `src/app/signup/` → `signUpAction` → `currentStrategy.signUp` → `api.auth.signUp` |
| Sign in | `src/app/signin/` → `signInAction` → `currentStrategy.signIn` → `api.auth.signIn` |
| Sign out | `signOutAction` → `currentStrategy.signOut` |
| JWT strategy | `src/lib/auth-jwt.ts` — `jose` HS256 token in an `httpOnly` cookie, 7-day expiry |
| Session strategy | `src/lib/auth-session.ts` — opaque 32-byte random token in cookie, row in `sessions` table |
| Strategy switch | `AUTH_STRATEGY` env var, validated at module load in `src/lib/auth.ts` |
| Session retrieval | `verifySession()` DAL — delegates to `currentStrategy.getSession()`, wrapped in React `cache()` |
| Protected routes | `requireSession()` on the page + optimistic cookie-presence check in `src/proxy.ts` |
| Password hashing | `bcryptjs`, cost factor 10, runs inside a Convex Node action |
| Validation | `zod` schemas at the Server Action boundary |
| User persistence | `users` table in Convex with a `by_email` index |
| Session persistence | `sessions` table with `by_token` and `by_expiresAt` indexes |
| Expired session cleanup | Daily Convex cron: `internal.sessions.deleteExpired` |

---

## 2. Folder layout

```
src/
  lib/
    auth.ts                  # entry point: picks strategy from env, re-exports
                             # verifySession + requireSession
    auth-shared.ts           # types, Zod schemas, cookie config, getSecret —
                             # shared by both strategies, lives in its own
                             # file to avoid a circular import
    auth-jwt.ts              # jwtStrategy implementation
    auth-session.ts          # sessionStrategy implementation
  app/
    actions.ts               # "use server": signUpAction, signInAction, signOutAction
                             # — all just delegate to currentStrategy
    page.tsx                 # public landing
    signin/page.tsx + form.tsx
    signup/page.tsx + form.tsx
    dashboard/page.tsx + sign-out-button.tsx
    ConvexClientProvider.tsx
    layout.tsx
  proxy.ts                   # Next.js 16 proxy — optimistic cookie-presence
                             # redirect on /dashboard

convex/
  schema.ts                  # users + tasks + sessions tables
  users.ts                   # internal getByEmail / insertUser
  sessions.ts                # internal insert + public getByToken /
                             # deleteByToken + internal deleteExpired
  auth.ts                    # "use node" — public signUp + signIn actions
                             # (bcryptjs). Both take an optional `session`
                             # arg so the row insert is atomic with the
                             # password verification.
  crons.ts                   # daily cron calling internal.sessions.deleteExpired
  tasks.ts                   # demo query, surfaced on /dashboard
```

**Design rule:** few dense files. The whole strategy story is in `src/lib/auth.ts` + the three sibling files + four Convex files. No utility folders, no helper soup.

---

## 3. The strategy interface

One type, four methods, two implementations.

```ts
// src/lib/auth-shared.ts
export type SessionPayload = { userId: Id<"users">; email: string };
export type AuthResult =
  | { ok: true; session: SessionPayload }
  | { ok: false; error: string };

export type SessionStrategy = {
  signUp(creds): Promise<AuthResult>;
  signIn(creds): Promise<AuthResult>;
  signOut(): Promise<void>;
  getSession(): Promise<SessionPayload | null>;
};
```

Why four methods instead of three (`createSession` / `getSession` / `clearSession`)?

Because for the session strategy the password check and the row insert **must** be the same Convex call. Splitting them would require a public Convex endpoint `createSession({userId, token})` — at which point anyone with the deployment URL can mint a session for any user without knowing the password. Folding sign-up/sign-in into the strategy keeps that invariant atomic.

`currentStrategy` is picked once at module load:

```ts
// src/lib/auth.ts
const RAW = process.env.AUTH_STRATEGY ?? "jwt";
if (RAW !== "jwt" && RAW !== "session") throw new Error(...);
export const currentStrategy =
  RAW === "session" ? sessionStrategy : jwtStrategy;
```

---

## 4. Database schema (Convex)

```ts
// convex/schema.ts
users: defineTable({
  email: v.string(),         // stored lowercased; the unique handle
  passwordHash: v.string(),  // bcrypt hash; never leaves Convex
}).index("by_email", ["email"]),

sessions: defineTable({
  userId: v.id("users"),     // foreign key
  token: v.string(),         // 32-byte random, base64url — the cookie value
  expiresAt: v.number(),     // epoch ms
})
  .index("by_token", ["token"])         // O(1) lookup on every request
  .index("by_expiresAt", ["expiresAt"]),// cron sweep

tasks: defineTable({ ... }),
```

- `sessions` is unused when `AUTH_STRATEGY=jwt` — JWT is stateless.
- `passwordHash` is never returned by any Convex function called from outside Convex.
- `_id` and `_creationTime` are Convex system fields.

---

## 5. The strategy switch (`AUTH_STRATEGY`)

A single env var in `.env.local`, server-only (no `NEXT_PUBLIC_` prefix):

```
AUTH_STRATEGY=jwt        # or `session`
```

Read at module load by `src/lib/auth.ts`. Unknown values throw immediately — fail loud, not silent. Default if unset: `jwt`.

**What changes when you flip the flag**

| Thing | When you toggle from jwt → session |
| --- | --- |
| `src/app/actions.ts` | No change |
| `src/proxy.ts` | No change |
| `src/app/dashboard/page.tsx` and all protected pages | No change |
| Cookie name | Still `session` |
| Cookie *contents* | JWT string → 43-char opaque token |
| What runs on `verifySession()` | `jose.jwtVerify(token, AUTH_SECRET)` → one Convex query |
| Sign-out | Cookie delete only → cookie delete + DB row delete |
| Revocation | None → immediate |
| `sessions` table | Unused → one row per active session, daily cleanup cron |
| `AUTH_SECRET` requirement | Required → ignored (no JWT to sign) |
| Existing sessions across the flip | All current cookies become invalid; users get bounced to `/signin` on next request (cookie shape no longer matches the verifier). Intentional. |

To switch: edit `.env.local`, restart `npm run dev`.

---

## 6. Flow walkthroughs — side by side

### Sign-up / sign-in

| Step | JWT | Session |
| --- | --- | --- |
| 1 | Form submits, Server Action Zod-parses input | same |
| 2 | `currentStrategy.signUp({email, password})` | `currentStrategy.signUp({email, password})` |
| 3 | `fetchAction(api.auth.signUp, creds)` — Convex bcrypt-hashes, inserts user, returns `{userId, email}` | same call BUT with `session: { token, expiresAt }` — Convex also inserts the session row in the same action |
| 4 | Mint JWT (`jose.SignJWT`, HS256, 7-day exp), sign with `AUTH_SECRET` | Token was already generated with `crypto.randomBytes(32)`; no signing |
| 5 | Cookie `session=<jwt>` (~200+ chars) | Cookie `session=<43-char opaque>` |
| 6 | `redirect("/dashboard")` | same |

### Read session on every protected page render

| Step | JWT | Session |
| --- | --- | --- |
| 1 | Page calls `requireSession()` → `verifySession()` → `currentStrategy.getSession()` | same |
| 2 | Read `session` cookie | same |
| 3 | `jose.jwtVerify(token, AUTH_SECRET)` — **CPU only, no I/O** | `fetchQuery(api.sessions.getByToken, { token })` — **one indexed Convex read** |
| 4 | Return `{userId, email}` from JWT payload, or `null` on any verification failure | Returns `{userId, email}` from the joined sessions+users row, or `null` if not found / expired / user deleted |

This is the **central trade-off**: JWT reads zero rows; session reads one row, every page.

React `cache()` dedupes per render — calling `verifySession()` from the layout AND the page only runs the cookie/verify path once.

### Sign-out

| Step | JWT | Session |
| --- | --- | --- |
| 1 | `currentStrategy.signOut()` deletes the cookie | Reads the cookie token, `fetchMutation(api.sessions.deleteByToken)` deletes the row, then deletes the cookie |
| 2 | `redirect("/signin")` | same |
| Effect on a stolen copy of the cookie | ⚠ Still valid until JWT `exp` (up to 7 days) | ✓ Immediately invalid — row is gone, next lookup returns null |

### Cleanup (session strategy only)

`convex/crons.ts` runs `internal.sessions.deleteExpired` every 24 hours. The mutation uses the `by_expiresAt` index to scan in batches of 100 (no `.filter()` — the project's Convex guidelines ban it), deletes them, and if it filled the batch re-schedules itself via `ctx.scheduler.runAfter(0, ...)` so a backlog gets drained without exceeding mutation transaction limits.

---

## 7. JWT vs Session — when to use which

| Concern | JWT (stateless) | Session (stateful) |
| --- | --- | --- |
| Where the truth lives | The token itself | A row in the database |
| Cost to verify | One signature check, CPU-only | One indexed DB read |
| Server-side revocation | ❌ Token valid until `exp` | ✅ Delete the row, instant |
| Sliding expiration | Requires reissuing on every request | Easy: bump `expiresAt` on read |
| Force-logout-everywhere | Hard (needs a denylist) | Trivial: delete all rows for the user |
| Reflect updated user data | After next sign-in | On the next request |
| Survives a database outage | ✅ Yes | ❌ No, every request fails |
| Works across services with no shared DB | ✅ Yes — verify the signature anywhere | ❌ Requires the DB |
| Cookie size | Larger (200–500 bytes) | Smaller (~50 bytes) |
| Bookkeeping | None | Daily cleanup cron |
| Mental model | "Crypto-signed claim" | "Database-backed identity" |

**Pick JWT when** the auth path needs to be cheap and stateless — high-traffic APIs, microservices that share an `AUTH_SECRET` but no DB, scenarios where a brief revocation lag is acceptable.

**Pick session when** revocation matters — a "log out everywhere" button, an admin force-disabling an account, anything that needs the user-data-on-next-request behavior. This is what most traditional web apps (banking, SaaS dashboards) actually want.

The professional libraries (NextAuth/Auth.js, Better Auth, Clerk, Supabase) default to **sessions** for exactly this reason. JWTs are more common in stateless APIs and the OAuth/OIDC world, where the issuer and the verifier are different services.

---

## 8. Security considerations

| Concern | JWT mitigation | Session mitigation |
| --- | --- | --- |
| Token theft via XSS | `httpOnly` cookie | `httpOnly` cookie |
| CSRF | `sameSite: lax` on the cookie + Server Actions are POST same-origin | same |
| Brute-force password guessing | bcrypt cost 10 (~100ms per attempt) | same |
| Account enumeration via timing | Dummy bcrypt compare on unknown email in `signIn` | same |
| Account enumeration via error messages | Generic "Invalid email or password" | same |
| Token forgery | HS256 verification with `AUTH_SECRET` | Token is 256-bit random; guessing is infeasible |
| Replay after sign-out | ⚠ JWT remains valid until `exp` | ✓ Row deleted; token immediately rejected |
| Token-mint-for-arbitrary-user | n/a (no such endpoint exists) | Prevented: session insert is wrapped inside `auth.signUp`/`signIn` which only run after password verification. There is **no** public `createSession({userId})` endpoint. |
| Stale tokens accumulating | n/a | Daily cron sweep via `by_expiresAt` index |
| Password hash leakage | `passwordHash` never leaves Convex; bcrypt compare runs inside the action | same |
| Direct database access | `users.getByEmail`, `users.insertUser`, `sessions.insert`, `sessions.deleteExpired` are all `internal*` — unreachable from the public internet | same |
| Validation | Zod parses every form payload at the Server Action boundary | same |
| Transport | Cookie is `secure: true` in production | same |
| Secret strength | `AUTH_SECRET` ≥ 32 chars validated at first use | n/a |

---

## 9. Drawbacks / known limitations

| # | Limitation | Affects | Real-world fix |
| --- | --- | --- | --- |
| 1 | No revocation under JWT | jwt only | Switch to session strategy, or add a JWT denylist |
| 2 | No refresh / sliding window | both | Issue a short access token + long refresh token (JWT) or bump `expiresAt` on read (session) |
| 3 | No rate limiting on `auth.signIn`/`signUp` | both | Token-bucket counter keyed by IP in a Convex table |
| 4 | No email verification | both | Send a tokenized link via a Convex action; gate sign-in on `emailVerifiedAt` |
| 5 | No password reset | both | "Forgot password" flow with single-use reset token |
| 6 | Email case is normalized at write | both | Acceptable; original case is lost |
| 7 | Sign-up race window on duplicate email | both | Convex has no unique constraints; acceptable, near-zero in practice |
| 8 | `ctx.auth.getUserIdentity()` returns null | both | Add `convex/auth.config.ts` + JWKS for client-reactive per-user queries |
| 9 | Switching strategies invalidates all in-flight cookies | both | Intentional; communicated by bouncing users to `/signin` |
| 10 | One indexed DB read per protected page render | session only | Cost of revocation; cache layer would defeat the point |
| 11 | `AUTH_SECRET` is a single key, no rotation | jwt only | Add a `kid`-indexed key set |
| 12 | No MFA, no OAuth, no remember-me, no device list | both | Out of scope |

---

## 10. Future improvements (priority order)

1. Sliding expiry on the session strategy (bump `expiresAt` on every read).
2. Email verification flow.
3. Password reset flow.
4. Rate limiting on sign-in / sign-up via a Convex `rateLimits` table.
5. JWT refresh tokens for longer JWT-strategy sessions without losing security.
6. Switch to Convex `auth.config.ts` + JWKS so reactive client-side Convex queries can be user-scoped.
7. "Log out everywhere" button (only meaningful under session strategy; requires a `by_user` index).
8. MFA (TOTP) via `otpauth`.
9. OAuth providers (Google, GitHub) layered on the same cookie.
10. Audit log of sign-in/out events.
11. JWT secret rotation with a `kid`-indexed key set.

---

## 11. Running it locally

```powershell
# 1. AUTH_SECRET in .env.local (already set; only used when AUTH_STRATEGY=jwt).
#    Regenerate any time with:
[Convert]::ToBase64String((1..32 | %{ Get-Random -Max 256 }))

# 2. AUTH_STRATEGY in .env.local: `jwt` or `session`. Default `jwt`.

# 3. Keep Convex sync running — it watches convex/*.ts and regenerates
#    _generated/ as you edit:
npx convex dev

# 4. In a second terminal:
npm run dev
```

Open <http://localhost:3000>.

### End-to-end check — JWT path

1. `.env.local`: `AUTH_STRATEGY=jwt`. Restart dev.
2. `/signup` → make `test@example.com` / `password123`. Auto-redirects to `/dashboard`.
3. DevTools → Cookies → `session` value starts with `eyJ` (JWT header).
4. Sign out → cookie gone, back to `/signin`.

### End-to-end check — Session path

1. `.env.local`: `AUTH_STRATEGY=session`. Restart dev.
2. `/signup` → make `other@example.com` / `password123`.
3. DevTools → Cookies → `session` is a ~43-char opaque string (no dots, no `eyJ`).
4. In the Convex dashboard, open the `sessions` table — one row with that `token`.
5. Sign out → that row is **gone** (refresh the Convex dashboard). Cookie is gone too.
6. (Optional revocation check) Sign in fresh, copy the cookie value, sign in again in another browser — now delete the first row from the Convex dashboard. Reload the dashboard tab in the first browser → bounced to `/signin`. That's revocation working.

### Flipping strategies

Edit `.env.local`, change `AUTH_STRATEGY`, restart dev. Any browser with an old cookie sees one bounce to `/signin` on the next request, then can sign in fresh.

---

## 12. Where to read what

If you want to understand the system, read in this order:

1. **`src/lib/auth-shared.ts`** — types, schemas, cookie config. The vocabulary both strategies use.
2. **`src/lib/auth-jwt.ts`** — read this first; it's the simpler of the two and matches the JWT diagrams in this doc.
3. **`src/lib/auth-session.ts`** — same shape, different verification path.
4. **`src/lib/auth.ts`** — how the env var picks one and the DAL wraps it.
5. **`src/app/actions.ts`** — three tiny Server Actions that delegate.
6. **`convex/auth.ts`** — bcrypt + optional session insert, all in one Node action.
7. **`convex/sessions.ts`** — internal CRUD + the cron's `deleteExpired` batching pattern.
8. **`convex/crons.ts`** — the scheduling.
9. **`src/proxy.ts`** — strategy-agnostic optimistic cookie check.
10. **`src/app/dashboard/page.tsx`** — canonical protected route.

Twelve files. If you can read them top-to-bottom, you understand both strategies and how they're switched.

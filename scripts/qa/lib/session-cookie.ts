/**
 * Builds the exact Cookie header the CMS's own route handlers expect, for a
 * given Supabase Auth email/password pair.
 *
 * Why not hand-roll the cookie format: `@supabase/ssr` (^0.12.0, pinned in
 * package.json) base64url-encodes the session and may split it into numbered
 * chunks (`sb-<ref>-auth-token.0`, `.1`, ...) once it crosses a size
 * threshold — see `node_modules/@supabase/ssr/dist/module/cookies.js`
 * (`createChunks`, `BASE64_PREFIX`). Reimplementing that would be a second
 * copy of a decision that already has one owner (CLAUDE.md §6, DRY). Instead
 * we run the real `createServerClient` against an in-memory cookie jar and
 * let the library do the encoding — identical to what `next dev` would set
 * for a real browser login.
 */
import { createServerClient } from '@supabase/ssr'

export interface SessionCookie {
  /** Ready to use as the `Cookie` request header. */
  header: string
  userId: string
  email: string
}

/**
 * Signs in with the Supabase Auth REST API and returns the Cookie header
 * that a browser would carry after `POST /auth/v1/token?grant_type=password`
 * followed by the CMS's client-side `signInWithPassword`.
 *
 * Throws if the credentials are rejected — callers decide whether that's a
 * fatal error (seeding) or a reason to report the state as SKIPPED (harness).
 */
export async function buildSessionCookieHeader(
  email: string,
  password: string,
  opts: { supabaseUrl: string; supabaseAnonKey: string }
): Promise<SessionCookie> {
  const jar = new Map<string, string>()

  const client = createServerClient(opts.supabaseUrl, opts.supabaseAnonKey, {
    cookies: {
      getAll: () => Array.from(jar.entries()).map(([name, value]) => ({ name, value })),
      setAll: (cookiesToSet) => {
        for (const { name, value } of cookiesToSet) {
          if (value) jar.set(name, value)
          else jar.delete(name)
        }
      },
    },
  })

  const { data, error } = await client.auth.signInWithPassword({ email, password })
  if (error || !data.user) {
    throw new Error(`signInWithPassword failed for ${email}: ${error?.message ?? 'no user returned'}`)
  }

  const header = Array.from(jar.entries())
    .map(([name, value]) => `${name}=${value}`)
    .join('; ')

  if (!header) {
    throw new Error(
      `signInWithPassword for ${email} succeeded but no auth cookie was written — ` +
        `@supabase/ssr version drift? Re-check node_modules/@supabase/ssr/package.json.`
    )
  }

  return { header, userId: data.user.id, email }
}

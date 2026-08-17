/**
 * The single gate for `app/api/**\/route.ts` — CARD-CMS-01.
 *
 * Every HTTP method exported by a route under `app/api/` must be the product of
 * `withAuth(...)` or `withPublicRoute(...)`. `scripts/check-route-policies.ts`
 * enforces it; `npm run check:routes` reports what is still missing.
 *
 * Why a wrapper instead of the proxy: `proxy.ts` matcher excludes `/api`, and
 * bringing `/api/*` into it would make every request pay a round trip to Supabase
 * Auth — including the catalogue reads the CMS map issues in volume.
 *
 * Why `getUser()` and never `getSession()`: `getSession()` reads from the storage
 * attached to the client (here: request cookies) and its values "may not be
 * authentic", so it must not back authorization. `getUser()` "performs a network
 * request to the Supabase Auth server, so the returned value is authentic and can
 * be used to base authorization rules on" — and that round trip is also what makes
 * a revoked session stop working before the cookie expires.
 * https://supabase.com/docs/reference/javascript/auth-getuser (@supabase/ssr ^0.12.0,
 * @supabase/supabase-js ^2.88.0), consulted 2026-08-05.
 */

import { getSupabaseRouteHandler } from './core/supabase-client'
import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'
import { CMS_ROLES, type Role } from './roles'

/** Route params as Next hands them to a route handler. */
export type RouteParams = Record<string, string | string[] | undefined>

/** Second argument Next passes to a route handler. Absent for static segments. */
export interface RouteContext<P extends RouteParams = RouteParams> {
  params?: Promise<P>
}

/** The row of `core.cms_users` that authorized this request. */
export interface CmsUser {
  email: string
  role: Role
  is_active: boolean
}

/** What the gate proved before the handler ran. */
export interface AuthContext {
  /** Authenticated Supabase auth user, revalidated against the Auth server. */
  user: { id: string; email?: string }
  cmsUser: CmsUser
  /** Cookie-bound route-handler client, so the handler does not build a second one. */
  supabase: any
}

/**
 * Handler protected by `withAuth`. It receives the proof as a third argument, so
 * the exported function keeps the exact shape Next expects — see `withAuth`.
 */
export type AuthedRouteHandler<P extends RouteParams = RouteParams> = (
  req: NextRequest,
  ctx: RouteContext<P>,
  auth: AuthContext
) => Promise<Response> | Response

/** Handler declared public. It gets no auth argument, because it proved nothing. */
export type PublicRouteHandler<P extends RouteParams = RouteParams> = (
  req: NextRequest,
  ctx: RouteContext<P>
) => Promise<Response> | Response

export interface AuthPolicy {
  /**
   * Roles of `core.cms_users` allowed to call the route. Required and non-empty:
   * a default would make the policy invisible at the call site, which is the very
   * thing this card exists to fix.
   */
  roles: readonly Role[]
}

export interface PublicPolicy {
  /**
   * Why this route answers without a session — one line, read by whoever audits
   * the gate. "Public by mistake" and "public on purpose" must not look alike.
   */
  reason: string
}

const UNAUTHENTICATED = { error: 'Unauthorized - Authentication required' }
const NO_CMS_ACCESS = { error: 'Forbidden - CMS access denied' }
const INSUFFICIENT_ROLE = { error: 'Forbidden - Insufficient privileges' }
const GATE_FAILURE = { error: 'Internal server error' }

/**
 * Declares that a route requires an authenticated CMS user with one of `roles`.
 *
 * ```ts
 * export const POST = withAuth({ roles: ['admin'] }, async (req, ctx, auth) => { ... })
 * ```
 *
 * Fails closed: anything unexpected answers 500, never the handler's 200.
 */
export function withAuth<P extends RouteParams = RouteParams>(
  policy: AuthPolicy,
  handler: AuthedRouteHandler<P>
): (req: NextRequest, ctx?: RouteContext<P>) => Promise<Response> {
  assertRoles(policy.roles)

  return async (req: NextRequest, ctx?: RouteContext<P>): Promise<Response> => {
    try {
      const supabase = getSupabaseRouteHandler(await cookies())

      // Authentic user: this call revalidates the JWT against the Auth server, so
      // a session revoked in the dashboard is refused here and not at cookie expiry.
      const { data, error } = await supabase.auth.getUser()
      const user = data?.user

      if (error || !user?.email) {
        return NextResponse.json(UNAUTHENTICATED, { status: 401 })
      }

      const { data: cmsUser, error: cmsError } = await supabase
        .schema('core')
        .from('cms_users')
        .select('email, role, is_active')
        .eq('email', user.email)
        .eq('is_active', true)
        .maybeSingle()

      if (cmsError) {
        // A failing lookup is not an absent user: refusing with 403 would tell the
        // caller "you have no CMS access" when the truth is "we could not tell".
        console.error('[auth-middleware] cms_users lookup failed:', cmsError.message)
        return NextResponse.json(GATE_FAILURE, { status: 500 })
      }

      if (!cmsUser) {
        return NextResponse.json(NO_CMS_ACCESS, { status: 403 })
      }

      if (!policy.roles.includes(cmsUser.role)) {
        return NextResponse.json(INSUFFICIENT_ROLE, { status: 403 })
      }

      return await handler(req, ctx ?? {}, {
        user: { id: user.id, email: user.email },
        cmsUser: cmsUser as CmsUser,
        supabase,
      })
    } catch (err) {
      // No email, no user id, no request body in the log: these end up in Vercel logs.
      console.error('[auth-middleware] gate failure:', err instanceof Error ? err.message : err)
      return NextResponse.json(GATE_FAILURE, { status: 500 })
    }
  }
}

/**
 * Declares that a route answers without a session, on purpose.
 *
 * ```ts
 * export const GET = withPublicRoute(
 *   { reason: 'Health check consumed by the Vercel cron' },
 *   async (req) => { ... }
 * )
 * ```
 *
 * It authenticates nothing — its whole job is to make "public" a statement in the
 * code instead of the absence of code. A public route that writes to the database
 * still needs `withRateLimit` and input validation, because the route is the only
 * barrier left.
 *
 * It cannot be combined with `service_role`: `scripts/check-route-policies.ts` fails
 * when a route file that reaches the service client exports a `withPublicRoute`
 * method. `service_role` ignores RLS, so that pair hands the whole database to an
 * anonymous caller — and the check is what keeps this paragraph from being advice.
 */
export function withPublicRoute<P extends RouteParams = RouteParams>(
  policy: PublicPolicy,
  handler: PublicRouteHandler<P>
): (req: NextRequest, ctx?: RouteContext<P>) => Promise<Response> {
  if (!policy.reason?.trim()) {
    throw new Error('withPublicRoute requires a reason: an unexplained public route is an ungated route')
  }

  return async (req: NextRequest, ctx?: RouteContext<P>): Promise<Response> => {
    return handler(req, ctx ?? {})
  }
}

function assertRoles(roles: readonly Role[]): void {
  if (!Array.isArray(roles) || roles.length === 0) {
    throw new Error('withAuth requires at least one role; use withPublicRoute for a route that needs none')
  }
  const unknown = roles.filter((role) => !CMS_ROLES.includes(role))
  if (unknown.length > 0) {
    throw new Error(`withAuth received roles that core.cms_users does not have: ${unknown.join(', ')}`)
  }
}

/**
 * What `withAuth` and `withPublicRoute` return, and therefore what a composer such
 * as `withRateLimit` receives and has to hand back unchanged in shape.
 */
export type GatedRouteHandler<P extends RouteParams = RouteParams> = (
  req: NextRequest,
  ctx?: RouteContext<P>
) => Promise<Response>

// Rate limiting helper
const rateLimitMap = new Map<string, number[]>()

/**
 * Caps requests per IP, per window, PER PROCESS. Composes over a gate:
 *
 * ```ts
 * export const POST = withRateLimit(10, 60_000)(withAuth({ roles: ['admin'] }, handler))
 * ```
 *
 * READ THAT LAST PART BEFORE RELYING ON THIS. The window lives in the `Map` above, which
 * belongs to one serverless instance: instances are created and destroyed per burst, several
 * run at once, and a caller who spreads their requests meets a fresh counter almost every
 * time. So this is a brake on an accidental double-click and on one client hammering one warm
 * instance — it is NOT a barrier, and a public route that writes to the database cannot be
 * defended by it alone. This docstring used to say "caps requests per IP" full stop, and the
 * public partner form was built on that sentence.
 *
 * A route that needs a real limit counts in the database, where the window survives the
 * process: `registerSubmissionAttempt` in `lib/services/partner-proposal-service.ts` is the
 * shape, and this composer stays in front of it as the cheap first line.
 *
 * It forwards `(req, ctx)` — dropping `ctx` here would hand `{}` to every handler on
 * a dynamic segment, so `/api/pois/[id]` would lose its `id` the moment it got a
 * rate limit. The composition is also the only one `scripts/check-route-policies.ts`
 * accepts around a gate; adding another wrapper means adding it there too.
 */
export function withRateLimit(maxRequests: number = 100, windowMs: number = 60000) {
  return <P extends RouteParams = RouteParams>(handler: GatedRouteHandler<P>): GatedRouteHandler<P> => {
    return async (req: NextRequest, ctx?: RouteContext<P>): Promise<Response> => {
      const ip = req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || 'unknown'
      const now = Date.now()
      const windowStart = now - windowMs

      const validRequests = (rateLimitMap.get(ip) ?? []).filter((time) => time > windowStart)

      if (validRequests.length >= maxRequests) {
        console.warn('⚠️ AUTH MIDDLEWARE: Rate limit exceeded for IP:', ip)
        return NextResponse.json(
          { error: 'Too many requests' },
          { status: 429 }
        )
      }

      validRequests.push(now)
      rateLimitMap.set(ip, validRequests)

      return handler(req, ctx)
    }
  }
}

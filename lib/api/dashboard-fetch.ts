/**
 * A GET to one of the CMS's own routes, carrying the operator's session cookie.
 *
 * SEC-37 put the dashboard's reads about people behind `app/api/dashboard/*`, where
 * `withAuth({ roles: ['admin'] })` checks session and role ON THE SERVER. The browser-side
 * service layers (`dashboard-service.ts`, `ranking-service.ts`) only parse what comes back.
 *
 * The relative path is deliberate: these calls belong to a screen, and a run on the server has
 * to fail loudly instead of picking another identity on its own — it was exactly a
 * `typeof window ? ... : anon` that produced the 269 anonymous calls the card measured.
 *
 * It lives here rather than inside `dashboard-service.ts` because a second service needs the
 * same transport, and importing the 1300-line dashboard module to get one `fetch` would pull
 * the whole thing into the bundle of a screen that uses none of it (CLAUDE.md §6).
 */

export interface RpcResult<T> {
  data: T | null
  error: { message: string } | null
}

export async function fetchDashboardRoute<T>(path: string): Promise<RpcResult<T>> {
  if (typeof window === 'undefined') {
    return {
      data: null,
      error: { message: `${path} requires the operator session; it has no server-side caller` },
    }
  }

  const response = await fetch(path, { credentials: 'same-origin' })
  const body = await response.json().catch(() => null)

  if (!response.ok) {
    const message = (body && typeof body.error === 'string' && body.error) || `HTTP ${response.status}`
    return { data: null, error: { message } }
  }

  return { data: (body?.data ?? null) as T | null, error: null }
}

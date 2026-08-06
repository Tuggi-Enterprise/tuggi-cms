/**
 * Reading query parameters in a route handler, once.
 *
 * A route is the only barrier in front of PostgREST, so a number that comes from a
 * caller is bounded before it becomes an RPC argument: `?limit=1e9` on a dashboard
 * read is a denial of service with no attacker beyond a curious operator.
 */

export interface BoundedIntOptions {
  fallback: number
  min: number
  max: number
}

/**
 * Integer query parameter, clamped to `[min, max]`.
 *
 * Absent, empty, non-numeric and non-finite all fall back — `Number('')` is `0`,
 * which would silently turn a missing `limit` into "return nothing".
 */
export function readBoundedInt(
  params: URLSearchParams,
  name: string,
  { fallback, min, max }: BoundedIntOptions
): number {
  const raw = params.get(name)
  if (raw === null || raw.trim() === '') return fallback

  const value = Number(raw)
  if (!Number.isFinite(value)) return fallback

  return Math.min(max, Math.max(min, Math.trunc(value)))
}

/**
 * Boolean query parameter. Only the literal strings decide; anything else falls
 * back, so `?onlyPending=maybe` does not read as `true` by truthiness.
 */
export function readBoolean(params: URLSearchParams, name: string, fallback: boolean): boolean {
  const raw = params.get(name)
  if (raw === 'true') return true
  if (raw === 'false') return false
  return fallback
}

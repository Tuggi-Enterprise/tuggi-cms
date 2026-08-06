/**
 * GET /api/dashboard/overview — the twelve reads behind the Overview screen.
 *
 * SEC-37. These RPCs used to be issued by the browser straight at PostgREST, and
 * the measurement that opened the card counted 269 of them arriving as `anon`:
 * `dashboard_recent_app_users` and `dashboard_user_analytics` return identifiers of
 * real people, and the publishable key that reaches them is inlined in every
 * browser bundle. The gate is here now, and the RPCs run with the operator's own
 * JWT (`auth.supabase`), which is the identity the SQL side already expects —
 * `core.is_caller_platform_admin()` guards the global wrappers.
 *
 * Roles: `admin` only. `proxy.ts` already sends `client` away from `/dashboard`
 * (to `/clients/dashboard`) and bounces every other role to `/unauthorized`; the
 * route states the same rule where it can be enforced instead of navigated around.
 *
 * The response mirrors the RPC results one to one, `{ data, error }` per key: the
 * parsing lives in `lib/services/dashboard-service.ts` and stays there, so this
 * route has nothing to keep in sync.
 */

import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth-middleware'

export const dynamic = 'force-dynamic'

/** `{ data, error }` as PostgREST hands it back, with the error reduced to a message. */
function result(res: { data: unknown; error: { message: string } | null }) {
  return { data: res.data ?? null, error: res.error ? { message: res.error.message } : null }
}

export const GET = withAuth({ roles: ['admin'] }, async (req: NextRequest, _ctx, auth) => {
  const ownerId = new URL(req.url).searchParams.get('ownerId') || null
  const core = auth.supabase.schema('core')

  const [
    userAnalytics,
    cityStats,
    mostVisitedCities,
    topPOIs,
    recentPOIs,
    inventoryFunnel,
    contentQuality,
    visitsByLanguage,
    recentAppActivity,
    countryStats,
    migrationMetrics,
    topGenerators,
  ] = await Promise.all([
    ownerId
      ? core.rpc('dashboard_user_analytics', { p_owner_id: ownerId })
      : core.rpc('dashboard_user_analytics_global'),
    core.rpc('dashboard_city_stats', { p_owner_id: ownerId }),
    core.rpc('dashboard_most_visited_cities', { limit_count: 20 }),
    core.rpc('dashboard_top_visited_pois', { limit_count: 10 }),
    core.rpc('dashboard_recent_visited_pois', { limit_count: 10 }),
    core.rpc('dashboard_inventory_funnel'),
    core.rpc('dashboard_content_quality'),
    core.rpc('dashboard_visits_by_language'),
    core.rpc('dashboard_recent_app_users', { limit_count: 7 }),
    ownerId
      ? core.rpc('dashboard_country_stats', { p_owner_id: ownerId })
      : core.rpc('dashboard_country_stats_global'),
    core.rpc('dashboard_migration_metrics'),
    core.rpc('dashboard_top_generators', { limit_count: 5 }),
  ])

  return NextResponse.json({
    data: {
      userAnalytics: result(userAnalytics),
      cityStats: result(cityStats),
      mostVisitedCities: result(mostVisitedCities),
      topPOIs: result(topPOIs),
      recentPOIs: result(recentPOIs),
      inventoryFunnel: result(inventoryFunnel),
      contentQuality: result(contentQuality),
      visitsByLanguage: result(visitsByLanguage),
      recentAppActivity: result(recentAppActivity),
      countryStats: result(countryStats),
      migrationMetrics: result(migrationMetrics),
      topGenerators: result(topGenerators),
    },
  })
})

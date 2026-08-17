// Centralized role definitions and helpers.
//
// SSOT for the vocabulary of `core.cms_users.role`. The four values below are the
// ones the CMS itself accepts when creating a user (app/api/admin/users/route.ts)
// and the ones the user editor offers (app/[locale]/users/cms/page.tsx).
// `lib/auth-middleware.ts` reads the vocabulary from here — do not restate it.
export const CMS_ROLES = ['admin', 'client', 'editor', 'viewer'] as const

export type Role = (typeof CMS_ROLES)[number]

export const ROLE_ADMIN: Role = 'admin'
export const ROLE_CLIENT: Role = 'client'

export function isAdmin(role?: string | null): boolean {
  return role === ROLE_ADMIN
}

export function isClient(role?: string | null): boolean {
  return role === ROLE_CLIENT
}

// ── The public surface of the CMS ──────────────────────────────────────────────────────
//
// SSOT for "which pages are served without a CMS session". `proxy.ts` reads it and states
// nothing of its own: the list used to live inline in the middleware, and the pages of #341 and
// #342 exist FOR people who have no account here — so the whole external half answered 307 to
// `/login` and the feature did not exist for anyone outside. `tests/api/public-pages.test.ts`
// is what makes removing an entry from here fail out loud instead of silently.
//
// `/parceria` USED TO BE HERE AND IS NOT ANY MORE (#396). The proposal moved to
// `tuggi-enterprise` and the old address answers a 301, declared in `next.config.js`. Putting
// it back would not make the redirect work better — config redirects run at step 2 of Next's
// execution order and the proxy at step 3, so the redirect answers BEFORE this list is even
// consulted. What it would do is keep a public prefix alive for a page that no longer exists.
//
// So one entry is left, and what protects it is a credential: `/contrato/<token>` is reached
// only by a 256-bit single-use token, stored as a SHA-256 hash and expiring. That is a
// different sentence from the one the proposal ever had, and it is the reason the two are no
// longer described together.

/** Paths served without a session, matched WHOLE. */
export const PUBLIC_EXACT_PATHS = ['/login', '/client-signup', '/debug', '/unauthorized'] as const

/**
 * Paths public from the segment on — `/contrato`, because the credential is the next segment.
 * Exact prefixes on purpose: `/contratos` is not `/contrato`, and loosening the proxy matcher
 * instead of this list would open every page under a locale.
 */
export const PUBLIC_PATH_PREFIXES = ['/contrato'] as const

/** `path` is the pathname WITHOUT the locale prefix — `/contrato/abc`, never `/pt/contrato/abc`. */
export function isPublicPath(path: string): boolean {
  if ((PUBLIC_EXACT_PATHS as readonly string[]).includes(path)) return true
  return PUBLIC_PATH_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))
}

export const ALLOWED_CLIENT_PATHS = [
  '/pois',
  '/pois/',
  '/pois/page',
  // '/poi-importer' is admin-only; clients can view and create via POI modal and API
  '/pois/create',
  '/api/pois/create-manual',
  '/api/pois/reverse-geocode',
  '/api/pois/enrich-osm',
  // '/api/pois/countries' was removed with the route itself (CARD-CMS-01): it had no
  // caller — the UI reads countries/states/cities through the `cms_get_*` RPCs in
  // `lib/core/location-service.ts`.
  '/api/pois/cities',

  // Client pages
  '/clients',
  '/clients/my-pois',
  '/clients/my-pois/',
  '/clients/dashboard',
  // Painel do coordenador (afiliados). Mora sob /clients/ de propósito: o middleware
  // libera não-admin por startsWith('/clients') — '/admin/*' bounça para /unauthorized.
  '/clients/coordinator',
]

// '/dashboard' foi REMOVIDO daqui (2026-07-17).
//
// O comentário anterior afirmava que a UI carregaria um dashboard escopado via
// `/api/clients/dashboard` — isso NUNCA foi implementado. app/[locale]/dashboard/page.tsx
// chama `getDashboardData(undefined)`, e com ownerId falsy o dashboard-service lê
// core.mv_user_analytics_global / core.mv_country_stats direto (GRANT ... TO authenticated).
// Resultado: todo client logado via /dashboard enxergava os totais da PLATAFORMA.
//
// A Overview é global por construção e não dá para escopar barato: das 14 chamadas que ela
// dispara, só 4 aceitam p_owner_id. As outras 10 (dashboard_inventory_funnel,
// dashboard_recent_app_users, dashboard_top_visited_pois, ...) não têm parâmetro de dono.
// Escopar tudo aquilo é um projeto; remover o acesso é uma linha.
//
// Client agora vai para /clients/dashboard; coordenador, para /clients/coordinator.


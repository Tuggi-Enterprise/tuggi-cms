// Centralized role definitions and helpers
export type Role = 'admin' | 'client'

export const ROLE_ADMIN: Role = 'admin'
export const ROLE_CLIENT: Role = 'client'

export function isAdmin(role?: string | null): boolean {
  return role === ROLE_ADMIN
}

export function isClient(role?: string | null): boolean {
  return role === ROLE_CLIENT
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
  '/api/pois/countries',
  '/api/pois/cities',
  '/api/pois/reverse-geocode',

  // Client pages
  '/clients',
  '/clients/my-pois',
  '/clients/my-pois/',
  '/dashboard'
]

// NOTE: '/dashboard' is allowed for clients, but the UI will load a scoped
// client dashboard (only the client's own metrics) by calling
// `/api/clients/dashboard`. Global admin dashboard data remains restricted
// to admins only.


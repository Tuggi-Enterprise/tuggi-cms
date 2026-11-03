/**
 * The filters of the events screen in the URL (#1078), with the parameter names of /pois where they
 * exist (search, status, country, state, city, page, view). The URL is the one place of the filter
 * state: the page reads it, and every change writes it back.
 */
import type { EventFilters, EventFreeFilter } from './event-service'

export type EventViewMode = 'cards' | 'list' | 'map'

export interface EventPageFilters {
  search: string
  status: 'all' | 'approved' | 'pending'
  time: 'all' | 'upcoming' | 'past'
  country: string
  state: string
  city: string
  categories: string[]
  source: string
  /** YYYY-MM-DD, local day. */
  from: string
  to: string
  free: EventFreeFilter
  missingImage: boolean
  missingTriggerPoints: boolean
  page: number
  view: EventViewMode
}

export const EMPTY_EVENT_FILTERS: EventPageFilters = {
  search: '',
  status: 'all',
  time: 'all',
  country: '',
  state: '',
  city: '',
  categories: [],
  source: '',
  from: '',
  to: '',
  free: 'all',
  missingImage: false,
  missingTriggerPoints: false,
  page: 1,
  view: 'cards',
}

const DAY = /^\d{4}-\d{2}-\d{2}$/

function oneOf<T extends string>(value: string | null, allowed: readonly T[], fallback: T): T {
  return value !== null && (allowed as readonly string[]).indexOf(value) >= 0 ? (value as T) : fallback
}

interface ReadableParams {
  get(name: string): string | null
}

export function readEventFilters(params: ReadableParams): EventPageFilters {
  const day = (name: string) => {
    const v = params.get(name) || ''
    return DAY.test(v) ? v : ''
  }
  const page = parseInt(params.get('page') || '1', 10)
  return {
    search: params.get('search') || '',
    status: oneOf(params.get('status'), ['all', 'approved', 'pending'] as const, 'all'),
    time: oneOf(params.get('time'), ['all', 'upcoming', 'past'] as const, 'all'),
    country: params.get('country') || '',
    state: params.get('state') || '',
    city: params.get('city') || '',
    categories: (params.get('category') || '').split(',').map((c) => c.trim()).filter(Boolean),
    source: params.get('source') || '',
    from: day('from'),
    to: day('to'),
    free: oneOf(params.get('free'), ['all', 'free', 'paid'] as const, 'all'),
    missingImage: params.get('noImage') === '1',
    missingTriggerPoints: params.get('noTriggerPoints') === '1',
    page: Number.isFinite(page) && page > 1 ? page : 1,
    view: oneOf(params.get('view'), ['cards', 'list', 'map'] as const, 'cards'),
  }
}

/** Only what differs from the default goes to the URL, so a clean screen has a clean URL. */
export function writeEventFilters(f: EventPageFilters): URLSearchParams {
  const p = new URLSearchParams()
  if (f.search.trim()) p.set('search', f.search)
  if (f.status !== 'all') p.set('status', f.status)
  if (f.time !== 'all') p.set('time', f.time)
  if (f.country) p.set('country', f.country)
  if (f.state) p.set('state', f.state)
  if (f.city) p.set('city', f.city)
  if (f.categories.length) p.set('category', f.categories.join(','))
  if (f.source) p.set('source', f.source)
  if (f.from) p.set('from', f.from)
  if (f.to) p.set('to', f.to)
  if (f.free !== 'all') p.set('free', f.free)
  if (f.missingImage) p.set('noImage', '1')
  if (f.missingTriggerPoints) p.set('noTriggerPoints', '1')
  if (f.page > 1) p.set('page', String(f.page))
  if (f.view !== 'cards') p.set('view', f.view)
  return p
}

/** Any filter set; the page and the view mode are not filters. */
export function hasActiveEventFilters(f: EventPageFilters): boolean {
  return writeEventFilters({ ...f, page: 1, view: 'cards' }).toString() !== ''
}

/** The local day as the instant it starts or ends in the browser's zone, for starts_after/starts_before. */
function dayBound(day: string, end: boolean): string | null {
  if (!day) return null
  const [y, m, d] = day.split('-').map(Number)
  const date = end ? new Date(y, m - 1, d, 23, 59, 59, 999) : new Date(y, m - 1, d, 0, 0, 0, 0)
  return date.toISOString()
}

/** The service filters of the list and of the map: everything the sidebar shows. */
export function toEventFilters(f: EventPageFilters): EventFilters {
  return {
    search: f.search || undefined,
    status: f.status,
    time: f.time,
    country: f.country || null,
    state: f.state || null,
    city: f.city || null,
    categories: f.categories,
    source: f.source || null,
    startsAfter: dayBound(f.from, false),
    startsBefore: dayBound(f.to, true),
    free: f.free,
    missingImage: f.missingImage,
    missingTriggerPoints: f.missingTriggerPoints,
  }
}

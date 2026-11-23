'use client'

/**
 * VenuePicker — autocomplete of the host of an Event: a POI or a place (#1242).
 *
 * The database guard `core.tg_event_venue_must_be_poi` accepts `entity_kind in ('poi','place')`
 * for `core.event_details.venue_attraction_id` (operator decision, 2026-11-23). So the picker
 * asks the two production searches that already exist, side by side, and tags each row with its
 * kind: `poiService.search` (`cms_list_pois`, POIs only) and `placeService.list`
 * (`cms_list_places`, places only). Neither returns the other kind, so the merge never repeats
 * a row. One search failing still shows what the other found.
 *
 * Empty state → search field with a debounced dropdown of results.
 * Linked     → chip with name/city (and the kind, when it was picked here) + remove button.
 */
import { useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { MapPin, Search, X, Loader2, Link2 } from 'lucide-react'
import { poiService } from '@/lib/core/poi-service'
import { placeService } from '@/lib/core/place-service'

export type VenueKind = 'poi' | 'place'

export interface VenueRef {
  id: string
  name: string
  city?: string | null
  /** Unknown on an event loaded from the database: its details carry only id and name. */
  kind?: VenueKind
}

const SEARCH_LIMIT = 12

/** POIs and places that match `q`, POIs first, each tagged with its kind. */
export async function searchVenues(q: string): Promise<VenueRef[]> {
  const [pois, places] = await Promise.allSettled([
    poiService.search({ search: q, status: 'all', limit: SEARCH_LIMIT, page: 1 }),
    placeService.list({ search: q, status: 'all', pageSize: SEARCH_LIMIT, page: 1 }),
  ])
  const out: VenueRef[] = []
  // `poiService.search` reports its own failure as `{ success: false }` instead of rejecting.
  if (pois.status === 'fulfilled' && pois.value.success !== false) {
    for (const p of pois.value.data || []) out.push({ id: p.id, name: p.name, city: p.city, kind: 'poi' })
  } else {
    console.error('VenuePicker: POI search failed', pois.status === 'fulfilled' ? pois.value.error : pois.reason)
  }
  if (places.status === 'fulfilled') {
    for (const p of places.value.items) out.push({ id: p.id, name: p.name, city: p.city, kind: 'place' })
  } else {
    console.error('VenuePicker: place search failed', places.reason)
  }
  return out
}

function KindBadge({ kind }: { kind: VenueKind }) {
  const t = useTranslations('Modals.EventDetails')
  return (
    <span
      data-testid="venue-kind"
      className={`flex-shrink-0 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-tight ${
        kind === 'place' ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300' : 'bg-tuggi-blue/10 text-tuggi-blue'
      }`}
    >
      {t(kind === 'place' ? 'labels.venue_kind_place' : 'labels.venue_kind_poi')}
    </span>
  )
}

interface Props {
  value: VenueRef | null
  onChange: (v: VenueRef | null) => void
  disabled?: boolean
}

export function VenuePicker({ value, onChange, disabled }: Props) {
  const t = useTranslations('Modals.EventDetails')
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<VenueRef[]>([])
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)

  // Debounced search, 2 characters minimum.
  useEffect(() => {
    const q = query.trim()
    if (q.length < 2) { setResults([]); setLoading(false); return }
    setLoading(true)
    // Two searches now race the next keystroke: an answer for a query already typed over is dropped.
    let stale = false
    const h = setTimeout(async () => {
      const found = await searchVenues(q)
      if (stale) return
      setResults(found)
      setOpen(true)
      setLoading(false)
    }, 350)
    return () => { stale = true; clearTimeout(h) }
  }, [query])

  // Close the dropdown on an outside click.
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  if (value) {
    return (
      <div className="flex items-center justify-between gap-3 px-4 py-3 bg-tuggi-blue/5 border border-tuggi-blue/20 rounded-xl">
        <div className="flex items-center gap-3 min-w-0">
          <div className="p-2 bg-tuggi-blue/10 rounded-lg flex-shrink-0"><Link2 className="h-4 w-4 text-tuggi-blue" /></div>
          <div className="min-w-0">
            <p className="flex items-center gap-2 font-semibold text-sm text-gray-900 dark:text-white min-w-0">
              <span className="truncate">{value.name}</span>
              {value.kind && <KindBadge kind={value.kind} />}
            </p>
            {value.city && <p className="text-xs text-gray-500 truncate">{value.city}</p>}
          </div>
        </div>
        {!disabled && (
          <button
            type="button"
            onClick={() => onChange(null)}
            className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors flex-shrink-0"
            title={t('labels.venue_remove')}
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="relative" ref={boxRef}>
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
        <input
          className="w-full pl-10 pr-10 py-3 bg-gray-50 dark:bg-gray-900/50 border border-transparent rounded-xl focus:bg-white dark:focus:bg-gray-900 focus:ring-2 focus:ring-tuggi-blue transition-all dark:text-white font-medium outline-none disabled:opacity-50"
          placeholder={t('labels.venue_search_placeholder')}
          value={query}
          disabled={disabled}
          onFocus={() => { if (results.length) setOpen(true) }}
          onChange={(e) => setQuery(e.target.value)}
        />
        {loading && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-tuggi-blue" />}
      </div>

      {open && results.length > 0 && (
        <ul className="absolute z-40 mt-2 w-full max-h-64 overflow-y-auto bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-xl">
          {results.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => { onChange(r); setOpen(false); setQuery('') }}
                className="w-full text-left px-4 py-2.5 hover:bg-tuggi-blue/5 flex items-center gap-3 transition-colors"
              >
                <MapPin className="h-4 w-4 text-gray-400 flex-shrink-0" />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-gray-900 dark:text-white truncate">{r.name}</span>
                  {r.city && <span className="block text-xs text-gray-500 truncate">{r.city}</span>}
                </span>
                {r.kind && <KindBadge kind={r.kind} />}
              </button>
            </li>
          ))}
        </ul>
      )}

      {open && !loading && query.trim().length >= 2 && results.length === 0 && (
        <div className="absolute z-40 mt-2 w-full px-4 py-3 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-xl text-sm text-gray-500">
          {t('labels.venue_no_results')}
        </div>
      )}
    </div>
  )
}

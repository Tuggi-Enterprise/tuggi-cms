'use client'

/**
 * VenuePicker — autocomplete de POI anfitrião para vincular um Evento a um POI.
 *
 * Reusa a busca de POIs de produção (poiService.search → cms_list_pois, que já
 * filtra entity_kind='poi'), então só oferece POIs — casando com a guarda de tipo
 * do banco (event_details.venue_attraction_id só aceita entity_kind='poi').
 *
 * Estado vazio  → campo de busca com dropdown de resultados (debounced).
 * Estado ligado → "chip" com nome/cidade do POI + botão de remover o vínculo.
 */
import { useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { MapPin, Search, X, Loader2, Link2 } from 'lucide-react'
import { poiService } from '@/lib/core/poi-service'

export interface VenueRef {
  id: string
  name: string
  city?: string | null
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

  // Busca com debounce (mín. 2 caracteres).
  useEffect(() => {
    const q = query.trim()
    if (q.length < 2) { setResults([]); return }
    setLoading(true)
    const h = setTimeout(async () => {
      try {
        const res = await poiService.search({ search: q, status: 'all', limit: 12, page: 1 })
        setResults((res.data || []).map((p) => ({ id: p.id, name: p.name, city: p.city })))
        setOpen(true)
      } catch {
        setResults([])
      } finally {
        setLoading(false)
      }
    }, 350)
    return () => clearTimeout(h)
  }, [query])

  // Fecha o dropdown ao clicar fora.
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
            <p className="font-semibold text-sm text-gray-900 dark:text-white truncate">{value.name}</p>
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
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-gray-900 dark:text-white truncate">{r.name}</span>
                  {r.city && <span className="block text-xs text-gray-500 truncate">{r.city}</span>}
                </span>
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

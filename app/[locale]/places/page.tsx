'use client'

import { useMemo, useState } from 'react'
import dynamic from 'next/dynamic'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import {
  Store, Plus, Search, Filter, RotateCcw, Loader2,
  Grid, List, ChevronLeft, ChevronRight, MapPin, Map as MapIcon,
} from 'lucide-react'
import { usePlaces, usePlaceFacets } from '@/lib/hooks/use-places'
import { useCmsUser } from '@/lib/hooks/useCmsUser'
import type { PlaceFilters, PlaceListItem } from '@/lib/core/place-service'
import { PlaceFormModal } from '@/components/place-management/PlaceFormModal'
import { derivePartnerPlan, paymentStance, planFactsFromRow } from '@/lib/clients/partner-plan'
import { PaymentStanceBadge } from '@/components/admin/clients/shared/PaymentStanceBadge'
import { cn } from '@/lib/utils'

// Map mode is opt-in, so the Google Maps view (POIMapVisualization underneath) stays out of the
// initial JS of the cards mode this screen opens in.
const EntityMapView = dynamic(
  () => import('@/components/entity-management/EntityMapView').then(m => m.EntityMapView),
  {
    ssr: false,
    loading: () => (
      <div className="h-[70vh] w-full flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-tuggi-blue" />
      </div>
    )
  }
)

const PAGE_SIZE = 50
const MAP_PAGE_SIZE = 2000
type ViewMode = 'cards' | 'list' | 'map'

export default function LocaisPage() {
  const t = useTranslations('PlaceManagement')
  const tc = useTranslations('Common')
  const queryClient = useQueryClient()
  const { canEdit } = useCmsUser()

  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<'all' | 'approved' | 'pending'>('all')
  const [page, setPage] = useState(1)
  const [viewMode, setViewMode] = useState<ViewMode>('cards')

  const [modalOpen, setModalOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)

  const filters: PlaceFilters = useMemo(
    () => ({ search: search || undefined, status, page, pageSize: PAGE_SIZE }),
    [search, status, page]
  )
  const facetFilters: PlaceFilters = useMemo(() => ({ search: search || undefined }), [search])

  const { data, isLoading, isFetching } = usePlaces(filters)
  const { data: facets } = usePlaceFacets(facetFilters)

  // Map view: fetch ALL matching places (with coordinates) in one page — only when active.
  const mapFilters: PlaceFilters = useMemo(
    () => ({ search: search || undefined, status, page: 1, pageSize: MAP_PAGE_SIZE }),
    [search, status]
  )
  const { data: mapData, isLoading: mapLoading } = usePlaces(mapFilters, viewMode === 'map')
  const mapItems = mapData?.items ?? []

  const items = data?.items ?? []
  const total = data?.total ?? 0
  const totalCount = facets?.total ?? total
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const hasActiveFilters = !!search || status !== 'all'

  const openCreate = () => { setEditingId(null); setModalOpen(true) }
  const openEdit = (id: string) => { setEditingId(id); setModalOpen(true) }
  const clearFilters = () => { setSearch(''); setStatus('all'); setPage(1) }

  const sidebarSelect = 'w-full px-3 py-2.5 bg-gray-50/50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700 rounded-xl text-sm outline-none focus:ring-2 focus:ring-tuggi-blue transition-all dark:text-white'
  const viewBtn = (active: boolean) => cn(
    'flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition-all duration-300',
    active ? 'bg-white dark:bg-gray-800 text-tuggi-blue shadow-md shadow-black/5' : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-200'
  )
  const pagerBtn = 'p-3 rounded-2xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 text-gray-600 dark:text-gray-300 enabled:hover:bg-tuggi-blue enabled:hover:text-white enabled:hover:border-tuggi-blue disabled:opacity-40 transition-all'

  /**
   * PAGA OU NÃO PAGA, no card — pedido do operador em 2026-08-26: *"pode levar a info para o card
   * de places se aquele Places é pago ou nao, de acordo com o contrato em que ele está ligado?"*.
   *
   * A régua NÃO é reescrita aqui. `derivePartnerPlan` já sabe ranquear os três donos da resposta —
   * contrato manda no cadastro, cadastro manda na proposta —, e `paymentStance` é o único lugar
   * que colapsa isso no binário. Um `monthly_fee_cents > 0` nesta tela chamaria cortesia de
   * pagamento e ausência de zero, que é BR-B2B-017 item 6 de cabeça para baixo.
   *
   * `null` para todo local sem parceiro atrás, que são 257 dos 283 medidos em 2026-08-26: um selo
   * `não pagante` no catálogo curado é ruído sobre uma pergunta que ninguém fez.
   */
  const stanceOf = (pl: PlaceListItem) =>
    pl.partner_client_id ? paymentStance(derivePartnerPlan(planFactsFromRow(pl)).kind) : null

  const renderCard = (pl: PlaceListItem) => {
    const location = [pl.city, pl.state, pl.country].filter(Boolean).join(', ')
    const price = pl.price_range ? '$'.repeat(pl.price_range) : ''
    const stance = stanceOf(pl)
    const statusPill = (
      <span className={cn('px-2 py-0.5 rounded-lg text-[10px] font-bold uppercase tracking-widest border',
        pl.approved ? 'bg-green-500/10 text-green-500 border-green-500/20' : 'bg-orange-500/10 text-orange-500 border-orange-500/20')}>
        {pl.approved ? t('badges.approved') : t('badges.pending')}
      </span>
    )
    return (
      <div
        key={pl.id}
        onClick={() => openEdit(pl.id)}
        className={cn(
          'group transition-all duration-300 cursor-pointer overflow-hidden relative',
          viewMode === 'cards'
            ? 'bg-white/80 dark:bg-gray-900/80 backdrop-blur-xl border border-gray-200/60 dark:border-gray-800/60 rounded-[1.5rem] hover:shadow-2xl hover:shadow-tuggi-blue/5 hover:-translate-y-1 hover:border-tuggi-blue/30 p-5'
            : 'bg-white/80 dark:bg-gray-900/80 backdrop-blur-xl p-4 border border-gray-200/60 dark:border-gray-800/60 rounded-2xl hover:border-tuggi-blue/30 hover:shadow-xl hover:shadow-black/5'
        )}
      >
        <div className={cn('absolute top-0 left-0 h-1 opacity-80', viewMode === 'cards' ? 'w-full' : 'w-1 h-full',
          pl.approved ? 'bg-gradient-to-r from-green-400 to-emerald-500' : 'bg-gradient-to-r from-orange-400 to-amber-500')} />

        {viewMode === 'cards' ? (
          <div className="flex flex-col h-full">
            <div className="flex items-center justify-between mb-4">
              <span className="text-[10px] font-bold text-tuggi-blue uppercase tracking-widest px-2.5 py-1 bg-tuggi-blue/5 rounded-full border border-tuggi-blue/10 capitalize">
                {pl.place_type || 'place'}{price && <span className="ml-1.5 normal-case">{price}</span>}
              </span>
              {statusPill}
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="font-bold text-gray-900 dark:text-white truncate mb-2">{pl.name}</h3>
              <div className="flex items-center gap-1.5 text-xs text-gray-500">
                <MapPin className="h-3.5 w-3.5 flex-shrink-0" /><span className="truncate">{location}</span>
              </div>
            </div>
            {/* A PARCERIA NUMA LINHA SÓ, e ela não fica na fileira de cima.
                Ali o selo `NÃO PAGANTE` ocupava duas linhas e empurrava `APROVADO` para fora do
                card — reportado pelo operador em 2026-08-26. Mas o conserto não é encolher o
                selo: a fileira de cima é sobre o REGISTRO (tipo, faixa de preço, publicado) e
                isto é sobre a PARCERIA — de quem é e se paga. Juntas numa linha própria, com a
                largura do card inteira, elas cabem e se leem como uma coisa só. */}
            {(pl.partner_name || stance) && (
              <div className="mt-3 flex items-center gap-2 min-w-0">
                {stance && <PaymentStanceBadge stance={stance} />}
                {pl.partner_name && (
                  <span className="text-[11px] text-gray-500 dark:text-gray-400 truncate">
                    {t('partner_owner', { name: pl.partner_name })}
                  </span>
                )}
              </div>
            )}
            <div className="mt-4 pt-3 border-t border-gray-100 dark:border-gray-800 flex items-center justify-between text-[11px] text-gray-400">
              <span>{t('content_summary', { desc: pl.description_count, tp: pl.trigger_point_count })}</span>
              {pl.has_hours && <span>{t('badges.hours')}</span>}
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-6 pl-2">
            <div className="flex-1 min-w-0">
              <h3 className="font-bold text-gray-900 dark:text-white truncate">{pl.name}</h3>
              <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
                {pl.place_type && (
                  <>
                    <span className="capitalize">{pl.place_type}{price && <span className="ml-1.5 text-tuggi-blue font-semibold">{price}</span>}</span>
                    <span className="text-gray-300 dark:text-gray-700">•</span>
                  </>
                )}
                <span className="truncate">{location}</span>
              </div>
            </div>
            <span className="hidden md:inline text-[11px] text-gray-400 flex-shrink-0">{t('content_summary', { desc: pl.description_count, tp: pl.trigger_point_count })}</span>
            {stance && <div className="flex-shrink-0"><PaymentStanceBadge stance={stance} /></div>}
            <div className="flex-shrink-0">{statusPill}</div>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 p-6 lg:p-8 flex flex-col">
      <div className="flex gap-8 flex-1 pt-6">
        {/* Left Column - Filters Sidebar */}
        <div className="w-[18%] flex-shrink-0">
          <div className="bg-white/70 dark:bg-gray-900/70 backdrop-blur-xl rounded-3xl border border-gray-200 dark:border-gray-800 shadow-2xl shadow-black/5 sticky top-24">
            <div className="p-6">
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-tuggi-blue/10 rounded-xl"><Filter className="h-5 w-5 text-tuggi-blue" /></div>
                  <h2 className="text-xl font-semibold text-gray-900 dark:text-white tracking-tight">{t('filters.title')}</h2>
                </div>
                {hasActiveFilters && (
                  <button onClick={clearFilters} className="p-2 text-gray-400 hover:text-tuggi-blue hover:bg-tuggi-blue/5 rounded-lg transition-all">
                    <RotateCcw className="h-4 w-4" />
                  </button>
                )}
              </div>

              <div className="mb-6">
                <div className="relative group">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <Search className="h-4 w-4 text-gray-400 group-focus-within:text-tuggi-blue transition-colors" />
                  </div>
                  <input
                    type="text"
                    placeholder={t('search_placeholder')}
                    value={search}
                    onChange={(e) => { setSearch(e.target.value); setPage(1) }}
                    className="w-full pl-10 pr-4 py-3 bg-gray-50/50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:ring-2 focus:ring-tuggi-blue focus:border-transparent transition-all outline-none dark:text-white"
                  />
                </div>
              </div>

              <div className="space-y-5">
                <div>
                  <h3 className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-3 px-1">{t('columns.status')}</h3>
                  <select value={status} onChange={(e) => { setStatus(e.target.value as any); setPage(1) }} className={sidebarSelect}>
                    <option value="all">{t('filters.status_all')}</option>
                    <option value="approved">{t('filters.status_approved')}</option>
                    <option value="pending">{t('filters.status_pending')}</option>
                  </select>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column - Content */}
        <div className="w-[82%]">
          {/* Stats Summary Bar */}
          <div className="bg-white/80 dark:bg-gray-900/80 backdrop-blur-xl rounded-3xl border border-gray-200 dark:border-gray-800 shadow-2xl shadow-black/5 mb-8 sticky top-0 z-30">
            <div className="p-4 flex items-center justify-between">
              <div className="flex items-center gap-8 pl-2">
                <div className="flex flex-col">
                  <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest leading-none mb-1">{t('title')}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-2xl font-bold text-gray-900 dark:text-white leading-none">{totalCount}</span>
                    <div className="w-1.5 h-1.5 rounded-full bg-tuggi-blue animate-pulse" />
                    {isFetching && <Loader2 className="h-4 w-4 animate-spin text-gray-300" />}
                  </div>
                </div>

                <div className="h-8 w-px bg-gray-200 dark:bg-gray-800" />

                <div className="flex items-center gap-1 p-1 bg-gray-50/50 dark:bg-gray-950/50 rounded-2xl border border-gray-100 dark:border-gray-800">
                  <button onClick={() => setViewMode('cards')} className={viewBtn(viewMode === 'cards')}><Grid className="h-3.5 w-3.5" /> Cards</button>
                  <button onClick={() => setViewMode('list')} className={viewBtn(viewMode === 'list')}><List className="h-3.5 w-3.5" /> List</button>
                  <button onClick={() => setViewMode('map')} className={viewBtn(viewMode === 'map')}><MapIcon className="h-3.5 w-3.5" /> Map</button>
                </div>
              </div>

              {canEdit && (
                <div className="pr-2">
                  <button
                    onClick={openCreate}
                    className="flex items-center gap-2 px-5 py-2.5 rounded-2xl font-semibold text-xs bg-tuggi-blue text-white hover:bg-tuggi-blue/90 shadow-lg shadow-tuggi-blue/20 transition-all duration-300"
                  >
                    <Plus className="h-3.5 w-3.5" /> {t('new_place')}
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Content Area */}
          <div className="flex-1">
            {viewMode === 'map' ? (
              mapLoading ? (
                <div className="bg-white/80 dark:bg-gray-900/80 backdrop-blur-xl rounded-3xl border border-gray-200 dark:border-gray-800 p-16 flex justify-center">
                  <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-tuggi-blue" />
                </div>
              ) : mapItems.length === 0 ? (
                <div className="bg-white/80 dark:bg-gray-900/80 backdrop-blur-xl rounded-3xl border border-gray-200 dark:border-gray-800 p-16 text-center">
                  <div className="inline-flex p-4 bg-gray-100 dark:bg-gray-800 rounded-2xl mb-4"><Store className="h-8 w-8 text-gray-400" /></div>
                  <p className="text-gray-500">{t('empty')}</p>
                </div>
              ) : (
                <div className="bg-white/80 dark:bg-gray-900/80 backdrop-blur-xl rounded-3xl border border-gray-200 dark:border-gray-800 overflow-hidden">
                  <EntityMapView
                    items={mapItems}
                    onItemClick={openEdit}
                    actionMenuLabels={{ edit: tc('actions.edit'), delete: '', garbage: '', approved: t('badges.approved'), pending: t('badges.pending') }}
                    height="70vh"
                  />
                </div>
              )
            ) : (
              <>
                {isLoading ? (
                  <div className="bg-white/80 dark:bg-gray-900/80 backdrop-blur-xl rounded-3xl border border-gray-200 dark:border-gray-800 p-16 flex justify-center">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-tuggi-blue" />
                  </div>
                ) : items.length === 0 ? (
                  <div className="bg-white/80 dark:bg-gray-900/80 backdrop-blur-xl rounded-3xl border border-gray-200 dark:border-gray-800 p-16 text-center">
                    <div className="inline-flex p-4 bg-gray-100 dark:bg-gray-800 rounded-2xl mb-4"><Store className="h-8 w-8 text-gray-400" /></div>
                    <p className="text-gray-500">{t('empty')}</p>
                  </div>
                ) : (
                  <div className={cn('transition-all duration-500',
                    viewMode === 'cards'
                      ? 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-6'
                      : 'space-y-3')}>
                    {items.map(renderCard)}
                  </div>
                )}

                {totalPages > 1 && (
                  <div className="flex items-center justify-center gap-3 mt-8">
                    <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className={pagerBtn}><ChevronLeft className="h-4 w-4" /></button>
                    <span className="text-sm font-medium text-gray-500 min-w-[80px] text-center">{page} / {totalPages}</span>
                    <button disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)} className={pagerBtn}><ChevronRight className="h-4 w-4" /></button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      <PlaceFormModal
        placeId={editingId}
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        onSaved={() => {
          queryClient.invalidateQueries({ queryKey: ['places'] })
          queryClient.invalidateQueries({ queryKey: ['places-facets'] })
        }}
      />
    </div>
  )
}

'use client'

/**
 * PlaceFormModal — criação/edição dos dados específicos de local/comércio
 * (core.attractions base + core.place_details). Horário de funcionamento
 * (attractions.opening_hours + is_poi_open_now), acessibilidade, localização,
 * boundary, trigger points e descrições+áudio reusam os satélites/campos de
 * attractions via attraction_id — wiring dessas abas é a próxima sub-tarefa.
 */
import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Store, X, Save, Loader2, Info, Sparkles, Send } from 'lucide-react'
import { placeService } from '@/lib/core/place-service'
import { usePlaceDetails } from '@/lib/hooks/use-places'

interface PlaceFormModalProps {
  placeId?: string | null
  isOpen: boolean
  onClose: () => void
  onSaved?: (id: string) => void
}

const PLACE_TYPES = ['restaurant', 'bar', 'cafe', 'shop', 'hotel', 'service', 'other']
const AMENITIES: { key: string; t: string }[] = [
  { key: 'has_wifi', t: 'wifi' },
  { key: 'has_outdoor_seating', t: 'outdoor' },
  { key: 'has_delivery', t: 'delivery' },
  { key: 'has_takeaway', t: 'takeaway' },
  { key: 'serves_alcohol', t: 'alcohol' },
  { key: 'accepts_reservations', t: 'reservations' },
]

const fieldLabel = 'block text-[10px] font-black text-gray-500 uppercase tracking-tighter mb-1.5 ml-1'
const fieldInput = 'w-full px-4 py-3 bg-gray-50 dark:bg-gray-900/50 border border-transparent rounded-xl focus:bg-white dark:focus:bg-gray-900 focus:ring-2 focus:ring-tuggi-blue transition-all dark:text-white font-medium outline-none'
const sectionCard = 'bg-white dark:bg-gray-800/40 rounded-2xl p-6 border border-gray-100 dark:border-gray-700/50 shadow-sm'
const sectionTitle = 'text-xs font-black text-gray-400 uppercase tracking-widest mb-5 flex items-center gap-2'

export function PlaceFormModal({ placeId, isOpen, onClose, onSaved }: PlaceFormModalProps) {
  const t = useTranslations('Modals.PlaceDetails')
  const tc = useTranslations('Common')
  const isEdit = !!placeId
  const { data: details, isLoading: loadingDetails, refetch } = usePlaceDetails(placeId ?? null, isOpen && isEdit)

  const [form, setForm] = useState<Record<string, any>>({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!isOpen) return
    if (isEdit && details) {
      const pd = details.place_details || {}
      setForm({
        name: details.name || '',
        city: details.city || '',
        state: details.state || '',
        country: details.country || '',
        approved: !!details.approved,
        is_active: details.is_active !== false,
        priority_level: details.priority_level ?? 3,
        place_type: pd.place_type || '',
        cuisine: (pd.cuisine || []).join(', '),
        price_range: pd.price_range ?? '',
        reservation_url: pd.reservation_url || '',
        menu_url: pd.menu_url || '',
        delivery_url: pd.delivery_url || '',
        order_online_url: pd.order_online_url || '',
        tags: (pd.tags || []).join(', '),
        has_wifi: !!pd.has_wifi,
        has_outdoor_seating: !!pd.has_outdoor_seating,
        has_delivery: !!pd.has_delivery,
        has_takeaway: !!pd.has_takeaway,
        serves_alcohol: !!pd.serves_alcohol,
        accepts_reservations: !!pd.accepts_reservations,
      })
    } else if (!isEdit) {
      setForm({ name: '', city: '', state: '', country: '', latitude: '', longitude: '', place_type: '' })
    }
    setError(null)
  }, [isOpen, isEdit, details])

  const set = (k: string, v: any) => setForm((p) => ({ ...p, [k]: v }))

  if (!isOpen) return null

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    try {
      if (!isEdit) {
        if (!form.name || !form.city || !form.country) {
          throw new Error(t('validation_required'))
        }
        const id = await placeService.create({
          name: form.name,
          city: form.city,
          country: form.country,
          state: form.state || null,
          latitude: form.latitude ? Number(form.latitude) : null,
          longitude: form.longitude ? Number(form.longitude) : null,
          place_type: form.place_type || null,
        })
        onSaved?.(id)
        onClose()
        return
      }

      await placeService.updateAttraction(placeId as string, {
        name: form.name,
        city: form.city,
        state: form.state || null,
        country: form.country,
        approved: !!form.approved,
        is_active: !!form.is_active,
        priority_level: Number(form.priority_level) || 3,
      })
      await placeService.updateDetails(placeId as string, {
        place_type: form.place_type || null,
        cuisine: String(form.cuisine || '').split(',').map((s: string) => s.trim()).filter(Boolean),
        price_range: form.price_range === '' ? null : Number(form.price_range),
        reservation_url: form.reservation_url || null,
        menu_url: form.menu_url || null,
        delivery_url: form.delivery_url || null,
        order_online_url: form.order_online_url || null,
        tags: String(form.tags || '').split(',').map((s: string) => s.trim()).filter(Boolean),
        has_wifi: !!form.has_wifi,
        has_outdoor_seating: !!form.has_outdoor_seating,
        has_delivery: !!form.has_delivery,
        has_takeaway: !!form.has_takeaway,
        serves_alcohol: !!form.serves_alcohol,
        accepts_reservations: !!form.accepts_reservations,
      })
      await refetch()
      onSaved?.(placeId as string)
      onClose()
    } catch (e: any) {
      setError(e?.message || t('error_save'))
    } finally {
      setSaving(false)
    }
  }

  const L = (k: string) => t(`labels.${k}`)

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={onClose}>
      <div
        className="bg-white dark:bg-gray-900 rounded-3xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col animate-in fade-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <header className="px-8 py-5 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-tuggi-blue/10 rounded-2xl"><Store className="h-6 w-6 text-tuggi-blue" /></div>
            <h2 className="text-2xl font-extrabold text-gray-900 dark:text-white tracking-tight">
              {isEdit ? t('title_edit') : t('title_new')}
            </h2>
          </div>
          <button onClick={onClose} className="p-3 text-gray-400 hover:text-tuggi-blue hover:bg-tuggi-blue/5 rounded-2xl transition-all">
            <X className="h-6 w-6" />
          </button>
        </header>

        {/* Body */}
        <div className="p-8 overflow-y-auto space-y-6">
          {error && (
            <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl text-red-700 dark:text-red-400 text-sm">{error}</div>
          )}

          {isEdit && loadingDetails ? (
            <div className="flex items-center justify-center py-16"><Loader2 className="w-8 h-8 animate-spin text-tuggi-blue" /></div>
          ) : (
            <>
              {/* Identity */}
              <section className={sectionCard}>
                <h4 className={sectionTitle}><Info className="h-4 w-4 text-tuggi-blue" />{t('sections.identity')}</h4>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="md:col-span-3">
                    <label className={fieldLabel}>{L('name')} *</label>
                    <input className={fieldInput} value={form.name || ''} onChange={(e) => set('name', e.target.value)} />
                  </div>
                  <div>
                    <label className={fieldLabel}>{L('country')} *</label>
                    <input className={fieldInput} value={form.country || ''} onChange={(e) => set('country', e.target.value)} />
                  </div>
                  <div>
                    <label className={fieldLabel}>{L('state')}</label>
                    <input className={fieldInput} value={form.state || ''} onChange={(e) => set('state', e.target.value)} />
                  </div>
                  <div>
                    <label className={fieldLabel}>{L('city')} *</label>
                    <input className={fieldInput} value={form.city || ''} onChange={(e) => set('city', e.target.value)} />
                  </div>
                  <div>
                    <label className={fieldLabel}>{L('type')}</label>
                    <select className={fieldInput} value={form.place_type || ''} onChange={(e) => set('place_type', e.target.value)}>
                      <option value="">—</option>
                      {PLACE_TYPES.map((ty) => <option key={ty} value={ty}>{ty}</option>)}
                    </select>
                  </div>
                  {!isEdit && (
                    <>
                      <div>
                        <label className={fieldLabel}>{L('latitude')}</label>
                        <input className={fieldInput} value={form.latitude || ''} onChange={(e) => set('latitude', e.target.value)} />
                      </div>
                      <div>
                        <label className={fieldLabel}>{L('longitude')}</label>
                        <input className={fieldInput} value={form.longitude || ''} onChange={(e) => set('longitude', e.target.value)} />
                      </div>
                    </>
                  )}
                </div>
              </section>

              {isEdit && (
                <>
                  {/* Commerce */}
                  <section className={sectionCard}>
                    <h4 className={sectionTitle}><Store className="h-4 w-4 text-tuggi-blue" />{t('sections.commerce')}</h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className={fieldLabel}>{L('price_range')}</label>
                        <select className={fieldInput} value={form.price_range ?? ''} onChange={(e) => set('price_range', e.target.value)}>
                          <option value="">—</option>
                          {[1, 2, 3, 4].map((n) => <option key={n} value={n}>{'$'.repeat(n)}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className={fieldLabel}>{L('cuisine')} <span className="text-gray-400 normal-case tracking-normal font-medium">({t('cuisine_hint')})</span></label>
                        <input className={fieldInput} value={form.cuisine || ''} onChange={(e) => set('cuisine', e.target.value)} />
                      </div>
                      <div>
                        <label className={fieldLabel}>{L('reservation_url')}</label>
                        <input className={fieldInput} value={form.reservation_url || ''} onChange={(e) => set('reservation_url', e.target.value)} />
                      </div>
                      <div>
                        <label className={fieldLabel}>{L('menu_url')}</label>
                        <input className={fieldInput} value={form.menu_url || ''} onChange={(e) => set('menu_url', e.target.value)} />
                      </div>
                      <div>
                        <label className={fieldLabel}>{L('delivery_url')}</label>
                        <input className={fieldInput} value={form.delivery_url || ''} onChange={(e) => set('delivery_url', e.target.value)} />
                      </div>
                      <div>
                        <label className={fieldLabel}>{L('order_online_url')}</label>
                        <input className={fieldInput} value={form.order_online_url || ''} onChange={(e) => set('order_online_url', e.target.value)} />
                      </div>
                      <div className="md:col-span-2">
                        <label className={fieldLabel}>{L('tags')} <span className="text-gray-400 normal-case tracking-normal font-medium">({t('tags_hint')})</span></label>
                        <input className={fieldInput} value={form.tags || ''} onChange={(e) => set('tags', e.target.value)} />
                      </div>
                    </div>
                  </section>

                  {/* Amenities */}
                  <section className={sectionCard}>
                    <h4 className={sectionTitle}><Sparkles className="h-4 w-4 text-tuggi-blue" />{t('sections.amenities')}</h4>
                    <div className="flex flex-wrap gap-x-6 gap-y-3">
                      {AMENITIES.map((a) => (
                        <label key={a.key} className="flex items-center gap-2 cursor-pointer">
                          <input type="checkbox" checked={!!form[a.key]} onChange={(e) => set(a.key, e.target.checked)} className="w-4 h-4 rounded accent-tuggi-blue" />
                          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">{t(`amenities.${a.t}`)}</span>
                        </label>
                      ))}
                    </div>
                  </section>

                  {/* Publishing */}
                  <section className={sectionCard}>
                    <h4 className={sectionTitle}><Send className="h-4 w-4 text-tuggi-blue" />{t('sections.publish')}</h4>
                    <div className="flex flex-wrap items-center gap-6">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input type="checkbox" checked={!!form.approved} onChange={(e) => set('approved', e.target.checked)} className="w-4 h-4 rounded accent-tuggi-blue" />
                        <span className="text-sm font-medium text-gray-700 dark:text-gray-300">{L('approved')}</span>
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input type="checkbox" checked={!!form.is_active} onChange={(e) => set('is_active', e.target.checked)} className="w-4 h-4 rounded accent-tuggi-blue" />
                        <span className="text-sm font-medium text-gray-700 dark:text-gray-300">{L('active')}</span>
                      </label>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-gray-700 dark:text-gray-300">{L('priority')}</span>
                        <select value={form.priority_level ?? 3} onChange={(e) => set('priority_level', e.target.value)} className="px-3 py-1.5 bg-gray-50 dark:bg-gray-900/50 border border-transparent rounded-lg text-sm dark:text-white outline-none focus:ring-2 focus:ring-tuggi-blue">
                          <option value={1}>1</option><option value={2}>2</option><option value={3}>3</option>
                        </select>
                      </div>
                    </div>
                  </section>

                  <p className="text-xs text-gray-400 px-1">{t('reused_note')}</p>
                </>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <footer className="px-8 py-5 border-t border-gray-100 dark:border-gray-800 flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 border border-gray-300 dark:border-gray-600 text-sm font-medium rounded-xl text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
            {tc('actions.cancel')}
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="inline-flex items-center gap-2 px-5 py-2 text-sm font-semibold rounded-xl text-white bg-tuggi-blue hover:bg-tuggi-blue/90 shadow-lg shadow-tuggi-blue/20 disabled:opacity-50 transition-all"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {saving ? tc('actions.saving') : (isEdit ? tc('actions.save') : tc('actions.create'))}
          </button>
        </footer>
      </div>
    </div>
  )
}

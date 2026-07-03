'use client'

/**
 * PlaceFormModal — criação/edição dos dados específicos de local/comércio
 * (core.attractions base + core.place_details). Horário de funcionamento
 * (attractions.opening_hours + is_poi_open_now), acessibilidade, localização,
 * boundary, trigger points e descrições+áudio reusam os satélites/campos de
 * attractions via attraction_id — wiring dessas abas é a próxima sub-tarefa.
 */
import { useEffect, useState } from 'react'
import { X, Save, Loader2 } from 'lucide-react'
import { placeService } from '@/lib/core/place-service'
import { usePlaceDetails } from '@/lib/hooks/use-places'

interface PlaceFormModalProps {
  placeId?: string | null
  isOpen: boolean
  onClose: () => void
  onSaved?: (id: string) => void
}

const PLACE_TYPES = ['restaurant', 'bar', 'cafe', 'shop', 'hotel', 'service', 'other']
const AMENITIES: { key: string; label: string }[] = [
  { key: 'has_wifi', label: 'Wi-Fi' },
  { key: 'has_outdoor_seating', label: 'Outdoor seating' },
  { key: 'has_delivery', label: 'Delivery' },
  { key: 'has_takeaway', label: 'Takeaway' },
  { key: 'serves_alcohol', label: 'Serves alcohol' },
  { key: 'accepts_reservations', label: 'Reservations' },
]

export function PlaceFormModal({ placeId, isOpen, onClose, onSaved }: PlaceFormModalProps) {
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
          throw new Error('Name, city and country are required')
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
        cuisine: String(form.cuisine || '').split(',').map((t: string) => t.trim()).filter(Boolean),
        price_range: form.price_range === '' ? null : Number(form.price_range),
        reservation_url: form.reservation_url || null,
        menu_url: form.menu_url || null,
        delivery_url: form.delivery_url || null,
        order_online_url: form.order_online_url || null,
        tags: String(form.tags || '').split(',').map((t: string) => t.trim()).filter(Boolean),
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
      setError(e?.message || 'Failed to save place')
    } finally {
      setSaving(false)
    }
  }

  const input = 'w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 focus:ring-2 focus:ring-tuggi-blue'
  const label = 'block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white dark:bg-gray-950 rounded-xl shadow-xl w-full max-w-3xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-gray-200 dark:border-gray-800">
          <h2 className="text-xl font-bold text-gray-900 dark:text-white">{isEdit ? 'Edit Place' : 'New Place'}</h2>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {error && <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{error}</div>}
          {isEdit && loadingDetails ? (
            <div className="flex items-center justify-center py-12 text-gray-500"><Loader2 className="w-6 h-6 animate-spin" /></div>
          ) : (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="md:col-span-2">
                  <label className={label}>Name *</label>
                  <input className={input} value={form.name || ''} onChange={(e) => set('name', e.target.value)} />
                </div>
                <div>
                  <label className={label}>Country *</label>
                  <input className={input} value={form.country || ''} onChange={(e) => set('country', e.target.value)} />
                </div>
                <div>
                  <label className={label}>State</label>
                  <input className={input} value={form.state || ''} onChange={(e) => set('state', e.target.value)} />
                </div>
                <div>
                  <label className={label}>City *</label>
                  <input className={input} value={form.city || ''} onChange={(e) => set('city', e.target.value)} />
                </div>
                <div>
                  <label className={label}>Type</label>
                  <select className={input} value={form.place_type || ''} onChange={(e) => set('place_type', e.target.value)}>
                    <option value="">—</option>
                    {PLACE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                {!isEdit && (
                  <>
                    <div>
                      <label className={label}>Latitude</label>
                      <input className={input} value={form.latitude || ''} onChange={(e) => set('latitude', e.target.value)} />
                    </div>
                    <div>
                      <label className={label}>Longitude</label>
                      <input className={input} value={form.longitude || ''} onChange={(e) => set('longitude', e.target.value)} />
                    </div>
                  </>
                )}
              </div>

              {isEdit && (
                <>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 border-t border-gray-100 dark:border-gray-800 pt-4">
                    <div>
                      <label className={label}>Price range (1–4)</label>
                      <select className={input} value={form.price_range ?? ''} onChange={(e) => set('price_range', e.target.value)}>
                        <option value="">—</option>
                        {[1, 2, 3, 4].map((n) => <option key={n} value={n}>{'$'.repeat(n)}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className={label}>Cuisine (comma-separated)</label>
                      <input className={input} value={form.cuisine || ''} onChange={(e) => set('cuisine', e.target.value)} />
                    </div>
                    <div>
                      <label className={label}>Reservation URL</label>
                      <input className={input} value={form.reservation_url || ''} onChange={(e) => set('reservation_url', e.target.value)} />
                    </div>
                    <div>
                      <label className={label}>Menu URL</label>
                      <input className={input} value={form.menu_url || ''} onChange={(e) => set('menu_url', e.target.value)} />
                    </div>
                    <div>
                      <label className={label}>Delivery URL</label>
                      <input className={input} value={form.delivery_url || ''} onChange={(e) => set('delivery_url', e.target.value)} />
                    </div>
                    <div>
                      <label className={label}>Order online URL</label>
                      <input className={input} value={form.order_online_url || ''} onChange={(e) => set('order_online_url', e.target.value)} />
                    </div>
                    <div className="md:col-span-2">
                      <label className={label}>Tags (comma-separated)</label>
                      <input className={input} value={form.tags || ''} onChange={(e) => set('tags', e.target.value)} />
                    </div>
                  </div>

                  <div className="border-t border-gray-100 dark:border-gray-800 pt-4">
                    <label className={label}>Amenities</label>
                    <div className="flex flex-wrap gap-5 mt-1">
                      {AMENITIES.map((a) => (
                        <label key={a.key} className="flex items-center gap-2 cursor-pointer">
                          <input type="checkbox" checked={!!form[a.key]} onChange={(e) => set(a.key, e.target.checked)} className="w-4 h-4" />
                          <span className="text-sm">{a.label}</span>
                        </label>
                      ))}
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-6 border-t border-gray-100 dark:border-gray-800 pt-4">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input type="checkbox" checked={!!form.approved} onChange={(e) => set('approved', e.target.checked)} className="w-4 h-4" />
                      <span className="text-sm font-medium">Approved</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input type="checkbox" checked={!!form.is_active} onChange={(e) => set('is_active', e.target.checked)} className="w-4 h-4" />
                      <span className="text-sm font-medium">Active</span>
                    </label>
                    <div>
                      <span className="text-sm font-medium mr-2">Priority</span>
                      <select value={form.priority_level ?? 3} onChange={(e) => set('priority_level', e.target.value)} className="px-2 py-1 border border-gray-300 dark:border-gray-700 rounded">
                        <option value={1}>1</option>
                        <option value={2}>2</option>
                        <option value={3}>3</option>
                      </select>
                    </div>
                  </div>

                  {/* Opening hours + accessibility reuse attractions fields; boundary,
                      trigger points and description/audio reuse the POI editors
                      (keyed by attraction_id) — wired in a follow-up. */}
                  <div className="mt-2 p-3 rounded-lg bg-gray-50 dark:bg-gray-900 text-xs text-gray-500">
                    Opening hours, accessibility, boundary, trigger points and description/audio
                    reuse the POI editors (keyed by attraction_id) — wired in a follow-up.
                  </div>
                </>
              )}
            </>
          )}
        </div>

        <div className="flex justify-end gap-3 p-5 border-t border-gray-200 dark:border-gray-800">
          <button onClick={onClose} className="px-4 py-2 rounded-lg bg-gray-200 dark:bg-gray-800 text-gray-800 dark:text-gray-200">Cancel</button>
          <button onClick={handleSave} disabled={saving} className="px-4 py-2 rounded-lg bg-tuggi-blue text-white font-medium flex items-center gap-2 disabled:opacity-50">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {isEdit ? 'Save' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  )
}

'use client'

/**
 * PlaceFormModal — gestão de Locais/Comércios no "modal de POI management" (drawer
 * com abas). Aba Details = campos específicos (core.attractions + core.place_details;
 * horário/acessibilidade reusam attractions). Boundary e Trigger Points vêm do
 * EntityManagementDrawer (keyed por attraction_id). Descrição/Áudio: próximo incremento.
 */
import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { Store, Info, Sparkles, Send } from 'lucide-react'
import { PLACE_TYPES, placeService } from '@/lib/core/place-service'
import { usePlaceDetails } from '@/lib/hooks/use-places'
import { useCmsUser } from '@/lib/hooks/useCmsUser'
import { EntityManagementDrawer } from '@/components/entity-management/EntityManagementDrawer'
import { LocationPicker } from '@/components/entity-management/LocationPicker'

interface PlaceFormModalProps {
  placeId?: string | null
  isOpen: boolean
  onClose: () => void
  onSaved?: (id: string) => void
}

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
  const queryClient = useQueryClient()
  const { canEdit } = useCmsUser()
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
        latitude: details.latitude ?? '',
        longitude: details.longitude ?? '',
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

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['places'] })
    queryClient.invalidateQueries({ queryKey: ['places-facets'] })
    if (placeId) queryClient.invalidateQueries({ queryKey: ['place-details', placeId] })
  }

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    try {
      if (!isEdit) {
        if (!form.name || !form.city || !form.country || !form.latitude || !form.longitude) {
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
        invalidate()
        onSaved?.(id)
        onClose()
        return
      }

      if (!form.name || !form.city || !form.country || !form.latitude || !form.longitude) {
        throw new Error(t('validation_required'))
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
      await placeService.setCoordinate(placeId as string, Number(form.latitude), Number(form.longitude))
      await refetch()
      invalidate()
      onSaved?.(placeId as string)
      onClose()
    } catch (e: any) {
      setError(e?.message || t('error_save'))
    } finally {
      setSaving(false)
    }
  }

  const L = (k: string) => t(`labels.${k}`)
  const coordinates = details?.latitude != null && details?.longitude != null
    ? { latitude: details.latitude, longitude: details.longitude }
    : undefined

  return (
    <EntityManagementDrawer
      isOpen={isOpen}
      isEdit={isEdit}
      entityId={(placeId as string) || ''}
      name={form.name || ''}
      coordinates={coordinates}
      canEdit={canEdit}
      loading={isEdit && loadingDetails}
      saving={saving}
      title={isEdit ? t('title_edit') : t('title_new')}
      HeaderIcon={Store}
      onClose={onClose}
      onSave={handleSave}
      invalidate={invalidate}
    >
      {error && (
        <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl text-red-700 dark:text-red-400 text-sm">{error}</div>
      )}

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
          <div className="md:col-span-3">
            <label className={fieldLabel}>{L('location')} *</label>
            {/* O endereço vai junto para CENTRALIZAR o mapa quando o local ainda não tem
                coordenada — é o caso do local que a aprovação do parceiro cria (#371). Ele nunca
                vira coordenada: quem grava é `handleSave`, com o par que o clique produziu. */}
            <LocationPicker
              editable={canEdit}
              latitude={form.latitude !== '' && form.latitude != null ? Number(form.latitude) : null}
              longitude={form.longitude !== '' && form.longitude != null ? Number(form.longitude) : null}
              name={form.name}
              address={details?.formatted_address ?? null}
              addressCaption={t('address_centered')}
              onChange={(lat, lng) => { set('latitude', lat); set('longitude', lng) }}
            />
          </div>
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
        </>
      )}
    </EntityManagementDrawer>
  )
}

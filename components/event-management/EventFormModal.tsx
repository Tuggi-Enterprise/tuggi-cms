'use client'

/**
 * EventFormModal — gestão de Eventos no "modal de POI management" (drawer com abas).
 * Aba Details = campos específicos do evento (core.attractions + core.event_details).
 * Abas Boundary e Trigger Points são reaproveitadas dos POIs pelo EntityManagementDrawer
 * (keyed por attraction_id). Descrição/Áudio ficam para o próximo incremento.
 */
import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { CalendarDays, Info, CalendarClock, Ticket, Send, Link2 } from 'lucide-react'
import { eventService } from '@/lib/core/event-service'
import { useEventDetails } from '@/lib/hooks/use-events'
import { useCmsUser } from '@/lib/hooks/useCmsUser'
import { EntityManagementDrawer } from '@/components/entity-management/EntityManagementDrawer'
import { LocationPicker } from '@/components/entity-management/LocationPicker'
import { VenuePicker } from '@/components/entity-management/VenuePicker'

interface EventFormModalProps {
  eventId?: string | null // null/undefined => create mode
  isOpen: boolean
  onClose: () => void
  onSaved?: (id: string) => void
}

const EVENT_STATUSES = ['scheduled', 'rescheduled', 'cancelled', 'postponed', 'sold_out', 'completed']
const EVENT_CATEGORIES = ['music', 'sports', 'festival', 'theatre', 'conference', 'fair', 'other']

const fieldLabel = 'block text-[10px] font-black text-gray-500 uppercase tracking-tighter mb-1.5 ml-1'
const fieldInput = 'w-full px-4 py-3 bg-gray-50 dark:bg-gray-900/50 border border-transparent rounded-xl focus:bg-white dark:focus:bg-gray-900 focus:ring-2 focus:ring-tuggi-blue transition-all dark:text-white font-medium outline-none'
const sectionCard = 'bg-white dark:bg-gray-800/40 rounded-2xl p-6 border border-gray-100 dark:border-gray-700/50 shadow-sm'
const sectionTitle = 'text-xs font-black text-gray-400 uppercase tracking-widest mb-5 flex items-center gap-2'

function toDatetimeLocal(iso?: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
function fromDatetimeLocal(val: string): string | null {
  if (!val) return null
  const d = new Date(val)
  return isNaN(d.getTime()) ? null : d.toISOString()
}

export function EventFormModal({ eventId, isOpen, onClose, onSaved }: EventFormModalProps) {
  const t = useTranslations('Modals.EventDetails')
  const queryClient = useQueryClient()
  const { canEdit } = useCmsUser()
  const isEdit = !!eventId
  const { data: details, isLoading: loadingDetails, refetch } = useEventDetails(eventId ?? null, isOpen && isEdit)

  const [form, setForm] = useState<Record<string, any>>({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!isOpen) return
    if (isEdit && details) {
      const ed = details.event_details || {}
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
        starts_at: toDatetimeLocal(ed.starts_at),
        ends_at: toDatetimeLocal(ed.ends_at),
        timezone: ed.timezone || 'America/Sao_Paulo',
        all_day: !!ed.all_day,
        status: ed.status || 'scheduled',
        event_category: ed.event_category || '',
        tags: (ed.tags || []).join(', '),
        is_free: !!ed.is_free,
        price_min: ed.price_min ?? '',
        price_max: ed.price_max ?? '',
        currency: ed.currency || 'BRL',
        capacity: ed.capacity ?? '',
        age_restriction: ed.age_restriction || '',
        organizer_name: ed.organizer_name || '',
        organizer_url: ed.organizer_url || '',
        ticket_url: ed.ticket_url || '',
        poster_url: ed.poster_url || '',
        venue_attraction_id: ed.venue_attraction_id || null,
        venue_name: ed.venue_name || null,
      })
    } else if (!isEdit) {
      setForm({
        name: '', city: '', state: '', country: '', latitude: '', longitude: '',
        starts_at: '', ends_at: '', timezone: 'America/Sao_Paulo', all_day: false,
      })
    }
    setError(null)
  }, [isOpen, isEdit, details])

  const set = (k: string, v: any) => setForm((p) => ({ ...p, [k]: v }))

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['events'] })
    queryClient.invalidateQueries({ queryKey: ['events-facets'] })
    if (eventId) queryClient.invalidateQueries({ queryKey: ['event-details', eventId] })
  }

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    try {
      if (!isEdit) {
        if (!form.name || !form.city || !form.country || !form.starts_at || !form.latitude || !form.longitude) {
          throw new Error(t('validation_required'))
        }
        const id = await eventService.create({
          name: form.name,
          city: form.city,
          country: form.country,
          state: form.state || null,
          latitude: form.latitude ? Number(form.latitude) : null,
          longitude: form.longitude ? Number(form.longitude) : null,
          starts_at: fromDatetimeLocal(form.starts_at) as string,
          ends_at: fromDatetimeLocal(form.ends_at),
          timezone: form.timezone,
          all_day: !!form.all_day,
        })
        invalidate()
        onSaved?.(id)
        onClose()
        return
      }

      if (!form.name || !form.city || !form.country || !form.latitude || !form.longitude) {
        throw new Error(t('validation_required'))
      }

      await eventService.updateAttraction(eventId as string, {
        name: form.name,
        city: form.city,
        state: form.state || null,
        country: form.country,
        approved: !!form.approved,
        is_active: !!form.is_active,
        priority_level: Number(form.priority_level) || 3,
      })
      await eventService.updateDetails(eventId as string, {
        starts_at: fromDatetimeLocal(form.starts_at),
        ends_at: fromDatetimeLocal(form.ends_at),
        timezone: form.timezone,
        all_day: !!form.all_day,
        status: form.status,
        event_category: form.event_category || null,
        tags: String(form.tags || '').split(',').map((s: string) => s.trim()).filter(Boolean),
        is_free: !!form.is_free,
        price_min: form.price_min === '' ? null : Number(form.price_min),
        price_max: form.price_max === '' ? null : Number(form.price_max),
        currency: form.currency || 'BRL',
        capacity: form.capacity === '' ? null : Number(form.capacity),
        age_restriction: form.age_restriction || null,
        organizer_name: form.organizer_name || null,
        organizer_url: form.organizer_url || null,
        ticket_url: form.ticket_url || null,
        poster_url: form.poster_url || null,
        venue_attraction_id: form.venue_attraction_id || null,
      })
      await eventService.setCoordinate(eventId as string, Number(form.latitude), Number(form.longitude))
      await refetch()
      invalidate()
      onSaved?.(eventId as string)
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
      entityId={(eventId as string) || ''}
      name={form.name || ''}
      coordinates={coordinates}
      canEdit={canEdit}
      loading={isEdit && loadingDetails}
      saving={saving}
      title={isEdit ? t('title_edit') : t('title_new')}
      HeaderIcon={CalendarDays}
      venueLinked={!!form.venue_attraction_id}
      venueName={form.venue_name || undefined}
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
          <div className="md:col-span-3">
            <label className={fieldLabel}>{L('location')} *</label>
            <LocationPicker
              editable={canEdit}
              latitude={form.latitude !== '' && form.latitude != null ? Number(form.latitude) : null}
              longitude={form.longitude !== '' && form.longitude != null ? Number(form.longitude) : null}
              name={form.name}
              onChange={(lat, lng) => { set('latitude', lat); set('longitude', lng) }}
            />
          </div>
        </div>
      </section>

      {/* Schedule */}
      <section className={sectionCard}>
        <h4 className={sectionTitle}><CalendarClock className="h-4 w-4 text-tuggi-blue" />{t('sections.schedule')}</h4>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className={fieldLabel}>{L('starts_at')} *</label>
            <input type="datetime-local" className={fieldInput} value={form.starts_at || ''} onChange={(e) => set('starts_at', e.target.value)} />
          </div>
          <div>
            <label className={fieldLabel}>{L('ends_at')}</label>
            <input type="datetime-local" className={fieldInput} value={form.ends_at || ''} onChange={(e) => set('ends_at', e.target.value)} />
          </div>
          <div>
            <label className={fieldLabel}>{L('timezone')}</label>
            <input className={fieldInput} value={form.timezone || ''} onChange={(e) => set('timezone', e.target.value)} />
          </div>
          <label className="flex items-center gap-2 mt-6 cursor-pointer">
            <input type="checkbox" checked={!!form.all_day} onChange={(e) => set('all_day', e.target.checked)} className="w-4 h-4 rounded accent-tuggi-blue" />
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">{L('all_day')}</span>
          </label>
        </div>
      </section>

      {isEdit && (
        <>
          {/* Host POI (vínculo) */}
          <section className={sectionCard}>
            <h4 className={sectionTitle}><Link2 className="h-4 w-4 text-tuggi-blue" />{t('sections.host')}</h4>
            <label className={fieldLabel}>{L('venue')}</label>
            <VenuePicker
              value={form.venue_attraction_id ? { id: form.venue_attraction_id, name: form.venue_name || '', city: form.city } : null}
              onChange={(v) => { set('venue_attraction_id', v?.id || null); set('venue_name', v?.name || null) }}
              disabled={!canEdit}
            />
            <p className="text-[11px] text-gray-400 mt-3 leading-relaxed">
              {form.venue_attraction_id ? t('venue_linked_hint') : t('venue_hint')}
            </p>
          </section>

          {/* Tickets & Organizer */}
          <section className={sectionCard}>
            <h4 className={sectionTitle}><Ticket className="h-4 w-4 text-tuggi-blue" />{t('sections.tickets')}</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className={fieldLabel}>{L('status')}</label>
                <select className={fieldInput} value={form.status || 'scheduled'} onChange={(e) => set('status', e.target.value)}>
                  {EVENT_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label className={fieldLabel}>{L('category')}</label>
                <select className={fieldInput} value={form.event_category || ''} onChange={(e) => set('event_category', e.target.value)}>
                  <option value="">—</option>
                  {EVENT_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div className="md:col-span-2">
                <label className={fieldLabel}>{L('tags')} <span className="text-gray-400 normal-case tracking-normal font-medium">({t('tags_hint')})</span></label>
                <input className={fieldInput} value={form.tags || ''} onChange={(e) => set('tags', e.target.value)} />
              </div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={!!form.is_free} onChange={(e) => set('is_free', e.target.checked)} className="w-4 h-4 rounded accent-tuggi-blue" />
                <span className="text-sm font-medium text-gray-700 dark:text-gray-300">{L('is_free')}</span>
              </label>
              <div />
              <div>
                <label className={fieldLabel}>{L('price_min')}</label>
                <input className={fieldInput} value={form.price_min ?? ''} onChange={(e) => set('price_min', e.target.value)} />
              </div>
              <div>
                <label className={fieldLabel}>{L('price_max')}</label>
                <input className={fieldInput} value={form.price_max ?? ''} onChange={(e) => set('price_max', e.target.value)} />
              </div>
              <div>
                <label className={fieldLabel}>{L('capacity')}</label>
                <input className={fieldInput} value={form.capacity ?? ''} onChange={(e) => set('capacity', e.target.value)} />
              </div>
              <div>
                <label className={fieldLabel}>{L('age_restriction')}</label>
                <input className={fieldInput} value={form.age_restriction || ''} onChange={(e) => set('age_restriction', e.target.value)} />
              </div>
              <div>
                <label className={fieldLabel}>{L('organizer_name')}</label>
                <input className={fieldInput} value={form.organizer_name || ''} onChange={(e) => set('organizer_name', e.target.value)} />
              </div>
              <div>
                <label className={fieldLabel}>{L('organizer_url')}</label>
                <input className={fieldInput} value={form.organizer_url || ''} onChange={(e) => set('organizer_url', e.target.value)} />
              </div>
              <div>
                <label className={fieldLabel}>{L('ticket_url')}</label>
                <input className={fieldInput} value={form.ticket_url || ''} onChange={(e) => set('ticket_url', e.target.value)} />
              </div>
              <div>
                <label className={fieldLabel}>{L('poster_url')}</label>
                <input className={fieldInput} value={form.poster_url || ''} onChange={(e) => set('poster_url', e.target.value)} />
              </div>
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

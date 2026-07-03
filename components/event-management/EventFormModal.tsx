'use client'

/**
 * EventFormModal — criação e edição dos dados ESPECÍFICOS de evento
 * (core.attractions base + core.event_details). Localização/boundary, trigger
 * points e descrições+áudio reusam os satélites de attractions via attraction_id;
 * o wiring dessas abas reaproveita os componentes de POI (POIModalContext) e é a
 * próxima sub-tarefa — o seam está marcado abaixo em "Reused POI tabs".
 */
import { useEffect, useState } from 'react'
import { X, Save, Loader2 } from 'lucide-react'
import { eventService } from '@/lib/core/event-service'
import { useEventDetails } from '@/lib/hooks/use-events'

interface EventFormModalProps {
  eventId?: string | null // null/undefined => create mode
  isOpen: boolean
  onClose: () => void
  onSaved?: (id: string) => void
}

const EVENT_STATUSES = ['scheduled', 'rescheduled', 'cancelled', 'postponed', 'sold_out', 'completed']
const EVENT_CATEGORIES = ['music', 'sports', 'festival', 'theatre', 'conference', 'fair', 'other']

function toDatetimeLocal(iso?: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  // yyyy-MM-ddThh:mm in local time
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
function fromDatetimeLocal(val: string): string | null {
  if (!val) return null
  const d = new Date(val)
  return isNaN(d.getTime()) ? null : d.toISOString()
}

export function EventFormModal({ eventId, isOpen, onClose, onSaved }: EventFormModalProps) {
  const isEdit = !!eventId
  const { data: details, isLoading: loadingDetails, refetch } = useEventDetails(eventId ?? null, isOpen && isEdit)

  const [form, setForm] = useState<Record<string, any>>({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Hydrate the form when a detail row loads (edit) or reset (create).
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

  if (!isOpen) return null

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    try {
      if (!isEdit) {
        if (!form.name || !form.city || !form.country || !form.starts_at) {
          throw new Error('Name, city, country and start date are required')
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
        onSaved?.(id)
        onClose()
        return
      }

      // Edit: split the patch across the two tables.
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
        tags: String(form.tags || '').split(',').map((t: string) => t.trim()).filter(Boolean),
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
      })
      await refetch()
      onSaved?.(eventId as string)
      onClose()
    } catch (e: any) {
      setError(e?.message || 'Failed to save event')
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
          <h2 className="text-xl font-bold text-gray-900 dark:text-white">
            {isEdit ? 'Edit Event' : 'New Event'}
          </h2>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{error}</div>
          )}
          {isEdit && loadingDetails ? (
            <div className="flex items-center justify-center py-12 text-gray-500">
              <Loader2 className="w-6 h-6 animate-spin" />
            </div>
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

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 border-t border-gray-100 dark:border-gray-800 pt-4">
                <div>
                  <label className={label}>Starts at *</label>
                  <input type="datetime-local" className={input} value={form.starts_at || ''} onChange={(e) => set('starts_at', e.target.value)} />
                </div>
                <div>
                  <label className={label}>Ends at</label>
                  <input type="datetime-local" className={input} value={form.ends_at || ''} onChange={(e) => set('ends_at', e.target.value)} />
                </div>
                <div>
                  <label className={label}>Timezone (IANA)</label>
                  <input className={input} value={form.timezone || ''} onChange={(e) => set('timezone', e.target.value)} />
                </div>
                <label className="flex items-center gap-2 mt-6 cursor-pointer">
                  <input type="checkbox" checked={!!form.all_day} onChange={(e) => set('all_day', e.target.checked)} className="w-4 h-4" />
                  <span className="text-sm">All day</span>
                </label>
              </div>

              {isEdit && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 border-t border-gray-100 dark:border-gray-800 pt-4">
                  <div>
                    <label className={label}>Status</label>
                    <select className={input} value={form.status || 'scheduled'} onChange={(e) => set('status', e.target.value)}>
                      {EVENT_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className={label}>Category</label>
                    <select className={input} value={form.event_category || ''} onChange={(e) => set('event_category', e.target.value)}>
                      <option value="">—</option>
                      {EVENT_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                  <div className="md:col-span-2">
                    <label className={label}>Tags (comma-separated)</label>
                    <input className={input} value={form.tags || ''} onChange={(e) => set('tags', e.target.value)} />
                  </div>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={!!form.is_free} onChange={(e) => set('is_free', e.target.checked)} className="w-4 h-4" />
                    <span className="text-sm">Free entry</span>
                  </label>
                  <div />
                  <div>
                    <label className={label}>Price min</label>
                    <input className={input} value={form.price_min ?? ''} onChange={(e) => set('price_min', e.target.value)} />
                  </div>
                  <div>
                    <label className={label}>Price max</label>
                    <input className={input} value={form.price_max ?? ''} onChange={(e) => set('price_max', e.target.value)} />
                  </div>
                  <div>
                    <label className={label}>Capacity</label>
                    <input className={input} value={form.capacity ?? ''} onChange={(e) => set('capacity', e.target.value)} />
                  </div>
                  <div>
                    <label className={label}>Age restriction</label>
                    <input className={input} value={form.age_restriction || ''} onChange={(e) => set('age_restriction', e.target.value)} />
                  </div>
                  <div>
                    <label className={label}>Organizer name</label>
                    <input className={input} value={form.organizer_name || ''} onChange={(e) => set('organizer_name', e.target.value)} />
                  </div>
                  <div>
                    <label className={label}>Organizer URL</label>
                    <input className={input} value={form.organizer_url || ''} onChange={(e) => set('organizer_url', e.target.value)} />
                  </div>
                  <div>
                    <label className={label}>Ticket URL</label>
                    <input className={input} value={form.ticket_url || ''} onChange={(e) => set('ticket_url', e.target.value)} />
                  </div>
                  <div>
                    <label className={label}>Poster URL</label>
                    <input className={input} value={form.poster_url || ''} onChange={(e) => set('poster_url', e.target.value)} />
                  </div>

                  <div className="md:col-span-2 flex flex-wrap gap-6 border-t border-gray-100 dark:border-gray-800 pt-4">
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

                  {/* Reused POI tabs (next sub-task): Boundary, Trigger Points,
                      Description + Audio — all key on this event's attraction_id. */}
                  <div className="md:col-span-2 mt-2 p-3 rounded-lg bg-gray-50 dark:bg-gray-900 text-xs text-gray-500">
                    Boundary, Trigger Points and Description/Audio reuse the POI editors
                    (keyed by attraction_id) — wired in a follow-up.
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        <div className="flex justify-end gap-3 p-5 border-t border-gray-200 dark:border-gray-800">
          <button onClick={onClose} className="px-4 py-2 rounded-lg bg-gray-200 dark:bg-gray-800 text-gray-800 dark:text-gray-200">
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 rounded-lg bg-tuggi-blue text-white font-medium flex items-center gap-2 disabled:opacity-50"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {isEdit ? 'Save' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  )
}

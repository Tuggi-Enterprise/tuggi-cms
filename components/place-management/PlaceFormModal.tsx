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
import { PlaceDeleteControl } from '@/components/place-management/PlaceDeleteControl'
import { Store, Info, Sparkles, Loader2 } from 'lucide-react'
import { PLACE_TYPES, placeService } from '@/lib/core/place-service'
import { usePlaceDetails } from '@/lib/hooks/use-places'
import { useReverseGeocode } from '@/lib/hooks/use-reverse-geocode'
import { missingRequiredLabels } from '@/lib/core/entity-form-validation'
import { useCmsUser } from '@/lib/hooks/useCmsUser'
import { buildAddressQuery } from '@/lib/maps/place-address-query'
import { cn } from '@/lib/utils'
import { applyNameOnlyDescription, descriptionPolicyKey } from '@/lib/hooks/use-description-policy'
import { EntityManagementDrawer } from '@/components/entity-management/EntityManagementDrawer'
import { LocationPicker } from '@/components/entity-management/LocationPicker'
import { PublishingControls } from '@/components/entity-management/PublishingControls'

interface PlaceFormModalProps {
  placeId?: string | null
  isOpen: boolean
  onClose: () => void
  onSaved?: (id: string) => void
  /** The tab a deep link asks for — see `EntityManagementDrawer`. */
  initialTab?: 'details' | 'description' | 'narration-audio' | 'trigger-points'
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

export function PlaceFormModal({ placeId, isOpen, onClose, onSaved, initialTab }: PlaceFormModalProps) {
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

  /**
   * Country/state/city come from the map click, like POI creation does. CREATE MODE ONLY: on an
   * existing record those fields were curated, and overwriting them when the pin moves would
   * erase someone's work. The operator can still correct all three by hand.
   */
  const { detecting: detectingLocation, detected: detectedLocation } = useReverseGeocode({
    enabled: isOpen && !isEdit && canEdit,
    latitude: form.latitude !== '' && form.latitude != null ? Number(form.latitude) : null,
    longitude: form.longitude !== '' && form.longitude != null ? Number(form.longitude) : null,
    onDetected: (loc) => {
      setForm((p) => ({
        ...p,
        city: loc.city ?? p.city,
        state: loc.state ?? p.state,
        country: loc.country ?? p.country,
      }))
    },
  })

  /** Which required fields are still empty, in the operator's language. */
  const missingFieldsMessage = () => {
    const fields = missingRequiredLabels(form).map((label) => t(`labels.${label}`))
    return t('validation_missing', { fields: fields.join(', ') })
  }

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['places'] })
    queryClient.invalidateQueries({ queryKey: ['places-facets'] })
    if (placeId) {
      queryClient.invalidateQueries({ queryKey: ['place-details', placeId] })
      // A faixa da aba Descrição lê o nome e o que está no ar; um save que mudou os dois deixaria
      // a faixa afirmando o estado anterior.
      queryClient.invalidateQueries({ queryKey: descriptionPolicyKey(placeId) })
    }
  }

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    try {
      if (!isEdit) {
        if (!form.name || !form.city || !form.country || !form.latitude || !form.longitude) {
          // Names the fields that are actually missing: the old fixed sentence listed
          // name/city/country while what was missing was the coordinate.
          throw new Error(missingFieldsMessage())
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
        throw new Error(missingFieldsMessage())
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

      /**
       * O QUE O PLANO DÁ A ESTE LOCAL, aplicado — BR-B2B-016, item 1.
       *
       * No plano gratuito o conteúdo do parceiro é o NOME, e é este save que o coloca lá: sem ele
       * o local fica mudo, porque o app tem guarda nativa contra tocar o direcional sozinho. A
       * rota decide se há algo a aplicar, então chamar aqui para todo local é barato — POI de
       * curadoria e parceiro pagante respondem `not_applicable` e nada é escrito. Ela também nunca
       * sobrescreve descrição que já existia (5º caso de borda da mesma regra).
       *
       * Best-effort: o local JÁ está gravado, e derrubar o save por causa disto faria o operador
       * reeditar tudo por uma linha de descrição que a aba Descrição mostra e resolve.
       */
      try {
        await applyNameOnlyDescription(placeId as string)
      } catch (policyError) {
        console.error('[places] política de descrição não aplicada:', policyError)
      }

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

  /**
   * O ENDEREÇO DO LOCAL, e é UM só — pedido do operador em 2026-08-26: *"na parte de detalhes,
   * mostre o endereço do local"*.
   *
   * A string é a MESMA que o mapa procura, hoisted de dentro do `LocationPicker` em vez de montada
   * uma segunda vez para a tela. Isso não é economia: o que o operador lê passa a ser exatamente
   * o que o buscador recebeu, então quando o pino cai no lugar errado a linha na tela é a
   * explicação — e não mais um dado para conferir contra o mapa.
   *
   * `formatted_address` é o que a aprovação do parceiro grava (rua, complemento, bairro);
   * `buildAddressQuery` acrescenta CEP, cidade, estado e país sem repetir o que já está lá. Os
   * campos vêm do FORMULÁRIO e não de `details`: se o curador acabou de corrigir a cidade, é a
   * corrigida que a linha mostra.
   */
  const addressQuery = buildAddressQuery({
    address: details?.formatted_address ?? null,
    postalCode: details?.postal_code ?? null,
    city: form.city,
    state: form.state,
    country: form.country,
  })
  /**
   * O CEP entra na linha por `buildAddressQuery`, mas a RUA é o que decide se há endereço a
   * mostrar: sem ela sobra `Cabo Frio, Rio de Janeiro, Brazil`, que é a repetição dos três campos
   * logo acima e não é endereço nenhum.
   */
  const hasStreetAddress = !!(details?.formatted_address ?? '').trim()
  const coordinates = details?.latitude != null && details?.longitude != null
    ? { latitude: details.latitude, longitude: details.longitude }
    : undefined

  return (
    <EntityManagementDrawer
      isOpen={isOpen}
      isEdit={isEdit}
      entityId={(placeId as string) || ''}
      initialTab={initialTab}
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
      sidebarFooter={isEdit ? (
        <>
          <PublishingControls
            title={t('sections.publish')}
            labels={{ approved: L('approved'), active: L('active'), priority: L('priority') }}
            approved={!!form.approved}
            isActive={!!form.is_active}
            priorityLevel={Number(form.priority_level) || 3}
            disabled={!canEdit}
            onChange={(patch) => setForm((p) => ({ ...p, ...patch }))}
          />
          {/* ABAIXO DA PUBLICAÇÃO, e não ao lado de Salvar: `Ativo` logo acima é a alternativa
              que o operador tem para o local que carrega histórico e por isso não pode sumir —
              tirar do turista sem apagar visita, feedback e trilha de triagem (BR-POI-005). */}
          {canEdit && placeId && (
            <PlaceDeleteControl
              attractionId={placeId as string}
              name={form.name || ''}
              onDeleted={async () => {
                invalidate()
                onSaved?.(placeId as string)
                onClose()
              }}
            />
          )}
        </>
      ) : undefined}
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
            {/* Não é campo: é o que está no cadastro. Editar endereço de parceiro é mexer no que
                ele declarou, e isso tem outro dono e outra tela — aqui ele existe para o curador
                conferir o pino contra o que o estabelecimento informou. */}
            <label className={fieldLabel}>{L('address')}</label>
            <p className={cn(
              'mb-5 px-4 py-3 rounded-xl bg-gray-50 dark:bg-gray-900/50 text-sm',
              hasStreetAddress
                ? 'font-medium text-gray-700 dark:text-gray-200'
                : 'italic text-gray-400 dark:text-gray-500'
            )}>
              {hasStreetAddress ? addressQuery : t('address_none')}
            </p>

            <label className={fieldLabel}>{L('location')} *</label>
            {/* O endereço vai junto para CENTRALIZAR o mapa quando o local ainda não tem
                coordenada — é o caso do local que a aprovação do parceiro cria (#371). Ele nunca
                vira coordenada: quem grava é `handleSave`, com o par que o clique produziu.

                E vai INTEIRO desde 26/08/2026. `formatted_address` do local de parceiro é só o
                que `joinAddress` monta — rua, complemento e bairro —, então a consulta saía como
                `Av Assunção 606, São Bento` e mandava o buscador procurar uma avenida no Brasil
                inteiro. Cidade, estado e CEP sempre estiveram no registro; faltava perguntá-los
                junto. Os campos são os do FORMULÁRIO e não os de `details`: se o curador acabou
                de corrigir a cidade, é a corrigida que deve mirar a câmera. */}
            <LocationPicker
              editable={canEdit}
              latitude={form.latitude !== '' && form.latitude != null ? Number(form.latitude) : null}
              longitude={form.longitude !== '' && form.longitude != null ? Number(form.longitude) : null}
              name={form.name}
              address={addressQuery}
              captions={{
                locating: t('address_locating'),
                centered: t('address_centered'),
                not_located: t('address_not_located'),
                no_address: t('address_missing'),
              }}
              onChange={(lat, lng) => { set('latitude', lat); set('longitude', lng) }}
            />
            {/* What the click resolved to, like the POI create tab: the fields above are already
                filled with it, and this panel is what lets the operator check before saving. */}
            {!isEdit && detectingLocation && (
              <p className="mt-2 flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                {t('location_detecting')}
              </p>
            )}
            {!isEdit && !detectingLocation && detectedLocation?.formatted_address && (
              <p className="mt-2 text-xs text-gray-600 dark:text-gray-400">
                {t('location_detected')} {detectedLocation.formatted_address}
              </p>
            )}
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

        </>
      )}
    </EntityManagementDrawer>
  )
}

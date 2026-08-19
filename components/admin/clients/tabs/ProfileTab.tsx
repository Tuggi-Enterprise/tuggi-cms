'use client'

import { Building2, Sparkles } from 'lucide-react'
import { useTranslations } from 'next-intl'
import {
  DEFAULT_CLIENT_TYPE,
  REGISTRABLE_CLIENT_TYPES,
  isRegistrableClientType,
  type Client,
  type ClientType,
} from '@/types/clients'
import { COUNTRIES } from '@/components/admin/clients/shared/countries'
import { EditField } from '@/components/admin/clients/shared/EditField'
import { SectionHeader } from '@/components/admin/clients/shared/SectionHeader'
import { ClientQrCode } from '@/components/admin/clients/shared/ClientQrCode'
import { MaterialOrders } from '@/components/admin/clients/shared/MaterialOrders'

export interface ClientEditorTabProps {
  client: Client | null
  edited: Partial<Client>
  updateField: <K extends keyof Client>(field: K, value: Client[K]) => void
  canEdit: boolean
  clientId?: string
}

function v<K extends keyof Client>(client: Client | null, edited: Partial<Client>, k: K): string {
  const raw = edited[k] ?? client?.[k]
  return raw == null ? '' : String(raw)
}

export function ProfileTab({ client, edited, updateField, canEdit, clientId }: ClientEditorTabProps) {
  const t = useTranslations('Clients.profile')
  const isEditing = canEdit
  const currentCountry = String(edited.country ?? client?.country ?? '')
  const currentType: ClientType = (edited.client_type ?? client?.client_type ?? DEFAULT_CLIENT_TYPE) as ClientType
  const currentSlug = String(edited.slug ?? client?.slug ?? '')
  // The offer is the four of BR-B2B-020, item 8 — never the seven the CHECK accepts. A legacy
  // value (`business`, `partner`, `hotel`) shows up only when it is what THIS client already
  // is, so the operator sees the truth and saving without touching the field reclassifies
  // nobody (edge case written into item 8). It is never offered to a registration being born.
  const typeOptions: readonly ClientType[] = isRegistrableClientType(currentType)
    ? REGISTRABLE_CLIENT_TYPES
    : [...REGISTRABLE_CLIENT_TYPES, currentType]
  // Show the QR only once we know which client we're attributing to —
  // create mode (no clientId yet) has nothing to point at.
  const showQr = Boolean(clientId)

  return (
    <div className="space-y-8 max-w-5xl mx-auto">
      {/* Identity */}
      <div className="bg-white dark:bg-gray-900 rounded-3xl border border-gray-200 dark:border-gray-800 p-8 shadow-sm">
        <SectionHeader icon={<Building2 className="w-4 h-4 text-tuggi-blue" />} title={t('sections.identity')} />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-6 gap-x-10">
          <EditField label={t('fields.name')} value={v(client, edited, 'name')} isEditing={isEditing} onChange={(val) => updateField('name', val)} />
          <EditField label={t('fields.companyName')} value={v(client, edited, 'company_name')} isEditing={isEditing} onChange={(val) => updateField('company_name', val)} />
          <EditField label={t('fields.email')} value={v(client, edited, 'email')} isEditing={isEditing} onChange={(val) => updateField('email', val)} type="email" />
          <EditField label={t('fields.phone')} value={v(client, edited, 'phone')} isEditing={isEditing} onChange={(val) => updateField('phone', val)} type="tel" />
          <EditField
            label={t('fields.slug')}
            value={v(client, edited, 'slug')}
            isEditing={isEditing}
            onChange={(val) => updateField('slug', val.toLowerCase().replace(/[^a-z0-9-]+/g, '-'))}
            placeholder={t('fields.slugAutoPlaceholder')}
            fullWidth
          />
          <EditField label={t('fields.website')} value={v(client, edited, 'website')} isEditing={isEditing} onChange={(val) => updateField('website', val)} isLink={!isEditing} />
          <EditField label={t('fields.industry')} value={v(client, edited, 'industry')} isEditing={isEditing} onChange={(val) => updateField('industry', val)} />
        </div>
      </div>

      {/* Partner attribution */}
      <div className="bg-white dark:bg-gray-900 rounded-3xl border border-gray-200 dark:border-gray-800 p-8 shadow-sm">
        <SectionHeader icon={<Sparkles className="w-4 h-4 text-pink-500" />} title={t('sections.attribution')} color="pink-500" />
        <p className="text-xs text-gray-500 mb-6 leading-relaxed">{t('sections.attributionHelp')}</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-6 gap-x-10">
          {isEditing ? (
            <div className="space-y-1">
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">{t('fields.clientType')}</p>
              <select
                value={currentType}
                onChange={(e) => updateField('client_type', e.target.value as ClientType)}
                className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-sm font-semibold text-gray-900 dark:text-white outline-none focus:ring-2 focus:ring-tuggi-blue/30 transition-all"
              >
                {typeOptions.map((value) => (
                  <option key={value} value={value}>{t(`clientTypes.${value}`)}</option>
                ))}
              </select>
            </div>
          ) : (
            <EditField label={t('fields.clientType')} value={t(`clientTypes.${currentType}`)} isEditing={false} onChange={() => {}} />
          )}
          <EditField label={t('fields.avatarUrl')} value={v(client, edited, 'avatar_url')} isEditing={isEditing} onChange={(val) => updateField('avatar_url', val)} placeholder={t('fields.avatarPlaceholder')} />
          <EditField label={t('fields.socialHandle')} value={v(client, edited, 'social_handle')} isEditing={isEditing} onChange={(val) => updateField('social_handle', val)} placeholder={t('fields.socialPlaceholder')} />
          <EditField label={t('fields.bioOneLine')} value={v(client, edited, 'bio_one_line')} isEditing={isEditing} onChange={(val) => updateField('bio_one_line', val)} fullWidth />
        </div>
      </div>

      {/* Address */}
      <div className="bg-white dark:bg-gray-900 rounded-3xl border border-gray-200 dark:border-gray-800 p-8 shadow-sm">
        <SectionHeader icon={<Building2 className="w-4 h-4 text-indigo-500" />} title={t('sections.address')} color="indigo-500" />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-6 gap-x-10">
          <EditField label={t('fields.address')} value={v(client, edited, 'address')} isEditing={isEditing} onChange={(val) => updateField('address', val)} fullWidth />
          <EditField label={t('fields.city')} value={v(client, edited, 'city')} isEditing={isEditing} onChange={(val) => updateField('city', val)} />
          <EditField label={t('fields.state')} value={v(client, edited, 'state')} isEditing={isEditing} onChange={(val) => updateField('state', val)} />
          {isEditing ? (
            <div className="space-y-1">
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">{t('fields.country')}</p>
              <select
                value={currentCountry}
                onChange={(e) => updateField('country', e.target.value)}
                className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-sm font-semibold text-gray-900 dark:text-white outline-none focus:ring-2 focus:ring-tuggi-blue/30 transition-all"
              >
                <option value="">{t('fields.selectCountry')}</option>
                {COUNTRIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          ) : (
            <EditField label={t('fields.country')} value={currentCountry || '-'} isEditing={false} onChange={() => {}} />
          )}
          <EditField label={t('fields.postalCode')} value={v(client, edited, 'postal_code')} isEditing={isEditing} onChange={(val) => updateField('postal_code', val)} />
        </div>
      </div>

      {/* Revenue QR — only on saved clients (need either a slug or an id to point at). */}
      {showQr && <ClientQrCode clientId={clientId} slug={currentSlug} />}

      {/* The material that carries that QR into the establishment. Same condition, and it is
          the same reason: an order is keyed on a client that exists. */}
      {clientId && <MaterialOrders clientId={clientId} />}
    </div>
  )
}

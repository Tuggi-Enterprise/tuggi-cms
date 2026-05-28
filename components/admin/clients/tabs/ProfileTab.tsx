'use client'

import { Building2, Sparkles } from 'lucide-react'
import type { Client, ClientType } from '@/types/clients'
import { COUNTRIES } from '@/components/admin/clients/shared/countries'
import { EditField } from '@/components/admin/clients/shared/EditField'
import { SectionHeader } from '@/components/admin/clients/shared/SectionHeader'

export interface ClientEditorTabProps {
  client: Client | null
  edited: Partial<Client>
  updateField: <K extends keyof Client>(field: K, value: Client[K]) => void
  canEdit: boolean
  clientId?: string
}

const CLIENT_TYPES: { value: ClientType; label: string }[] = [
  { value: 'business', label: 'Business' },
  { value: 'influencer', label: 'Influencer' },
  { value: 'hotel', label: 'Hotel' },
  { value: 'partner', label: 'Partner' },
  { value: 'creator', label: 'Creator' },
]

function v<K extends keyof Client>(client: Client | null, edited: Partial<Client>, k: K): string {
  const raw = edited[k] ?? client?.[k]
  return raw == null ? '' : String(raw)
}

export function ProfileTab({ client, edited, updateField, canEdit }: ClientEditorTabProps) {
  const isEditing = canEdit
  const currentCountry = String(edited.country ?? client?.country ?? '')
  const currentType: ClientType = (edited.client_type ?? client?.client_type ?? 'business') as ClientType

  return (
    <div className="space-y-8 max-w-5xl mx-auto">
      {/* Identity */}
      <div className="bg-white dark:bg-gray-900 rounded-3xl border border-gray-200 dark:border-gray-800 p-8 shadow-sm">
        <SectionHeader icon={<Building2 className="w-4 h-4 text-tuggi-blue" />} title="Identidade" />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-6 gap-x-10">
          <EditField label="Nome / Razão Social" value={v(client, edited, 'name')} isEditing={isEditing} onChange={(val) => updateField('name', val)} />
          <EditField label="Nome comercial (Trade name)" value={v(client, edited, 'company_name')} isEditing={isEditing} onChange={(val) => updateField('company_name', val)} />
          <EditField label="Email principal" value={v(client, edited, 'email')} isEditing={isEditing} onChange={(val) => updateField('email', val)} type="email" />
          <EditField label="Telefone" value={v(client, edited, 'phone')} isEditing={isEditing} onChange={(val) => updateField('phone', val)} type="tel" />
          <EditField
            label="Slug (URL pública /d/...)"
            value={v(client, edited, 'slug')}
            isEditing={isEditing}
            onChange={(val) => updateField('slug', val.toLowerCase().replace(/[^a-z0-9-]+/g, '-'))}
            placeholder="auto-generated"
            fullWidth
          />
          <EditField label="Website" value={v(client, edited, 'website')} isEditing={isEditing} onChange={(val) => updateField('website', val)} isLink={!isEditing} />
          <EditField label="Indústria" value={v(client, edited, 'industry')} isEditing={isEditing} onChange={(val) => updateField('industry', val)} />
        </div>
      </div>

      {/* Partner attribution */}
      <div className="bg-white dark:bg-gray-900 rounded-3xl border border-gray-200 dark:border-gray-800 p-8 shadow-sm">
        <SectionHeader icon={<Sparkles className="w-4 h-4 text-pink-500" />} title="Atribuição (parceiro / consumer-facing)" color="pink-500" />
        <p className="text-xs text-gray-500 mb-6 leading-relaxed">
          Campos usados nas telas do app onde o parceiro aparece (atribuição de cupom, página de download, etc.).
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-6 gap-x-10">
          {isEditing ? (
            <div className="space-y-1">
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Tipo de relação</p>
              <select
                value={currentType}
                onChange={(e) => updateField('client_type', e.target.value as ClientType)}
                className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-sm font-semibold text-gray-900 dark:text-white outline-none focus:ring-2 focus:ring-tuggi-blue/30 transition-all"
              >
                {CLIENT_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>
          ) : (
            <EditField label="Tipo de relação" value={currentType} isEditing={false} onChange={() => {}} />
          )}
          <EditField label="Avatar URL" value={v(client, edited, 'avatar_url')} isEditing={isEditing} onChange={(val) => updateField('avatar_url', val)} placeholder="https://..." />
          <EditField label="Handle social" value={v(client, edited, 'social_handle')} isEditing={isEditing} onChange={(val) => updateField('social_handle', val)} placeholder="@neymarjr" />
          <EditField label="Bio (1 linha)" value={v(client, edited, 'bio_one_line')} isEditing={isEditing} onChange={(val) => updateField('bio_one_line', val)} fullWidth />
        </div>
      </div>

      {/* Address */}
      <div className="bg-white dark:bg-gray-900 rounded-3xl border border-gray-200 dark:border-gray-800 p-8 shadow-sm">
        <SectionHeader icon={<Building2 className="w-4 h-4 text-indigo-500" />} title="Endereço" color="indigo-500" />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-6 gap-x-10">
          <EditField label="Endereço" value={v(client, edited, 'address')} isEditing={isEditing} onChange={(val) => updateField('address', val)} fullWidth />
          <EditField label="Cidade" value={v(client, edited, 'city')} isEditing={isEditing} onChange={(val) => updateField('city', val)} />
          <EditField label="Estado / Província" value={v(client, edited, 'state')} isEditing={isEditing} onChange={(val) => updateField('state', val)} />
          {isEditing ? (
            <div className="space-y-1">
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">País</p>
              <select
                value={currentCountry}
                onChange={(e) => updateField('country', e.target.value)}
                className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-sm font-semibold text-gray-900 dark:text-white outline-none focus:ring-2 focus:ring-tuggi-blue/30 transition-all"
              >
                <option value="">Selecionar país...</option>
                {COUNTRIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          ) : (
            <EditField label="País" value={currentCountry || '-'} isEditing={false} onChange={() => {}} />
          )}
          <EditField label="CEP / Código postal" value={v(client, edited, 'postal_code')} isEditing={isEditing} onChange={(val) => updateField('postal_code', val)} />
        </div>
      </div>
    </div>
  )
}

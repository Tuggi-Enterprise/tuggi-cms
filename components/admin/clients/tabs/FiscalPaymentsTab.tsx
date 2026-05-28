'use client'

import { Scale, Landmark, Percent } from 'lucide-react'
import type { Client } from '@/types/clients'
import { taxConfigFor, usesBankingIBAN } from '@/components/admin/clients/shared/countries'
import { EditField } from '@/components/admin/clients/shared/EditField'
import { SectionHeader } from '@/components/admin/clients/shared/SectionHeader'
import type { ClientEditorTabProps } from './ProfileTab'

function v<K extends keyof Client>(client: Client | null, edited: Partial<Client>, k: K): string {
  const raw = edited[k] ?? client?.[k]
  return raw == null ? '' : String(raw)
}

export function FiscalPaymentsTab({ client, edited, updateField, canEdit }: ClientEditorTabProps) {
  const isEditing = canEdit
  const currentCountry = String(edited.country ?? client?.country ?? '')
  const taxConfig = taxConfigFor(currentCountry)
  const showIBAN = usesBankingIBAN(currentCountry)
  const commissionRate = edited.commission_rate ?? client?.commission_rate ?? 0.2

  return (
    <div className="space-y-8 max-w-5xl mx-auto">
      {/* Legal */}
      <div className="bg-white dark:bg-gray-900 rounded-3xl border border-gray-200 dark:border-gray-800 p-8 shadow-sm">
        <SectionHeader icon={<Scale className="w-4 h-4 text-purple-500" />} title="Legal & Fiscal" color="purple-500" />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-6 gap-x-10">
          <EditField
            label={taxConfig.label}
            value={v(client, edited, 'tax_id')}
            isEditing={isEditing}
            onChange={(val) => updateField('tax_id', val)}
            placeholder={taxConfig.placeholder}
          />
          <div className="space-y-1">
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Tipo de tax ID</p>
            <span className="inline-flex px-3 py-1 rounded-lg text-[11px] font-bold uppercase tracking-widest bg-purple-50 text-purple-600 border border-purple-100">
              {currentCountry ? `Auto: ${taxConfig.type}` : 'Selecione país primeiro'}
            </span>
          </div>
          <EditField
            label="Representante legal"
            value={v(client, edited, 'legal_representative_name')}
            isEditing={isEditing}
            onChange={(val) => updateField('legal_representative_name', val)}
            placeholder="Nome completo"
          />
          <EditField
            label="Cargo / Título"
            value={v(client, edited, 'legal_representative_role')}
            isEditing={isEditing}
            onChange={(val) => updateField('legal_representative_role', val)}
            placeholder="CEO, Director, Sócio-Gerente..."
          />
          <EditField
            label="Notas internas"
            value={v(client, edited, 'notes')}
            isEditing={isEditing}
            onChange={(val) => updateField('notes', val)}
            multiline
            fullWidth
            placeholder="Notas internas sobre este cliente..."
          />
        </div>
      </div>

      {/* Banking */}
      <div className="bg-white dark:bg-gray-900 rounded-3xl border border-gray-200 dark:border-gray-800 p-8 shadow-sm">
        <SectionHeader icon={<Landmark className="w-4 h-4 text-green-500" />} title="Banco & Pagamentos" color="green-500" />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-6 gap-x-10">
          <EditField
            label="Email de cobrança"
            value={v(client, edited, 'billing_email')}
            isEditing={isEditing}
            onChange={(val) => updateField('billing_email', val)}
            type="email"
            placeholder="finance@empresa.com"
          />
          <EditField
            label="Banco"
            value={v(client, edited, 'bank_name')}
            isEditing={isEditing}
            onChange={(val) => updateField('bank_name', val)}
            placeholder="ex. Itaú, BCP"
          />
          {(showIBAN || !currentCountry) ? (
            <>
              <EditField
                label="IBAN"
                value={v(client, edited, 'iban')}
                isEditing={isEditing}
                onChange={(val) => updateField('iban', val)}
                placeholder="PT50 0000 ..."
              />
              <EditField
                label="BIC / SWIFT"
                value={v(client, edited, 'bic_swift')}
                isEditing={isEditing}
                onChange={(val) => updateField('bic_swift', val)}
                placeholder="CEMAPTP2XXX"
              />
            </>
          ) : (
            <>
              <EditField
                label="Routing number (ABA)"
                value={v(client, edited, 'bank_routing_number')}
                isEditing={isEditing}
                onChange={(val) => updateField('bank_routing_number', val)}
                placeholder="021000021"
              />
              <EditField
                label="Account number"
                value={v(client, edited, 'bank_account_number')}
                isEditing={isEditing}
                onChange={(val) => updateField('bank_account_number', val)}
                placeholder="123456789"
              />
            </>
          )}
        </div>
      </div>

      {/* Commission */}
      <div className="bg-white dark:bg-gray-900 rounded-3xl border border-gray-200 dark:border-gray-800 p-8 shadow-sm">
        <SectionHeader icon={<Percent className="w-4 h-4 text-amber-500" />} title="Comissão" color="amber-500" />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-6 gap-x-10">
          {isEditing ? (
            <div className="space-y-1">
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Taxa de comissão</p>
              <input
                type="number"
                step="0.001"
                min="0"
                max="1"
                value={commissionRate}
                onChange={(e) => updateField('commission_rate', parseFloat(e.target.value))}
                className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-sm font-bold text-gray-900 dark:text-white outline-none focus:ring-2 focus:ring-tuggi-blue/30"
              />
              <p className="text-[10px] text-gray-400 mt-1">Valor entre 0 e 1 (ex. 0.20 = 20%)</p>
            </div>
          ) : (
            <div className="space-y-1">
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Taxa de comissão</p>
              <p className="text-2xl font-bold text-gray-900 dark:text-white">{(commissionRate * 100).toFixed(1)}%</p>
            </div>
          )}
          {isEditing && (
            <div className="space-y-1">
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Platform owner?</p>
              <label className="inline-flex items-center gap-2 mt-1">
                <input
                  type="checkbox"
                  checked={Boolean(edited.is_platform_owner ?? client?.is_platform_owner)}
                  onChange={(e) => updateField('is_platform_owner', e.target.checked)}
                  className="rounded border-gray-300 text-tuggi-blue focus:ring-tuggi-blue"
                />
                <span className="text-sm text-gray-700">Marque se o cliente é a própria Tuggi (split contábil)</span>
              </label>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

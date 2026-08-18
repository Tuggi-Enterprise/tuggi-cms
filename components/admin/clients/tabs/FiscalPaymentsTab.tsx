'use client'

import { useEffect, useState } from 'react'
import { Scale, Landmark, Percent } from 'lucide-react'
import { useTranslations } from 'next-intl'
import type { Client } from '@/types/clients'
import { taxConfigFor, usesBankingIBAN } from '@/components/admin/clients/shared/countries'
import { EditField } from '@/components/admin/clients/shared/EditField'
import { SectionHeader } from '@/components/admin/clients/shared/SectionHeader'
import { formatDate, formatFee } from '@/lib/contract/snapshot'
import type { ClientEditorTabProps } from './ProfileTab'

function v<K extends keyof Client>(client: Client | null, edited: Partial<Client>, k: K): string {
  const raw = edited[k] ?? client?.[k]
  return raw == null ? '' : String(raw)
}

/**
 * The signed contract, only so the note below the fee field can exist.
 *
 * BR-B2B-017, item 5 is the trap this tab was going to walk into: the person about to edit
 * the monthly fee is HERE, not on the contract page, and without the note they would
 * reasonably believe they just changed what the partner pays. They did not — the contract
 * froze its own value at acceptance — and finding that out later is finding it out from
 * the partner.
 */
function useSignedContract(clientId?: string) {
  const [signed, setSigned] = useState<{ acceptedAt: string; feeCents: number | null; courtesy: boolean } | null>(
    null
  )

  useEffect(() => {
    if (!clientId) return
    let active = true
    fetch(`/api/admin/clients/${clientId}/contract`)
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (!active || !data?.acceptance || !data?.contract) return
        setSigned({
          acceptedAt: data.acceptance.acceptedAt,
          feeCents: data.contract.snapshot?.monthlyFeeCents ?? null,
          courtesy: Boolean(data.contract.snapshot?.isCourtesy),
        })
      })
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [clientId])

  return signed
}

export function FiscalPaymentsTab({ client, edited, updateField, canEdit, clientId }: ClientEditorTabProps) {
  const t = useTranslations('Clients.fiscal')
  const isEditing = canEdit
  const currentCountry = String(edited.country ?? client?.country ?? '')
  const taxConfig = taxConfigFor(currentCountry)
  const showIBAN = usesBankingIBAN(currentCountry)
  /**
   * No fallback. Painting 20% into a field nobody filled in is the presumed value
   * BR-MONETIZACAO-039, item 3, forbids — the operator would save the guess believing they had
   * confirmed it. Absent renders as a pendency; a stored `0` renders as `0,0%`, because zero is
   * a decision somebody took and the two may not look alike (the rule's edge case).
   */
  const commissionRate = edited.commission_rate ?? client?.commission_rate ?? null
  const signedContract = useSignedContract(clientId)
  const isCourtesy = Boolean(edited.is_courtesy ?? client?.is_courtesy)
  const monthlyFeeCents = edited.monthly_fee_cents ?? client?.monthly_fee_cents ?? null

  return (
    <div className="space-y-8 max-w-5xl mx-auto">
      {/* Legal */}
      <div className="bg-white dark:bg-gray-900 rounded-3xl border border-gray-200 dark:border-gray-800 p-8 shadow-sm">
        <SectionHeader icon={<Scale className="w-4 h-4 text-purple-500" />} title={t('sections.legal')} color="purple-500" />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-6 gap-x-10">
          <EditField
            label={taxConfig.label}
            value={v(client, edited, 'tax_id')}
            isEditing={isEditing}
            onChange={(val) => updateField('tax_id', val)}
            placeholder={taxConfig.placeholder}
          />
          <div className="space-y-1">
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">{t('fields.taxIdType')}</p>
            <span className="inline-flex px-3 py-1 rounded-lg text-[11px] font-bold uppercase tracking-widest bg-purple-50 text-purple-600 border border-purple-100">
              {currentCountry ? t('fields.taxIdAutoCountry', { type: taxConfig.type }) : t('fields.taxIdSelectCountry')}
            </span>
          </div>
          <EditField
            label={t('fields.legalRepName')}
            value={v(client, edited, 'legal_representative_name')}
            isEditing={isEditing}
            onChange={(val) => updateField('legal_representative_name', val)}
            placeholder={t('fields.legalRepNamePlaceholder')}
          />
          <EditField
            label={t('fields.legalRepRole')}
            value={v(client, edited, 'legal_representative_role')}
            isEditing={isEditing}
            onChange={(val) => updateField('legal_representative_role', val)}
            placeholder={t('fields.legalRepRolePlaceholder')}
          />
          <EditField
            label={t('fields.notes')}
            value={v(client, edited, 'notes')}
            isEditing={isEditing}
            onChange={(val) => updateField('notes', val)}
            multiline
            fullWidth
            placeholder={t('fields.notesPlaceholder')}
          />
        </div>
      </div>

      {/* Banking */}
      <div className="bg-white dark:bg-gray-900 rounded-3xl border border-gray-200 dark:border-gray-800 p-8 shadow-sm">
        <SectionHeader icon={<Landmark className="w-4 h-4 text-green-500" />} title={t('sections.banking')} color="green-500" />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-6 gap-x-10">
          <EditField
            label={t('fields.billingEmail')}
            value={v(client, edited, 'billing_email')}
            isEditing={isEditing}
            onChange={(val) => updateField('billing_email', val)}
            type="email"
            placeholder={t('fields.billingEmailPlaceholder')}
          />
          <EditField
            label={t('fields.bankName')}
            value={v(client, edited, 'bank_name')}
            isEditing={isEditing}
            onChange={(val) => updateField('bank_name', val)}
            placeholder={t('fields.bankNamePlaceholder')}
          />
          {(showIBAN || !currentCountry) ? (
            <>
              <EditField
                label="IBAN"
                value={v(client, edited, 'iban')}
                isEditing={isEditing}
                onChange={(val) => updateField('iban', val)}
                placeholder={t('fields.ibanPlaceholder')}
              />
              <EditField
                label={t('fields.bicSwift')}
                value={v(client, edited, 'bic_swift')}
                isEditing={isEditing}
                onChange={(val) => updateField('bic_swift', val)}
                placeholder={t('fields.bicSwiftPlaceholder')}
              />
            </>
          ) : (
            <>
              <EditField
                label={t('fields.routingNumber')}
                value={v(client, edited, 'bank_routing_number')}
                isEditing={isEditing}
                onChange={(val) => updateField('bank_routing_number', val)}
                placeholder={t('fields.routingPlaceholder')}
              />
              <EditField
                label={t('fields.accountNumber')}
                value={v(client, edited, 'bank_account_number')}
                isEditing={isEditing}
                onChange={(val) => updateField('bank_account_number', val)}
                placeholder={t('fields.accountPlaceholder')}
              />
            </>
          )}
        </div>
      </div>

      {/* Commission */}
      <div className="bg-white dark:bg-gray-900 rounded-3xl border border-gray-200 dark:border-gray-800 p-8 shadow-sm">
        <SectionHeader icon={<Percent className="w-4 h-4 text-amber-500" />} title={t('sections.commission')} color="amber-500" />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-6 gap-x-10">
          {isEditing ? (
            <div className="space-y-1">
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">{t('fields.commissionRate')}</p>
              {/*
                THE OPERATOR TYPES `10`, AND THE COLUMN STORES `0.1`.
                
                The field used to be the raw rate — `step="0.001"`, `max="1"` — under a label
                that reads `Taxa de comissão`. Typing `10` into it meant 1000%, and typing `0.1`
                is a translation the person should not be doing. The percentage is the unit the
                decision is taken in; the fraction is how the column happens to store it.
                
                `Math.round` on the product because binary floats turn `0.07 * 100` into
                `7.000000000000001`, and a rate is not worth persisting with that tail.
              */}
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  max="100"
                  inputMode="decimal"
                  value={commissionRate === null ? '' : Math.round(commissionRate * 1000) / 10}
                  onChange={(e) => {
                    const typed = e.target.value
                    updateField(
                      'commission_rate',
                      typed === ''
                        ? (undefined as never)
                        : Math.round(parseFloat(typed) * 10) / 1000
                    )
                  }}
                  className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-sm font-semibold text-gray-900 dark:text-white outline-none focus:ring-2 focus:ring-tuggi-blue/30"
                />
                <span className="text-sm font-semibold text-gray-500 dark:text-gray-400" aria-hidden="true">
                  %
                </span>
              </div>
              <p className="text-[10px] text-gray-400 mt-1">{t('fields.commissionRateHelp')}</p>
            </div>
          ) : (
            <div className="space-y-1">
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">{t('fields.commissionRate')}</p>
              <p className="text-2xl font-bold text-gray-900 dark:text-white">
                {commissionRate === null ? '—' : `${(commissionRate * 100).toFixed(1)}%`}
              </p>
            </div>
          )}
          <div className="space-y-1">
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">{t('fields.monthlyFee')}</p>
            {isEditing ? (
              <>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={monthlyFeeCents === null ? '' : monthlyFeeCents / 100}
                  disabled={isCourtesy}
                  onChange={(e) =>
                    updateField(
                      'monthly_fee_cents',
                      e.target.value === '' ? null : Math.round(parseFloat(e.target.value) * 100)
                    )
                  }
                  className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-sm font-semibold text-gray-900 dark:text-white outline-none focus:ring-2 focus:ring-tuggi-blue/30 disabled:opacity-50"
                />
                <p className="text-[10px] text-gray-400 mt-1">{t('fields.monthlyFeeHelp')}</p>
                <label className="inline-flex items-center gap-2 mt-2">
                  <input
                    type="checkbox"
                    checked={isCourtesy}
                    onChange={(e) => updateField('is_courtesy', e.target.checked)}
                    className="rounded border-gray-300 text-tuggi-blue focus:ring-tuggi-blue/30"
                  />
                  <span className="text-sm text-gray-700">{t('fields.courtesy')}</span>
                </label>
                {isCourtesy && (
                  <EditField
                    label={t('fields.courtesyReason')}
                    value={v(client, edited, 'courtesy_reason')}
                    isEditing={isEditing}
                    onChange={(val) => updateField('courtesy_reason', val)}
                  />
                )}
              </>
            ) : (
              <p className="text-2xl font-bold text-gray-900 dark:text-white">
                {isCourtesy ? t('fields.courtesy') : formatFee(monthlyFeeCents)}
              </p>
            )}
            {signedContract && (
              <p className="mt-2 rounded-lg border border-amber-400 bg-amber-50 p-2 text-xs text-gray-900">
                {t('fields.frozenValueNote', {
                  date: formatDate(signedContract.acceptedAt),
                  value: signedContract.courtesy ? t('fields.courtesy') : formatFee(signedContract.feeCents),
                })}
              </p>
            )}
          </div>
          {isEditing && (
            <div className="space-y-1">
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">{t('fields.isPlatformOwner')}</p>
              <label className="inline-flex items-center gap-2 mt-1">
                <input
                  type="checkbox"
                  checked={Boolean(edited.is_platform_owner ?? client?.is_platform_owner)}
                  onChange={(e) => updateField('is_platform_owner', e.target.checked)}
                  className="rounded border-gray-300 text-tuggi-blue focus:ring-tuggi-blue/30"
                />
                <span className="text-sm text-gray-700">{t('fields.isPlatformOwnerHelp')}</span>
              </label>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

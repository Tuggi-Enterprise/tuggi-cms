'use client'

/**
 * The quantity control — `DS-COMPONENTE-012`: the field does not validate, it prevents.
 *
 * Usage is metered in whole 5-minute blocks (BR-MONETIZACAO-049), so an amount outside
 * the block is born with 1 to 4 minutes no block can ever consume, and the debit charges
 * the whole block against the neighbouring grant. The screen's answer is not a better
 * error message: minutes are a `<select>` of 12 options and hours are an integer, so no
 * reachable combination of the controls forms an invalid total. The database still
 * refuses (`TGM49`) — the screen is one door, the database is the last one.
 *
 * ONE form serves the individual grant and the batch, which is what keeps the block rule
 * in a single place.
 *
 * The `+1 h` / `+5 h` / `+10 h` buttons are arithmetic, not the catalogue: no product
 * amount is written anywhere in this file. The catalogue has an owner
 * (`drive.product_grant_map`, BR-MONETIZACAO-048) and the CMS is not it. Neither is the
 * cap per act — that number lives in `drive.manual_grant_cap_minutes()` and comes back as
 * a refusal, never as a constant here (BR-MONETIZACAO-063).
 */

import { useId } from 'react'
import { useTranslations } from 'next-intl'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { formatDuration, MINUTE_OPTIONS } from '@/lib/format/duration'
import type { GrantDraft } from './types'

const HOUR_STEPS = [1, 5, 10]

export function draftTotalMinutes(draft: GrantDraft): number {
  const hours = Number.isFinite(draft.hours) ? Math.max(0, Math.trunc(draft.hours)) : 0
  const minutes = Number.isFinite(draft.minutes) ? Math.max(0, Math.trunc(draft.minutes)) : 0
  return hours * 60 + minutes
}

export interface TierOption {
  id: string
  display_name: string
  name: string
}

interface Props {
  draft: GrantDraft
  onChange: (draft: GrantDraft) => void
  tiers: TierOption[]
  /** Latest date a period grant may reach — BR-MONETIZACAO-017, one year from today. */
  maxUntil: string
  disabled?: boolean
}

export function GrantCreditForm({ draft, onChange, tiers, maxUntil, disabled }: Props) {
  const t = useTranslations('Pages.AppUsers.credit')
  const ids = useId()
  const total = draftTotalMinutes(draft)

  const set = (patch: Partial<GrantDraft>) => onChange({ ...draft, ...patch })

  return (
    <div className="space-y-5">
      <fieldset disabled={disabled} className="space-y-2">
        <legend className="text-sm font-medium text-gray-700 dark:text-gray-300">
          {t('form.type')}
        </legend>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {(['minutes', 'until'] as const).map((type) => (
            <label
              key={type}
              htmlFor={`${ids}-type-${type}`}
              className={
                'flex cursor-pointer gap-3 rounded-lg border p-3 text-sm ' +
                (draft.grantType === type
                  ? 'border-primary bg-primary/5'
                  : 'border-gray-200 dark:border-gray-700')
              }
            >
              <input
                id={`${ids}-type-${type}`}
                type="radio"
                name={`${ids}-type`}
                className="mt-1 h-4 w-4"
                checked={draft.grantType === type}
                onChange={() => set({ grantType: type })}
              />
              <span>
                <span className="block font-semibold text-gray-900 dark:text-white">
                  {type === 'minutes' ? t('form.type_minutes') : t('form.type_until')}
                </span>
                <span className="block text-gray-700 dark:text-gray-400">
                  {type === 'minutes' ? t('form.type_minutes_help') : t('form.type_until_help')}
                </span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      {draft.grantType === 'minutes' ? (
        <fieldset disabled={disabled} className="space-y-2">
          <legend className="text-sm font-medium text-gray-700 dark:text-gray-300">
            {t('form.amount')}
          </legend>
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-28">
              <Label htmlFor={`${ids}-hours`} className="dark:text-gray-300">
                {t('form.hours')}
              </Label>
              <Input
                id={`${ids}-hours`}
                type="number"
                min={0}
                step={1}
                inputMode="numeric"
                value={Number.isFinite(draft.hours) ? draft.hours : 0}
                onChange={(event) =>
                  set({ hours: Math.max(0, Math.trunc(Number(event.target.value) || 0)) })
                }
              />
            </div>
            <div className="w-28">
              <Label htmlFor={`${ids}-minutes`} className="dark:text-gray-300">
                {t('form.minutes')}
              </Label>
              {/* A `<select>`, not an input: 18 must not be typeable. */}
              <select
                id={`${ids}-minutes`}
                value={draft.minutes}
                onChange={(event) => set({ minutes: Number(event.target.value) })}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {MINUTE_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {String(option).padStart(2, '0')}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex gap-2">
              {HOUR_STEPS.map((step) => (
                <Button
                  key={step}
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => set({ hours: Math.max(0, Math.trunc(draft.hours || 0)) + step })}
                >
                  {t('form.add_hours', { hours: step })}
                </Button>
              ))}
            </div>
          </div>

          {/* Both units, always: hours are how the operator reads it, minutes are what
              goes in the payload, and nobody should convert in their head. */}
          <p
            aria-live="polite"
            className="text-sm font-semibold text-gray-900 dark:text-white"
          >
            {t('form.total', { duration: formatDuration(total), minutes: total })}
          </p>
          <p className="text-xs text-gray-700 dark:text-gray-400">{t('form.step_help')}</p>
        </fieldset>
      ) : (
        <fieldset disabled={disabled} className="space-y-3">
          <div>
            <Label htmlFor={`${ids}-until`} className="dark:text-gray-300">
              {t('form.until_date')}
            </Label>
            <Input
              id={`${ids}-until`}
              type="date"
              value={draft.endsAt}
              max={maxUntil}
              onChange={(event) => set({ endsAt: event.target.value })}
            />
            <p className="mt-1 text-xs text-gray-700 dark:text-gray-400">
              {t('form.until_max', { date: new Date(maxUntil).toLocaleDateString() })}
            </p>
          </div>
          <div>
            <Label htmlFor={`${ids}-tier`} className="dark:text-gray-300">
              {t('form.license')}
            </Label>
            <select
              id={`${ids}-tier`}
              value={draft.tierId}
              onChange={(event) => set({ tierId: event.target.value })}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="">—</option>
              {tiers.map((tier) => (
                <option key={tier.id} value={tier.id}>
                  {tier.display_name}
                </option>
              ))}
            </select>
          </div>
        </fieldset>
      )}

      <div>
        <Label htmlFor={`${ids}-ref`} className="dark:text-gray-300">
          {t('form.ref')}
        </Label>
        <Input
          id={`${ids}-ref`}
          value={draft.sourceRef}
          disabled={disabled}
          aria-describedby={`${ids}-ref-help`}
          onChange={(event) => set({ sourceRef: event.target.value })}
        />
        {/* `source_ref` is immutable. An e-mail in it is a residual identifier that
            account deletion cannot reach, which is why the helper is mandatory. */}
        <p id={`${ids}-ref-help`} className="mt-1 text-xs text-gray-700 dark:text-gray-400">
          {t('form.ref_help')}
        </p>
      </div>
    </div>
  )
}

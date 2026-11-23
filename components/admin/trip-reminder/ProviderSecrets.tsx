'use client'

/**
 * Segredos tab of `/admin/trip-reminder` (#1233, BR-COMUNICACAO-024 item 10): write-only fields.
 *
 * The screen never has a saved value: the read brings `configured_at` and `last4` only. A new value
 * lives in the DOM of an uncontrolled password field, never in React state; it is read once on
 * submit, the field is emptied before the request leaves, and the form closes on success. A
 * refusal does not keep it either: the operator types it again. After a write the whole read is
 * reloaded, so the date, the last 4 and the change log (`secret_changes`, who and when) are the
 * database's, never a copy kept here.
 */

import { useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { CELL, DIM, HEAD_SOLO } from '@/components/ui/dense-table'
import { UNKNOWN_VALUE } from '@/lib/format/unknown'
import {
  SECRET_MAX_LENGTH,
  messageId,
  type ProviderSecret,
  type TripAdminError,
  type TripSettings,
} from '@/lib/trip-reminder/settings'
import { errorText, formatInstant } from './format'

export function ProviderSecrets({ data, reload }: { data: TripSettings; reload: () => Promise<void> }) {
  const t = useTranslations('TripReminder')
  const channels = Array.from(new Set(data.secrets.map((s) => s.channel)))
  const slotName = (name: string) => (t.has(`secrets.slots.${messageId(name)}`) ? t(`secrets.slots.${messageId(name)}`) : name)

  return (
    <div className="space-y-10">
      <section aria-labelledby="trip-secrets">
        <h2 id="trip-secrets" className="text-lg font-bold text-gray-900 dark:text-gray-100">
          {t('secrets.heading')}
        </h2>
        <p className={`mb-3 text-sm ${DIM}`}>{t('secrets.intro')}</p>
        <div className="space-y-4">
          {channels.map((channel) => (
            <div key={channel} className="rounded-lg border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
              <h3 className="border-b border-gray-100 px-4 py-2 text-sm font-semibold text-gray-800 dark:border-gray-800 dark:text-gray-100">
                {t.has(`secrets.groups.${channel}`) ? t(`secrets.groups.${channel}`) : channel}
              </h3>
              <ul className="divide-y divide-gray-100 dark:divide-gray-800">
                {data.secrets
                  .filter((s) => s.channel === channel)
                  .map((slot) => (
                    <SecretRow key={slot.name} slot={slot} label={slotName(slot.name)} reload={reload} />
                  ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      <section aria-labelledby="trip-secret-changes">
        <h2 id="trip-secret-changes" className="text-lg font-bold text-gray-900 dark:text-gray-100">
          {t('secrets.history_heading')}
        </h2>
        <p className={`mb-3 text-sm ${DIM}`}>{t('secrets.history_intro')}</p>
        {data.secret_changes.length ? (
          <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th className={HEAD_SOLO}>{t('secrets.when')}</th>
                  <th className={HEAD_SOLO}>{t('secrets.slot')}</th>
                  <th className={HEAD_SOLO}>{t('secrets.who')}</th>
                </tr>
              </thead>
              <tbody>
                {data.secret_changes.map((change, index) => (
                  <tr key={`${change.name}-${change.changed_at}-${index}`} className="border-t border-gray-100 dark:border-gray-800">
                    <td className={`${CELL} whitespace-nowrap`}>{formatInstant(change.changed_at)}</td>
                    <td className={CELL}>
                      {slotName(change.name)}
                      <span className={`ml-2 font-mono text-xs ${DIM}`}>{change.name}</span>
                    </td>
                    <td className={CELL}>{change.changed_by_email ?? UNKNOWN_VALUE}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className={`text-sm ${DIM}`}>{t('secrets.history_empty')}</p>
        )}
      </section>
    </div>
  )
}

function SecretRow({ slot, label, reload }: { slot: ProviderSecret; label: string; reload: () => Promise<void> }) {
  const t = useTranslations('TripReminder')
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [failed, setFailed] = useState<TripAdminError | null>(null)
  const fieldRef = useRef<HTMLInputElement | null>(null)
  const fieldId = `trip-secret-${messageId(slot.name)}`

  const save = async () => {
    const field = fieldRef.current
    if (!field) return
    const value = field.value
    // The value leaves the DOM before the request leaves the page.
    field.value = ''
    if (value.trim() === '') {
      setFailed({ code: 'invalid_secret' })
      field.focus()
      return
    }
    setSaving(true)
    setFailed(null)
    setSaved(false)
    try {
      const response = await fetch('/api/admin/trip-reminder/secrets', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: slot.name, value }),
      })
      const envelope = await response.json().catch(() => null)
      if (!response.ok) {
        setFailed(envelope?.error ?? { code: 'unknown' })
        return
      }
      setOpen(false)
      setSaved(true)
      await reload()
    } catch {
      setFailed({ code: 'unknown' })
    } finally {
      setSaving(false)
    }
  }

  const status = slot.configured_at
    ? slot.last4
      ? t('secrets.configured_last4', { date: formatInstant(slot.configured_at), last4: slot.last4 })
      : t('secrets.configured', { date: formatInstant(slot.configured_at) })
    : t('secrets.not_configured')

  return (
    <li className="px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-gray-900 dark:text-white">{label}</p>
          <p className={`font-mono text-xs ${DIM}`}>{slot.name}</p>
          <p className={`mt-1 text-xs ${slot.configured_at ? 'text-green-800 dark:text-green-300' : 'text-gray-600 dark:text-gray-300'}`}>
            {status}
          </p>
        </div>
        {!open ? (
          <Button
            variant="outline"
            size="sm"
            aria-label={t(slot.configured_at ? 'secrets.replace_aria' : 'secrets.set_aria', { name: label })}
            onClick={() => {
              setOpen(true)
              setSaved(false)
              setFailed(null)
            }}>
            {slot.configured_at ? t('secrets.replace') : t('secrets.set')}
          </Button>
        ) : null}
      </div>

      {open ? (
        <form
          className="mt-3 flex flex-wrap items-end gap-2"
          autoComplete="off"
          onSubmit={(event) => {
            event.preventDefault()
            void save()
          }}>
          <div className="min-w-[16rem] flex-1">
            <Label htmlFor={fieldId}>{t('secrets.field_label', { name: label })}</Label>
            <input
              ref={fieldRef}
              id={fieldId}
              name={`secret-${messageId(slot.name)}`}
              type="password"
              autoFocus
              autoComplete="new-password"
              spellCheck={false}
              maxLength={SECRET_MAX_LENGTH}
              className="mt-1 h-9 w-full rounded-md border border-gray-300 px-2 font-mono text-sm dark:border-gray-700 dark:bg-gray-800"
            />
          </div>
          <Button type="submit" variant="cta" size="sm" disabled={saving}>
            {saving ? t('secrets.saving') : t('secrets.save')}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={saving}
            onClick={() => {
              if (fieldRef.current) fieldRef.current.value = ''
              setOpen(false)
              setFailed(null)
            }}>
            {t('secrets.cancel')}
          </Button>
        </form>
      ) : null}

      {saved ? (
        <p role="status" className="mt-2 text-xs font-semibold text-green-700 dark:text-green-400">
          {t('secrets.saved', { name: label })}
        </p>
      ) : null}
      {failed ? (
        <p role="alert" className="mt-2 text-xs text-red-700 dark:text-red-400">
          {errorText(t, failed)}
        </p>
      ) : null}
    </li>
  )
}

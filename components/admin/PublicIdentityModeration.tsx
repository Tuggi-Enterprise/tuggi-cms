'use client'

/**
 * The public name of an account on its record (#1144, BR-USUARIO-051 items 5 and 6), admin only,
 * next to "Can publish itineraries" (`RoutePublishingToggle`). The two blocks are independent:
 * this one locks the edit of display name, @ and bio; the other blocks route publishing.
 *
 * Reset goes through `drive.reset_public_identity_as`: a generated name, or an empty bio, that does
 * not count toward the person's limit and works on a locked account. A removed @ is blocked forever,
 * so every reset asks twice. While the route cannot read (migration not applied, account without a
 * profile) nothing is drawn.
 */

import { useCallback, useEffect, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { PUBLIC_IDENTITY_FIELDS, type AccountIdentity, type PublicIdentityField } from '@/lib/public-identity/moderation'

export interface PublicIdentityPanelProps {
  userId: string
  identity: AccountIdentity
  busy: boolean
  error: string | null
  done: string | null
  onReset: (field: PublicIdentityField) => void
  onLock: (locked: boolean) => void
}

const VALUE_OF: Record<PublicIdentityField, keyof Pick<AccountIdentity, 'nickname' | 'bio'>> = {
  nickname: 'nickname',
  bio: 'bio',
}

/** Only draws: the bench and the tests mount it with an identity. */
export function PublicIdentityPanel({ userId, identity, busy, error, done, onReset, onLock }: PublicIdentityPanelProps) {
  const t = useTranslations('Pages.AppUsers.public_identity')
  const locale = useLocale()
  const [confirming, setConfirming] = useState<PublicIdentityField | null>(null)
  const date = (iso: string) => new Date(iso).toLocaleDateString(locale)
  const lockId = `identity-lock-${userId}`

  return (
    <div className="rounded-xl border border-gray-200 p-4 dark:border-gray-800">
      <h3 className="text-sm font-semibold text-gray-900 dark:text-white">{t('title')}</h3>
      <p className="text-xs text-gray-600 dark:text-gray-400">{t('hint')}</p>

      <ul className="mt-3 space-y-2 text-sm">
        {PUBLIC_IDENTITY_FIELDS.map((field) => {
          const value = identity[VALUE_OF[field]]
          const resetAt = identity.resetAt[field]
          const hintId = `identity-reset-hint-${userId}-${field}`
          return (
            <li key={field} className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-xs text-gray-600 dark:text-gray-400">{t(`fields.${field}`)}</p>
                <p className="whitespace-pre-line break-words font-medium text-gray-900 dark:text-white">
                  {value ?? <span className="text-gray-500">{t('empty')}</span>}
                </p>
                {resetAt && <p className="text-xs text-gray-600 dark:text-gray-400">{t('reset_at', { date: date(resetAt) })}</p>}
                {confirming === field && (
                  <p id={hintId} className="mt-1 max-w-[20rem] text-xs text-gray-800 dark:text-gray-200">
                    {t(`reset_hint.${field}`)}
                  </p>
                )}
              </div>
              {confirming === field ? (
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    disabled={busy}
                    aria-describedby={hintId}
                    onClick={() => {
                      setConfirming(null)
                      onReset(field)
                    }}
                  >
                    {t('confirm')}
                  </Button>
                  <Button type="button" variant="ghost" size="sm" onClick={() => setConfirming(null)}>
                    {t('cancel')}
                  </Button>
                </div>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={busy || (field === 'bio' && value === null)}
                  aria-label={t('reset_label', { field: t(`fields.${field}`) })}
                  onClick={() => setConfirming(field)}
                >
                  {t('reset')}
                </Button>
              )}
            </li>
          )
        })}
      </ul>

      <div className="mt-4 flex items-start gap-3 border-t border-gray-200 pt-3 dark:border-gray-800">
        <input
          id={lockId}
          type="checkbox"
          checked={identity.locked}
          disabled={busy}
          onChange={(event) => onLock(event.target.checked)}
          aria-describedby={`${lockId}-hint`}
          className="mt-0.5 h-4 w-4 rounded border-gray-400 text-tuggi-blue focus:ring-tuggi-blue disabled:opacity-50"
        />
        <div className="min-w-0">
          <label htmlFor={lockId} className="text-sm font-semibold text-gray-900 dark:text-white">
            {t('lock_label')}
          </label>
          <p id={`${lockId}-hint`} className="text-xs text-gray-600 dark:text-gray-400">
            {identity.locked && identity.lockedAt ? t('locked_since', { date: date(identity.lockedAt) }) : t('lock_hint')}
          </p>
        </div>
      </div>

      {done && <p role="status" className="mt-2 text-xs font-semibold text-green-800">{done}</p>}
      {error && <p role="alert" className="mt-2 text-xs text-red-700">{error}</p>}
    </div>
  )
}

/** Reads the identity of the account, resets and locks, and tells the record to read again. */
export function PublicIdentityModeration({ userId, onChanged }: { userId: string; onChanged?: () => void }) {
  const t = useTranslations('Pages.AppUsers.public_identity')
  const [identity, setIdentity] = useState<AccountIdentity | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/users/${userId}/public-identity`, { cache: 'no-store' })
      if (!res.ok) return
      const body = (await res.json()) as { identity?: AccountIdentity }
      if (body.identity) setIdentity(body.identity)
    } catch {
      /* not drawn */
    }
  }, [userId])

  useEffect(() => {
    void load()
  }, [load])

  if (!identity) return null

  const act = async (init: { path: string; method: string; body: unknown }, doneText: (body: Record<string, unknown>) => string) => {
    setBusy(true)
    setError(null)
    setDone(null)
    try {
      const res = await fetch(`/api/admin/users/${userId}/public-identity${init.path}`, {
        method: init.method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(init.body),
      })
      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>
      if (!res.ok) {
        setError(t('error'))
        await load()
        return
      }
      setDone(doneText(body))
      await load()
      onChanged?.()
    } catch {
      setError(t('error'))
      await load()
    } finally {
      setBusy(false)
    }
  }

  return (
    <PublicIdentityPanel
      userId={userId}
      identity={identity}
      busy={busy}
      error={error}
      done={done}
      onReset={(field) =>
        void act({ path: '/reset', method: 'POST', body: { field } }, (body) => {
          const outcome = body.outcome as { value?: string | null } | undefined
          return outcome?.value ? t('reset_done', { value: outcome.value }) : t('reset_done_empty')
        })
      }
      onLock={(locked) => {
        // The box follows the click at once, as the route publishing switch does; a failure reads the truth back.
        setIdentity({ ...identity, locked })
        void act({ path: '', method: 'PATCH', body: { locked } }, () => t(locked ? 'locked_done' : 'unlocked_done'))
      }}
    />
  )
}

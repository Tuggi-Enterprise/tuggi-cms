'use client'

/**
 * Access and balance for one app user, plus the two histories — spec §3, §4, §7.
 *
 * It replaced the *Subscription* block of the user modal, which edited `tier` + date and
 * wrote `drive.profiles` straight through a service-role route. Three things it does
 * that the old block could not:
 *
 * - **Nothing is computed here.** `state`, `balance_minutes` and `ends_at` arrive from
 *   `drive.get_entitlement` through `drive.get_time_credit_ledger`, and the CMS neither
 *   re-implements the `unlimited` → `metered` → `free` order nor re-adds the ledger
 *   (BR-MONETIZACAO-046). A failed read prints "balance not loaded", never `0 min`:
 *   measured zero and unknown zero are different facts (`DS-COMPONENTE-007`).
 * - **During `unlimited` the balance stays on screen, with the label that names why it
 *   is idle** (`DS-COMPONENTE-015`, BR-MONETIZACAO-051). This diverges from the app on
 *   purpose: there the balance disappears, because the tourist cannot act on the period.
 *   The operator can. One rule, two audiences, opposite results — nobody harmonises them.
 * - **403 is a state, not a failure.** A `viewer` does not pass
 *   `core.is_caller_platform_admin()`, so the read answers 403 and that is expected: it
 *   gets its own sentence, not a red box. For a non-admin the grant and revoke buttons
 *   are absent from the DOM — a disabled control with no explanation is worse than an
 *   absent one in a tool somebody uses all day.
 *
 * The consumption tab is a sequence of sessions and never a trail: no coordinate, no POI,
 * no city, no country, no map. `Quando` is always `consumed_at`, the server's stamp —
 * `client_reported_at` is not on screen, because a device clock is not a source of truth
 * (BR-MONETIZACAO-049) and showing it invites somebody to read it as one.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { formatDuration } from '@/lib/format/duration'
import { GRANT_SOURCES } from '@/lib/credit/entitlement'
import { DialogShell } from './DialogShell'
import { GrantCreditDialog } from './GrantCreditDialog'
import { creditFailureText, readFailure, type CreditFailure } from './errorText'
import type { LedgerEnvelope, LedgerGrant, LedgerSession } from './types'

const PAGE_SIZE = 50

interface Props {
  userId: string
  /** BR-USUARIO-042: the tourist is a `nickname` here too. The full name never arrives. */
  nickname: string | null
  email: string | null
  isAdmin: boolean
  /** Licence and provider are the profile's labels, not the entitlement. Secondary line. */
  licenseLabel?: string | null
  providerLabel?: string | null
  onChanged?: () => void
}

export function CreditPanel({
  userId,
  nickname,
  email,
  isAdmin,
  licenseLabel,
  providerLabel,
  onChanged,
}: Props) {
  const t = useTranslations('Pages.AppUsers.credit')

  const [envelope, setEnvelope] = useState<LedgerEnvelope | null>(null)
  const [loading, setLoading] = useState(true)
  const [failure, setFailure] = useState<CreditFailure | null>(null)
  const [tab, setTab] = useState<'grants' | 'consumption'>('grants')
  const [grantOpen, setGrantOpen] = useState(false)
  const [revoking, setRevoking] = useState<LedgerGrant | null>(null)
  const [updated, setUpdated] = useState(false)

  const load = useCallback(
    async (limit: number = PAGE_SIZE) => {
      setLoading(true)
      try {
        const response = await fetch(
          `/api/admin/users/${userId}/credit?session_limit=${limit}`
        )
        if (!response.ok) {
          setEnvelope(null)
          setFailure(await readFailure(response))
          return
        }
        setEnvelope(await response.json())
        setFailure(null)
      } catch {
        setEnvelope(null)
        setFailure({ code: 'network' })
      } finally {
        setLoading(false)
      }
    },
    [userId]
  )

  useEffect(() => {
    void load()
  }, [load])

  const markUpdated = () => {
    setUpdated(true)
    window.setTimeout(() => setUpdated(false), 3000)
    void load()
    onChanged?.()
  }

  const sourceLabel = (source: string): string =>
    (GRANT_SOURCES as readonly string[]).includes(source)
      ? t(`grants.source_${source}`)
      : source

  const usageLabel = (session: LedgerSession): string => {
    if (session.blocks_offline === 0) return t('usage.origin_online')
    if (session.blocks_offline_pending > 0) return t('usage.origin_offline')
    return t('usage.origin_reconciled')
  }

  if (loading && !envelope) {
    return (
      <section className="space-y-3 rounded-xl bg-gray-50 p-4 dark:bg-gray-800/50">
        {[0, 1, 2].map((row) => (
          <div key={row} className="h-6 w-full animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
        ))}
      </section>
    )
  }

  if (failure?.code === 'forbidden') {
    return (
      <section className="rounded-xl bg-gray-50 p-4 text-sm text-gray-700 dark:bg-gray-800/50 dark:text-gray-300">
        {t('panel.forbidden')}
      </section>
    )
  }

  return (
    <section className="space-y-4 rounded-xl bg-gray-50 p-4 dark:bg-gray-800/50">
      <header className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-bold text-gray-700 dark:text-gray-300">{t('panel.title')}</h3>
        <div className="flex items-center gap-3">
          {updated ? (
            <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">
              {t('panel.updated')}
            </span>
          ) : null}
          {isAdmin ? (
            <Button size="sm" onClick={() => setGrantOpen(true)}>
              {t('panel.grant_cta')}
            </Button>
          ) : null}
        </div>
      </header>

      {!envelope ? (
        <div className="space-y-2 text-sm">
          <p className="text-gray-900 dark:text-white">
            {failure ? creditFailureText(t, failure) : t('panel.error')}
          </p>
          <Button size="sm" variant="outline" onClick={() => void load()}>
            {t('panel.retry')}
          </Button>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <div>
              {/* The field that carries the state badge has its own label. It used to
                  repeat `panel.title`, the section heading 20 px above it, which left the
                  badge in an unnamed field and the panel saying the same thing twice. */}
              <p className="text-xs text-gray-700 dark:text-gray-400">{t('panel.state')}</p>
              <Badge
                className="mt-1"
                variant={
                  envelope.state === 'unlimited'
                    ? 'default'
                    : envelope.state === 'metered'
                      ? 'secondary'
                      : 'outline'
                }
              >
                {t(`panel.state_${envelope.state}`)}
              </Badge>
            </div>
            <div>
              <p className="text-xs text-gray-700 dark:text-gray-400">{t('panel.balance')}</p>
              <p className="mt-1 text-lg font-bold text-gray-900 dark:text-white">
                {formatDuration(envelope.balance_minutes)}
              </p>
              <p className="text-xs text-gray-700 dark:text-gray-400">
                {t('panel.balance_minutes', { minutes: envelope.balance_minutes })}
              </p>
              <p className="mt-1 text-xs text-gray-700 dark:text-gray-400">
                {t('panel.license')}: {licenseLabel || '—'} · {t('panel.provider')}:{' '}
                {providerLabel || '—'}
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-700 dark:text-gray-400">{t('panel.ends_at')}</p>
              <p className="mt-1 font-medium text-gray-900 dark:text-white">
                {envelope.ends_at ? new Date(envelope.ends_at).toLocaleDateString() : '—'}
              </p>
            </div>
          </div>

          {envelope.state === 'unlimited' && envelope.balance_minutes > 0 && envelope.ends_at ? (
            <p className="text-xs text-gray-700 dark:text-gray-400">
              {t('panel.inert_notice', {
                date: new Date(envelope.ends_at).toLocaleDateString(),
              })}
            </p>
          ) : null}

          <div className="flex gap-2 border-b border-gray-200 dark:border-gray-700" role="tablist">
            {(['grants', 'consumption'] as const).map((key) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={tab === key}
                onClick={() => setTab(key)}
                className={
                  'px-3 py-2 text-sm font-semibold ' +
                  (tab === key
                    ? 'border-b-2 border-primary text-gray-900 dark:text-white'
                    : 'text-gray-700 dark:text-gray-400')
                }
              >
                {t(`tabs.${key}`)}
              </button>
            ))}
          </div>

          {tab === 'grants' ? (
            <GrantsTable
              grants={envelope.grants}
              isAdmin={isAdmin}
              sourceLabel={sourceLabel}
              onRevoke={setRevoking}
            />
          ) : (
            <ConsumptionTable
              sessions={envelope.consumption}
              total={envelope.consumption_sessions_total}
              usageLabel={usageLabel}
              onLoadMore={() => void load(envelope.session_limit + PAGE_SIZE)}
            />
          )}
        </>
      )}

      {grantOpen ? (
        <GrantCreditDialog
          targets={[{ userId, nickname, email }]}
          onClose={() => setGrantOpen(false)}
          onGranted={markUpdated}
        />
      ) : null}

      {revoking ? (
        <RevokeDialog
          grant={revoking}
          userId={userId}
          sourceLabel={sourceLabel}
          onClose={() => setRevoking(null)}
          onRevoked={() => {
            setRevoking(null)
            markUpdated()
          }}
        />
      ) : null}
    </section>
  )
}

function GrantsTable({
  grants,
  isAdmin,
  sourceLabel,
  onRevoke,
}: {
  grants: LedgerGrant[]
  isAdmin: boolean
  sourceLabel: (source: string) => string
  onRevoke: (grant: LedgerGrant) => void
}) {
  const t = useTranslations('Pages.AppUsers.credit')

  if (grants.length === 0) {
    return <p className="py-6 text-center text-sm text-gray-700 dark:text-gray-400">{t('grants.empty')}</p>
  }

  return (
    <table className="w-full text-left text-sm">
      <thead className="text-xs uppercase text-gray-700 dark:text-gray-400">
        <tr>
          <th className="py-2 pr-3">{t('grants.col_when')}</th>
          <th className="py-2 pr-3">{t('grants.col_type')}</th>
          <th className="py-2 pr-3">{t('grants.col_amount')}</th>
          <th className="py-2 pr-3">{t('grants.col_source')}</th>
          <th className="py-2 pr-3">{t('grants.col_by')}</th>
          <th className="py-2 pr-3">{t('grants.col_status')}</th>
          <th className="py-2" />
        </tr>
      </thead>
      <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
        {grants.map((grant) => (
          <tr key={grant.id} className="text-gray-900 dark:text-white">
            <td className="py-2 pr-3">{new Date(grant.granted_at).toLocaleString()}</td>
            <td className="py-2 pr-3">
              {grant.grant_type === 'minutes' ? t('grants.type_minutes') : t('grants.type_until')}
            </td>
            <td className="py-2 pr-3">
              {grant.grant_type === 'minutes'
                ? formatDuration(grant.minutes_granted ?? 0)
                : t('grants.until_value', {
                    date: grant.ends_at ? new Date(grant.ends_at).toLocaleDateString() : '',
                  })}
            </td>
            <td className="py-2 pr-3">{sourceLabel(grant.source)}</td>
            {/* A self-service port stores NULL on purpose. The cell says so in words —
                never blank, never a dash that reads as missing data. */}
            <td className="py-2 pr-3">{grant.granted_by_email || t('grants.by_system')}</td>
            <td className="py-2 pr-3">
              {grant.invalidated_at ? (
                <span title={grant.invalidation_reason ?? undefined}>
                  {t('grants.status_revoked')}
                  {grant.invalidation_reason ? ` · ${grant.invalidation_reason}` : ''}
                </span>
              ) : (
                t('grants.status_valid')
              )}
            </td>
            <td className="py-2 text-right">
              {isAdmin && !grant.invalidated_at ? (
                <Button size="sm" variant="outline" onClick={() => onRevoke(grant)}>
                  {t('grants.revoke_cta')}
                </Button>
              ) : null}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function ConsumptionTable({
  sessions,
  total,
  usageLabel,
  onLoadMore,
}: {
  sessions: LedgerSession[]
  total: number
  usageLabel: (session: LedgerSession) => string
  onLoadMore: () => void
}) {
  const t = useTranslations('Pages.AppUsers.credit')

  if (sessions.length === 0) {
    return <p className="py-6 text-center text-sm text-gray-700 dark:text-gray-400">{t('usage.empty')}</p>
  }

  return (
    <div className="space-y-3">
      <table className="w-full text-left text-sm">
        <thead className="text-xs uppercase text-gray-700 dark:text-gray-400">
          <tr>
            <th className="py-2 pr-3">{t('grants.col_when')}</th>
            <th className="py-2 pr-3">{t('usage.col_session')}</th>
            <th className="py-2 pr-3">{t('usage.col_blocks')}</th>
            <th className="py-2 pr-3">{t('usage.col_minutes')}</th>
            <th className="py-2">{t('usage.col_origin')}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
          {sessions.map((session) => (
            <tr key={session.session_id} className="text-gray-900 dark:text-white">
              <td className="py-2 pr-3">
                {new Date(session.first_consumed_at).toLocaleString()} –{' '}
                {new Date(session.last_consumed_at).toLocaleTimeString()}
              </td>
              {/* Six characters, so two sessions of the same day can be told apart. */}
              <td className="py-2 pr-3 font-mono text-xs">…{session.session_id.slice(-6)}</td>
              <td className="py-2 pr-3">{session.blocks}</td>
              <td className="py-2 pr-3">{formatDuration(session.minutes)}</td>
              <td className="py-2">{usageLabel(session)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {sessions.length < total ? (
        <Button size="sm" variant="outline" onClick={onLoadMore}>
          {t('usage.load_more')}
        </Button>
      ) : null}
    </div>
  )
}

function RevokeDialog({
  grant,
  userId,
  sourceLabel,
  onClose,
  onRevoked,
}: {
  grant: LedgerGrant
  userId: string
  sourceLabel: (source: string) => string
  onClose: () => void
  onRevoked: () => void
}) {
  const t = useTranslations('Pages.AppUsers.credit')
  const cancelRef = useRef<HTMLButtonElement | null>(null)
  const [reason, setReason] = useState('')
  const [failure, setFailure] = useState<CreditFailure | null>(null)
  const [sending, setSending] = useState(false)

  const amount =
    grant.grant_type === 'minutes'
      ? formatDuration(grant.minutes_granted ?? 0)
      : t('grants.until_value', {
          date: grant.ends_at ? new Date(grant.ends_at).toLocaleDateString() : '',
        })

  const submit = async () => {
    if (!reason.trim()) {
      setFailure({ code: 'reason_required' })
      return
    }
    setSending(true)
    try {
      const response = await fetch(`/api/admin/users/${userId}/credit/revoke`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ grant_id: grant.id, reason: reason.trim() }),
      })
      if (!response.ok) {
        setFailure(await readFailure(response))
        return
      }
      onRevoked()
    } catch {
      setFailure({ code: 'network' })
    } finally {
      setSending(false)
    }
  }

  return (
    <DialogShell
      open
      title={t('revoke.title')}
      onClose={onClose}
      initialFocusRef={cancelRef}
      footer={
        <>
          <Button ref={cancelRef} variant="outline" onClick={onClose}>
            {t('form.cancel')}
          </Button>
          <Button variant="destructive" disabled={sending} onClick={() => void submit()}>
            {t('revoke.cta')}
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-sm text-gray-900 dark:text-white">
        {failure ? (
          <p className="rounded-md border border-destructive/40 bg-destructive/5 p-3">
            {creditFailureText(t, failure)}
          </p>
        ) : null}
        <p>
          {t('revoke.summary', {
            amount,
            source: sourceLabel(grant.source),
            date: new Date(grant.granted_at).toLocaleDateString(),
          })}
        </p>
        {/* `minutes_consumed` comes from the RPC, per grant. Without it the operator
            revokes without knowing the size of the effect. */}
        <p>{t('revoke.consumed', { duration: formatDuration(grant.minutes_consumed) })}</p>
        <p className="text-gray-700 dark:text-gray-300">{t('revoke.effect')}</p>
        {grant.grant_type === 'until' ? (
          // Said BEFORE the click instead of arriving as `warning` in the envelope after.
          <p className="text-gray-700 dark:text-gray-300">{t('revoke.until_warning')}</p>
        ) : null}
        <div>
          <Label htmlFor="revoke-reason" className="dark:text-gray-300">
            {t('revoke.reason')}
          </Label>
          <Textarea
            id="revoke-reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            aria-describedby="revoke-reason-help"
          />
          <p id="revoke-reason-help" className="mt-1 text-xs text-gray-700 dark:text-gray-400">
            {t('revoke.reason_help')}
          </p>
        </div>
      </div>
    </DialogShell>
  )
}

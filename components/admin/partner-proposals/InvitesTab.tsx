'use client'

/**
 * The queue of live links. A table and not cards: it is a work queue and the operator scans
 * a column, not a card.
 *
 * TWO ACTS THAT LOOK ALIKE AND ARE NOT:
 *
 *  · `Reenviar` mints a NEW link for the SAME proposal and does not carry a destination
 *    field. The address comes from the record, never from a form — a link that reopens a
 *    proposal hands back the CNPJ, the legal representative and the documents already sent,
 *    and one transposed letter would deliver all of it to a stranger with the look of a
 *    successful send. The confirmation says so, and says that a wrong address needs a NEW
 *    invite instead.
 *  · `Revogar` switches a live link off and touches nothing else.
 *
 * A consumed invite (`Recebido`, `Promovido`, `Descartado`) offers no `Revogar`: there is no
 * live link to switch off, and a button that changes nothing is noise.
 *
 * Every situation is TEXT plus colour, never colour alone (DS-A11Y-003).
 */

import { useEffect, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { InviteDrawer } from './InviteDrawer'
import { dayDelta, formatShortDate } from './format'
import type { InviteRow, InviteSituation, Translator } from './types'

const SITUATIONS: InviteSituation[] = [
  'sent',
  'started',
  'received',
  'promoted',
  'discarded',
  'expired',
  'revoked',
]

/** Text carries the state; the tint only reinforces it. */
const SITUATION_TINT: Record<InviteSituation, string> = {
  sent: 'text-gray-900',
  started: 'text-primary-800',
  received: 'text-primary-800',
  promoted: 'text-green-800',
  discarded: 'text-gray-700',
  expired: 'text-gray-700',
  revoked: 'text-destructive',
}

interface InvitesTabProps {
  locale: string
  invites: InviteRow[]
  loading: boolean
  failed: boolean
  onReload: () => void
}

export function InvitesTab({ locale, invites, loading, failed, onReload }: InvitesTabProps) {
  const t = useTranslations('PartnerProposals')
  const [search, setSearch] = useState('')
  const [situation, setSituation] = useState<'all' | InviteSituation>('all')
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return invites.filter((invite) => {
      if (situation !== 'all' && invite.situation !== situation) return false
      if (!needle) return true
      return (
        invite.recipientEmail.toLowerCase().indexOf(needle) >= 0 ||
        (invite.tradeName ?? '').toLowerCase().indexOf(needle) >= 0 ||
        (invite.recipientName ?? '').toLowerCase().indexOf(needle) >= 0
      )
    })
  }, [invites, search, situation])

  const filtering = search.trim() !== '' || situation !== 'all'

  async function resend(invite: InviteRow) {
    if (!window.confirm(`${t('resend.title')}\n\n${t('resend.body')}\n\n${t('resend.keeps')}\n\n${t('resend.wrongAddress')}`)) {
      return
    }
    setBusyId(invite.id)
    setActionError(null)
    try {
      // No address in the body, on purpose: `createInvite` reads the destination from the
      // record, and the type of its input has no shape in which a resend names one.
      const response = await fetch('/api/admin/partner-invites', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ submissionId: invite.submissionId }),
      })
      if (!response.ok) {
        setActionError(t('inviteDrawer.failed'))
        return
      }
      onReload()
    } catch {
      setActionError(t('inviteDrawer.failed'))
    } finally {
      setBusyId(null)
    }
  }

  async function revoke(invite: InviteRow) {
    if (!window.confirm(`${t('revoke.title')}\n\n${t('revoke.body')}`)) return
    setBusyId(invite.id)
    setActionError(null)
    try {
      const response = await fetch(`/api/admin/partner-invites/${invite.id}`, { method: 'DELETE' })
      if (!response.ok) {
        setActionError(t('revoke.failed'))
        return
      }
      onReload()
    } catch {
      setActionError(t('revoke.failed'))
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="flex flex-col gap-6 lg:flex-row">
      <aside className="w-full shrink-0 space-y-4 lg:w-64">
        <Button onClick={() => setDrawerOpen(true)} className="w-full">
          {t('invites.new')}
        </Button>

        <div>
          <Label htmlFor="invite-search">{t('invites.searchLabel')}</Label>
          <Input
            id="invite-search"
            value={search}
            placeholder={t('invites.searchPlaceholder')}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>

        <div>
          <Label htmlFor="invite-situation">{t('invites.situationLabel')}</Label>
          <select
            id="invite-situation"
            value={situation}
            onChange={(event) => setSituation(event.target.value as 'all' | InviteSituation)}
            className="mt-1 block w-full rounded-md border border-input bg-white px-3 py-2 text-sm text-gray-900"
          >
            <option value="all">{t('invites.allSituations')}</option>
            {SITUATIONS.map((value) => (
              <option key={value} value={value}>
                {t(`invites.situations.${value}`)}
              </option>
            ))}
          </select>
        </div>

        {filtering && (
          <Button
            variant="outline"
            className="w-full"
            onClick={() => {
              setSearch('')
              setSituation('all')
            }}
          >
            {t('invites.clearFilters')}
          </Button>
        )}
      </aside>

      <section className="min-w-0 flex-1">
        {actionError && (
          <p className="mb-3 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-gray-900">
            {actionError}
          </p>
        )}

        {failed ? (
          <div className="rounded-md border border-gray-200 p-6 text-center">
            <p className="font-medium text-gray-900">{t('invites.errorTitle')}</p>
            <Button variant="outline" className="mt-3" onClick={onReload}>
              {t('invites.retry')}
            </Button>
          </div>
        ) : (
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-gray-300 text-left text-xs uppercase tracking-wide text-gray-700">
                <th scope="col" className="px-2 py-2">{t('invites.columns.establishment')}</th>
                <th scope="col" className="px-2 py-2">{t('invites.columns.recipient')}</th>
                <th scope="col" className="px-2 py-2">{t('invites.columns.situation')}</th>
                <th scope="col" className="px-2 py-2">{t('invites.columns.sent')}</th>
                <th scope="col" className="px-2 py-2">{t('invites.columns.validity')}</th>
                <th scope="col" className="px-2 py-2">{t('invites.columns.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {loading &&
                [0, 1, 2, 3, 4].map((row) => (
                  <tr key={`skeleton-${row}`} className="border-b border-gray-100">
                    <td className="px-2 py-3" colSpan={6}>
                      <span className="sr-only">{t('invites.loading')}</span>
                      <span className="block h-4 w-full animate-pulse rounded bg-gray-100" aria-hidden="true" />
                    </td>
                  </tr>
                ))}

              {!loading &&
                filtered.map((invite) => (
                  <tr key={invite.id} className="border-b border-gray-100 align-top">
                    <td className="px-2 py-3 text-gray-900">{invite.tradeName || t('invites.noEstablishment')}</td>
                    <td className="px-2 py-3">
                      <span className="block text-gray-900">{invite.recipientEmail}</span>
                      {invite.recipientName && (
                        <span className="block text-xs text-gray-700">{invite.recipientName}</span>
                      )}
                    </td>
                    <td className={`px-2 py-3 font-medium ${SITUATION_TINT[invite.situation]}`}>
                      {t(`invites.situations.${invite.situation}`)}
                      {invite.isPartial && (
                        <span className="ml-1 rounded-full border border-gray-400 px-1.5 py-0.5 text-xs font-normal text-gray-800">
                          {t('invites.partialBadge')}
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-3 text-gray-800">
                      {t('invites.sentAt', {
                        date: formatShortDate(invite.createdAt),
                        ago: t('invites.ago', { days: Math.abs(dayDelta(invite.createdAt) ?? 0) }),
                      })}
                    </td>
                    <td className="px-2 py-3 text-gray-800">{validityLabel(invite, t)}</td>
                    <td className="px-2 py-3">
                      <div className="flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busyId === invite.id}
                          onClick={() => resend(invite)}
                        >
                          {busyId === invite.id ? (
                            <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                          ) : (
                            t('invites.actions.resend')
                          )}
                        </Button>
                        {invite.revocable && (
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={busyId === invite.id}
                            onClick={() => revoke(invite)}
                          >
                            {t('invites.actions.revoke')}
                          </Button>
                        )}
                        {invite.submissionStatus && invite.submissionStatus !== 'draft' && (
                          <Link
                            href={`/${locale}/admin/partner-proposals/${invite.submissionId}`}
                            className="inline-flex h-9 items-center px-3 text-sm font-medium text-primary-800 underline underline-offset-4"
                          >
                            {t('invites.actions.openProposal')}
                          </Link>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        )}

        {!loading && !failed && filtered.length === 0 && (
          <div className="rounded-md border border-gray-200 p-6 text-center">
            {filtering ? (
              <>
                <p className="font-medium text-gray-900">{t('invites.emptyFilteredTitle')}</p>
                <Button
                  variant="outline"
                  className="mt-3"
                  onClick={() => {
                    setSearch('')
                    setSituation('all')
                  }}
                >
                  {t('invites.clearFilters')}
                </Button>
              </>
            ) : (
              <>
                <p className="font-medium text-gray-900">{t('invites.emptyTitle')}</p>
                <p className="mx-auto mt-1 max-w-lg text-sm text-gray-800">{t('invites.emptyBody')}</p>
                <Button className="mt-3" onClick={() => setDrawerOpen(true)}>
                  {t('invites.new')}
                </Button>
              </>
            )}
          </div>
        )}
      </section>

      <InviteDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        onCreated={onReload}
      />
    </div>
  )
}

/** `Expira em 12 dias` · `Expira amanhã` · `Expirou há 3 dias` — never a bare date. */
function validityLabel(invite: InviteRow, t: Translator): string {
  const days = dayDelta(invite.expiresAt)
  if (days === null) return '—'
  if (days < 0) return t('invites.validity.past', { days: Math.abs(days) })
  if (days === 0) return t('invites.validity.today')
  if (days === 1) return t('invites.validity.tomorrow')
  return t('invites.validity.future', { days })
}

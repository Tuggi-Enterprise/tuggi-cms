'use client'

/**
 * The acceptance link of a client who did not come through the portal — BR-B2B-056, spec of the
 * `design` in #872 §3. Lives in the record's contract tab; the board card only copies.
 *
 * Every link is new: the database keeps only the token's hash, so `Copiar o link` issues one and
 * the previous link (the one that went by e-mail, too) stops working — the panel says so.
 */

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import { FileSignature } from 'lucide-react'
import { SectionHeader } from '@/components/admin/clients/shared/SectionHeader'
import type { AcceptanceSource } from '@/lib/partnerships/acceptance-gate'
import type { IssuedLink, LinkStatus } from '@/lib/partnerships/acceptance-link'

interface GateAnswer {
  acceptedAt: string | null
  acceptanceSource: AcceptanceSource | null
  link: LinkStatus | null
}

type Busy = 'send' | 'copy' | null

const ZONE = 'America/Sao_Paulo'
const day = (iso: string) =>
  new Intl.DateTimeFormat('pt-BR', { timeZone: ZONE, day: '2-digit', month: '2-digit' }).format(new Date(iso))
// `14h05` — the house format for a time of day (spec #872 §3, `{HHhmm}`).
const time = (iso: string) =>
  new Intl.DateTimeFormat('pt-BR', { timeZone: ZONE, hour: '2-digit', minute: '2-digit', hour12: false })
    .format(new Date(iso))
    .replace(':', 'h')

export function AcceptanceLinkPanel({
  clientId,
  email,
  lead,
}: {
  clientId: string
  email: string | null
  /** The first lines of the card, under its title: `ContractTab` puts the origin here (#911). */
  lead?: ReactNode
}) {
  const t = useTranslations('Clients.portal.acceptanceLink')
  const [gate, setGate] = useState<GateAnswer | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [busy, setBusy] = useState<Busy>(null)
  const [issued, setIssued] = useState<(IssuedLink & { at: string; sent: boolean }) | null>(null)
  const [message, setMessage] = useState<{ text: string; tone: 'status' | 'alert' } | null>(null)

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/admin/clients/${clientId}/acceptance-link`)
      if (!response.ok) return setLoadFailed(true)
      setGate((await response.json()) as GateAnswer)
      setLoadFailed(false)
    } catch {
      setLoadFailed(true)
    }
  }, [clientId])

  useEffect(() => {
    void load()
  }, [load])

  const refusal = (payload: { error?: string; field?: string } | null): string => {
    const code = payload?.error ?? 'issue_failed'
    if (code === 'record_incomplete' && payload?.field && t.has(`fields.${payload.field}`)) {
      return t('errors.record_incomplete', { field: t(`fields.${payload.field}`) })
    }
    return t.has(`errors.${code}`) ? t(`errors.${code}`) : t('errors.issue_failed')
  }

  async function issue(send: boolean) {
    setBusy(send ? 'send' : 'copy')
    setMessage(null)
    try {
      const response = await fetch(`/api/admin/clients/${clientId}/acceptance-link`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ send }),
      })
      const payload = (await response.json().catch(() => null)) as (IssuedLink & { error?: string; field?: string }) | null
      if (!response.ok || !payload?.url) {
        setMessage({ text: refusal(payload), tone: 'alert' })
        return
      }
      setIssued({ ...payload, at: new Date().toISOString(), sent: send && payload.emailSent === true })
      if (send && payload.emailSent !== true) {
        setMessage({ text: t('sendFailed'), tone: 'alert' })
      } else if (!send) {
        await copy(payload.url)
      }
      void load()
    } catch {
      setMessage({ text: t('errors.issue_failed'), tone: 'alert' })
    } finally {
      setBusy(null)
    }
  }

  async function copy(url: string) {
    try {
      await navigator.clipboard.writeText(url)
      setMessage({ text: t('copied'), tone: 'status' })
    } catch {
      setMessage({ text: t('copyFailed'), tone: 'alert' })
    }
  }

  if (loadFailed) {
    return (
      <div className="space-y-4">
        {lead}
        <p className="text-sm text-gray-600">{t('loadFailed')}</p>
      </div>
    )
  }
  if (!gate) return null
  // A signed legacy contract or the portal's acceptance is shown by the cards around this one.
  if (gate.acceptanceSource && gate.acceptanceSource !== 'link') return null

  const accepted = gate.acceptanceSource === 'link' && gate.acceptedAt
  const expired = !issued && gate.link?.state === 'expired'

  return (
    <div className="rounded-3xl border border-gray-200 bg-white p-5 shadow-sm lg:p-8 dark:border-gray-800 dark:bg-gray-900">
      <div className="flex flex-wrap items-center gap-3">
        <SectionHeader icon={<FileSignature className="h-4 w-4 text-indigo-500" />} title={t('title')} color="indigo-500" />
        <span className="rounded-full border border-gray-300 px-2 py-0.5 text-xs font-medium text-gray-900 dark:text-gray-200">
          {accepted ? t('accepted') : t('pending')}
        </span>
      </div>
      {lead}

      {accepted ? (
        <p className="mt-3 text-sm text-gray-900 dark:text-gray-200">{t('acceptedOn', { date: day(gate.acceptedAt!) })}</p>
      ) : (
        <div className="mt-3 space-y-3 text-sm text-gray-900 dark:text-gray-200">
          {email && <p>{t('goesTo', { email })}</p>}

          {issued?.sent ? (
            <p>
              {t('sent', { date: day(issued.at), time: time(issued.at), email: issued.sentTo, until: day(issued.expiresAt) })}
            </p>
          ) : expired && gate.link ? (
            <p>{t('expired', { date: day(gate.link.expiresAt) })}</p>
          ) : gate.link?.state === 'live' && !issued ? (
            <p>{t('validUntil', { until: day(gate.link.expiresAt) })}</p>
          ) : null}

          {issued && (
            <p className="break-all rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 font-mono text-xs dark:border-gray-700 dark:bg-gray-800">
              {issued.url}
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void issue(true)}
              disabled={busy !== null}
              className="inline-flex min-h-[44px] items-center rounded-xl bg-primary-800 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 lg:min-h-[36px]"
            >
              {busy === 'send' ? t('sending') : expired ? t('sendNew') : t('send')}
            </button>
            <button
              type="button"
              onClick={() => (issued ? void copy(issued.url) : void issue(false))}
              disabled={busy !== null}
              className="inline-flex min-h-[44px] items-center rounded-xl border border-primary-800 px-4 py-2 text-sm font-semibold text-primary-800 disabled:opacity-50 dark:border-tuggi-blue dark:text-tuggi-blue lg:min-h-[36px]"
            >
              {busy === 'copy' ? t('copying') : t('copy')}
            </button>
          </div>
          {!issued && <p className="text-xs text-gray-600 dark:text-gray-400">{t('copyRenews')}</p>}

          {message && (
            <p role={message.tone} className="text-sm text-gray-900 dark:text-gray-200">
              {message.text}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

'use client'

/**
 * The panel that mints a link, and the one place in the CMS that shows a credential.
 *
 * DS-COMPONENTE-019 IS THE WHOLE SHAPE OF THIS COMPONENT, not a note on it:
 *
 *  · the token exists in the e-mail and in this response, and nowhere else — the database
 *    holds a SHA-256 of it. So the panel does not close by itself after minting, says in the
 *    same block that there is no second showing and why, offers no "see it again", and warns
 *    before closing while the value is on screen;
 *  · `Copiar link` confirms IN TEXT (`role="status"`), never by swapping an icon — a state
 *    told only by colour or shape is DS-A11Y-003;
 *  · a failed e-mail does NOT invalidate the link that was already minted: the panel offers
 *    it for manual sending and tells the operator not to mint another.
 *
 * The result is held in component state and never written to storage, a query string or a
 * log. Closing the panel is what destroys it, which is exactly what the copy promises.
 */

import { useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { AlertTriangle, Check, Loader2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { INVITE_TTL_DAYS } from '@/lib/services/partner-proposal-service'
import { formatDate } from './format'
import type { CreatedInviteResult } from './types'

interface ClientOption {
  id: string
  name: string
  email: string | null
}

interface InviteDrawerProps {
  open: boolean
  onClose: () => void
  /** Called once a link was minted, so the list behind the panel can refresh. */
  onCreated: () => void
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
/** The route accepts up to 60; anything longer is a link living longer than the deal. */
const TTL_OPTIONS = [7, INVITE_TTL_DAYS, 30, 60]

export function InviteDrawer({ open, onClose, onCreated }: InviteDrawerProps) {
  const t = useTranslations('PartnerProposals')

  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [tradeName, setTradeName] = useState('')
  const [clientQuery, setClientQuery] = useState('')
  const [clientOptions, setClientOptions] = useState<ClientOption[]>([])
  const [client, setClient] = useState<ClientOption | null>(null)
  const [ttlDays, setTtlDays] = useState(INVITE_TTL_DAYS)

  const [emailError, setEmailError] = useState(false)
  const [sending, setSending] = useState(false)
  const [failed, setFailed] = useState(false)
  const [result, setResult] = useState<CreatedInviteResult | null>(null)
  const [copied, setCopied] = useState(false)

  const firstFieldRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (open) firstFieldRef.current?.focus()
  }, [open])

  // Search runs against the client list the CMS already exposes; the drawer does not grow a
  // second way of asking "which client is this?".
  useEffect(() => {
    if (!open || clientQuery.trim().length < 2) {
      setClientOptions([])
      return
    }
    let cancelled = false
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(
          `/api/admin/clients?search=${encodeURIComponent(clientQuery.trim())}&limit=5`
        )
        if (!response.ok) return
        const payload = await response.json()
        if (cancelled) return
        const rows = Array.isArray(payload?.clients) ? payload.clients : []
        setClientOptions(
          rows.map((row: Record<string, unknown>) => ({
            id: String(row.id),
            name: String(row.name ?? row.company_name ?? ''),
            email: (row.email as string) ?? null,
          }))
        )
      } catch {
        if (!cancelled) setClientOptions([])
      }
    }, 250)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [clientQuery, open])

  if (!open) return null

  const dirty = email !== '' || name !== '' || tradeName !== '' || client !== null

  function reset() {
    setEmail('')
    setName('')
    setTradeName('')
    setClientQuery('')
    setClientOptions([])
    setClient(null)
    setTtlDays(INVITE_TTL_DAYS)
    setEmailError(false)
    setFailed(false)
    setResult(null)
    setCopied(false)
  }

  function requestClose() {
    // The warning before closing is item 6 of DS-COMPONENTE-019: the value is on screen and
    // there is no second showing. `dirty` gets the ordinary "you typed something" confirm.
    if (result && !window.confirm(t('inviteDrawer.closeConfirm'))) return
    if (!result && dirty && !window.confirm(t('inviteDrawer.closeConfirm'))) return
    reset()
    onClose()
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!EMAIL_PATTERN.test(email.trim())) {
      setEmailError(true)
      return
    }
    setEmailError(false)
    setFailed(false)
    setSending(true)

    try {
      const response = await fetch('/api/admin/partner-invites', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          recipientEmail: email.trim(),
          recipientName: name.trim() || null,
          tradeName: tradeName.trim() || null,
          clientId: client?.id ?? null,
          ttlDays,
        }),
      })
      if (!response.ok) {
        setFailed(true)
        return
      }
      setResult((await response.json()) as CreatedInviteResult)
      onCreated()
    } catch {
      setFailed(true)
    } finally {
      setSending(false)
    }
  }

  async function copyLink() {
    if (!result) return
    try {
      await navigator.clipboard.writeText(result.url)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/40" onClick={requestClose} aria-hidden="true" />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={t('inviteDrawer.title')}
        className="relative flex h-full w-full max-w-md flex-col overflow-y-auto bg-white shadow-xl"
      >
        <header className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
          <h2 className="text-lg font-semibold text-gray-900">{t('inviteDrawer.title')}</h2>
          <Button variant="ghost" size="icon" onClick={requestClose} aria-label={t('inviteDrawer.cancel')}>
            <X className="h-5 w-5" aria-hidden="true" />
          </Button>
        </header>

        {result ? (
          <div className="space-y-4 px-5 py-5">
            <h3 className="text-base font-semibold text-gray-900">{t('inviteResult.title')}</h3>

            <div className="rounded-md border border-primary/40 bg-primary-50 p-3">
              <p className="break-all font-mono text-sm text-gray-900">{result.url}</p>
              <div className="mt-3 flex items-center gap-3">
                <Button type="button" size="sm" onClick={copyLink}>
                  {t('inviteResult.copy')}
                </Button>
                {/* Confirmation in words. An icon swap alone is DS-A11Y-003. */}
                <span role="status" className="text-sm font-medium text-primary-800">
                  {copied ? t('inviteResult.copied') : ''}
                </span>
              </div>
            </div>

            <div className="rounded-md border border-gray-200 bg-gray-50 p-3 text-sm text-gray-800">
              <p className="font-semibold text-gray-900">{t('inviteResult.onceTitle')}</p>
              <p className="mt-1">{t('inviteResult.onceBody')}</p>
              <p className="mt-2">{t('inviteResult.validUntil', { date: formatDate(result.expiresAt) })}</p>
            </div>

            {result.emailed ? (
              <p className="flex items-start gap-2 text-sm text-gray-800">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary-800" aria-hidden="true" />
                <span>{t('inviteResult.emailed', { email: result.recipientEmail })}</span>
              </p>
            ) : (
              <div className="flex items-start gap-2 rounded-md border border-secondary-700/40 bg-secondary-50 p-3 text-sm text-gray-900">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <div>
                  <p className="font-semibold">{t('inviteResult.emailFailedTitle')}</p>
                  <p className="mt-1">{t('inviteResult.emailFailedBody')}</p>
                </div>
              </div>
            )}

            <Button type="button" variant="outline" onClick={requestClose} className="w-full">
              {t('inviteResult.done')}
            </Button>
          </div>
        ) : (
          <form className="space-y-5 px-5 py-5" onSubmit={submit}>
            <div>
              <Label htmlFor="invite-email">{t('inviteDrawer.emailLabel')}</Label>
              <Input
                id="invite-email"
                ref={firstFieldRef}
                type="email"
                value={email}
                required
                aria-describedby="invite-email-help"
                aria-invalid={emailError || undefined}
                onChange={(event) => setEmail(event.target.value)}
              />
              <p id="invite-email-help" className="mt-1 text-xs text-gray-700">
                {t('inviteDrawer.emailHelp')}
              </p>
              {emailError && (
                <p className="mt-1 text-xs font-medium text-destructive">{t('inviteDrawer.emailError')}</p>
              )}
            </div>

            <div>
              <Label htmlFor="invite-name">{t('inviteDrawer.nameLabel')}</Label>
              <Input
                id="invite-name"
                value={name}
                aria-describedby="invite-name-help"
                onChange={(event) => setName(event.target.value)}
              />
              <p id="invite-name-help" className="mt-1 text-xs text-gray-700">
                {t('inviteDrawer.nameHelp')}
              </p>
            </div>

            <div>
              <Label htmlFor="invite-trade-name">{t('inviteDrawer.tradeNameLabel')}</Label>
              <Input
                id="invite-trade-name"
                value={tradeName}
                aria-describedby="invite-trade-name-help"
                onChange={(event) => setTradeName(event.target.value)}
              />
              <p id="invite-trade-name-help" className="mt-1 text-xs text-gray-700">
                {t('inviteDrawer.tradeNameHelp')}
              </p>
            </div>

            <div>
              <Label htmlFor="invite-client">{t('inviteDrawer.clientLabel')}</Label>
              {client ? (
                <div className="flex items-center justify-between rounded-md border border-gray-300 px-3 py-2">
                  <span className="text-sm text-gray-900">{client.name}</span>
                  <Button type="button" variant="ghost" size="sm" onClick={() => setClient(null)}>
                    {t('inviteDrawer.clientClear')}
                  </Button>
                </div>
              ) : (
                <>
                  <Input
                    id="invite-client"
                    value={clientQuery}
                    placeholder={t('inviteDrawer.clientPlaceholder')}
                    aria-describedby="invite-client-help"
                    onChange={(event) => setClientQuery(event.target.value)}
                  />
                  {clientQuery.trim().length >= 2 && clientOptions.length === 0 && (
                    <p className="mt-1 text-xs text-gray-700">{t('inviteDrawer.clientNone')}</p>
                  )}
                  {clientOptions.length > 0 && (
                    <ul className="mt-1 divide-y divide-gray-200 rounded-md border border-gray-300">
                      {clientOptions.map((option) => (
                        <li key={option.id}>
                          <button
                            type="button"
                            className="w-full px-3 py-2 text-left text-sm text-gray-900 hover:bg-gray-50"
                            onClick={() => {
                              setClient(option)
                              setClientQuery('')
                              setClientOptions([])
                            }}
                          >
                            {option.name}
                            {option.email ? ` · ${option.email}` : ''}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}
              <p id="invite-client-help" className="mt-1 text-xs text-gray-700">
                {t('inviteDrawer.clientHelp')}
              </p>
            </div>

            <div>
              <Label htmlFor="invite-ttl">{t('inviteDrawer.ttlLabel')}</Label>
              <select
                id="invite-ttl"
                value={ttlDays}
                onChange={(event) => setTtlDays(Number(event.target.value))}
                className="mt-1 block w-full rounded-md border border-input bg-white px-3 py-2 text-sm text-gray-900"
              >
                {TTL_OPTIONS.map((days) => (
                  <option key={days} value={days}>
                    {t('inviteDrawer.ttlDays', { days })}
                  </option>
                ))}
              </select>
            </div>

            {failed && (
              <p className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-gray-900">
                {t('inviteDrawer.failed')}
              </p>
            )}

            <Button type="submit" disabled={sending} className="w-full">
              {sending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                  {t('inviteDrawer.submitting')}
                </>
              ) : (
                t('inviteDrawer.submit')
              )}
            </Button>
          </form>
        )}
      </aside>
    </div>
  )
}

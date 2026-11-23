'use client'

/**
 * Envios tab of `/admin/trip-reminder` (#1233, BR-COMUNICACAO-024 item 9).
 *
 * - "Enviar teste para mim": one button per piece and reminder channel, in the order the sender
 *   tries the channels. The confirmation of the number exists only on a phone channel (`canTest`).
 *   The result is the Edge Function's `{ ok, channel, error_code? }`, shown in the cell, the
 *   failure code included; the log below reloads, since the function records the test.
 * - The log: `drive.cms_get_message_sends`, newest first, a phone shown by its last 4 digits only.
 */

import { useCallback, useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { CELL, DIM, FilterChip, HEAD_SOLO } from '@/components/ui/dense-table'
import { UNKNOWN_VALUE } from '@/lib/format/unknown'
import {
  SENDS_LIMIT_MAX,
  TEMPLATE_PIECES,
  canTest,
  isTestChannel,
  reminderChannels,
  type MessageSend,
  type TemplatePiece,
  type TestSendResult,
  type TripAdminError,
  type TripSwitch,
} from '@/lib/trip-reminder/settings'
import { errorText, formatInstant } from './format'

type SendsLoad =
  | { state: 'loading' }
  | { state: 'error'; error: TripAdminError | null }
  | { state: 'ready'; sends: MessageSend[] }

export function MessageSends({ switches }: { switches: TripSwitch[] }) {
  const t = useTranslations('TripReminder')
  const channels = reminderChannels(switches).filter((c) => isTestChannel(c.name))
  const [filter, setFilter] = useState<string | null>(null)
  const [load, setLoad] = useState<SendsLoad>({ state: 'loading' })

  const channelName = (name: string) => (t.has(`channels.${name}`) ? t(`channels.${name}`) : name)

  const fetchSends = useCallback(async () => {
    try {
      const query = new URLSearchParams({ limit: String(SENDS_LIMIT_MAX) })
      if (filter) query.set('channel', filter)
      const response = await fetch(`/api/admin/trip-reminder/sends?${query}`, { cache: 'no-store' })
      const envelope = await response.json().catch(() => null)
      if (!response.ok) {
        setLoad({ state: 'error', error: envelope?.error ?? null })
        return
      }
      setLoad({ state: 'ready', sends: Array.isArray(envelope?.sends) ? envelope.sends : [] })
    } catch {
      setLoad({ state: 'error', error: null })
    }
  }, [filter])

  useEffect(() => {
    void fetchSends()
  }, [fetchSends])

  return (
    <div className="space-y-10">
      <section aria-labelledby="trip-test">
        <h2 id="trip-test" className="text-lg font-bold text-gray-900 dark:text-gray-100">
          {t('test.heading')}
        </h2>
        <p className={`mb-3 text-sm ${DIM}`}>{t('test.intro')}</p>
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className={HEAD_SOLO}>{t('sends.piece')}</th>
                {channels.map((c) => (
                  <th key={c.name} className={HEAD_SOLO}>
                    {channelName(c.name)}
                    {!c.is_on ? <span className="ml-1 font-normal normal-case tracking-normal">({t('test.channel_off')})</span> : null}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {TEMPLATE_PIECES.map((piece) => (
                <tr key={piece} className="border-t border-gray-100 dark:border-gray-800">
                  <th scope="row" className={`${CELL} whitespace-nowrap text-left font-semibold`}>
                    {t(`pieces.${piece}`)}
                  </th>
                  {channels.map((c) => (
                    <td key={c.name} className={`${CELL} align-top`}>
                      {canTest(piece, c.kind) ? (
                        <TestButton piece={piece} channel={c.name} label={t('test.aria', { piece: t(`pieces.${piece}`), channel: channelName(c.name) })} onSent={fetchSends} />
                      ) : (
                        <span className={`text-xs ${DIM}`}>{t('test.not_applicable')}</span>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-labelledby="trip-sends">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 id="trip-sends" className="text-lg font-bold text-gray-900 dark:text-gray-100">
            {t('sends.heading')}
          </h2>
          <Button variant="outline" size="sm" onClick={() => void fetchSends()}>
            {t('sends.refresh')}
          </Button>
        </div>
        <p className={`mb-3 text-sm ${DIM}`}>{t('sends.intro')}</p>
        <div className="mb-3 flex flex-wrap gap-2">
          <FilterChip active={filter === null} onClick={() => setFilter(null)}>
            {t('sends.all')}
          </FilterChip>
          {channels.map((c) => (
            <FilterChip key={c.name} active={filter === c.name} onClick={() => setFilter(c.name)}>
              {channelName(c.name)}
            </FilterChip>
          ))}
        </div>

        {load.state === 'loading' ? <p className={`text-sm ${DIM}`}>{t('loading')}</p> : null}
        {load.state === 'error' ? (
          <p role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            {t('load_error')} {errorText(t, load.error)}
          </p>
        ) : null}
        {load.state === 'ready' && load.sends.length === 0 ? <p className={`text-sm ${DIM}`}>{t('sends.empty')}</p> : null}
        {load.state === 'ready' && load.sends.length > 0 ? (
          <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th className={HEAD_SOLO}>{t('sends.when')}</th>
                  <th className={HEAD_SOLO}>{t('sends.piece')}</th>
                  <th className={HEAD_SOLO}>{t('sends.channel')}</th>
                  <th className={HEAD_SOLO}>{t('sends.outcome')}</th>
                  <th className={HEAD_SOLO}>{t('sends.reason')}</th>
                  <th className={HEAD_SOLO}>{t('sends.phone')}</th>
                  <th className={HEAD_SOLO}>{t('sends.updated')}</th>
                </tr>
              </thead>
              <tbody>
                {load.sends.map((send) => (
                  <tr key={send.id} className="border-t border-gray-100 dark:border-gray-800">
                    <td className={`${CELL} whitespace-nowrap`}>{formatInstant(send.created_at)}</td>
                    <td className={CELL}>{t.has(`pieces.${send.piece}`) ? t(`pieces.${send.piece}`) : send.piece}</td>
                    <td className={CELL}>{channelName(send.channel)}</td>
                    <td className={CELL}>
                      <span
                        className={
                          send.outcome === 'failed'
                            ? 'font-semibold text-red-700 dark:text-red-400'
                            : send.outcome === 'delivered'
                              ? 'font-semibold text-green-800 dark:text-green-300'
                              : 'text-gray-800 dark:text-gray-200'
                        }>
                        {t.has(`sends.outcomes.${send.outcome}`) ? t(`sends.outcomes.${send.outcome}`) : send.outcome}
                      </span>
                    </td>
                    <td className={`${CELL} max-w-[20rem] break-words font-mono text-xs`}>{send.reason ?? UNKNOWN_VALUE}</td>
                    <td className={`${CELL} whitespace-nowrap tabular-nums`}>
                      {send.phone_last4 ? t('sends.phone_last4', { last4: send.phone_last4 }) : UNKNOWN_VALUE}
                    </td>
                    <td className={`${CELL} whitespace-nowrap ${DIM}`}>{formatInstant(send.updated_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>
    </div>
  )
}

function TestButton({
  piece,
  channel,
  label,
  onSent,
}: {
  piece: TemplatePiece
  channel: string
  label: string
  onSent: () => Promise<void>
}) {
  const t = useTranslations('TripReminder')
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState<TestSendResult | null>(null)

  const send = async () => {
    setSending(true)
    setResult(null)
    try {
      const response = await fetch('/api/admin/trip-reminder/test-send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ piece, channel }),
      })
      const envelope = await response.json().catch(() => null)
      if (envelope && typeof envelope.ok === 'boolean') {
        setResult({ ok: envelope.ok, channel, error_code: envelope.error_code })
      } else {
        setResult({ ok: false, channel, error_code: envelope?.error?.code ?? `http_${response.status}` })
      }
      await onSent()
    } catch {
      setResult({ ok: false, channel, error_code: 'network' })
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <Button variant="outline" size="sm" disabled={sending} aria-label={label} onClick={() => void send()}>
        {sending ? t('test.sending') : t('test.send')}
      </Button>
      {result ? (
        result.ok ? (
          <span role="status" className="text-xs font-semibold text-green-700 dark:text-green-400">
            {t('test.ok')}
          </span>
        ) : (
          <span role="alert" className="font-mono text-xs text-red-700 dark:text-red-400">
            {t('test.failed', { code: result.error_code ?? 'unknown' })}
          </span>
        )
      ) : null}
    </div>
  )
}

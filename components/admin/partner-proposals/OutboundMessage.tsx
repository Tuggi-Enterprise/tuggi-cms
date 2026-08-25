'use client'

/**
 * What the Tuggi writes to the partner — §5 of the spec, rendered for the operator to send.
 *
 * WHY IT IS NOT SENT FROM HERE, stated where the decision lives: `send-transactional` carries
 * no authorization of its own until #346, and the four texts below are not the invite — they
 * would be four new templates on a function that is still reachable without a secret. The
 * copy is the design's, unchanged; the delivery is the operator's, by e-mail or WhatsApp,
 * with `Copiar mensagem`. Registered in #341 as what waits for #346.
 *
 * DS-COPY-017 IS WHAT THE SHAPE OBEYS: every text names the class of what was missing by its
 * OBJECT — document, address, story — never by the internal gate number; says what would
 * serve; says coming back is possible; and states what does NOT change only where that is
 * true. Nothing here says a deadline, says "aprovado", or claims the Tuggi verified, audited
 * or certified anybody.
 *
 * AND GATE 3 HAS NO TEMPLATE, on purpose. BR-B2B-011 item 4 says to communicate what was
 * missing and item 6 forbids describing gate 3. A generic text would describe the gate by
 * euphemism and take from the person who knows the truth the chance to tell it — so the panel
 * shows why there is nothing to send and tells them to write it by hand.
 */

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import type { RegularityReport } from '@/lib/partner-form/regularity'
import { FIELD } from './surface'

/**
 * THE MESSAGE IS NOT A CARD OF ITS OWN, and stopped being one on 2026-08-25.
 *
 * It used to draw the same glass panel as the block that chooses it, with the same `Outbound
 * heading` inside — a card inside a card, and the heading twice. The picker owns the card and
 * the heading now; this is the panel that opens under the choice.
 */
const PANEL =
  'rounded-2xl border border-gray-200 bg-gray-50/60 p-4 dark:border-gray-800 dark:bg-gray-900/40'

export type OutboundKind = 'regularity' | 'gate1' | 'gate2' | 'gate3'

/**
 * `documents` was a fifth text and it is gone. It asked the partner to send the alvará and the
 * contrato social through a link, and there is no upload behind that link any anymore: the
 * papers are checked in person (operator, 2026-08-16). A message pointing at a page that
 * cannot receive a file is worse than no message.
 */

const GATE1_REASONS = ['not_located', 'already_there', 'not_permanent', 'not_open'] as const

interface OutboundMessageProps {
  kind: OutboundKind
  recipientName: string
  tradeName: string
  categoryLabel: string
  city: string
  report: RegularityReport
}

export function OutboundMessage({
  kind,
  recipientName,
  tradeName,
  categoryLabel,
  city,
  report,
}: OutboundMessageProps) {
  const t = useTranslations('PartnerProposals')
  const [gate1Reason, setGate1Reason] = useState<(typeof GATE1_REASONS)[number]>('not_located')
  const [copied, setCopied] = useState(false)

  if (kind === 'gate3') {
    return (
      <div className={`${PANEL} text-sm`}>
        <p className="font-semibold text-gray-900 dark:text-white">{t('outbound.gate3NoTemplate')}</p>
        <p className="mt-1 text-gray-800 dark:text-gray-300">{t('outbound.gate3Body')}</p>
      </div>
    )
  }

  const subject =
    kind === 'gate1' || kind === 'gate2'
      ? t(`outbound.${kind}.subject`, { tradeName })
      : t(`outbound.${kind}.subject`)

  const body = buildBody()
  const full = `${subject}\n\n${body}`

  function buildBody(): string {
    if (kind === 'regularity') {
      return t('outbound.regularity.body', {
        name: recipientName,
        tradeName,
        missing: report.missing
          .map((id) => t(`regularity.items.${id}`).toLowerCase())
          .join(t('regularity.itemSeparator')),
      })
    }

    if (kind === 'gate1') {
      return t('outbound.gate1.body', {
        name: recipientName,
        tradeName,
        reason: t(`outbound.gate1.reasons.${gate1Reason}`),
      })
    }

    return t('outbound.gate2.body', {
      name: recipientName,
      tradeName,
      category: categoryLabel,
      city,
    })
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(full)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }

  return (
    <div className={`${PANEL} text-sm`}>
      <p className="text-xs text-gray-700 dark:text-gray-400">{t('outbound.manualNotice')}</p>

      {kind === 'gate1' && (
        <div className="mt-3">
          <label htmlFor="gate1-reason" className="block text-sm font-medium text-gray-700 dark:text-gray-400">
            {t('discard.reasonLabel')}
          </label>
          <select
            id="gate1-reason"
            value={gate1Reason}
            onChange={(event) =>
              setGate1Reason(event.target.value as (typeof GATE1_REASONS)[number])
            }
            className={`mt-1 ${FIELD}`}
          >
            {GATE1_REASONS.map((reason) => (
              <option key={reason} value={reason}>
                {t(`outbound.gate1.reasons.${reason}`)}
              </option>
            ))}
          </select>
        </div>
      )}

      <p className="mt-3 text-xs uppercase tracking-wide text-gray-700 dark:text-gray-400">{t('outbound.subject')}</p>
      <p className="font-medium text-gray-900 dark:text-white">{subject}</p>

      {/* No `max-height` with `overflow-hidden` anywhere above this: a long message has to
          be readable whole, and this repo has lost text to that pair before. */}
      <pre className="mt-3 whitespace-pre-wrap break-words font-sans text-gray-900 dark:text-white">{body}</pre>

      {(kind === 'gate1' || kind === 'gate2') && (
        <>
          <p className="mt-3 font-medium text-gray-900 dark:text-white">{t('outbound.partnershipStands')}</p>
          <p className="mt-1 text-xs text-gray-700 dark:text-gray-400">{t('outbound.partnershipStandsHint')}</p>
        </>
      )}

      <div className="mt-3 flex items-center gap-3">
        <Button type="button" size="sm" variant="outline" onClick={copy}>
          {t('outbound.copy')}
        </Button>
        <span role="status" className="text-sm font-medium text-primary-800 dark:text-tuggi-blue">
          {copied ? t('outbound.copied') : ''}
        </span>
      </div>
    </div>
  )
}

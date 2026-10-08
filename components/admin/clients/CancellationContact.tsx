'use client'

/**
 * The contact state of a portal cancellation (#913, BR-B2B-060 items 5 and 7), the same in the
 * list (`AdminCancellationsPageContent`) and in the client record (`PortalCancellations`): one
 * state in words, never only a color, and in Pendente the "Marcar que falamos" button on the line.
 *
 * One click, no confirmation (spec §5). The line changes at once; if the save fails it goes back
 * to the previous state and the screen's error strip says so. After a save the owner rereads the
 * source, which brings the operator's name.
 */

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { formatDate } from '@/lib/contract/snapshot'
import type { Cancellation } from '@/lib/clients/cancellations'

export function useContactToggle(
  setRows: (update: (rows: Cancellation[]) => Cancellation[]) => void,
  onError: (failed: boolean) => void,
  onSaved: () => void
) {
  const [busy, setBusy] = useState<string | null>(null)

  const toggle = async (row: Cancellation, mark: boolean) => {
    const replace = (next: Cancellation) => setRows((rows) => rows.map((r) => (r.feedbackId === next.feedbackId ? next : r)))
    setBusy(row.feedbackId)
    onError(false)
    replace(
      mark
        ? { ...row, contact: 'done', contactedAt: new Date().toISOString(), contactedBy: null }
        : { ...row, contact: 'pending', contactedAt: null, contactedBy: null }
    )
    try {
      const res = await fetch(`/api/admin/clients/cancellations/${row.feedbackId}/contacted`, { method: mark ? 'POST' : 'DELETE' })
      if (!res.ok) throw new Error(String(res.status))
      onSaved()
    } catch {
      replace(row)
      onError(true)
    } finally {
      setBusy(null)
    }
  }

  return { busy, toggle }
}

export function CancellationContact({
  row,
  busy,
  onToggle,
}: {
  row: Cancellation
  busy: boolean
  onToggle: (row: Cancellation, mark: boolean) => void
}) {
  const t = useTranslations('Clients.cancellations')
  if (row.contact === 'declined') return <span className="text-gray-600">{t('contact.declined')}</span>
  if (row.contact === 'pending') {
    return (
      <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-semibold text-amber-800">{t('contact.pending')}</span>
        <button
          type="button"
          disabled={busy}
          onClick={() => onToggle(row, true)}
          className="rounded-md border border-gray-300 px-2 py-1 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          {t('markContacted')}
        </button>
      </span>
    )
  }
  const date = row.contactedAt ? formatDate(row.contactedAt) : ''
  return (
    <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
      <span className="text-gray-700">{row.contactedBy ? t('contact.doneBy', { date, name: row.contactedBy }) : t('contact.done', { date })}</span>
      <button
        type="button"
        disabled={busy}
        onClick={() => onToggle(row, false)}
        className="text-xs font-semibold text-tuggi-blue hover:underline disabled:opacity-50"
      >
        {t('undo')}
      </button>
    </span>
  )
}

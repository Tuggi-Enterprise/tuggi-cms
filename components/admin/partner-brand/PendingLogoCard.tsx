'use client'

/**
 * One partner logo waiting for the curator (#1257, BR-B2B-070 item 2): the logo on the air beside
 * the one sent, Approve, and Refuse with the reason the portal shows the partner. Same card as the
 * photo and text queue (`AdminPlaceChangesPageContent`). Used by the queue of /admin/partner-brand and
 * by the Marca tab of the client record.
 *
 * The bucket only takes PNG up to 2 MB; square and at least 512 × 512 px is the curator's check, so
 * the card reads the real size on load and says when it falls short. It never blocks the decision.
 * `409 logo_not_pending` (TGB71): another file arrived or someone decided first; the card says so and
 * the host reloads.
 */

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { LOGO_REASON_MAX, type PartnerBrandError } from '@/lib/partner-brand/brand'
import { usePartnerBrandErrorText } from './usePartnerBrandErrorText'

/** BR-B2B-070 item 2: the smallest side the logo may have. */
export const LOGO_MIN_SIDE_PX = 512

interface PendingLogoCardProps {
  clientId: string
  logoPath: string
  logoUrl: string | null
  approvedLogoUrl: string | null
  /** The partner name, in the queue; the record already says whose logo it is. */
  title?: React.ReactNode
  submittedAt?: string | null
  /** After a decision, or after the server said the file is not pending any more. */
  onDecided: (outcome: 'approved' | 'rejected' | 'stale') => void
}

export function PendingLogoCard({ clientId, logoPath, logoUrl, approvedLogoUrl, title, submittedAt, onDecided }: PendingLogoCardProps) {
  const t = useTranslations('PartnerBrand.logo')
  const errorText = usePartnerBrandErrorText()
  const [refusing, setRefusing] = useState(false)
  const [reason, setReason] = useState('')
  const [reasonMissing, setReasonMissing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [size, setSize] = useState<{ width: number; height: number } | null>(null)
  const reasonId = `logo-reason-${clientId}`

  const decide = async (approve: boolean) => {
    if (!approve && !reason.trim()) return setReasonMissing(true)
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/partner-brand/logos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: clientId, logo_path: logoPath, approve, reason: approve ? null : reason.trim() }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        const e = data.error as PartnerBrandError | undefined
        setError(errorText(e))
        if (e?.code === 'logo_not_pending') onDecided('stale')
        return
      }
      onDecided(approve ? 'approved' : 'rejected')
    } catch {
      setError(errorText({ code: 'write_failed' }))
    } finally {
      setBusy(false)
    }
  }

  const short = size !== null && (size.width !== size.height || Math.min(size.width, size.height) < LOGO_MIN_SIDE_PX)

  return (
    <li data-logo={clientId} className="list-none rounded-lg border border-gray-200 bg-white p-4">
      {(title || submittedAt) && (
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          {title ? <h3 className="text-base font-semibold text-gray-900">{title}</h3> : <span />}
          {submittedAt && <span className="text-xs text-gray-500">{t('submittedAt', { date: new Date(submittedAt).toLocaleString() })}</span>}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Side title={t('live')}>
          <Logo src={approvedLogoUrl} alt={t('live')} empty={t('noneLive')} />
        </Side>
        <Side title={t('sent')} accent>
          <Logo src={logoUrl} alt={t('sent')} empty={t('unsigned')} onSize={setSize} />
          {size && (
            <p className={`text-xs ${short ? 'text-amber-800' : 'text-gray-600'}`}>
              {short
                ? t('sizeShort', { width: size.width, height: size.height, min: LOGO_MIN_SIDE_PX })
                : t('size', { width: size.width, height: size.height })}
            </p>
          )}
        </Side>
      </div>
      <p className="mt-3 text-xs text-gray-500">{t('checkHint', { min: LOGO_MIN_SIDE_PX })}</p>

      {refusing && (
        <div className="mt-4 flex flex-col gap-1.5">
          <label htmlFor={reasonId} className="text-sm font-semibold text-gray-800">
            {t('reasonLabel')}
          </label>
          <textarea
            id={reasonId}
            autoFocus
            rows={2}
            maxLength={LOGO_REASON_MAX}
            value={reason}
            placeholder={t('reasonPlaceholder')}
            aria-invalid={reasonMissing || undefined}
            aria-describedby={reasonMissing ? `${reasonId}-error` : undefined}
            onChange={(e) => {
              setReason(e.target.value)
              setReasonMissing(false)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setRefusing(false)
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void decide(false)
            }}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-tuggi-blue/40 aria-[invalid=true]:border-red-500"
          />
          {reasonMissing && (
            <span id={`${reasonId}-error`} className="text-xs text-red-700">
              {errorText({ code: 'reason_required' })}
            </span>
          )}
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {refusing ? (
          <>
            <button
              type="button"
              disabled={busy}
              onClick={() => void decide(false)}
              className="rounded-md bg-red-700 px-3 py-2 text-sm font-semibold text-white hover:bg-red-800 disabled:opacity-50">
              {t('refuseConfirm')}
            </button>
            <button type="button" disabled={busy} onClick={() => setRefusing(false)} className="rounded-md px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-100">
              {t('cancel')}
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              disabled={busy}
              aria-busy={busy || undefined}
              onClick={() => void decide(true)}
              className="rounded-md bg-green-700 px-3 py-2 text-sm font-semibold text-white hover:bg-green-800 disabled:opacity-50">
              {busy ? t('approving') : t('approve')}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setRefusing(true)}
              className="rounded-md border border-gray-300 px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50">
              {t('refuse')}
            </button>
          </>
        )}
        {error && (
          <span role="alert" className="text-sm text-red-700">
            {error}
          </span>
        )}
      </div>
    </li>
  )
}

function Side({ title, accent, children }: { title: string; accent?: boolean; children: React.ReactNode }) {
  return (
    <section className={`flex flex-col gap-2 rounded-md p-3 ${accent ? 'bg-blue-50/60 ring-1 ring-blue-100' : 'bg-gray-50'}`}>
      <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-600">{title}</h4>
      {children}
    </section>
  )
}

/** The logo on a white plate, whole (`contain`), as the app shows it. */
export function Logo({
  src,
  alt,
  empty,
  onSize,
}: {
  src: string | null
  alt: string
  empty: string
  onSize?: (size: { width: number; height: number }) => void
}) {
  if (!src) {
    return <span className="flex h-32 w-32 items-center justify-center rounded border border-dashed border-gray-300 bg-white p-2 text-center text-xs text-gray-500">{empty}</span>
  }
  return (
    // Signed URL of a private bucket: the image optimizer serves none of it.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      onLoad={(e) => onSize?.({ width: e.currentTarget.naturalWidth, height: e.currentTarget.naturalHeight })}
      className="h-32 w-32 rounded border border-gray-200 bg-white object-contain p-2"
    />
  )
}

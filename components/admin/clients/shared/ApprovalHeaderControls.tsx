'use client'

import { useState } from 'react'
import { CheckCircle, XCircle, Clock, AlertTriangle, Loader2 } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { cn } from '@/lib/utils'
import type { ClientStatus } from '@/types/clients'

interface ApprovalHeaderControlsProps {
  clientId: string
  status: ClientStatus
  /**
   * Email of the client being approved. The approve endpoint uses this
   * to create the linked CMS user — admin doesn't re-type it.
   */
  clientEmail?: string | null
  /**
   * Display name of the client (Legal name / company contact). Used as
   * the new CMS user's full_name.
   */
  clientName?: string | null
  canEdit: boolean
  onChanged: (next: { status: ClientStatus; rejection_reason?: string; approved_at?: string }) => void
}

/**
 * Status badge + inline approve/reject buttons rendered in the
 * ClientEditorModal header — same place where POIDetailsModal shows
 * its HOMOLOGADO / EM ANÁLISE state.
 *
 * Approve no longer prompts the admin for email/name — those already
 * exist on the client record (clientEmail/clientName props). The popover
 * just shows a preview of what's about to be created and a Confirm
 * button. If either field is missing on the client, the popover steers
 * the admin back to the Perfil tab instead of asking for ad-hoc input.
 *
 * Reject uses a single rejection_reason input (unchanged).
 */
export function ApprovalHeaderControls({
  clientId,
  status,
  clientEmail,
  clientName,
  canEdit,
  onChanged,
}: ApprovalHeaderControlsProps) {
  const t = useTranslations('Clients.approval')
  const [openAction, setOpenAction] = useState<null | 'approve' | 'reject'>(null)
  const [rejectionReason, setRejectionReason] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const trimmedEmail = (clientEmail ?? '').trim()
  const trimmedName = (clientName ?? '').trim()
  const hasClientData = trimmedEmail.length > 0 && trimmedName.length > 0

  const badge = (() => {
    switch (status) {
      case 'approved':
        return { label: t('status.approved'), icon: CheckCircle, className: 'bg-green-50 border-green-200 text-green-700' }
      case 'rejected':
        return { label: t('status.rejected'), icon: XCircle, className: 'bg-red-50 border-red-200 text-red-600' }
      default:
        return { label: t('status.pending'), icon: Clock, className: 'bg-orange-50 border-orange-200 text-orange-700' }
    }
  })()

  const handleApprove = async () => {
    if (!hasClientData) {
      setError(t('approveMissingClientData'))
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/clients/${clientId}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cmsUserEmail: trimmedEmail, cmsUserName: trimmedName }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? t('errors.approveFailed'))
        return
      }
      onChanged({ status: 'approved', approved_at: new Date().toISOString() })
      setOpenAction(null)
    } catch {
      setError(t('errors.networkApprove'))
    } finally {
      setSubmitting(false)
    }
  }

  const handleReject = async () => {
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/clients/${clientId}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rejectionReason: rejectionReason.trim() || 'No reason provided' }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? t('errors.rejectFailed'))
        return
      }
      onChanged({ status: 'rejected', rejection_reason: rejectionReason.trim() })
      setOpenAction(null)
    } catch {
      setError(t('errors.networkReject'))
    } finally {
      setSubmitting(false)
    }
  }

  const Icon = badge.icon
  return (
    // `flex-wrap` because on a phone this row is the whole width of the screen and the badge
    // plus two acts is wider than 390px in Portuguese. `min-h-[44px]` on the acts: they are
    // `Aprovar` and `Recusar` on a client record, and a 26px target for a decision that sends
    // an e-mail is the shape that gets tapped by accident.
    <div className="relative flex flex-wrap items-center gap-2">
      <span className={cn('inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest border', badge.className)}>
        <Icon className="w-3.5 h-3.5" />
        {badge.label}
      </span>

      {status === 'pending' && canEdit && (
        <>
          <button
            type="button"
            onClick={() => setOpenAction('approve')}
            disabled={submitting}
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl bg-green-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-green-700 disabled:opacity-50 transition-all lg:min-h-0"
          >
            <CheckCircle className="w-3.5 h-3.5" /> {t('approve')}
          </button>
          <button
            type="button"
            onClick={() => setOpenAction('reject')}
            disabled={submitting}
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-bold text-red-700 hover:bg-red-100 disabled:opacity-50 transition-all lg:min-h-0"
          >
            <XCircle className="w-3.5 h-3.5" /> {t('reject')}
          </button>
        </>
      )}

      {openAction && (
        // Popover anchored to the right edge of the header, clamped to
        // viewport with margin so it never bleeds past the drawer on
        // smaller laptops.
        <div
          className="absolute right-0 top-full mt-2 z-50 w-[min(24rem,calc(100vw-2rem))] max-w-sm rounded-2xl border border-gray-200 bg-white p-5 shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-bold text-gray-900">
              {openAction === 'approve' ? t('approveTitle') : t('rejectTitle')}
            </h3>
            <button
              type="button"
              onClick={() => { setOpenAction(null); setError(null) }}
              className="text-gray-400 hover:text-gray-700"
            >
              <XCircle className="w-4 h-4" />
            </button>
          </div>

          {error && (
            <div className="mb-3 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              <AlertTriangle className="w-3.5 h-3.5" /> {error}
            </div>
          )}

          {openAction === 'approve' ? (
            <div className="space-y-3">
              {hasClientData ? (
                <>
                  <p className="text-xs text-gray-500 leading-relaxed">{t('approveConfirmIntro')}</p>
                  <div className="rounded-xl bg-gray-50 border border-gray-200 p-3 space-y-2">
                    <div>
                      <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">{t('cmsUserEmailLabel')}</p>
                      <p className="text-sm font-semibold text-gray-900 break-all">{trimmedEmail}</p>
                    </div>
                    <div>
                      <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">{t('cmsUserNameLabel')}</p>
                      <p className="text-sm font-semibold text-gray-900">{trimmedName}</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={handleApprove}
                    disabled={submitting}
                    className="w-full py-2.5 bg-green-600 text-white font-bold rounded-xl hover:bg-green-700 disabled:opacity-50 transition-all flex items-center justify-center gap-2 text-sm"
                  >
                    {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
                    {t('confirmApprove')}
                  </button>
                </>
              ) : (
                <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                  <p>{t('approveMissingClientData')}</p>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              <div>
                <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">
                  {t('rejectionReason')}
                </label>
                <textarea
                  rows={3}
                  value={rejectionReason}
                  onChange={(e) => setRejectionReason(e.target.value)}
                  placeholder={t('rejectionReasonPlaceholder')}
                  className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-sm font-semibold outline-none focus:ring-2 focus:ring-tuggi-blue/30 resize-none"
                />
              </div>
              <button
                type="button"
                onClick={handleReject}
                disabled={submitting}
                className="w-full py-2.5 bg-red-600 text-white font-bold rounded-xl hover:bg-red-700 disabled:opacity-50 transition-all flex items-center justify-center gap-2 text-sm"
              >
                {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
                {t('confirmReject')}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

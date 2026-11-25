'use client'

/**
 * The refusal of a user route version (#1106, BR-ROTA-006 item 3): the reason is required, up to
 * 1,000 characters, and the author reads it as written. The button stays disabled while the reason
 * is blank, and `parseRejectReason` is the same check the API route runs before the RPC.
 *
 * Also the refusal of a partner's place suggestion (#1261, BR-B2B-073 item 3.b, the same 1,000):
 * `labels` says it is the partner who reads, and `fieldId` keeps one id per card.
 */

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { CharCount } from '@/components/ui/CharCount'
import { REJECT_REASON_MAX, parseRejectReason } from '@/lib/routes/route-revisions'

export interface RejectFormLabels {
  label: string
  placeholder: string
  submit: string
  reason_required: string
}

export interface RejectFormProps {
  busy: boolean
  onReject: (reason: string) => void
  initialReason?: string
  /** The id of the field; unique per form on the page. */
  fieldId?: string
  /** The words of another reader than the route author. */
  labels?: RejectFormLabels
}

export function RejectForm({ busy, onReject, initialReason = '', fieldId = 'route-review-reason', labels }: RejectFormProps) {
  const t = useTranslations('Pages.RouteReview')
  const [reason, setReason] = useState(initialReason)
  const [touched, setTouched] = useState(false)
  const parsed = parseRejectReason(reason)
  const errorId = `${fieldId}-error`
  const errorText = !parsed.ok ? (parsed.error === 'reason_required' && labels ? labels.reason_required : t(parsed.error)) : ''

  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault()
        setTouched(true)
        if (parsed.ok) onReject(parsed.reason)
      }}
    >
      <label htmlFor={fieldId} className="block text-xs font-semibold text-gray-700">
        {labels?.label ?? t('reject_label')}
      </label>
      <textarea
        id={fieldId}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        onBlur={() => setTouched(true)}
        rows={4}
        maxLength={REJECT_REASON_MAX}
        required
        aria-invalid={touched && !parsed.ok}
        aria-describedby={errorId}
        placeholder={labels?.placeholder ?? t('reject_placeholder')}
        className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-tuggi-blue focus:outline-none focus:ring-2 focus:ring-tuggi-blue/40"
      />
      <div className="flex items-center justify-between gap-2">
        <span id={errorId} role={touched && !parsed.ok ? 'alert' : undefined} className="text-xs text-red-700">
          {touched ? errorText : ''}
        </span>
        <CharCount value={reason} max={REJECT_REASON_MAX} />
      </div>
      <Button type="submit" variant="destructive" size="sm" disabled={busy || !parsed.ok}>
        {busy ? t('rejecting') : (labels?.submit ?? t('reject'))}
      </Button>
    </form>
  )
}

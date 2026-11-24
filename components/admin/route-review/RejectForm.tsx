'use client'

/**
 * The refusal of a user route version (#1106, BR-ROTA-006 item 3): the reason is required, up to
 * 1,000 characters, and the author reads it as written. The button stays disabled while the reason
 * is blank, and `parseRejectReason` is the same check the API route runs before the RPC.
 */

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { CharCount } from '@/components/ui/CharCount'
import { REJECT_REASON_MAX, parseRejectReason } from '@/lib/routes/route-revisions'

export interface RejectFormProps {
  busy: boolean
  onReject: (reason: string) => void
  initialReason?: string
}

export function RejectForm({ busy, onReject, initialReason = '' }: RejectFormProps) {
  const t = useTranslations('Pages.RouteReview')
  const [reason, setReason] = useState(initialReason)
  const [touched, setTouched] = useState(false)
  const parsed = parseRejectReason(reason)

  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault()
        setTouched(true)
        if (parsed.ok) onReject(parsed.reason)
      }}
    >
      <label htmlFor="route-review-reason" className="block text-xs font-semibold text-gray-700">
        {t('reject_label')}
      </label>
      <textarea
        id="route-review-reason"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        onBlur={() => setTouched(true)}
        rows={4}
        maxLength={REJECT_REASON_MAX}
        required
        aria-invalid={touched && !parsed.ok}
        aria-describedby="route-review-reason-error"
        placeholder={t('reject_placeholder')}
        className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-tuggi-blue focus:outline-none focus:ring-2 focus:ring-tuggi-blue/40"
      />
      <div className="flex items-center justify-between gap-2">
        <span id="route-review-reason-error" role={touched && !parsed.ok ? 'alert' : undefined} className="text-xs text-red-700">
          {touched && !parsed.ok ? t(parsed.error) : ''}
        </span>
        <CharCount value={reason} max={REJECT_REASON_MAX} />
      </div>
      <Button type="submit" variant="destructive" size="sm" disabled={busy || !parsed.ok}>
        {busy ? t('rejecting') : t('reject')}
      </Button>
    </form>
  )
}

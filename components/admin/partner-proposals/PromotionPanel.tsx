'use client'

/**
 * The promotion panel — DS-COMPONENTE-018.
 *
 * In line and not a modal: the operator has to keep seeing the proposal while deciding.
 *
 * THE THREE RULES ARE `buildPromotionPlan`'s, NOT THIS FILE'S. This renders a plan and sends
 * back the list of columns the operator ticked; the same module rebuilds the plan on the
 * server and refuses anything that was not ticked. A divergent field is born UNCHECKED and
 * stays that way unless somebody says otherwise, one field at a time — the record was written
 * by the team, the proposal by somebody outside, and an external form does not get to erase
 * internal work in silence.
 *
 * THERE IS NO E-MAIL COLLISION TO RESOLVE. `core.clients.email` stopped being unique
 * (operator, 2026-08-16) because one owner has several places and each place is its own
 * record — so the panel that made the operator choose between "tie it to that client" and
 * "use another address" went with the constraint that created it. What keeps a company from
 * being registered twice is the CNPJ, refused at the form.
 *
 * The confirmation is ONE act and names the effect with the count and the target — never
 * `Confirmar`. Two acts are the rule for what binds legally (DS-COMPONENTE-017); this is
 * internal operation, and the protection against the expensive mistake is already the
 * per-field tick above.
 */

import { useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { AlertTriangle, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  PROMOTION_NEVER_WRITES,
  buildPromotionPlan,
  summarizePromotion,
} from '@/lib/partner-form/promotion'
import type { ProposalDetail } from './types'

type Failure = 'write' | 'not_promotable' | 'network' | 'nothing' | null

interface PromotionPanelProps {
  detail: ProposalDetail
  /** The Portuguese label of the chosen category, read from `PartnerForm.categories.<id>`. */
  categoryLabel: string
  onClose: () => void
  onPromoted: () => void
}

export function PromotionPanel({ detail, categoryLabel, onClose, onPromoted }: PromotionPanelProps) {
  const t = useTranslations('PartnerProposals')

  const [industry, setIndustry] = useState(categoryLabel)
  const [approved, setApproved] = useState<string[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [failure, setFailure] = useState<Failure>(null)

  const client = detail.client

  const plan = useMemo(
    () => buildPromotionPlan(detail.submission.answers, client, { categoryLabel: industry }),
    [detail.submission.answers, client, industry]
  )

  const summary = summarizePromotion(plan, { approved })

  const targetName =
    client?.name ?? detail.submission.answers.trade_name ?? t('review.noTradeName')

  function toggle(column: string) {
    setApproved((current) =>
      current.indexOf(column) >= 0
        ? current.filter((value) => value !== column)
        : current.concat(column)
    )
  }

  async function promote() {
    if (summary.total === 0) {
      setFailure('nothing')
      return
    }
    setSubmitting(true)
    setFailure(null)

    try {
      const response = await fetch(
        `/api/admin/partner-proposals/${detail.submission.id}/promote`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ approved, industry }),
        }
      )

      if (response.ok) {
        onPromoted()
        return
      }

      const payload = await response.json().catch(() => ({}))
      setFailure(payload?.error === 'not_promotable' ? 'not_promotable' : 'write')
    } catch {
      // The request never came back with an answer. The write is not idempotent, so this
      // case never gets a "try again" button — it gets the instruction to go and look.
      setFailure('network')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <section
      aria-labelledby="promotion-heading"
      className="rounded-md border-2 border-primary/50 bg-white p-4"
    >
      <h2 id="promotion-heading" className="text-base font-semibold text-gray-900">
        {plan.creating ? t('promotion.createTitle') : t('promotion.updateTitle', { name: targetName })}
      </h2>

      <table className="mt-4 w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-gray-300 text-left text-xs uppercase tracking-wide text-gray-700">
            <th scope="col" className="px-2 py-2">{t('promotion.columns.field')}</th>
            <th scope="col" className="px-2 py-2">{t('promotion.columns.current')}</th>
            <th scope="col" className="px-2 py-2">{t('promotion.columns.proposed')}</th>
            <th scope="col" className="px-2 py-2" />
          </tr>
        </thead>
        <tbody>
          {plan.entries.map((entry) => (
            <tr key={entry.column} className="border-b border-gray-100 align-top">
              <td className="px-2 py-2 font-medium text-gray-900">
                {t(`promotion.fields.${entry.column}`)}
              </td>
              <td className="px-2 py-2 text-gray-700">
                {entry.current ?? <em className="not-italic text-gray-600">{t('promotion.emptyValue')}</em>}
              </td>
              <td className="px-2 py-2 text-gray-900">
                {entry.editable ? (
                  <>
                    <Label htmlFor="promotion-industry" className="sr-only">
                      {t(`promotion.fields.${entry.column}`)}
                    </Label>
                    <Input
                      id="promotion-industry"
                      value={industry}
                      onChange={(event) => setIndustry(event.target.value)}
                      aria-describedby="promotion-industry-hint"
                    />
                    <span id="promotion-industry-hint" className="mt-1 block text-xs text-gray-700">
                      {t('promotion.industryHint')}
                    </span>
                  </>
                ) : (
                  entry.proposed
                )}
              </td>
              <td className="px-2 py-2">
                {entry.decision === 'conflict' ? (
                  <label className="flex items-center gap-2 text-xs font-medium text-gray-900">
                    <Checkbox
                      checked={approved.indexOf(entry.column) >= 0}
                      onCheckedChange={() => toggle(entry.column)}
                      aria-label={`${t('promotion.replace')} — ${t(`promotion.fields.${entry.column}`)}`}
                    />
                    <span>{t('promotion.replace')}</span>
                  </label>
                ) : (
                  <span className="text-xs text-gray-700">{t('promotion.fillBadge')}</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {plan.unchanged.length > 0 && (
        <p className="mt-2 text-xs text-gray-700">
          {t('promotion.unchanged', { count: plan.unchanged.length })}
        </p>
      )}

      {summary.kept > 0 && (
        <p className="mt-1 text-xs text-gray-800">{t('promotion.keptNotice', { count: summary.kept })}</p>
      )}

      <div className="mt-4 rounded-md border border-gray-200 bg-gray-50 p-3 text-xs text-gray-800">
        <p className="font-semibold text-gray-900">{t('promotion.neverHeading')}</p>
        <p className="mt-1 font-mono">{PROMOTION_NEVER_WRITES.join(', ')}</p>
        <p className="mt-2">{t('promotion.neverBody')}</p>
      </div>

      <div className="mt-4 rounded-md border border-gray-300 p-3 text-sm">
        <p className="font-semibold text-gray-900">{t('promotion.reviewTitle')}</p>
        <p className="mt-1 text-gray-900">
          {summary.replaced > 0
            ? t('promotion.reviewBody', {
                total: summary.total,
                name: targetName,
                filled: summary.filled,
                replaced: summary.replaced,
              })
            : t('promotion.reviewNoReplacement', { total: summary.total, name: targetName })}
        </p>
      </div>

      {failure && (
        <div
          className="mt-3 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-gray-900"
          role="alert"
        >
          <p className="flex items-center gap-2 font-semibold">
            <AlertTriangle className="h-4 w-4" aria-hidden="true" />
            {failure === 'network' ? t('promotion.failedNetworkTitle') : t('promotion.failedTitle')}
          </p>
          <p className="mt-1">
            {failure === 'network' && t('promotion.failedNetworkBody')}
            {failure === 'not_promotable' && t('promotion.failedNotPromotable')}
            {failure === 'write' && t('promotion.failedNothingWritten')}
            {failure === 'nothing' && t('promotion.nothingToWrite')}
          </p>
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-3">
        <Button
          type="button"
          onClick={promote}
          disabled={submitting || summary.total === 0}
        >
          {submitting ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
              {t('promotion.committing')}
            </>
          ) : (
            t('promotion.commit', { count: summary.total, name: targetName })
          )}
        </Button>
        <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>
          {t('promotion.back')}
        </Button>
      </div>
    </section>
  )
}

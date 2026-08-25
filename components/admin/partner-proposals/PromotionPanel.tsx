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
 * THERE IS NO E-MAIL COLLISION TO RESOLVE. `partner.clients.email` stopped being unique
 * (operator, 2026-08-16) because one owner has several places and each place is its own
 * record — so the panel that made the operator choose between "tie it to that client" and
 * "use another address" went with the constraint that created it. What keeps a company from
 * being registered twice is the CNPJ — and since 2026-08-19 it is the DATABASE that refuses it,
 * `clients_tax_id_normalized_uk`, and not the public form. The form used to, and that refusal was
 * a public oracle of who is a client of the Tuggi in exchange for a guarantee it could not give:
 * read-then-insert is a race, and it missed the four other write paths into `partner.clients`.
 *
 * The confirmation is ONE act and names the effect with the count and the target — never
 * `Confirmar`. Two acts are the rule for what binds legally (DS-COMPONENTE-017); this is
 * internal operation, and the protection against the expensive mistake is already the
 * per-field tick above.
 *
 * ONLY THE DIVERGENCE IS A DECISION, and on 2026-08-25 the panel stopped pretending otherwise.
 *
 * It drew a four-column comparison table over EVERY column of the plan, and for the ordinary
 * case — a proposal with no client behind it — every one of those rows read `vazio` on one side
 * and `Estava vazio — vai ser preenchido` on the other, fifteen times. There was nothing to
 * decide on any of them: `resolvePromotionWrite` writes a `fill` with no act, by design. A
 * screen that asks for attention it has no use for is a step the operator learns to click
 * through, and the tick that DOES matter is on the same wall.
 *
 * So the table survives for `conflict` rows and nothing else. The fills are one sentence with
 * the count, and the list is one disclosure away for the operator who wants to read it before
 * an irreversible write. `Ramo` comes out of the table entirely: it is the one value this panel
 * lets somebody type, and a text input in the third cell of row five is where it went unnoticed.
 */

import { useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { AlertTriangle, ChevronDown, ChevronRight, Loader2 } from 'lucide-react'
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
import { CARD } from './surface'

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
  /** The fills, which are a count by default and a list for whoever asks. */
  const [fillsOpen, setFillsOpen] = useState(false)

  const client = detail.client

  const plan = useMemo(
    () => buildPromotionPlan(detail.submission.answers, client, { categoryLabel: industry }),
    [detail.submission.answers, client, industry]
  )

  const summary = summarizePromotion(plan, { approved })

  /**
   * The plan split by what it ASKS OF A PERSON. A `conflict` is a decision and gets a row with a
   * control; a `fill` is arithmetic and gets a count.
   *
   * Read off `decision` and never off `plan.creating`: a proposal promoted into an EXISTING
   * client whose record happens to be empty is all fills too, and it deserves the same screen as
   * a new one.
   *
   * THE EDITABLE COLUMN STAYS IN ITS LIST. It gets an input of its own above, because it is the
   * one value somebody types — but it is written like any other column, so taking it out of the
   * count made the panel say `14 campos vão ser preenchidos` above a button reading `Gravar 15
   * campos`. Two numbers for one write is worse than the input appearing twice.
   */
  const conflicts = plan.entries.filter((entry) => entry.decision === 'conflict')
  const fills = plan.entries.filter((entry) => entry.decision === 'fill')

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
      className={`${CARD} border-2 border-primary-800/40 p-6`}
    >
      <h2 id="promotion-heading" className="text-base font-semibold text-gray-900 dark:text-white">
        {plan.creating ? t('promotion.createTitle') : t('promotion.updateTitle', { name: targetName })}
      </h2>

      {/* THE ONE VALUE SOMEBODY TYPES, out of the table and into a field of its own. It was the
          third cell of a row in the middle of fifteen, wearing the same weight as fourteen
          read-only values, and it is the only thing on this panel a person can change. */}
      {plan.entries.some((entry) => entry.editable) && (
        <div className="mt-4 max-w-md">
          <Label htmlFor="promotion-industry" className="text-sm font-medium text-gray-900 dark:text-white">
            {t('promotion.industryLabel')}
          </Label>
          <Input
            id="promotion-industry"
            className="mt-1"
            value={industry}
            onChange={(event) => setIndustry(event.target.value)}
            aria-describedby="promotion-industry-hint"
          />
          <span id="promotion-industry-hint" className="mt-1 block text-xs text-gray-700 dark:text-gray-400">
            {t('promotion.industryHint')}
          </span>
        </div>
      )}

      {/* THE DECISION, and the only part of the plan that ever needed a table. A divergent field
          is born unchecked and stays that way unless somebody says so, one field at a time
          (DS-COMPONENTE-018).

          THREE COLUMNS DO NOT FIT A PHONE, and squeezing them is worse than scrolling them:
          `campo / atual / proposto` at 90px each turns every value into a column of single
          words, and this table is read to DECIDE which value is right. It scrolls inside its own
          box, so the page behind it never moves sideways. */}
      {conflicts.length > 0 && (
        <div className="mt-5">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
            {t('promotion.conflictsHeading')}
          </h3>
          <p className="mt-1 text-sm text-gray-800 dark:text-gray-300">{t('promotion.conflictsIntro')}</p>

          <div className="mt-3 -mx-2 overflow-x-auto px-2">
            <table className="w-full min-w-[34rem] border-collapse text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-left dark:border-gray-800 text-xs uppercase tracking-wide text-gray-700 dark:text-gray-400">
                  <th scope="col" className="px-2 py-2">{t('promotion.columns.field')}</th>
                  <th scope="col" className="px-2 py-2">{t('promotion.columns.current')}</th>
                  <th scope="col" className="px-2 py-2">{t('promotion.columns.proposed')}</th>
                  <th scope="col" className="px-2 py-2" />
                </tr>
              </thead>
              <tbody>
                {conflicts.map((entry) => (
                  <tr key={entry.column} className="border-b border-gray-100 align-top dark:border-gray-800">
                    <td className="px-2 py-2 font-medium text-gray-900 dark:text-white">
                      {t(`promotion.fields.${entry.column}`)}
                    </td>
                    <td className="px-2 py-2 text-gray-700 dark:text-gray-400">{entry.current}</td>
                    <td className="px-2 py-2 text-gray-900 dark:text-white">{entry.proposed}</td>
                    <td className="px-2 py-2">
                      <label className="flex items-center gap-2 text-xs font-medium text-gray-900 dark:text-white">
                        <Checkbox
                          checked={approved.indexOf(entry.column) >= 0}
                          onCheckedChange={() => toggle(entry.column)}
                          aria-label={`${t('promotion.replace')} — ${t(`promotion.fields.${entry.column}`)}`}
                        />
                        <span>{t('promotion.replace')}</span>
                      </label>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* THE ARITHMETIC. `resolvePromotionWrite` writes these with no act, so the panel states
          the count and offers the list — it does not ask fifteen times for permission it does
          not need. The write is irreversible, so the list is one click away and never gone. */}
      {fills.length > 0 && (
        <div className="mt-5 rounded-2xl border border-gray-200 p-3 dark:border-gray-800">
          <p className="text-sm text-gray-900 dark:text-white">
            {t('promotion.fillsSummary', { count: fills.length })}
          </p>
          <button
            type="button"
            onClick={() => setFillsOpen((value) => !value)}
            aria-expanded={fillsOpen}
            aria-controls="promotion-fills"
            className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-primary-800 underline underline-offset-4 dark:text-tuggi-blue"
          >
            {fillsOpen ? (
              <ChevronDown className="h-4 w-4" aria-hidden="true" />
            ) : (
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            )}
            {fillsOpen ? t('promotion.fillsHide') : t('promotion.fillsShow')}
          </button>

          {fillsOpen && (
            <dl id="promotion-fills" className="mt-3 grid gap-x-6 gap-y-2 border-t border-gray-100 pt-3 dark:border-gray-800 sm:grid-cols-2">
              {fills.map((entry) => (
                <div key={entry.column}>
                  <dt className="text-xs text-gray-700 dark:text-gray-400">
                    {t(`promotion.fields.${entry.column}`)}
                  </dt>
                  {/* The live value for the one column somebody can type, never the plan's
                      original: this list is a review of what the button is about to write. */}
                  <dd className="break-words text-sm text-gray-900 dark:text-white">
                    {entry.editable ? industry : entry.proposed}
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      )}

      {plan.unchanged.length > 0 && (
        <p className="mt-2 text-xs text-gray-700 dark:text-gray-400">
          {t('promotion.unchanged', { count: plan.unchanged.length })}
        </p>
      )}

      {summary.kept > 0 && (
        <p className="mt-1 text-xs text-gray-800 dark:text-gray-300">{t('promotion.keptNotice', { count: summary.kept })}</p>
      )}

      <div className="mt-4 rounded-2xl border border-gray-200 bg-gray-50/60 p-3 text-xs text-gray-800 dark:border-gray-800 dark:bg-gray-900/40 dark:text-gray-300">
        <p className="font-semibold text-gray-900 dark:text-white">{t('promotion.neverHeading')}</p>
        <p className="mt-1 font-mono">{PROMOTION_NEVER_WRITES.join(', ')}</p>
        <p className="mt-2">{t('promotion.neverBody')}</p>
      </div>

      <div className="mt-4 rounded-2xl border border-gray-200 p-3 text-sm dark:border-gray-800">
        <p className="font-semibold text-gray-900 dark:text-white">{t('promotion.reviewTitle')}</p>
        <p className="mt-1 text-gray-900 dark:text-white">
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
          className="mt-3 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-gray-900 dark:text-white"
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
          variant="cta"
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

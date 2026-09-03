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
 * an irreversible write.
 *
 * EVERY VALUE THE PARTNER TYPED IS NOW EDITABLE, AND THE INPUT LIVES WHERE THE VALUE LIVES
 * (#679). `Ramo` used to be the only one and had a field of its own above the table; with
 * twelve editable columns that block would be the wall this panel spent a rewrite removing, so
 * the input replaces the value in the list it was already in — the disclosure for a fill, the
 * `Da proposta` cell for a conflict. The operator who has nothing to correct sees the same
 * screen as before; the one who does finds the field where the wrong value already is.
 *
 * WHAT IS EDITED IS THE CLIENT RECORD, NEVER THE PROPOSAL. `partner.partner_form_submissions`
 * keeps what the partner sent, and that is what makes it auditable — the panel says so out loud
 * (`promotion.editHint`) because an input that silently rewrote the inbox would be the same
 * screen.
 *
 * A VALUE THAT DOES NOT FIT ITS COLUMN NEVER REACHES THE ROUTE. `CLIENT_COLUMN_LIMITS` is the
 * width of `partner.clients`, the button goes dead while anything exceeds it, and the field
 * says which one, com QUANTOS caracteres e por qual limite. Before #679 that was a 503:
 * `varchar(255)` refused a 300-character `website`, the proposal stayed in the queue with no
 * path out of it, and the screen told the operator the record might have been written.
 *
 * E PREVENIR NÃO É RELATAR UMA FALHA. O mesmo bloco vermelho serve dois estados: o valor que já
 * chegou estourado da proposta — sem clique nenhum — e a escrita que o servidor recusou. Com o
 * título de falha nos dois, o painel anunciava `Não foi possível promover` a quem ainda não
 * tinha tentado. `blockedTitle` é o estado sem `failure`; `failedTitle` fica para o que falhou.
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
  lengthViolations,
  resolvePromotionWrite,
  summarizePromotion,
  type PromotableColumn,
  type PromotionEntry,
} from '@/lib/partner-form/promotion'
import type { ProposalDetail } from './types'
import { CARD } from './surface'

/**
 * `client_written` and `nothing_written` are the same HTTP failure told apart by one fact the
 * server sends — whether a row landed in `partner.clients`. They were one message until #679,
 * and it was the pessimistic one: an operator whose write failed clean was sent to check a
 * record that had never existed, and told that promoting again would create a duplicate.
 */
type Failure =
  | 'too_long'
  | 'nothing_written'
  | 'client_written'
  | 'not_promotable'
  | 'network'
  | 'nothing'
  | null

interface PromotionPanelProps {
  detail: ProposalDetail
  /** The Portuguese label of the chosen category, read from `PartnerForm.categories.<id>`. */
  categoryLabel: string
  onClose: () => void
  onPromoted: () => void
}

export function PromotionPanel({ detail, categoryLabel, onClose, onPromoted }: PromotionPanelProps) {
  const t = useTranslations('PartnerProposals')

  /**
   * ONLY WHAT THE OPERATOR ACTUALLY TYPED. An untouched column is absent here and the plan's
   * own value answers for it, so there is no second copy of the proposal to keep in step — and
   * `industry` is in the same bag as the rest, though it is also the plan's `categoryLabel`:
   * the category id is English and the proposed value only exists because the panel translates
   * it, so the plan has to be rebuilt with what the operator left in the field.
   */
  const [overrides, setOverrides] = useState<Record<string, string>>({})
  const [approved, setApproved] = useState<string[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [failure, setFailure] = useState<Failure>(null)
  /** The column and limit of a `too_long` the SERVER refused — see `promote`. */
  const [refused, setRefused] = useState<{ column: string; limit: number } | null>(null)
  /** The fills, which are a count by default and a list for whoever asks. */
  const [fillsOpen, setFillsOpen] = useState(false)

  const client = detail.client
  const industry = overrides.industry ?? categoryLabel

  const plan = useMemo(
    () => buildPromotionPlan(detail.submission.answers, client, { categoryLabel: industry }),
    [detail.submission.answers, client, industry]
  )

  const summary = summarizePromotion(plan, { approved, overrides })

  /** What the operator sees in the field, and exactly what the button will write. */
  const valueOf = (entry: PromotionEntry) => overrides[entry.column] ?? entry.proposed

  /**
   * THE SAME MAP THE ROUTE REFUSES BY. Run on the resolved write and not on the proposal:
   * what does not fit is what is about to be inserted, and the operator just typed it.
   */
  const resolved = resolvePromotionWrite(plan, { approved, overrides })
  const violations = lengthViolations(resolved.updates)
  /**
   * A VIOLAÇÃO INTEIRA, e não só o limite. `lengthViolations` já devolve `length`, e a frase que
   * esconde o excesso manda o operador cortar às cegas: numa URL de 300 caracteres contra
   * `varchar(255)`, saber que sobram 45 é a diferença entre uma edição e várias tentativas.
   */
  const violationOf = new Map(violations.map((violation) => [violation.column, violation]))

  /**
   * A RECUSA DO SERVIDOR, com o tamanho junto. A resposta da rota traz coluna e limite; o
   * comprimento é o do valor que ESTA tela mandou gravar, lido da mesma escrita resolvida — não
   * uma segunda cópia do que o operador digitou. Sem esse valor não há frase com número, e o
   * bloco cai no texto de "nada foi gravado", exatamente como já caía sem `refused`.
   */
  const refusedValue = refused
    ? resolved.updates[refused.column as PromotableColumn]
    : undefined
  const refusedTooLong =
    refused && typeof refusedValue === 'string'
      ? { ...refused, length: refusedValue.length }
      : null

  /** The value of every editable column of the plan, typed or pre-filled — what the body says. */
  function editedValues(): Record<string, string> {
    const values: Record<string, string> = {}
    for (const entry of plan.entries) {
      if (entry.editable) values[entry.column] = valueOf(entry)
    }
    return values
  }

  function setOverride(column: string, value: string) {
    setOverrides((current) => ({ ...current, [column]: value }))
    setFailure(null)
    setRefused(null)
  }

  /**
   * The field of a value somebody may retype — an `<Input>` under the label the list already
   * prints, the same pair the panel used for `Ramo` alone. A column over its limit says so
   * under its own field and the input carries `aria-invalid`, so the block is never something
   * only the dead button knows about.
   *
   * A FUNCTION THAT RETURNS JSX, NOT A COMPONENT DECLARED IN A RENDER. A component defined
   * inside `PromotionPanel` is a new type on every render, so React would unmount and remount
   * the input at each keystroke and the caret would leave the field after one character.
   */
  function editableValue(entry: PromotionEntry, hint?: string) {
    const id = `promotion-value-${entry.column}`
    const violation = violationOf.get(entry.column)
    const described = [hint ? `${id}-hint` : null, violation ? `${id}-error` : null]
      .filter(Boolean)
      .join(' ')

    return (
      <>
        <Input
          id={id}
          className="mt-1"
          value={valueOf(entry)}
          onChange={(event) => setOverride(entry.column, event.target.value)}
          aria-invalid={violation ? true : undefined}
          aria-describedby={described || undefined}
        />
        {hint && (
          <span id={`${id}-hint`} className="mt-1 block text-xs text-gray-700 dark:text-gray-400">
            {hint}
          </span>
        )}
        {violation && (
          <span
            id={`${id}-error`}
            className="mt-1 block text-xs font-medium text-destructive"
          >
            {t('promotion.failedTooLong', {
              field: t(`promotion.fields.${entry.column}`),
              length: violation.length,
              limit: violation.limit,
            })}
          </span>
        )}
      </>
    )
  }

  /**
   * The plan split by what it ASKS OF A PERSON. A `conflict` is a decision and gets a row with a
   * control; a `fill` is arithmetic and gets a count.
   *
   * Read off `decision` and never off `plan.creating`: a proposal promoted into an EXISTING
   * client whose record happens to be empty is all fills too, and it deserves the same screen as
   * a new one.
   *
   * AN EDITABLE COLUMN STAYS IN ITS LIST, and the input is what its value cell holds. Pulling
   * the editable ones into a block of their own made the panel say `14 campos vão ser
   * preenchidos` above a button reading `Gravar 15 campos`; two numbers for one write is the
   * defect, and it is the reason the fields were never a section apart.
   */
  const conflicts = plan.entries.filter((entry) => entry.decision === 'conflict')
  const fills = plan.entries.filter((entry) => entry.decision === 'fill')

  /** The disclosure cannot be shut over the field that is blocking the button. */
  const fillIsOverLimit = fills.some((entry) => violationOf.has(entry.column))
  const showFills = fillsOpen || fillIsOverLimit

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
    // The button is already disabled while anything is over its limit; this is the same rule
    // stated where it cannot be clicked past.
    if (violations.length > 0) {
      setFailure('too_long')
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
          // EVERY EDITABLE VALUE TRAVELS, TYPED OR NOT. The server rebuilds the plan from the
          // database and has no copy of the category labels, so `industry` has to be in here
          // for the column to exist at all — and sending the resolved value of each editable
          // column is what makes the body say plainly what the operator is asking to write.
          body: JSON.stringify({ approved, overrides: editedValues() }),
        }
      )

      if (response.ok) {
        onPromoted()
        return
      }

      const payload = await response.json().catch(() => ({}))
      const error = payload?.error

      if (error === 'too_long') {
        // The screen already blocks this; getting here means the database knows a narrower
        // column than `CLIENT_COLUMN_LIMITS` does, and the answer names which one.
        setRefused(
          typeof payload?.column === 'string' && typeof payload?.limit === 'number'
            ? { column: payload.column, limit: payload.limit }
            : null
        )
        setFailure('too_long')
      } else if (error === 'not_promotable') {
        setFailure('not_promotable')
      } else {
        // THE ONE FACT THAT DECIDES THE SENTENCE. `clientWritten` is the outcome's own client
        // id, so "nothing was written" is stated only when nothing was.
        setFailure(payload?.clientWritten === true ? 'client_written' : 'nothing_written')
      }
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

      {/* WHAT THE EDITING IS AND IS NOT. The operator corrects what goes to the client record;
          the proposal keeps what the partner sent, and it is the auditable copy of it. Stated
          once, at the top, because every field below is an input. */}
      {plan.entries.some((entry) => entry.editable) && (
        <p className="mt-2 text-sm text-gray-800 dark:text-gray-300">{t('promotion.editHint')}</p>
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
                    {/* THE CELL THE OPERATOR CAN CORRECT. The row already names the field in the
                        first cell, so the input takes that name — a `<Label>` in a table cell
                        would repeat the column header for every row. */}
                    <td className="px-2 py-2 text-gray-900 dark:text-white">
                      {entry.editable ? (
                        <div className="min-w-[12rem]">
                          <Label htmlFor={`promotion-value-${entry.column}`} className="sr-only">
                            {`${t(`promotion.fields.${entry.column}`)} — ${t('promotion.columns.proposed')}`}
                          </Label>
                          {editableValue(entry)}
                        </div>
                      ) : (
                        entry.proposed
                      )}
                    </td>
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
          {/* A VALUE OVER ITS LIMIT KEEPS THE LIST OPEN. The field that blocks the button is in
              here, and a disclosure that can be shut over it hides the only place the operator
              can fix it. */}
          <button
            type="button"
            onClick={() => setFillsOpen((value) => !value)}
            aria-expanded={showFills}
            aria-controls="promotion-fills"
            disabled={fillIsOverLimit}
            className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-primary-800 underline underline-offset-4 disabled:no-underline disabled:opacity-60 dark:text-tuggi-blue"
          >
            {showFills ? (
              <ChevronDown className="h-4 w-4" aria-hidden="true" />
            ) : (
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            )}
            {showFills ? t('promotion.fillsHide') : t('promotion.fillsShow')}
          </button>

          {showFills && (
            <div id="promotion-fills" className="mt-3 grid gap-x-6 gap-y-3 border-t border-gray-100 pt-3 dark:border-gray-800 sm:grid-cols-2">
              {fills.map((entry) => (
                <div key={entry.column}>
                  {/* The live value, never the plan's original: this list is a review of what
                      the button is about to write, and for an editable column it is the field
                      where the value is corrected. */}
                  {entry.editable ? (
                    <>
                      <Label
                        htmlFor={`promotion-value-${entry.column}`}
                        className="text-xs text-gray-700 dark:text-gray-400"
                      >
                        {t(`promotion.fields.${entry.column}`)}
                      </Label>
                      {editableValue(
                        entry,
                        entry.column === 'industry' ? t('promotion.industryHint') : undefined
                      )}
                    </>
                  ) : (
                    <>
                      <span className="block text-xs text-gray-700 dark:text-gray-400">
                        {t(`promotion.fields.${entry.column}`)}
                      </span>
                      <p className="break-words text-sm text-gray-900 dark:text-white">
                        {entry.proposed}
                      </p>
                    </>
                  )}
                </div>
              ))}
            </div>
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

      {/* THE REASON IS NEXT TO THE BUTTON, ALWAYS. The field says which value does not fit and
          this says why the promotion is not going to happen — a dead button whose explanation is
          three sections up is a button the operator clicks again. */}
      {(failure || violations.length > 0) && (
        <div
          className="mt-3 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-gray-900 dark:text-white"
          role="alert"
        >
          {/* PREVENIR NÃO É RELATAR. O bloco também aparece com NENHUMA tentativa feita — basta
              a proposta trazer um valor que não cabe —, e anunciar `Não foi possível promover`
              sobre um clique que ninguém deu é relatar uma falha que não aconteceu. O título da
              falha fica para quando houve falha; sem `failure`, o que existe é um bloqueio. */}
          <p className="flex items-center gap-2 font-semibold">
            <AlertTriangle className="h-4 w-4" aria-hidden="true" />
            {failure === null
              ? t('promotion.blockedTitle')
              : failure === 'network'
                ? t('promotion.failedNetworkTitle')
                : t('promotion.failedTitle')}
          </p>
          <div className="mt-1">
            {violations.map((violation) => (
              <p key={violation.column}>
                {t('promotion.failedTooLong', {
                  field: t(`promotion.fields.${violation.column}`),
                  length: violation.length,
                  limit: violation.limit,
                })}
              </p>
            ))}
            {/* The server refused a length the screen let through: the column it names is not
                one this panel knows a limit for, so it is stated on its own — com o tamanho lido
                da própria escrita que saiu daqui, que é o valor que o banco recusou. */}
            {violations.length === 0 && failure === 'too_long' && (
              <p>
                {refusedTooLong
                  ? t('promotion.failedTooLong', {
                      field: t(`promotion.fields.${refusedTooLong.column}`),
                      length: refusedTooLong.length,
                      limit: refusedTooLong.limit,
                    })
                  : t('promotion.failedNothingWritten')}
              </p>
            )}
            {failure === 'network' && <p>{t('promotion.failedNetworkBody')}</p>}
            {failure === 'not_promotable' && <p>{t('promotion.failedNotPromotable')}</p>}
            {failure === 'nothing_written' && <p>{t('promotion.failedNothingWritten')}</p>}
            {failure === 'client_written' && <p>{t('promotion.failedClientWritten')}</p>}
            {failure === 'nothing' && <p>{t('promotion.nothingToWrite')}</p>}
          </div>
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-3">
        <Button
          type="button"
          variant="cta"
          onClick={promote}
          disabled={submitting || summary.total === 0 || violations.length > 0}
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

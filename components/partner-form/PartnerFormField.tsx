'use client'

import React from 'react'
import { AlertCircle } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { BRAZIL_STATES } from '@/lib/constants/brazil-states'
import { PARTNER_CATEGORIES, type PartnerField } from '@/lib/partner-form/fields'
import { maskCnpjInput, cnpjCharactersMissing } from '@/lib/validation/cnpj'
import type { FieldProblem } from '@/lib/partner-form/schema'
import {
  FIELD_CONTROL,
  FIELD_CONTROL_INVALID,
  FIELD_ERROR,
  FIELD_HELP,
  FIELD_LABEL,
} from './styles'

/**
 * One field of the partner form, rendered from its declaration.
 *
 * The label is a real `<label htmlFor>` and never a placeholder (SC 3.3.2, and criterion
 * 8 of the spec). Help is persistent text under the label and not a placeholder either —
 * a placeholder disappears exactly when the person starts writing, which is when they
 * need the example.
 *
 * `aria-describedby` points at help and error together, `aria-invalid` marks the field,
 * and the error carries an icon AND text (DS-A11Y-003), never colour alone.
 */

/** Fraction of the limit at which the remaining budget becomes visible (spec §6). */
const COUNTER_THRESHOLD = 0.8

interface PartnerFormFieldProps {
  field: PartnerField
  value: string
  problem?: FieldProblem
  onChange: (value: string) => void
  onBlur?: () => void
  /** Rendered under the field: the non-blocking nudges of step 3. */
  nudge?: React.ReactNode
}

export function PartnerFormField({
  field,
  value,
  problem,
  onChange,
  onBlur,
  nudge,
}: PartnerFormFieldProps) {
  const t = useTranslations('PartnerForm')
  const inputId = `partner-field-${field.id}`
  const helpId = `${inputId}-help`
  const errorId = `${inputId}-error`
  const counterId = `${inputId}-counter`

  const help = t(`fields.${field.id}.help`)

  // The counter exists only where the limit is soft. A textarea has no `maxLength` on
  // purpose (below), so nothing stops the person at the limit: the warning has to arrive
  // before the damage, and the last fifth of the budget is where it is still cheap to
  // shorten. Inputs keep their hard limit and need no counter.
  const remaining = field.maxLength - value.length
  const showCounter =
    field.type === 'textarea' && remaining >= 0 && value.length >= field.maxLength * COUNTER_THRESHOLD

  const describedBy = [help ? helpId : null, showCounter ? counterId : null, problem ? errorId : null]
    .filter(Boolean)
    .join(' ')

  const controlClass = `${FIELD_CONTROL}${problem ? ` ${FIELD_CONTROL_INVALID}` : ''}`

  const shared = {
    id: inputId,
    name: field.id,
    value,
    onBlur,
    'aria-invalid': problem ? (true as const) : undefined,
    'aria-describedby': describedBy || undefined,
    autoComplete: field.autoComplete,
    className: controlClass,
  }

  return (
    <div className="mb-6">
      <label htmlFor={inputId} className={FIELD_LABEL}>
        {t(`fields.${field.id}.label`)}
      </label>
      {help ? (
        <p id={helpId} className={FIELD_HELP}>
          {help}
        </p>
      ) : null}

      {renderControl()}

      {showCounter ? (
        <p id={counterId} className={FIELD_HELP}>
          {t('charactersLeft', { n: remaining })}
        </p>
      ) : null}

      {nudge}

      {problem ? (
        <p id={errorId} className={FIELD_ERROR} role="alert">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{errorMessage(t, field, problem, value)}</span>
        </p>
      ) : null}
    </div>
  )

  function renderControl() {
    switch (field.type) {
      case 'textarea':
        // No `maxLength`, deliberately: with it, pasting a long story TRUNCATES IN
        // SILENCE — the person loses the end of their own text without a word, and
        // `errors.too_long`, which says how much to cut, becomes unreachable exactly when
        // it is the right message. The limit is enforced on submit (`validateAnswers`),
        // and the counter above warns before it is reached.
        return <textarea {...shared} rows={3} onChange={(event) => onChange(event.target.value)} />


      case 'select':
        return (
          <select {...shared} onChange={(event) => onChange(event.target.value)}>
            <option value="" />
            {optionsOf(field, (key) => t(key)).map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        )

      case 'cnpj':
        return (
          <input
            {...shared}
            // `type="text"` and `inputMode="text"`, deliberately. A numeric keypad makes
            // an alphanumeric CNPJ physically impossible to type, and `type="number"`
            // breaks the mask on top of that.
            type="text"
            inputMode="text"
            autoCapitalize="characters"
            spellCheck={false}
            maxLength={18}
            placeholder="XX.XXX.XXX/XXXX-NN"
            onChange={(event) => onChange(maskCnpjInput(event.target.value))}
          />
        )

      case 'postal_code':
        return (
          <input
            {...shared}
            type="text"
            inputMode="numeric"
            maxLength={9}
            onChange={(event) => onChange(event.target.value)}
          />
        )

      case 'date':
        return (
          <input
            {...shared}
            type="date"
            onChange={(event) => onChange(event.target.value)}
          />
        )

      default:
        return (
          <input
            {...shared}
            type={field.type === 'email' ? 'email' : field.type === 'tel' ? 'tel' : 'text'}
            inputMode={field.type === 'tel' ? 'tel' : undefined}
            maxLength={field.maxLength}
            onChange={(event) => onChange(event.target.value)}
          />
        )
    }
  }
}

function optionsOf(
  field: PartnerField,
  translate: (key: string) => string
): { value: string; label: string }[] {
  if (field.id === 'state') {
    return BRAZIL_STATES.map((state) => ({ value: state.code, label: `${state.code} — ${state.name}` }))
  }
  if (field.id === 'category') {
    return PARTNER_CATEGORIES.map((category) => ({
      value: category,
      label: translate(`categories.${category}`),
    }))
  }
  return (field.options ?? []).map((option) => ({ value: option, label: option }))
}

/**
 * The required message names the field, always — "Preencha o nome do estabelecimento",
 * never "campo obrigatório". Everything else comes from the shared error table, so the
 * server's 400 and this summary cannot disagree.
 *
 * There is NO generic fallback, and that is the point: `errors.required` was removed
 * because a field whose copy is missing has to fail loudly (the promise `fields.ts`
 * makes) instead of rendering a sentence that helps nobody and that nobody discovers.
 * A missing key surfaces as the key itself, and the suite refuses it
 * (`tests/api/partner-form.test.ts`, DS-COMPONENTE-016).
 */
export function errorMessage(
  t: (key: string, values?: Record<string, string | number>) => string,
  field: PartnerField,
  problem: FieldProblem,
  value: string
): string {
  if (problem.code === 'required') {
    return t(`fields.${field.id}.requiredError`)
  }
  if (problem.code === 'cnpj_incomplete') {
    return t('errors.cnpj_incomplete', { n: cnpjCharactersMissing(value) })
  }
  if (problem.code === 'too_long') {
    // DS-COPY-002: saying what to do includes saying how much.
    return t('errors.too_long', { max: field.maxLength, over: value.length - field.maxLength })
  }
  return t(`errors.${problem.code}`)
}

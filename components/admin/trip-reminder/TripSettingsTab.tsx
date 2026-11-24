'use client'

/**
 * Configuração tab of `/admin/trip-reminder` (#1233).
 *
 * - Switches: `PATCH .../switches` saves on the control, optimistic, and rolls back on refusal (the
 *   weekly push pattern). The effective "ask for the phone" comes back from the database with every
 *   write (BR-COMUNICACAO-024 item 1), so the line under the list never guesses it.
 * - Numbers: the shared reward editor (`RewardSettingsTable`, `drive.set_reward_setting`), fed by the
 *   `numbers` of `drive.cms_get_trip_settings` (BR-MONETIZACAO-091, BR-MONETIZACAO-086 2.c and 2.d).
 * - Templates: one WhatsApp template name per piece and language (BR-COMUNICACAO-024 item 8).
 */

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { CELL, DIM, HEAD_SOLO } from '@/components/ui/dense-table'
import { RewardSettingsTable } from '@/components/admin/rewards/RewardSettingsTable'
import {
  PROVIDER_LANGUAGE_RE,
  PROVIDER_LANGUAGE_SUGGESTION,
  TEMPLATE_LANGUAGES,
  TEMPLATE_NAME_MAX_LENGTH,
  TEMPLATE_NAME_RE,
  TEMPLATE_PIECES,
  messageId,
  numbersAsRewardSettings,
  type TemplateLanguage,
  type TemplatePiece,
  type TripAdminError,
  type TripSettings,
  type TripSwitch,
  type TripTemplate,
} from '@/lib/trip-reminder/settings'
import { errorText, formatInstant } from './format'

export function TripSettingsTab({
  data,
  reload,
  onChange,
}: {
  data: TripSettings
  reload: () => Promise<void>
  onChange: (next: TripSettings) => void
}) {
  const t = useTranslations('TripReminder')

  const onSwitchSaved = (row: TripSwitch, askPhoneEffective: boolean) =>
    onChange({
      ...data,
      ask_phone_effective: askPhoneEffective,
      switches: data.switches.map((s) => (s.key === row.key ? row : s)),
    })

  return (
    <div className="space-y-10">
      <section aria-labelledby="trip-switches">
        <h2 id="trip-switches" className="text-lg font-bold text-gray-900 dark:text-gray-100">
          {t('switches.heading')}
        </h2>
        <p className={`mb-3 text-sm ${DIM}`}>{t('switches.intro')}</p>
        <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white dark:divide-gray-800 dark:border-gray-800 dark:bg-gray-900">
          {data.switches.map((row) => (
            <SwitchRow key={row.key} row={row} onSaved={onSwitchSaved} />
          ))}
        </ul>
        <p
          role="status"
          className={`mt-2 text-sm font-semibold ${data.ask_phone_effective ? 'text-green-800 dark:text-green-300' : 'text-gray-700 dark:text-gray-300'}`}>
          {data.ask_phone_effective ? t('switches.ask_phone_on') : t('switches.ask_phone_off')}
        </p>
      </section>

      <section aria-labelledby="trip-numbers">
        <h2 id="trip-numbers" className="text-lg font-bold text-gray-900 dark:text-gray-100">
          {t('numbers.heading')}
        </h2>
        <p className={`mb-3 text-sm ${DIM}`}>{t('numbers.intro')}</p>
        <RewardSettingsTable settings={numbersAsRewardSettings(data.numbers)} onSaved={reload} />
      </section>

      <TemplatesBlock templates={data.templates} reload={reload} />
    </div>
  )
}

function SwitchRow({ row, onSaved }: { row: TripSwitch; onSaved: (row: TripSwitch, askPhoneEffective: boolean) => void }) {
  const t = useTranslations('TripReminder')
  const [isOn, setIsOn] = useState(row.is_on)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState<string | null>(null)
  const [failed, setFailed] = useState<TripAdminError | null>(null)

  const id = messageId(row.key)
  const known = t.has(`switches.items.${id}.label`)
  const label = known ? t(`switches.items.${id}.label`) : row.key
  const inputId = `trip-switch-${id}`

  const save = async (next: boolean) => {
    setIsOn(next)
    setSaving(true)
    setSaved(null)
    setFailed(null)
    try {
      const response = await fetch('/api/admin/trip-reminder/switches', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: row.key, is_on: next }),
      })
      const envelope = await response.json().catch(() => null)
      if (!response.ok) {
        setIsOn(!next)
        setFailed(envelope?.error ?? { code: 'unknown' })
        return
      }
      const isOnNow = envelope?.is_on === true
      setIsOn(isOnNow)
      onSaved({ ...row, is_on: isOnNow, updated_at: envelope?.updated_at ?? row.updated_at }, envelope?.ask_phone_effective === true)
      setSaved(t(isOnNow ? 'switches.saved_on' : 'switches.saved_off', { label }))
    } catch {
      setIsOn(!next)
      setFailed({ code: 'unknown' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <li className="flex items-start gap-3 px-4 py-3">
      <input
        id={inputId}
        type="checkbox"
        checked={isOn}
        disabled={saving}
        onChange={(event) => void save(event.target.checked)}
        aria-describedby={`${inputId}-hint`}
        className="mt-1 h-4 w-4 rounded border-gray-400 text-tuggi-blue focus:ring-tuggi-blue disabled:opacity-50"
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <label htmlFor={inputId} className="text-sm font-semibold text-gray-900 dark:text-white">
            {label}
          </label>
          <span className={`text-xs font-semibold ${isOn ? 'text-green-800 dark:text-green-300' : 'text-gray-600 dark:text-gray-300'}`}>
            {isOn ? t('switches.on') : t('switches.off')}
          </span>
          <span className={`font-mono text-xs ${DIM}`}>{row.key}</span>
        </div>
        <p id={`${inputId}-hint`} className={`text-xs ${DIM}`}>
          {known ? t(`switches.items.${id}.hint`) : null}
          {row.rule_id ? <span className="ml-2 font-mono">{row.rule_id}</span> : null}
          {row.updated_at ? <span className="ml-2">{t('switches.changed', { date: formatInstant(row.updated_at) })}</span> : null}
        </p>
        {saved ? (
          <p role="status" className="mt-1 text-xs font-semibold text-green-700 dark:text-green-400">
            {saved}
          </p>
        ) : null}
        {failed ? (
          <p role="alert" className="mt-1 text-xs text-red-700 dark:text-red-400">
            {errorText(t, failed)}
          </p>
        ) : null}
      </div>
    </li>
  )
}

const CHANNEL = 'whatsapp'

interface Draft {
  piece: TemplatePiece
  language: TemplateLanguage
  name: string
  providerLanguage: string
}

const EMPTY_DRAFT: Draft = { piece: 'trip_reminder_before', language: 'pt', name: '', providerLanguage: PROVIDER_LANGUAGE_SUGGESTION.pt }

function TemplatesBlock({ templates, reload }: { templates: TripTemplate[]; reload: () => Promise<void> }) {
  const t = useTranslations('TripReminder')
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<string | null>(null)
  const [failed, setFailed] = useState<TripAdminError | null>(null)

  const languageName = (language: string) => (t.has(`languages.${language}`) ? t(`languages.${language}`) : language)
  const nameProblem = draft.name !== '' && (draft.name.length > TEMPLATE_NAME_MAX_LENGTH || !TEMPLATE_NAME_RE.test(draft.name))
  const providerProblem = !PROVIDER_LANGUAGE_RE.test(draft.providerLanguage)
  const whatsapp = templates.filter((tpl) => tpl.channel === CHANNEL)

  const write = async (body: Record<string, unknown>, message: string) => {
    setBusy(true)
    setDone(null)
    setFailed(null)
    try {
      const response = await fetch('/api/admin/trip-reminder/templates', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel: CHANNEL, ...body }),
      })
      const envelope = await response.json().catch(() => null)
      if (!response.ok) {
        setFailed(envelope?.error ?? { code: 'unknown' })
        return false
      }
      setDone(message)
      await reload()
      return true
    } catch {
      setFailed({ code: 'unknown' })
      return false
    } finally {
      setBusy(false)
    }
  }

  const submit = async () => {
    if (draft.name === '' || nameProblem || providerProblem) return
    const ok = await write(
      { piece: draft.piece, language: draft.language, template_name: draft.name, provider_language: draft.providerLanguage },
      t('templates.saved')
    )
    if (ok) setDraft(EMPTY_DRAFT)
  }

  return (
    <section aria-labelledby="trip-templates">
      <h2 id="trip-templates" className="text-lg font-bold text-gray-900 dark:text-gray-100">
        {t('templates.heading')}
      </h2>
      <p className={`mb-3 text-sm ${DIM}`}>{t('templates.intro')}</p>

      {whatsapp.length ? (
        <div className="mb-4 overflow-x-auto rounded-lg border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className={HEAD_SOLO}>{t('templates.piece')}</th>
                <th className={HEAD_SOLO}>{t('templates.language')}</th>
                <th className={HEAD_SOLO}>{t('templates.name')}</th>
                <th className={HEAD_SOLO}>{t('templates.provider_language')}</th>
                <th className={HEAD_SOLO}>{t('templates.updated')}</th>
                <th className={HEAD_SOLO}>
                  <span className="sr-only">{t('templates.edit')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {whatsapp.map((tpl) => {
                const names = { piece: t(`pieces.${tpl.piece}`), language: languageName(tpl.language) }
                return (
                  <tr key={`${tpl.piece}-${tpl.language}`} className="border-t border-gray-100 dark:border-gray-800">
                    <td className={CELL}>{names.piece}</td>
                    <td className={CELL}>{names.language}</td>
                    <td className={`${CELL} font-mono text-xs`}>{tpl.template_name}</td>
                    <td className={`${CELL} font-mono text-xs`}>{tpl.provider_language}</td>
                    <td className={`${CELL} whitespace-nowrap ${DIM}`}>{formatInstant(tpl.updated_at)}</td>
                    <td className={`${CELL} whitespace-nowrap text-right`}>
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={busy}
                          aria-label={t('templates.edit_aria', names)}
                          onClick={() =>
                            setDraft({
                              piece: tpl.piece,
                              language: (TEMPLATE_LANGUAGES as readonly string[]).includes(tpl.language) ? (tpl.language as TemplateLanguage) : 'pt',
                              name: tpl.template_name,
                              providerLanguage: tpl.provider_language,
                            })
                          }>
                          {t('templates.edit')}
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={busy}
                          aria-label={t('templates.remove_aria', names)}
                          onClick={() => void write({ piece: tpl.piece, language: tpl.language, template_name: null }, t('templates.removed'))}>
                          {t('templates.remove')}
                        </Button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className={`mb-4 text-sm ${DIM}`}>{t('templates.empty')}</p>
      )}

      <form
        className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900"
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}>
        <h3 className="mb-3 text-sm font-semibold text-gray-900 dark:text-gray-100">{t('templates.form_heading')}</h3>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
          <div>
            <Label htmlFor="trip-template-piece">{t('templates.piece')}</Label>
            <Select
              id="trip-template-piece"
              className="mt-1"
              value={draft.piece}
              onValueChange={(value) => setDraft({ ...draft, piece: value as TemplatePiece })}>
              {TEMPLATE_PIECES.map((piece) => (
                <option key={piece} value={piece}>
                  {t(`pieces.${piece}`)}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="trip-template-language">{t('templates.language')}</Label>
            <Select
              id="trip-template-language"
              className="mt-1"
              value={draft.language}
              onValueChange={(value) => {
                const language = value as TemplateLanguage
                setDraft({ ...draft, language, providerLanguage: PROVIDER_LANGUAGE_SUGGESTION[language] })
              }}>
              {TEMPLATE_LANGUAGES.map((language) => (
                <option key={language} value={language}>
                  {languageName(language)}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="trip-template-name">{t('templates.name')}</Label>
            <Input
              id="trip-template-name"
              className="mt-1 font-mono"
              value={draft.name}
              maxLength={TEMPLATE_NAME_MAX_LENGTH}
              autoComplete="off"
              aria-invalid={nameProblem || undefined}
              aria-describedby={nameProblem ? 'trip-template-name-problem' : undefined}
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
            />
            {nameProblem ? (
              <p id="trip-template-name-problem" className="mt-1 text-xs text-red-700 dark:text-red-400">
                {t('templates.name_problem')}
              </p>
            ) : null}
          </div>
          <div>
            <Label htmlFor="trip-template-provider-language">{t('templates.provider_language')}</Label>
            <Input
              id="trip-template-provider-language"
              className="mt-1 font-mono"
              value={draft.providerLanguage}
              autoComplete="off"
              aria-invalid={providerProblem || undefined}
              aria-describedby={providerProblem ? 'trip-template-provider-problem' : undefined}
              onChange={(event) => setDraft({ ...draft, providerLanguage: event.target.value })}
            />
            {providerProblem ? (
              <p id="trip-template-provider-problem" className="mt-1 text-xs text-red-700 dark:text-red-400">
                {t('templates.provider_language_problem')}
              </p>
            ) : null}
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Button type="submit" variant="cta" size="sm" disabled={busy || draft.name === '' || nameProblem || providerProblem}>
            {busy ? t('templates.saving') : t('templates.save')}
          </Button>
          {done ? (
            <p role="status" className="text-xs font-semibold text-green-700 dark:text-green-400">
              {done}
            </p>
          ) : null}
          {failed ? (
            <p role="alert" className="text-xs text-red-700 dark:text-red-400">
              {errorText(t, failed)}
            </p>
          ) : null}
        </div>
      </form>
    </section>
  )
}

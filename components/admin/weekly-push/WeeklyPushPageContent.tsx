'use client'

/**
 * /admin/weekly-push: the operator turns the two weekly push pieces on and off, moves their local
 * hour, edits their texts per language and reads what each send produced (BR-COMUNICACAO-019 3.m,
 * 3.m.9 and 4.1; #1047; spec docs/design/spec-cms-regua-de-push-2026-10.md).
 *
 * Three blocks, each loading and failing alone: pieces and texts come from one read
 * (`GET /api/admin/weekly-push`), results from another (`.../results`). Piece writes save on the
 * control, optimistic, and roll back on refusal (the `RoutePublishingToggle` pattern). The hour
 * select offers `policy.allowed_hours` only, so the quiet hours never appear as a choice. Text
 * writes are disabled while `validateWeeklyPushText` finds a problem; a database refusal (TGN*)
 * lands in the same i18n key.
 *
 * Page gate: `resolveAccess` (proxy). API gate: `withAuth({ roles: ['admin'] })`.
 */

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Container } from '@/components/ui/Container'
import { CharCount } from '@/components/ui/CharCount'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { TuggiLogo } from '@/components/ui/TuggiLogo'
import {
  CELL,
  DIM,
  DenseTableScroller,
  FilterChip,
  HEAD_SOLO,
  HEAD_SOLO_NUM,
  NUM,
} from '@/components/ui/dense-table'
import {
  PIECE_VARIANTS,
  WEEKLY_PUSH_BODY_MAX,
  WEEKLY_PUSH_LANGUAGES,
  WEEKLY_PUSH_PIECES,
  WEEKLY_PUSH_RESULT_WEEKS,
  WEEKLY_PUSH_TITLE_MAX,
  calendarDate,
  fillWeeklyPushText,
  notDelivered,
  stripPlaceholders,
  validateWeeklyPushText,
  weekEnd,
  weeklyPushErrorKey,
  type WeeklyPushErrorCode,
  type WeeklyPushLanguage,
  type WeeklyPushPiece,
  type WeeklyPushPieceRow,
  type WeeklyPushPolicy,
  type WeeklyPushResults,
  type WeeklyPushSettings,
  type WeeklyPushTextProblem,
  type WeeklyPushTextRow,
  type WeeklyPushVariant,
} from '@/lib/notifications/weekly-push'

type Load<T> = { state: 'loading' } | { state: 'error' } | { state: 'ready'; data: T }

type Translate = ReturnType<typeof useTranslations>

const SAVED_MS = 2000
const RESULT_COLUMNS = 7

/** Values every refusal message may ask for; a key that does not use one ignores it. */
function errorValues(policy: WeeklyPushPolicy | null, code?: WeeklyPushErrorCode | 'name_in_title') {
  const max = code === 'body_too_long' ? WEEKLY_PUSH_BODY_MAX : WEEKLY_PUSH_TITLE_MAX
  return {
    max,
    placeholder: '',
    from: policy?.quiet_from_hour ?? '',
    until: policy?.quiet_until_hour ?? '',
    before_from: policy ? Math.max(...policy.allowed_hours) : '',
  }
}

/** `{name}` and `{city}` shown as tokens, the rest as written. */
function WithPlaceholders({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\{name\}|\{city\})/).map((part, i) =>
        part === '{name}' || part === '{city}' ? (
          <span key={i} className="rounded bg-gray-100 px-1 font-mono text-xs dark:bg-gray-800">
            {part}
          </span>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        )
      )}
    </>
  )
}

export function WeeklyPushPageContent() {
  const t = useTranslations('Pages.WeeklyPush')
  const locale = useLocale()
  const [settings, setSettings] = useState<Load<WeeklyPushSettings>>({ state: 'loading' })
  const [results, setResults] = useState<Load<WeeklyPushResults>>({ state: 'loading' })

  const dateFormat = useMemo(() => new Intl.DateTimeFormat(locale, { dateStyle: 'short' }), [locale])

  const fetchSettings = useCallback(async () => {
    try {
      const response = await fetch('/api/admin/weekly-push', { cache: 'no-store' })
      if (!response.ok) throw new Error(String(response.status))
      setSettings({ state: 'ready', data: (await response.json()) as WeeklyPushSettings })
    } catch {
      setSettings({ state: 'error' })
    }
  }, [])

  const fetchResults = useCallback(async () => {
    try {
      const response = await fetch('/api/admin/weekly-push/results', { cache: 'no-store' })
      if (!response.ok) throw new Error(String(response.status))
      setResults({ state: 'ready', data: (await response.json()) as WeeklyPushResults })
    } catch {
      setResults({ state: 'error' })
    }
  }, [])

  useEffect(() => {
    void fetchSettings()
    void fetchResults()
  }, [fetchSettings, fetchResults])

  const ready = settings.state === 'ready' ? settings.data : null

  const touch = (updatedAt: string | null | undefined) => {
    if (!updatedAt) return
    setSettings((prev) =>
      prev.state === 'ready' ? { state: 'ready', data: { ...prev.data, last_changed_at: updatedAt } } : prev
    )
  }

  const replacePiece = (row: WeeklyPushPieceRow) => {
    setSettings((prev) =>
      prev.state === 'ready'
        ? {
            state: 'ready',
            data: {
              ...prev.data,
              pieces: prev.data.pieces.map((p) =>
                p.piece === row.piece ? { ...p, ...row, last_sent_local_date: p.last_sent_local_date } : p
              ),
            },
          }
        : prev
    )
    touch(row.updated_at)
  }

  const replaceText = (row: WeeklyPushTextRow) => {
    setSettings((prev) => {
      if (prev.state !== 'ready') return prev
      const same = (x: WeeklyPushTextRow) =>
        x.piece === row.piece && x.variant === row.variant && x.language === row.language
      const texts = prev.data.texts.some(same)
        ? prev.data.texts.map((x) => (same(x) ? row : x))
        : [...prev.data.texts, row]
      return { state: 'ready', data: { ...prev.data, texts } }
    })
    touch(row.updated_at)
  }

  const loadingLine = <p className={`text-sm ${DIM}`}>{t('loading')}</p>
  const loadFailed = (
    <div role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
      {t('messages.load_failed')}
    </div>
  )

  return (
    <div className="cms-width min-h-screen bg-gray-50/50">
      <Container className="py-8">
        <header className="mb-4">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">{t('title')}</h1>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">{t('subtitle')}</p>
          {ready ? (
            <p className={`mt-1 text-xs ${DIM}`}>
              {t('limits', {
                cap: ready.policy.week_cap,
                from: ready.policy.quiet_from_hour,
                until: ready.policy.quiet_until_hour,
              })}{' '}
              {t('audience')}
            </p>
          ) : null}
          {ready?.last_changed_at ? (
            <p className={`mt-1 text-xs ${DIM}`}>
              {t('last_changed', { date: dateFormat.format(new Date(ready.last_changed_at)) })}
            </p>
          ) : null}
        </header>

        <section aria-labelledby="weekly-push-pieces">
          <h2 id="weekly-push-pieces" className="mb-4 text-lg font-bold text-gray-900 dark:text-gray-100">
            {t('pieces.title')}
          </h2>
          {settings.state === 'loading' ? loadingLine : null}
          {settings.state === 'error' ? loadFailed : null}
          {ready ? (
            <div className="grid gap-4 lg:grid-cols-2">
              {WEEKLY_PUSH_PIECES.map((piece) => {
                const row = ready.pieces.find((p) => p.piece === piece)
                return row ? (
                  <PieceCard
                    key={piece}
                    row={row}
                    policy={ready.policy}
                    dateFormat={dateFormat}
                    onSaved={replacePiece}
                  />
                ) : null
              })}
            </div>
          ) : null}
        </section>

        <section aria-labelledby="weekly-push-results" className="mt-8">
          <header className="mb-4">
            <h2 id="weekly-push-results" className="text-lg font-bold text-gray-900 dark:text-gray-100">
              {t('results.title')}
            </h2>
            <p className={`mt-1 text-sm ${DIM}`}>{t('results.subtitle')}</p>
          </header>
          {results.state === 'loading' ? loadingLine : null}
          {results.state === 'error' ? (
            <div role="alert" className="flex items-center gap-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
              <span>{t('results.load_failed')}</span>
              <Button variant="outline" size="sm" onClick={() => {
                  setResults({ state: 'loading' })
                  void fetchResults()
                }}>
                {t('results.retry')}
              </Button>
            </div>
          ) : null}
          {results.state === 'ready' ? (
            <ResultsTable
              results={results.data}
              pieces={ready?.pieces ?? []}
              t={t}
              dateFormat={dateFormat}
              locale={locale}
            />
          ) : null}
        </section>

        <section aria-labelledby="weekly-push-texts" className="mt-8">
          <h2 id="weekly-push-texts" className="mb-4 text-lg font-bold text-gray-900 dark:text-gray-100">
            {t('texts.title')}
          </h2>
          {settings.state === 'loading' ? loadingLine : null}
          {settings.state === 'error' ? loadFailed : null}
          {ready ? <TextsBlock settings={ready} t={t} onSaved={replaceText} /> : null}
        </section>
      </Container>
    </div>
  )
}

// ── Pieces ───────────────────────────────────────────────────────────────────────────────

/** One piece: on/off and local hour, each saved on change. Exported for the render test. */
export function PieceCard({
  row,
  policy,
  dateFormat,
  onSaved,
}: {
  row: WeeklyPushPieceRow
  policy: WeeklyPushPolicy
  dateFormat: Intl.DateTimeFormat
  onSaved: (row: WeeklyPushPieceRow) => void
}) {
  const t = useTranslations('Pages.WeeklyPush')
  const [isActive, setIsActive] = useState(row.is_active)
  const [hour, setHour] = useState(row.local_hour)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState<string | null>(null)
  const [failed, setFailed] = useState<WeeklyPushErrorCode | null>(null)
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => {
    if (savedTimer.current) clearTimeout(savedTimer.current)
  }, [])

  const day = t(`pieces.${row.piece}.label`)
  const id = `weekly-push-${row.piece}`

  const save = async (change: { is_active?: boolean; local_hour?: number }, done: string) => {
    const previous = { isActive, hour }
    if (change.is_active !== undefined) setIsActive(change.is_active)
    if (change.local_hour !== undefined) setHour(change.local_hour)
    setSaving(true)
    setFailed(null)
    setSaved(null)
    try {
      const response = await fetch('/api/admin/weekly-push', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ piece: row.piece, ...change }),
      })
      const envelope = await response.json().catch(() => null)
      if (!response.ok) {
        setIsActive(previous.isActive)
        setHour(previous.hour)
        setFailed(envelope?.error?.code ?? 'unknown')
        return
      }
      const next = envelope as WeeklyPushPieceRow
      setIsActive(next.is_active)
      setHour(next.local_hour)
      onSaved(next)
      setSaved(done)
      if (savedTimer.current) clearTimeout(savedTimer.current)
      savedTimer.current = setTimeout(() => setSaved(null), SAVED_MS)
    } catch {
      setIsActive(previous.isActive)
      setHour(previous.hour)
      setFailed('unknown')
    } finally {
      setSaving(false)
    }
  }

  // English capitalizes weekdays, so the sentence keeps the label as is.
  const lowerDay = useLocale() === 'en' ? day : day.toLocaleLowerCase()

  return (
    <div
      className={`rounded-xl border border-gray-200 p-4 dark:border-gray-800 ${
        isActive ? 'bg-white dark:bg-gray-900' : 'bg-gray-50 dark:bg-gray-800/50'
      }`}>
      <p className="font-semibold text-gray-900 dark:text-white">{t('pieces.row_title', { day, hour })}</p>
      <p className="text-sm text-gray-600 dark:text-gray-300">{t(`pieces.${row.piece}.order`)}</p>
      <p className={`mt-1 text-xs ${DIM}`}>
        {t('pieces.never_repeats')}{' '}
        {row.last_sent_local_date
          ? t('pieces.last_send', { date: dateFormat.format(calendarDate(row.last_sent_local_date)) })
          : t('pieces.no_send_yet')}
      </p>

      <div className="mt-4 flex items-start gap-3">
        <input
          id={`${id}-active`}
          type="checkbox"
          checked={isActive}
          disabled={saving}
          onChange={(event) => {
            const next = event.target.checked
            void save(
              { is_active: next },
              t(next ? 'messages.piece_on' : 'messages.piece_off', { day: lowerDay })
            )
          }}
          aria-describedby={`${id}-active-hint`}
          className="mt-0.5 h-4 w-4 rounded border-gray-400 text-tuggi-blue focus:ring-tuggi-blue disabled:opacity-50"
        />
        <div className="min-w-0">
          <label htmlFor={`${id}-active`} className="text-sm font-semibold text-gray-900 dark:text-white">
            {isActive ? t('pieces.enabled') : t('pieces.disabled')}
          </label>
          <p id={`${id}-active-hint`} className={`text-xs ${DIM}`}>
            {t('pieces.disabled_hint')}
          </p>
        </div>
      </div>

      <div className="mt-4 max-w-[200px]">
        <Label htmlFor={`${id}-hour`}>{t('pieces.hour_label')}</Label>
        <Select
          id={`${id}-hour`}
          value={String(hour)}
          disabled={saving}
          aria-describedby={`${id}-hour-hint`}
          onValueChange={(value) => {
            const next = Number(value)
            void save({ local_hour: next }, t('messages.hour_saved', { hour: next }))
          }}
          className="mt-1">
          {policy.allowed_hours.map((h) => (
            <option key={h} value={String(h)}>
              {t('pieces.hour_option', { hour: h })}
            </option>
          ))}
        </Select>
      </div>
      <p id={`${id}-hour-hint`} className={`mt-1 text-xs ${DIM}`}>
        {t('pieces.hour_hint')}
      </p>

      {saved ? (
        <p role="status" className="mt-2 text-xs font-semibold text-green-700 dark:text-green-400">
          {saved}
        </p>
      ) : null}
      {failed ? (
        <p role="alert" className="mt-2 text-xs text-red-700 dark:text-red-400">
          {t(weeklyPushErrorKey(failed, 'piece'), errorValues(policy, failed))}
        </p>
      ) : null}
    </div>
  )
}

// ── Results ──────────────────────────────────────────────────────────────────────────────

function ResultsTable({
  results,
  pieces,
  t,
  dateFormat,
  locale,
}: {
  results: WeeklyPushResults
  pieces: WeeklyPushPieceRow[]
  t: Translate
  dateFormat: Intl.DateTimeFormat
  locale: string
}) {
  const dayMonth = useMemo(() => new Intl.DateTimeFormat(locale, { day: '2-digit', month: '2-digit' }), [locale])

  if (results.weeks.length === 0) {
    return (
      <p className="text-sm italic text-gray-500 dark:text-gray-400">
        {t('results.empty_title')}. {t('results.empty_body')}
      </p>
    )
  }

  const pieceLabel = (piece: WeeklyPushPiece) => {
    const day = t(`pieces.${piece}.label`)
    const hour = pieces.find((p) => p.piece === piece)?.local_hour
    return hour === undefined ? day : t('pieces.row_title', { day, hour })
  }
  const count = (n: number) => <span className={n === 0 ? DIM : undefined}>{n}</span>

  return (
    <div className="rounded-lg border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
      <DenseTableScroller label={t('results.caption', { weeks: WEEKLY_PUSH_RESULT_WEEKS })}>
        <table className="w-full border-collapse">
          <caption className="sr-only">{t('results.caption', { weeks: WEEKLY_PUSH_RESULT_WEEKS })}</caption>
          <thead>
            <tr>
              <th scope="col" className={HEAD_SOLO}>{t('results.date')}</th>
              <th scope="col" className={HEAD_SOLO}>{t('results.piece')}</th>
              <th scope="col" className={HEAD_SOLO_NUM} title={t('results.picked_hint')}>{t('results.picked')}</th>
              <th scope="col" className={HEAD_SOLO_NUM} title={t('results.sent_hint')}>{t('results.sent')}</th>
              <th scope="col" className={HEAD_SOLO_NUM} title={t('results.denied_hint')}>{t('results.denied')}</th>
              <th scope="col" className={HEAD_SOLO_NUM} title={t('results.in_progress_hint')}>{t('results.in_progress')}</th>
              <th scope="col" className={HEAD_SOLO_NUM} title={t('results.failed_hint')}>{t('results.failed')}</th>
            </tr>
          </thead>
          {results.weeks.map((week) => (
            <tbody key={week.week_start} className="border-t border-gray-200 dark:border-gray-800">
              <tr>
                <th
                  colSpan={RESULT_COLUMNS}
                  scope="colgroup"
                  className="bg-gray-50 px-3 py-1.5 text-left text-xs font-semibold text-gray-700 dark:bg-gray-800 dark:text-gray-200">
                  <span className="flex items-center justify-between gap-6">
                    <span>
                      {t('results.week', {
                        from: dayMonth.format(calendarDate(week.week_start)),
                        to: dayMonth.format(weekEnd(week.week_start)),
                      })}
                    </span>
                    <span title={t('results.push_off_today_hint')}>
                      {t('results.push_off_today')}:{' '}
                      {t('results.push_off_today_value', { off: week.push_off_today, people: week.sent_people })}
                    </span>
                  </span>
                </th>
              </tr>
              {week.sends.map((send) => (
                <tr key={`${send.piece}-${send.local_date}`} className="border-t border-gray-100 dark:border-gray-800">
                  <td className={`${CELL} whitespace-nowrap`}>{dateFormat.format(calendarDate(send.local_date))}</td>
                  <td className={`${CELL} whitespace-nowrap`}>{pieceLabel(send.piece)}</td>
                  <td className={`${NUM} font-semibold`}>{count(send.picked)}</td>
                  <td className={NUM}>{count(send.sent)}</td>
                  <td className={NUM}>{count(send.denied)}</td>
                  <td className={NUM}>{count(send.claimed)}</td>
                  <td className={`${NUM} ${DIM}`}>{notDelivered(send)}</td>
                </tr>
              ))}
            </tbody>
          ))}
        </table>
      </DenseTableScroller>
    </div>
  )
}

// ── Texts ────────────────────────────────────────────────────────────────────────────────

interface Editing {
  piece: WeeklyPushPiece
  variant: WeeklyPushVariant
  title: string
  body: string
  originalTitle: string
  originalBody: string
}

function problemKey(problem: WeeklyPushTextProblem): string {
  return problem.code === 'name_in_title' ? 'texts.errors.name_in_title' : weeklyPushErrorKey(problem.code, 'text')
}

function TextsBlock({
  settings,
  t,
  onSaved,
}: {
  settings: WeeklyPushSettings
  t: Translate
  onSaved: (row: WeeklyPushTextRow) => void
}) {
  const tLanguage = useTranslations('Pages.Marketing.Audience.language')
  const tCommon = useTranslations('Common.actions')
  const tPreview = useTranslations('Pages.Notifications.preview')
  const [language, setLanguage] = useState<WeeklyPushLanguage>('pt')
  const [editing, setEditing] = useState<Editing | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<WeeklyPushErrorCode | null>(null)
  const [savedRow, setSavedRow] = useState<string | null>(null)
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => {
    if (savedTimer.current) clearTimeout(savedTimer.current)
  }, [])

  const rows = WEEKLY_PUSH_PIECES.flatMap((piece) =>
    PIECE_VARIANTS[piece].map((variant) => ({
      piece,
      variant,
      text: settings.texts.find((x) => x.piece === piece && x.variant === variant && x.language === language) ?? null,
    }))
  )

  const dirty = editing !== null && (editing.title !== editing.originalTitle || editing.body !== editing.originalBody)
  const problems = editing ? validateWeeklyPushText(editing.variant, editing.title, editing.body) : []
  const titleProblems = problems.filter((p) => p.field === 'title')
  const bodyProblems = problems.filter((p) => p.field === 'body')
  const canSave = editing !== null && dirty && problems.length === 0 && !saving

  const open = (piece: WeeklyPushPiece, variant: WeeklyPushVariant, text: WeeklyPushTextRow | null) => {
    if (editing?.piece === piece && editing.variant === variant) {
      if (!dirty) setEditing(null)
      return
    }
    setSaveError(null)
    setSavedRow(null)
    setEditing({
      piece,
      variant,
      title: text?.title ?? '',
      body: text?.body ?? '',
      originalTitle: text?.title ?? '',
      originalBody: text?.body ?? '',
    })
  }

  const cancel = () => {
    setEditing(null)
    setSaveError(null)
  }

  const save = async () => {
    if (!editing || !canSave) return
    setSaving(true)
    setSaveError(null)
    try {
      const response = await fetch('/api/admin/weekly-push/texts', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          piece: editing.piece,
          variant: editing.variant,
          language,
          title: editing.title,
          body: editing.body,
        }),
      })
      const envelope = await response.json().catch(() => null)
      if (!response.ok) {
        setSaveError(envelope?.error?.code ?? 'unknown')
        return
      }
      onSaved(envelope as WeeklyPushTextRow)
      setSavedRow(`${editing.piece}-${editing.variant}`)
      if (savedTimer.current) clearTimeout(savedTimer.current)
      savedTimer.current = setTimeout(() => setSavedRow(null), SAVED_MS)
      setEditing(null)
    } catch {
      setSaveError('unknown')
    } finally {
      setSaving(false)
    }
  }

  const sample = (variant: WeeklyPushVariant) => ({
    name: variant === 'route' ? t('preview.sample_route_name') : t('preview.sample_event_name'),
    city: t('preview.sample_city'),
  })

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold text-gray-700 dark:text-gray-200">{t('texts.language_label')}</span>
        {WEEKLY_PUSH_LANGUAGES.map((code) => (
          <FilterChip key={code} active={language === code} disabled={editing !== null} onClick={() => setLanguage(code)}>
            {tLanguage(code)}
          </FilterChip>
        ))}
      </div>
      <p className={`mb-1 text-xs ${DIM}`}>{t('texts.language_hint')}</p>
      <p className={`mb-3 text-xs ${DIM}`}>
        {t('texts.variant_hint')} {t('texts.placeholders_hint')}
      </p>
      {editing ? (
        <p className={`mb-3 text-xs ${DIM}`} role="status">
          {t('texts.language_locked')}
        </p>
      ) : null}

      <div className="rounded-lg border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
        <DenseTableScroller maxHeightClassName="">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th scope="col" className={`${HEAD_SOLO} w-10`}>
                  <span className="sr-only">{t('texts.edit')}</span>
                </th>
                <th scope="col" className={HEAD_SOLO}>{t('texts.piece_label')}</th>
                <th scope="col" className={HEAD_SOLO}>{t('texts.variant_label')}</th>
                <th scope="col" className={HEAD_SOLO}>{t('texts.title_label')}</th>
                <th scope="col" className={HEAD_SOLO}>{t('texts.body_label')}</th>
                <th scope="col" className={HEAD_SOLO}>
                  <span className="sr-only">{t('texts.edit')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ piece, variant, text }) => {
                const rowId = `${piece}-${variant}`
                const isOpen = editing?.piece === piece && editing.variant === variant
                const locked = editing !== null && !isOpen && dirty
                const day = t(`pieces.${piece}.label`)
                const variantLabel = t(`texts.variant.${variant}`)
                return (
                  <Fragment key={rowId}>
                    <tr className="border-t border-gray-100 dark:border-gray-800">
                      <td className={CELL}>
                        <button
                          type="button"
                          aria-expanded={isOpen}
                          aria-controls={`weekly-push-edit-${rowId}`}
                          aria-label={t('texts.edit_aria', { day, variant: variantLabel })}
                          disabled={locked}
                          onClick={() => open(piece, variant, text)}
                          className="rounded p-1 text-gray-500 hover:bg-gray-100 disabled:opacity-40 dark:hover:bg-gray-800">
                          {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                        </button>
                      </td>
                      <td className={`${CELL} whitespace-nowrap`}>{day}</td>
                      <td className={`${CELL} whitespace-nowrap`}>
                        {variantLabel}
                        {savedRow === rowId ? (
                          <span role="status" className="ml-2 text-xs text-green-700 dark:text-green-400">
                            {t('messages.text_saved')}
                          </span>
                        ) : null}
                      </td>
                      {text ? (
                        <>
                          <td className={`${CELL} min-w-[200px]`}>
                            <WithPlaceholders text={text.title} />
                          </td>
                          <td className={`${CELL} min-w-[320px] whitespace-normal`}>
                            <WithPlaceholders text={text.body} />
                          </td>
                        </>
                      ) : (
                        <td colSpan={2} className={`${CELL} italic ${DIM}`}>
                          {t('texts.empty_title', { language: tLanguage(language) })}
                        </td>
                      )}
                      <td className={`${CELL} whitespace-nowrap text-right`}>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={locked || isOpen}
                          onClick={() => open(piece, variant, text)}
                          aria-label={t('texts.edit_aria', { day, variant: variantLabel })}>
                          {t('texts.edit')}
                        </Button>
                      </td>
                    </tr>
                    {isOpen && editing ? (
                      <tr id={`weekly-push-edit-${rowId}`} className="bg-gray-50/60 dark:bg-gray-800/40">
                        <td colSpan={6} className="px-3 py-4">
                          <div className="grid gap-6 lg:grid-cols-2">
                            <div>
                              <div className="flex items-center justify-between">
                                <Label htmlFor={`${rowId}-title`}>{t('texts.title_label')}</Label>
                                <CharCount value={stripPlaceholders(editing.title.trim())} max={WEEKLY_PUSH_TITLE_MAX} />
                              </div>
                              <Input
                                id={`${rowId}-title`}
                                autoFocus
                                value={editing.title}
                                aria-invalid={titleProblems.length > 0 ? true : undefined}
                                aria-describedby={titleProblems.length > 0 ? `${rowId}-title-problem` : undefined}
                                onChange={(e) => setEditing({ ...editing, title: e.target.value })}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    e.preventDefault()
                                    void save()
                                  } else if (e.key === 'Escape') {
                                    e.preventDefault()
                                    cancel()
                                  }
                                }}
                                className="mt-1 rounded-xl border-gray-200 focus:ring-tuggi-blue"
                              />
                              {titleProblems.length > 0 ? (
                                <p id={`${rowId}-title-problem`} className="mt-1 text-xs text-red-700 dark:text-red-400">
                                  {titleProblems.map((p) => t(problemKey(p), { ...errorValues(null, p.code), ...p.values })).join(' ')}
                                </p>
                              ) : null}

                              <div className="mt-4 flex items-center justify-between">
                                <Label htmlFor={`${rowId}-body`}>{t('texts.body_label')}</Label>
                                <CharCount value={stripPlaceholders(editing.body.trim())} max={WEEKLY_PUSH_BODY_MAX} />
                              </div>
                              <Textarea
                                id={`${rowId}-body`}
                                value={editing.body}
                                aria-invalid={bodyProblems.length > 0 ? true : undefined}
                                aria-describedby={bodyProblems.length > 0 ? `${rowId}-body-problem` : undefined}
                                onChange={(e) => setEditing({ ...editing, body: e.target.value })}
                                onKeyDown={(e) => {
                                  if (e.key === 'Escape') {
                                    e.preventDefault()
                                    cancel()
                                  }
                                }}
                                className="mt-1 min-h-[96px] rounded-xl border-gray-200 focus:ring-tuggi-blue"
                              />
                              {bodyProblems.length > 0 ? (
                                <p id={`${rowId}-body-problem`} className="mt-1 text-xs text-red-700 dark:text-red-400">
                                  {bodyProblems.map((p) => t(problemKey(p), { ...errorValues(null, p.code), ...p.values })).join(' ')}
                                </p>
                              ) : null}
                              <p className={`mt-1 text-xs ${DIM}`}>
                                {t('texts.counter_hint')} {t('texts.city_form_hint')}
                              </p>

                              {saveError ? (
                                <p role="alert" className="mt-3 rounded-md border border-red-200 bg-red-50 p-2 text-sm text-red-800">
                                  {t(weeklyPushErrorKey(saveError, 'text'), errorValues(null, saveError))}
                                </p>
                              ) : null}

                              <div className="mt-4 flex gap-2">
                                <Button variant="outline" size="sm" onClick={cancel} disabled={saving}>
                                  {tCommon('cancel')}
                                </Button>
                                <Button variant="cta" size="sm" onClick={() => void save()} disabled={!canSave}>
                                  {saving ? tCommon('saving') : t('texts.save')}
                                </Button>
                              </div>
                            </div>

                            <div>
                              <p className="mb-2 text-xs font-semibold text-gray-700 dark:text-gray-200">{t('preview.title')}</p>
                              <div className="max-w-[360px] rounded-xl border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-900">
                                <div className="flex items-center gap-2">
                                  <TuggiLogo size="sm" showText={false} className="h-5 w-5" />
                                  <span className="text-xs text-gray-500">{tPreview('app_name')}</span>
                                </div>
                                <p className="mt-2 text-sm font-semibold text-gray-900 dark:text-white">
                                  {fillWeeklyPushText(editing.title, sample(variant))}
                                </p>
                                <p className="text-sm text-gray-700 dark:text-gray-300">
                                  {fillWeeklyPushText(editing.body, sample(variant))}
                                </p>
                              </div>
                              <p className={`mt-2 text-xs ${DIM}`}>{t('preview.sample_hint')}</p>
                            </div>
                          </div>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </DenseTableScroller>
      </div>
    </div>
  )
}

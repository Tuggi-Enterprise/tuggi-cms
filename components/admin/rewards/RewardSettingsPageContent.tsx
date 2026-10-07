'use client'

/**
 * /admin/reward-settings — the operator edits the numbers of earned hours (#855, values of #854).
 *
 * Dense table grouped by program (`components/ui/dense-table.tsx`, DS-COMPONENTE-081), one value
 * edited at a time, inline: Enter asks for confirmation, Esc cancels. The confirmation is the
 * credit screen's `DialogShell`, and it opens on "Cancelar", never on the button that writes.
 * The database refusal is shown as the database gave it (`rewardSettingErrorText`).
 *
 * pt-BR only, by card. The page gate is `resolveAccess` (proxy); the API gate is `withAuth`.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Container } from '@/components/ui/Container'
import { CELL, DIM, HEAD, HEAD_NUM, NUM } from '@/components/ui/dense-table'
import { DialogShell } from '@/components/admin/credit/DialogShell'
import {
  PROBLEM_TEXT,
  PROGRAM_LABEL,
  PROGRAM_ORDER,
  UNIT_LABEL,
  labelOf,
  parseRewardValue,
  programOf,
  rewardSettingErrorText,
  ruleOf,
  validateRewardValue,
  type RewardSetting,
  type RewardSettingError,
  type RewardSettingsEnvelope,
} from '@/lib/rewards/settings'

const numberFormat = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 })
const dateFormat = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' })

type Load =
  | { state: 'loading' }
  | { state: 'error'; error: RewardSettingError | null }
  | { state: 'ready'; data: RewardSettingsEnvelope }

interface Pending {
  setting: RewardSetting
  next: number
}

export function RewardSettingsPageContent() {
  const [load, setLoad] = useState<Load>({ state: 'loading' })
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [pending, setPending] = useState<Pending | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<RewardSettingError | null>(null)
  const [savedKey, setSavedKey] = useState<string | null>(null)
  const cancelRef = useRef<HTMLButtonElement | null>(null)

  const fetchSettings = useCallback(async () => {
    try {
      const response = await fetch('/api/admin/reward-settings', { cache: 'no-store' })
      const envelope = await response.json().catch(() => null)
      if (!response.ok) {
        setLoad({ state: 'error', error: envelope?.error ?? null })
        return
      }
      setLoad({ state: 'ready', data: envelope as RewardSettingsEnvelope })
    } catch {
      setLoad({ state: 'error', error: null })
    }
  }, [])

  useEffect(() => {
    void fetchSettings()
  }, [fetchSettings])

  const groups = useMemo(() => {
    if (load.state !== 'ready') return []
    return PROGRAM_ORDER.map((program) => ({
      program,
      rows: load.data.settings.filter((s) => programOf(s.key) === program),
    })).filter((g) => g.rows.length > 0)
  }, [load])

  const editing =
    load.state === 'ready' ? load.data.settings.find((s) => s.key === editingKey) ?? null : null
  const parsed = parseRewardValue(draft)
  const problem = editing ? validateRewardValue(parsed, editing.unit) : null
  const unchanged = editing !== null && parsed === editing.value

  const startEdit = (setting: RewardSetting) => {
    setEditingKey(setting.key)
    setDraft(String(setting.value).replace('.', ','))
    setSavedKey(null)
  }

  const cancelEdit = () => {
    setEditingKey(null)
    setDraft('')
  }

  const askConfirm = () => {
    if (!editing || problem || unchanged) return
    setSaveError(null)
    setPending({ setting: editing, next: parsed })
  }

  const confirmSave = async () => {
    if (!pending) return
    setSaving(true)
    setSaveError(null)
    try {
      const response = await fetch('/api/admin/reward-settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: pending.setting.key, value: pending.next }),
      })
      const envelope = await response.json().catch(() => null)
      if (!response.ok) {
        setSaveError(envelope?.error ?? { code: 'unknown' })
        return
      }
      setSavedKey(pending.setting.key)
      setPending(null)
      cancelEdit()
      await fetchSettings()
    } catch {
      setSaveError({ code: 'unknown' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="cms-width min-h-screen bg-gray-50/50">
      <Container className="py-8">
        <header className="mb-4">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Horas concedidas</h1>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
            Valor novo vale para concessões futuras. Hora já creditada não muda.
          </p>
          {load.state === 'ready' && load.data.updated_at ? (
            <p className={`mt-1 text-xs ${DIM}`}>
              Última alteração: {dateFormat.format(new Date(load.data.updated_at))}
            </p>
          ) : null}
        </header>

        {load.state === 'loading' ? (
          <p className={`text-sm ${DIM}`}>Carregando…</p>
        ) : null}

        {load.state === 'error' ? (
          <div role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            Não foi possível ler os parâmetros. {rewardSettingErrorText(load.error)}
          </div>
        ) : null}

        {load.state === 'ready' ? (
          <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th className={HEAD}>Parâmetro</th>
                  <th className={HEAD_NUM}>Valor</th>
                  <th className={HEAD}>Unidade</th>
                  <th className={HEAD}>Regra</th>
                  <th className={HEAD}>
                    <span className="sr-only">Ação</span>
                  </th>
                </tr>
              </thead>
              {groups.map(({ program, rows }) => (
                <tbody key={program} className="border-t border-gray-200 dark:border-gray-800">
                  <tr>
                    <th
                      colSpan={5}
                      scope="colgroup"
                      className="bg-gray-50 px-3 py-1.5 text-left text-xs font-semibold text-gray-700 dark:bg-gray-800 dark:text-gray-200">
                      {PROGRAM_LABEL[program]}
                    </th>
                  </tr>
                  {rows.map((setting) => {
                    const isEditing = setting.key === editingKey
                    const inputId = `reward-${setting.key}`
                    return (
                      <tr key={setting.key} className="border-t border-gray-100 dark:border-gray-800">
                        <td className={CELL}>
                          <label htmlFor={inputId} className="block">
                            {labelOf(setting.key)}
                          </label>
                          <span className={`font-mono text-xs ${DIM}`}>{setting.key}</span>
                        </td>
                        <td className={NUM}>
                          {isEditing ? (
                            <div className="flex flex-col items-end gap-1">
                              <input
                                id={inputId}
                                autoFocus
                                inputMode="decimal"
                                value={draft}
                                aria-invalid={problem ? true : undefined}
                                aria-describedby={problem ? `${inputId}-problem` : undefined}
                                onChange={(e) => setDraft(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    e.preventDefault()
                                    askConfirm()
                                  } else if (e.key === 'Escape') {
                                    e.preventDefault()
                                    cancelEdit()
                                  }
                                }}
                                className="w-28 rounded-md border border-gray-300 px-2 py-1 text-right text-sm tabular-nums dark:border-gray-700 dark:bg-gray-800"
                              />
                              {problem ? (
                                <span id={`${inputId}-problem`} className="text-xs text-red-700 dark:text-red-400">
                                  {PROBLEM_TEXT[problem]}
                                </span>
                              ) : null}
                            </div>
                          ) : (
                            <>
                              {numberFormat.format(setting.value)}
                              {savedKey === setting.key ? (
                                <span className="ml-2 text-xs text-green-700 dark:text-green-400">salvo</span>
                              ) : null}
                            </>
                          )}
                        </td>
                        <td className={`${CELL} ${DIM}`}>{setting.unit ? UNIT_LABEL[setting.unit] : '—'}</td>
                        <td className={`${CELL} ${DIM} whitespace-nowrap font-mono text-xs`}>
                          {ruleOf(setting.key) ?? '—'}
                        </td>
                        <td className={`${CELL} whitespace-nowrap text-right`}>
                          {isEditing ? (
                            <div className="flex justify-end gap-2">
                              <Button variant="outline" size="sm" onClick={cancelEdit}>
                                Cancelar
                              </Button>
                              <Button
                                variant="cta"
                                size="sm"
                                onClick={askConfirm}
                                disabled={Boolean(problem) || unchanged}>
                                Salvar
                              </Button>
                            </div>
                          ) : (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => startEdit(setting)}
                              aria-label={`Editar ${labelOf(setting.key)}`}>
                              Editar
                            </Button>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              ))}
            </table>
          </div>
        ) : null}
      </Container>

      {pending ? (
        <DialogShell
          open
          title="Confirmar alteração"
          busy={saving}
          onClose={() => setPending(null)}
          initialFocusRef={cancelRef}
          footer={
            <>
              <Button ref={cancelRef} variant="outline" onClick={() => setPending(null)} disabled={saving}>
                Cancelar
              </Button>
              <Button variant="cta" onClick={confirmSave} disabled={saving}>
                {saving ? 'Salvando…' : 'Salvar valor'}
              </Button>
            </>
          }>
          <p className="text-sm text-gray-800 dark:text-gray-200">
            <strong>{labelOf(pending.setting.key)}</strong>
          </p>
          <p className="mt-2 text-sm tabular-nums text-gray-800 dark:text-gray-200">
            {numberFormat.format(pending.setting.value)} → <strong>{numberFormat.format(pending.next)}</strong>{' '}
            {pending.setting.unit ? UNIT_LABEL[pending.setting.unit] : ''}
          </p>
          <p className={`mt-3 text-sm ${DIM}`}>
            Vale para as próximas concessões. Hora já creditada não muda.
          </p>
          {saveError ? (
            <p role="alert" className="mt-3 rounded-md bg-red-50 p-2 text-sm text-red-800">
              {rewardSettingErrorText(saveError)}
            </p>
          ) : null}
        </DialogShell>
      ) : null}
    </div>
  )
}

'use client'

/**
 * The editor of `drive.reward_settings` values (#855), shared by `/admin/reward-settings` (every
 * key) and `/admin/trip-reminder` (the welcome and planned trip keys, #1233). One editor, so the
 * two screens cannot disagree about what a valid value is or how a refusal reads.
 *
 * Dense table grouped by program (`components/ui/dense-table.tsx`, DS-COMPONENTE-081), one value
 * edited at a time, inline: Enter asks for confirmation, Esc cancels. The confirmation opens on
 * "Cancelar", never on the button that writes. The column band is `HEAD_SOLO`: the program rows
 * live inside the body, so a `top-7` band (`HEAD`) covered the first of them.
 * The write is `PATCH /api/admin/reward-settings`
 * (`drive.set_reward_setting` on the operator's JWT); the database refusal is shown as the
 * database gave it (`rewardSettingErrorText`).
 */

import { useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { CELL, DIM, HEAD_SOLO, HEAD_SOLO_NUM, NUM } from '@/components/ui/dense-table'
import { DialogShell } from '@/components/admin/credit/DialogShell'
import {
  PROBLEM_TEXT,
  PROGRAM_LABEL,
  PROGRAM_ORDER,
  UNIT_LABEL,
  hintOf,
  labelOf,
  parseRewardValue,
  programOf,
  rewardSettingErrorText,
  ruleOf,
  validateRewardValue,
  type RewardSetting,
  type RewardSettingError,
} from '@/lib/rewards/settings'

const numberFormat = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 })

interface Pending {
  setting: RewardSetting
  next: number
}

export function RewardSettingsTable({
  settings,
  onSaved,
}: {
  settings: RewardSetting[]
  /** Called after a write the database accepted, so the owner reloads its read. */
  onSaved: () => Promise<void> | void
}) {
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [pending, setPending] = useState<Pending | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<RewardSettingError | null>(null)
  const [savedKey, setSavedKey] = useState<string | null>(null)
  const cancelRef = useRef<HTMLButtonElement | null>(null)

  const groups = useMemo(
    () =>
      PROGRAM_ORDER.map((program) => ({
        program,
        rows: settings.filter((s) => programOf(s.key) === program),
      })).filter((g) => g.rows.length > 0),
    [settings]
  )

  const editing = settings.find((s) => s.key === editingKey) ?? null
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
      await onSaved()
    } catch {
      setSaveError({ code: 'unknown' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className={HEAD_SOLO}>Parâmetro</th>
              <th className={HEAD_SOLO_NUM}>Valor</th>
              <th className={HEAD_SOLO}>Unidade</th>
              <th className={HEAD_SOLO}>Regra</th>
              <th className={HEAD_SOLO}>
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
                const hint = hintOf(setting.key)
                return (
                  <tr key={setting.key} className="border-t border-gray-100 dark:border-gray-800">
                    <td className={CELL}>
                      <label htmlFor={inputId} className="block">
                        {labelOf(setting.key)}
                      </label>
                      <span className={`font-mono text-xs ${DIM}`}>{setting.key}</span>
                      {hint ? (
                        <p id={`${inputId}-hint`} className="mt-1 text-xs text-amber-800 dark:text-amber-300">
                          {hint}
                        </p>
                      ) : null}
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
                            aria-describedby={
                              [problem ? `${inputId}-problem` : null, hint ? `${inputId}-hint` : null]
                                .filter(Boolean)
                                .join(' ') || undefined
                            }
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
                      {setting.rule_id ?? ruleOf(setting.key) ?? '—'}
                    </td>
                    <td className={`${CELL} whitespace-nowrap text-right`}>
                      {isEditing ? (
                        <div className="flex justify-end gap-2">
                          <Button variant="outline" size="sm" onClick={cancelEdit}>
                            Cancelar
                          </Button>
                          <Button variant="cta" size="sm" onClick={askConfirm} disabled={Boolean(problem) || unchanged}>
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
          <p className={`mt-3 text-sm ${DIM}`}>Vale para as próximas concessões. Hora já creditada não muda.</p>
          {saveError ? (
            <p role="alert" className="mt-3 rounded-md bg-red-50 p-2 text-sm text-red-800">
              {rewardSettingErrorText(saveError)}
            </p>
          ) : null}
        </DialogShell>
      ) : null}
    </>
  )
}

'use client'

/**
 * Quadro or Tabela — the one control that switches between the two views of `/admin/clients`.
 *
 * THE BOARD IS THE DEFAULT, and only `?view=table` is ever written. The screen is opened to
 * WORK the queue far more often than to look a partner up, and a value that is never written
 * when it is the default keeps `Limpar filtros` able to empty the address bar — the same
 * discipline `applyFilters` follows for `state=all`. It also means every link already out
 * there, none of which carries `view`, lands on the board.
 *
 * `VIEW_PARAM` is deliberately NOT in `PARAM_KEYS` of `directory-filter`: it is not a filter,
 * and `applyFilters` copies the whole `URLSearchParams` while touching only the keys it knows,
 * so the view survives narrowing the rail for free.
 */

import { useTranslations } from 'next-intl'

export const VIEW_PARAM = 'view'

/** The only written value. Anything else — including nothing — is the board. */
export const TABLE_VIEW = 'table'

export function isBoardView(param: string | null): boolean {
  return param !== TABLE_VIEW
}

interface ViewSwitchProps {
  board: boolean
  onChange: (board: boolean) => void
}

export function ViewSwitch({ board, onChange }: ViewSwitchProps) {
  const t = useTranslations('Clients.board')

  return (
    <div
      role="group"
      aria-label={t('switchLabel')}
      className="inline-flex overflow-hidden rounded-xl border border-gray-200 dark:border-gray-700"
    >
      <Option label={t('boardView')} active={board} onSelect={() => onChange(true)} />
      <Option label={t('tableView')} active={!board} onSelect={() => onChange(false)} />
    </div>
  )
}

/**
 * `aria-pressed` and not a tab: switching does not reveal a panel inside this widget, it
 * navigates. The active one is `text-gray-900` on a tinted surface — the state is carried by
 * the word's weight and by the attribute, never by colour alone (DS-A11Y-003).
 */
function Option({
  label,
  active,
  onSelect,
}: {
  label: string
  active: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onSelect}
      className={`min-h-[24px] px-3 py-1.5 text-sm transition-colors ${
        active
          ? 'bg-primary-800/10 font-semibold text-gray-900 dark:bg-tuggi-blue/10 dark:text-white'
          : 'text-primary-800 hover:bg-gray-50 dark:text-tuggi-blue dark:hover:bg-gray-800'
      }`}
    >
      {label}
    </button>
  )
}

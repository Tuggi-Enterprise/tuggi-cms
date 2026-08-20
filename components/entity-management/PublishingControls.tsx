'use client'

/**
 * PublishingControls — approved / active / priority of a Place or an Event.
 *
 * WHY IT LEFT THE FORM: these three lived at the bottom of the Details tab, after Identity,
 * Commerce and Amenities, which on a place with every field filled means below the fold. The
 * operator's report was literal — "esses campos ficam escondidos" — and the ask was to put them
 * in the sidebar. They are the shortest decision on the screen and the one people come back for,
 * so they sit where the navigation is, not at the end of a form.
 *
 * The labels come from the caller: this component is rendered under two i18n namespaces
 * (`Modals.PlaceDetails` and `Modals.EventDetails`), and calling `useTranslations` here would
 * print the key name to whichever screen does not own the namespace.
 *
 * Stacked and not in a row because the sidebar is 18rem wide; the horizontal layout is what the
 * wide Details column allowed.
 */

interface PublishingControlsProps {
  title: string
  labels: { approved: string; active: string; priority: string }
  approved: boolean
  isActive: boolean
  priorityLevel: number
  disabled?: boolean
  onChange: (patch: { approved?: boolean; is_active?: boolean; priority_level?: number }) => void
}

const PRIORITY_LEVELS = [1, 2, 3]

export function PublishingControls({
  title, labels, approved, isActive, priorityLevel, disabled = false, onChange,
}: PublishingControlsProps) {
  return (
    <section className="mt-6 pt-5 border-t border-gray-200 dark:border-gray-800">
      <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest px-3">{title}</span>
      <div className="mt-3 flex flex-col gap-3 px-3">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={approved}
            disabled={disabled}
            onChange={(e) => onChange({ approved: e.target.checked })}
            className="w-4 h-4 rounded accent-tuggi-blue"
          />
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">{labels.approved}</span>
        </label>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={isActive}
            disabled={disabled}
            onChange={(e) => onChange({ is_active: e.target.checked })}
            className="w-4 h-4 rounded accent-tuggi-blue"
          />
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">{labels.active}</span>
        </label>
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">{labels.priority}</span>
          <select
            value={priorityLevel}
            disabled={disabled}
            onChange={(e) => onChange({ priority_level: Number(e.target.value) })}
            className="px-3 py-1.5 bg-white dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700 rounded-lg text-sm dark:text-white outline-none focus:ring-2 focus:ring-tuggi-blue"
          >
            {PRIORITY_LEVELS.map((level) => (
              <option key={level} value={level}>{level}</option>
            ))}
          </select>
        </div>
      </div>
    </section>
  )
}

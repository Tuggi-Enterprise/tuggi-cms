'use client'

import { useId, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

export const FIELD_LABEL = 'text-[10px] font-bold text-gray-500 uppercase tracking-widest'
const VALUE = 'text-sm font-bold text-gray-900 dark:text-white'

interface EditFieldProps {
  label: string
  value: string
  isEditing: boolean
  onChange: (val: string) => void
  isLink?: boolean
  type?: string
  placeholder?: string
  fullWidth?: boolean
  multiline?: boolean
  disabled?: boolean
}

/**
 * Editable / read-only field used by every Client editor tab.
 * View mode shows the value as plain text (or as a link when isLink).
 * Edit mode shows an input/textarea. Identical visual language to the
 * legacy ClientDetails EditField, extracted to one source of truth.
 *
 * No placeholder unless the caller passes one (#911): the old default, `Enter {label}...`, was
 * English in every empty field of a Portuguese screen and repeated the label above it. It was
 * also the only name the input had; the label above is now tied to it by `htmlFor`.
 */
export function EditField({
  label,
  value,
  isEditing,
  onChange,
  isLink,
  type = 'text',
  placeholder,
  fullWidth,
  multiline,
  disabled,
}: EditFieldProps) {
  const id = useId()
  const inputClasses =
    'w-full px-3 py-2 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-sm font-semibold text-gray-900 dark:text-white outline-none focus:ring-2 focus:ring-tuggi-blue/30 transition-all disabled:opacity-50'

  return (
    <div className={cn('space-y-1', fullWidth && 'sm:col-span-2')}>
      {isEditing ? (
        <label htmlFor={id} className={cn(FIELD_LABEL, 'block')}>
          {label}
        </label>
      ) : (
        <p className={FIELD_LABEL}>{label}</p>
      )}
      {isEditing ? (
        multiline ? (
          <textarea
            id={id}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            rows={3}
            disabled={disabled}
            className={cn(inputClasses, 'resize-none')}
            placeholder={placeholder}
          />
        ) : (
          <input
            id={id}
            type={type}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            disabled={disabled}
            className={inputClasses}
            placeholder={placeholder}
          />
        )
      ) : isLink && value && value !== '-' ? (
        <a
          href={value.startsWith('http') ? value : `https://${value}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm font-bold text-tuggi-blue hover:underline break-all"
        >
          {value}
        </a>
      ) : (
        <p className={cn(VALUE, 'break-all')}>{value || '-'}</p>
      )}
    </div>
  )
}

/**
 * The read-only face of `EditField` for a value that is not a plain string — a link, a list, a
 * button beside the value. Same label, same weight; used by the portal validation (#870).
 */
export function ReadField({ label, children, fullWidth }: { label: string; children: ReactNode; fullWidth?: boolean }) {
  const empty = children == null || children === '' || (Array.isArray(children) && children.length === 0)
  return (
    <div className={cn('space-y-1', fullWidth && 'sm:col-span-2')}>
      <p className={FIELD_LABEL}>{label}</p>
      <div className={cn(VALUE, 'break-words')}>{empty ? '-' : children}</div>
    </div>
  )
}

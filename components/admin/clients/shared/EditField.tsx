'use client'

import { cn } from '@/lib/utils'

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
  const inputClasses =
    'w-full px-3 py-2 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-sm font-semibold text-gray-900 dark:text-white outline-none focus:ring-2 focus:ring-tuggi-blue/30 transition-all disabled:opacity-50'

  return (
    <div className={cn('space-y-1', fullWidth && 'sm:col-span-2')}>
      <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">{label}</p>
      {isEditing ? (
        multiline ? (
          <textarea
            value={value}
            onChange={(e) => onChange(e.target.value)}
            rows={3}
            disabled={disabled}
            className={cn(inputClasses, 'resize-none')}
            placeholder={placeholder ?? `Enter ${label}...`}
          />
        ) : (
          <input
            type={type}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            disabled={disabled}
            className={inputClasses}
            placeholder={placeholder ?? `Enter ${label}...`}
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
        <p className="text-sm font-bold text-gray-900 dark:text-white break-all">{value || '-'}</p>
      )}
    </div>
  )
}

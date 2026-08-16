/**
 * The external surface does not inherit the CMS density — DS-LAYOUT-005.
 *
 * `components/ui/input.tsx` (h-10 = 40 px, `text-sm` = 14 px) and `label.tsx` serve the
 * curator who is in the CMS eight hours a day; tightening them to please a phone costs
 * that person clicks every day. So the primitives stay exactly as they are and the
 * override lives here, in one place, instead of being retyped per field:
 *
 *   - 48 px minimum height on every control (HIG 44 pt, Material 48 dp; WCAG 2.2
 *     SC 2.5.8 floors it at 24×24 and 44 is the Tuggi ruler for this surface);
 *   - `text-base` = 16 px in every entry field (SC 1.4.4, and it is also what stops
 *     Safari on iOS from zooming when the field takes focus);
 *   - single column at any width — the segment is a phone behind a counter.
 *
 * Colours: `bg-primary-800` (#00719F, white on it = 5.44:1) for the primary action, never
 * `bg-primary` (#00A8E8 = 2.70:1); `border-input` (#8A8A8A = 3.45:1) because inside a
 * white card the border is the only thing identifying the control (SC 1.4.11); and
 * `text-destructive` (#DC2626 = 4.83:1) for errors, never `text-red-500` (3.76:1).
 */

export const FIELD_LABEL = 'block text-base font-semibold text-gray-900'

export const FIELD_HELP = 'mt-1 text-sm text-gray-700'

export const FIELD_CONTROL =
  'mt-2 block w-full min-h-[48px] rounded-md border border-input bg-white px-3 py-3 text-base ' +
  'text-gray-900 placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-primary ' +
  'focus:ring-offset-2 focus:border-primary-800'

export const FIELD_CONTROL_INVALID = 'border-destructive focus:border-destructive'

export const FIELD_ERROR = 'mt-2 flex items-start gap-2 text-sm font-medium text-destructive'

export const BUTTON_PRIMARY =
  'inline-flex w-full min-h-[48px] items-center justify-center rounded-md bg-primary-800 ' +
  'px-4 py-3 text-base font-semibold text-white transition-colors hover:bg-[#005D83] ' +
  'focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2'

export const BUTTON_SECONDARY =
  'inline-flex w-full min-h-[48px] items-center justify-center rounded-md border border-input ' +
  'bg-white px-4 py-3 text-base font-semibold text-primary-800 transition-colors hover:bg-gray-50 ' +
  'focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2'

export const BUTTON_QUIET =
  'inline-flex min-h-[44px] items-center justify-center rounded-md px-3 py-2 text-base ' +
  'font-medium text-primary-800 underline underline-offset-4 focus:outline-none ' +
  'focus:ring-2 focus:ring-primary focus:ring-offset-2'

/** Single column at any width, and a comfortable measure on a desktop. */
export const PAGE_SHELL = 'mx-auto w-full max-w-xl px-4 pb-40 pt-6'

export const CARD = 'rounded-xl border border-input bg-white p-4 sm:p-6'

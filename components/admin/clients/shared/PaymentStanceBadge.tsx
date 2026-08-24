'use client'

/**
 * PAGANTE OU NÃO PAGANTE — the binary, wherever a surface has room for a word.
 *
 * IT LEFT `FiscalPaymentsTab` THE MOMENT THE TABLE ALSO NEEDED IT. A second copy of a pill is
 * not the expensive part; a second copy of the DECISIONS inside it is — which green, which grey,
 * which of the two words, and whether the icon announces itself. Those four would have drifted
 * the first time somebody adjusted one surface, and the drift would read as two screens
 * disagreeing about who pays.
 *
 * THE WORD COMES FROM `Clients.stance` AND NOT FROM THE CALLER. It used to be a `label` prop,
 * which is how the fiscal tab could say `Pagante` while the table said something else — one
 * fact, two i18n keys, two chances to edit only one of them. The component reads the namespace
 * itself, so there is one word and one place to change it.
 *
 * ── THREE CHANNELS, AND THE COLOUR IS ONLY ONE OF THEM ──────────────────────────────────────
 *
 * DS-A11Y-003 asks for colour PLUS one of icon, text, shape or position. This carries all three
 * of the first, which is what lets it be the whole mark on a surface — unlike the board's card,
 * where the stripe is a summary of a plan line that is already there in words.
 *
 * MEASURED, because a green nobody measured is how `#00A8E8` ended up painting text at 2.70:1
 * elsewhere in this repo. As INK the badge answers to SC 1.4.3 (4.5:1) and as a BORDER to
 * SC 1.4.11 (3:1):
 *
 *   paying      text `green-700`   #15803D → 5.02:1 on white, 4.79:1 on the `green-50` fill
 *               text `emerald-400` #34D399 → 9.23:1 on gray-900
 *               border `green-700` → 5.02:1 on white, 3.54:1 on gray-900 (one token, both modes)
 *   not paying  text `gray-700`    #374151 → 10.31:1 on white
 *               text `gray-300`    #D1D5DB → 12.04:1 on gray-900
 *               border `gray-500`  #6B7280 → 4.83:1 on white, 3.67:1 on gray-900
 *
 * THE ICON IS `aria-hidden`. The word beside it is the accessible name, and a screen reader that
 * announced `circle-off, não pagante` would be reading the drawing (DS-A11Y-004).
 */

import { useTranslations } from 'next-intl'
import { CircleDollarSign, CircleOff } from 'lucide-react'
import type { PaymentStance } from '@/lib/clients/partner-plan'

const SHELL = 'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest'

const SKIN: Record<PaymentStance, string> = {
  paying:
    'border-green-700 bg-green-50 text-green-700 dark:border-green-700 dark:bg-emerald-500/10 dark:text-emerald-400',
  not_paying:
    'border-gray-500 bg-gray-50 text-gray-700 dark:border-gray-500 dark:bg-gray-800 dark:text-gray-300',
}

export function PaymentStanceBadge({ stance }: { stance: PaymentStance }) {
  const t = useTranslations('Clients.stance')
  const Icon = stance === 'paying' ? CircleDollarSign : CircleOff

  return (
    <span className={`${SHELL} ${SKIN[stance]}`}>
      <Icon className="h-3 w-3" aria-hidden="true" />
      {t(stance)}
    </span>
  )
}

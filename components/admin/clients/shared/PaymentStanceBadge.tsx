'use client'

/**
 * PAGANTE OU NÃO PAGANTE — one symbol, the same one on every surface of the CMS.
 *
 * IT LEFT `FiscalPaymentsTab` THE MOMENT THE TABLE ALSO NEEDED IT. A second copy of a pill is
 * not the expensive part; a second copy of the DECISIONS inside it is — which green, which grey,
 * which icon, and whether the drawing announces itself. Those would have drifted the first time
 * somebody adjusted one surface, and the drift would read as two screens disagreeing about who
 * pays.
 *
 * ── IT IS A SYMBOL, AND SINCE 2026-08-26 THAT IS THE ONLY THING IT IS ───────────────────────
 *
 * It used to print the word beside the icon. `NÃO PAGANTE` in a 260px card of the Places grid
 * wrapped onto two lines and pushed `APROVADO` off the card; the operator reported it twice, and
 * then asked for the symbol everywhere — *"podemos padronizar esse simbolo em todos os locais"*.
 *
 * THE STANDARD IS THE DEFAULT AND NOT A PROP, deliberately. A `compact` flag would make the
 * standard something each caller has to remember to ask for, and the sixth surface would be the
 * one that forgot — which is how a design system stops being one. There is a single rendering,
 * so there is nothing to drift.
 *
 * THE WORD DID NOT DISAPPEAR, IT MOVED. Every one of the five call sites already carries it in
 * context and would have been saying it twice: the directory has a `Plano` column header AND the
 * record line under the badge (`R$ 149,00 por mês`, `Cortesia`, `Plano: ninguém declarou`); the
 * fiscal tab sits beside the `MENSALIDADE` label and above the value; the description studio
 * prints the plan's SOURCE next to it; the Places card names the partner on the same line. The
 * badge answers "paying?" — never what the money is, which is the record's job and not a
 * colour's.
 *
 * ── CHANNELS, AND THE COLOUR IS ONLY ONE OF THEM ────────────────────────────────────────────
 *
 * DS-A11Y-003 asks for colour PLUS one of icon, text, shape or position. Dropping the word leaves
 * colour, icon AND shape, so it still clears the rule with one channel to spare.
 *
 * WHAT DROPPING THE WORD DID COST is the accessible name, and that is not optional: the word used
 * to BE it. So it moved onto the element — `role="img"` with an `aria-label` — and the drawing
 * inside stays `aria-hidden`, because a screen reader announcing `circle-off, não pagante` would
 * be reading the drawing (DS-A11Y-004). `title` gives the same word to a sighted operator on
 * hover, which is what makes the symbol learnable on first contact.
 *
 * MEASURED, because a green nobody measured is how `#00A8E8` ended up painting text at 2.70:1
 * elsewhere in this repo. As the only INK left, the icon answers to SC 1.4.11 (3:1) for non-text
 * content, and the border to the same:
 *
 *   paying      icon `green-700`   #15803D → 5.02:1 on white, 4.79:1 on the `green-50` fill
 *               icon `emerald-400` #34D399 → 9.23:1 on gray-900
 *               border `green-700` → 5.02:1 on white, 3.54:1 on gray-900 (one token, both modes)
 *   not paying  icon `gray-700`    #374151 → 10.31:1 on white
 *               icon `gray-300`    #D1D5DB → 12.04:1 on gray-900
 *               border `gray-500`  #6B7280 → 4.83:1 on white, 3.67:1 on gray-900
 *
 * All six clear 3:1 with room, and they are the same tokens as before — nothing new to measure.
 */

import { useTranslations } from 'next-intl'
import { CircleDollarSign, CircleOff } from 'lucide-react'
import type { PaymentStance } from '@/lib/clients/partner-plan'

/** A fixed circle: it never wraps, never grows, and never pushes a neighbour off a card. */
const SHELL = 'inline-flex items-center justify-center shrink-0 rounded-full border h-6 w-6'

const SKIN: Record<PaymentStance, string> = {
  paying:
    'border-green-700 bg-green-50 text-green-700 dark:border-green-700 dark:bg-emerald-500/10 dark:text-emerald-400',
  not_paying:
    'border-gray-500 bg-gray-50 text-gray-700 dark:border-gray-500 dark:bg-gray-800 dark:text-gray-300',
}

export function PaymentStanceBadge({ stance }: { stance: PaymentStance }) {
  const t = useTranslations('Clients.stance')
  const Icon = stance === 'paying' ? CircleDollarSign : CircleOff
  const label = t(stance)

  return (
    <span className={`${SHELL} ${SKIN[stance]}`} role="img" aria-label={label} title={label}>
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
    </span>
  )
}

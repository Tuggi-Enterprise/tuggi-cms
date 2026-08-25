/**
 * The two class strings the parceria screens draw with — declared ONCE.
 *
 * They were declared four times, verbatim, in `ProposalReview`, `RegularityBand`,
 * `PromotionPanel` and `OutboundMessage`, each carrying a copy of the same comment explaining
 * why. Four copies of a decision is the DRY defect of CLAUDE.md §6 in its cheapest form: the day
 * somebody fixes the dark-mode border in one of them, three screens keep the old one and nothing
 * breaks. `components/admin/contract/ContractManager.tsx` holds a FIFTH copy and is not touched
 * here — its `FIELD` bakes a `mt-1` in, so it is not the same string, and rewriting a screen
 * this card does not change is the mass edit the scout rule forbids.
 *
 * THE SHELL IS `/pois`'s, THE INK IS NOT, and the two halves are separable on purpose.
 *
 * The CMS's visual language is the glass panel: `rounded-3xl`, `backdrop-blur-xl`, a hairline
 * border and a wide shadow, over `bg-gray-50 dark:bg-gray-950` — 36 files draw it. What these
 * screens do NOT take from `/pois` is the paint. That screen writes text and draws informative
 * icons in `text-tuggi-blue` (#00A8E8, 2.70:1 on white — SC 1.4.3 asks 4.5:1). Here the ink stays
 * `text-primary-800` (#00719F, 5.44:1) in daylight and becomes `text-tuggi-blue` in the dark,
 * where the same colour measures 6.57:1 over `gray-900`. The brand blue is not a bad ink; it is
 * a bad ink ON WHITE.
 *
 * Micro-caps labels are `text-gray-500` and not `/pois`'s `text-gray-400`, which measures
 * 2.51:1 at 10px — a defect of the pattern, reported to `design` in
 * `docs/dev/briefing-design-parcerias.md`.
 */
export const CARD =
  'rounded-3xl border border-gray-200 bg-white/70 shadow-2xl shadow-black/5 backdrop-blur-xl ' +
  'dark:border-gray-800 dark:bg-gray-900/70'

/** One typed control, in the shape the rest of the CMS uses. */
export const FIELD =
  'block w-full rounded-xl border border-gray-200 bg-gray-50/50 px-3 py-2.5 text-sm text-gray-900 ' +
  'outline-none transition-all focus:border-transparent focus:ring-2 focus:ring-primary-800 ' +
  'dark:border-gray-700 dark:bg-gray-900/50 dark:text-white'

/**
 * A LINK that carries the weight of the primary act — the `cta` variant of `components/ui/button`
 * in anchor clothes.
 *
 * `Button` has no `asChild` (there is no `@radix-ui/react-slot` in this project), and wrapping a
 * `<Link>` in a `<button>` is a control inside a control: the keyboard gets two stops and the
 * screen reader announces a button that is a link. `Continuar em {nome}` IS a navigation, so it
 * is an anchor, and the paint is the same 5.44:1 white-on-`primary-800` the variant measured.
 */
export const CTA_LINK =
  'inline-flex h-10 items-center justify-center whitespace-nowrap rounded-md bg-primary-800 px-4 py-2 ' +
  'text-sm font-medium text-white transition-colors hover:brightness-90 focus-visible:outline-none ' +
  'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2'

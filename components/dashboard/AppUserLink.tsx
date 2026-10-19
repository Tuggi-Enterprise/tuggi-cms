'use client'

/**
 * The tourist's nickname, wherever a CMS screen prints one — and the door to the file.
 *
 * **This module is the only way `AppUserDrawer` is opened.** Six surfaces used to differ: two
 * (`app/[locale]/users/app`, `UsersAll`) hung an `onClick` on the `<tr>`, and four printed
 * dead text. A row with a click handler is not reachable by keyboard, has no role, and gives
 * no hint it does anything — so the two that "worked" worked only for a mouse. The label is
 * a `<button>` now: tab reaches it, Enter and Space fire it, and `aria-haspopup="dialog"`
 * says what it will do before it does it.
 *
 * The trigger owns the drawer rather than reporting a selection up to the page. That is what
 * makes the six surfaces the same three lines instead of six copies of "state + conditional
 * render", and it is why the row `onClick` could go away rather than be kept in parallel:
 * two owners of "which file is open" on one screen is the defect this card came to remove
 * (CLAUDE.md §6), and the one that survives is the accessible one.
 *
 * The drawer goes to `document.body` through a portal. It renders inside a `<td>` on three
 * screens and inside a `<p>` on three others, and a `position: fixed` overlay nested in a
 * transformed or scrolled ancestor is a bug that only shows up on one of the six.
 *
 * The label itself is `appUserLabel` — `nickname`, else the first 8 characters of the
 * `user_id` (**BR-USUARIO-042**). It is also the button's accessible name, which is the
 * point: the operator hears the same identifier he reads. With neither link there is nobody
 * to open, so the em dash stays plain text.
 *
 * The second way in is an address: `/users/app?user=<id>&tab=<tab>` (#976), which is also where
 * the old Passaporte page redirects. `AppUserDeepLink` is that door, and it lives here so the
 * drawer still has one owner module; the list reads the URL and hands it the two values.
 */

import { useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/utils'
import { appUserLabel, type AppUserIdentity } from '@/lib/format/user-identity'
import { AppUserDrawer } from '@/components/dashboard/AppUserDrawer'
import type { AppUserTab } from '@/lib/users/app-user-href'

export function AppUserLink({
  user,
  className,
  onUpdate,
}: {
  user: AppUserIdentity | null | undefined
  /** Type scale and colour belong to the row; the affordance belongs here. */
  className?: string
  /** The host's list is stale after a grant or a client link — #310, #659. */
  onUpdate?: () => void
}) {
  const [isOpen, setIsOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)

  const label = appUserLabel(user)
  const userId = user?.user_id?.trim()

  if (!userId) return <span className={className}>{label}</span>

  const close = () => {
    setIsOpen(false)
    // Focus goes back where it came from. Without this the keyboard restarts at the top of
    // the document, which on a 500-row report means finding the row again by hand.
    triggerRef.current?.focus()
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="dialog"
        onClick={(event) => {
          // Two of the six surfaces still have a clickable ancestor for other reasons.
          event.stopPropagation()
          setIsOpen(true)
        }}
        className={cn(
          'text-left underline-offset-2 hover:underline focus-visible:underline rounded-sm',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tuggi-blue',
          className
        )}
      >
        {label}
      </button>

      {isOpen &&
        createPortal(
          <AppUserDrawer userId={userId} identity={user} onClose={close} onUpdate={onUpdate} />,
          document.body
        )}
    </>
  )
}

const subscribeNothing = () => () => {}

/**
 * The drawer opened from the address rather than from a row: `?user=<id>&tab=<tab>`. The host
 * owns the URL and passes the two values in; closing is the host's too, because only it knows
 * which parameters to keep.
 */
export function AppUserDeepLink({
  userId,
  tab,
  onClose,
  onUpdate,
}: {
  userId: string
  tab: AppUserTab
  onClose: () => void
  onUpdate?: () => void
}) {
  // The list renders on the server too, where there is no `document` to portal into. The address
  // is known there, so this is the one door that can be asked to open before hydration.
  const onClient = useSyncExternalStore(subscribeNothing, () => true, () => false)
  if (!onClient) return null
  return createPortal(
    // Keyed by user and tab: a new address is a new record, not a re-render of the old one.
    <AppUserDrawer key={`${userId}:${tab}`} userId={userId} initialTab={tab} onClose={onClose} onUpdate={onUpdate} />,
    document.body
  )
}

export default AppUserLink

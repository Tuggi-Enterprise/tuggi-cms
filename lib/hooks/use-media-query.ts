'use client'

/**
 * One media query, read as React state.
 *
 * WHY A HOOK AND NOT A TAILWIND CLASS. Most of what changes between a phone and a monitor is
 * layout, and layout belongs in CSS — `lg:flex-row` costs nothing and renders identically on the
 * server. This hook exists for the cases where the DIFFERENCE IS BEHAVIOUR, not paint: the
 * board mounts `@dnd-kit` only where a pointer exists, because a drag sensor on a touch screen
 * fights the finger that is trying to scroll. Rendering both trees and hiding one with `hidden`
 * would mount the sensors anyway.
 *
 * IT STARTS `false` ON EVERY RENDER, INCLUDING THE SERVER'S, and that is deliberate. There is no
 * viewport during SSR, so any guess is a guess; guessing `false` means the first paint is the
 * MOBILE tree, which is the one that survives being wrong — a phone getting the phone layout
 * immediately, a desktop getting it for one frame. The reverse (desktop-first) puts a 288px-wide
 * fixed rail on a 390px screen until hydration lands, which is exactly the overflow this whole
 * change exists to remove.
 */

import { useEffect, useState } from 'react'

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false)

  useEffect(() => {
    // `matchMedia` is absent in jsdom and in any renderer without a window. Its absence is not
    // an error here — it means "no viewport", and no viewport is the mobile branch.
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return

    const list = window.matchMedia(query)
    const read = () => setMatches(list.matches)
    read()

    list.addEventListener('change', read)
    return () => list.removeEventListener('change', read)
  }, [query])

  return matches
}

/**
 * Tailwind's `lg` breakpoint, as the one constant both sides read.
 *
 * SSOT: the CSS says `lg:flex-row` and the script says `useIsDesktop()`, and if the two numbers
 * ever disagree the board would paint one layout and behave like the other. 1024px is Tailwind's
 * default `lg` — the value `tailwind.config.js` inherits by not overriding `screens`.
 */
export const DESKTOP_QUERY = '(min-width: 1024px)'

export function useIsDesktop(): boolean {
  return useMediaQuery(DESKTOP_QUERY)
}

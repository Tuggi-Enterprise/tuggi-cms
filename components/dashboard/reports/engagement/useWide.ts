'use client'

import { useSyncExternalStore } from 'react'

/** `lg` and up (1024 px), the breakpoint where the page lays its cards in pairs (spec Parte E §E2). */
const WIDE = '(min-width: 1024px)'

const subscribe = (onChange: () => void) => {
  const mq = window.matchMedia(WIDE)
  mq.addEventListener('change', onChange)
  return () => mq.removeEventListener('change', onChange)
}

/** Whether the viewport is `lg` or wider; `true` on the server, where nothing is drawn. */
export function useWide(): boolean {
  return useSyncExternalStore(subscribe, () => window.matchMedia(WIDE).matches, () => true)
}

'use client'

/**
 * The Portuguese-only namespaces of the client screen, handed down from the server page (#875,
 * item 5).
 *
 * `Partnerships`, `Clients.directory` and `Clients.board` live only in `messages/pt.json` (#408),
 * and the client components used to import that file whole — 206 KB of every namespace of the
 * CMS in the JavaScript of one page. The server page now reads it and passes only these three;
 * the components that overlay them read the same slice from here, under the same name.
 */

import { createContext, useContext, type ReactNode } from 'react'
import type ptJson from '@/messages/pt.json'

export interface PtOverlay {
  Partnerships: (typeof ptJson)['Partnerships']
  Clients: {
    directory: (typeof ptJson)['Clients']['directory']
    board: (typeof ptJson)['Clients']['board']
  }
}

const PtOverlayContext = createContext<PtOverlay | null>(null)

export function PtOverlayProvider({ value, children }: { value: PtOverlay; children: ReactNode }) {
  return <PtOverlayContext.Provider value={value}>{children}</PtOverlayContext.Provider>
}

/** Throws outside the provider: a missing overlay prints key names on screen, silently. */
export function usePtOverlay(): PtOverlay {
  const value = useContext(PtOverlayContext)
  if (!value) throw new Error('usePtOverlay outside PtOverlayProvider')
  return value
}

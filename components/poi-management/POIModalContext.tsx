'use client'

/**
 * Shared state container for POIDetailsModal and its (incrementally) extracted
 * tab components. The parent owns the state; this context only EXPOSES it so a
 * tab can be lifted out of the 5k-line monolith without prop-drilling, and
 * without breaking the not-yet-extracted tabs that still read the same state.
 *
 * As more tabs are extracted, add the values they need to POIModalContextValue.
 */

import { createContext, useContext, type ReactNode } from 'react'

export interface BoundaryLatLng {
  lat: number
  lng: number
}

export interface POIModalContextValue {
  // Shell / shared
  getPoi: () => any
  canEdit: boolean
  invalidateAllPOICaches: () => void | Promise<void>
  showFeedback: (message: string, type: 'success' | 'error') => void
  requestConfirm: (message: string) => Promise<boolean>

  // Boundary tab
  boundaryPolygon: BoundaryLatLng[] | null
  setBoundaryPolygon: (polygon: BoundaryLatLng[] | null) => void
  existingBoundary: BoundaryLatLng[] | null
  isDrawingEnabled: boolean
  setIsDrawingEnabled: (value: boolean) => void
  isSavingBoundary: boolean
  handleBoundaryPolygonComplete: (polygon: any) => void
  handleSaveBoundary: () => void
  handleDeleteBoundary: () => void

  // Group-POIs tab
  groupInfo: any
  nearbyPOIs: any[]
  selectedPOIs: string[]
  drawnPolygon: BoundaryLatLng[] | null
  groupName: string
  setGroupName: (name: string) => void
  groupLoading: boolean
  handleTogglePOI: (id: string) => void
  handlePolygonComplete: (polygon: any) => void
  handleSaveGroup: () => void
}

const POIModalContext = createContext<POIModalContextValue | null>(null)

export function POIModalProvider({
  value,
  children,
}: {
  value: POIModalContextValue
  children: ReactNode
}) {
  return <POIModalContext.Provider value={value}>{children}</POIModalContext.Provider>
}

export function usePOIModalContext(): POIModalContextValue {
  const ctx = useContext(POIModalContext)
  if (!ctx) {
    throw new Error('usePOIModalContext must be used within a POIModalProvider')
  }
  return ctx
}

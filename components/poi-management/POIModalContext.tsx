'use client'

/**
 * Shared state container for POIDetailsModal and its (incrementally) extracted
 * tab components. The parent owns the state; this context only EXPOSES it so a
 * tab can be lifted out of the 5k-line monolith without prop-drilling, and
 * without breaking the not-yet-extracted tabs that still read the same state.
 *
 * As more tabs are extracted, add the values they need to POIModalContextValue.
 */

import { createContext, useContext, type ReactNode, type Dispatch, type SetStateAction } from 'react'

export interface BoundaryLatLng {
  lat: number
  lng: number
}

export interface POIModalContextValue {
  // Shell / shared
  getPoi: () => any
  canEdit: boolean
  isCreateMode: boolean
  onClose: () => void
  invalidateAllPOICaches: () => void | Promise<void>
  showFeedback: (message: string, type: 'success' | 'error') => void
  requestConfirm: (message: string) => Promise<boolean>

  // Create tab
  createName: string
  setCreateName: (value: string) => void
  createCoordinates: { lat: number; lng: number } | null
  setCreateCoordinates: (value: any) => void
  createLocation: any
  createBoundary: BoundaryLatLng[] | null
  setCreateBoundary: (value: any) => void
  createCategory: string
  setCreateCategory: (value: any) => void
  createType: string
  setCreateType: (value: any) => void
  createOwnerId: string
  setCreateOwnerId: (value: any) => void
  createBusinessStatus: string
  setCreateBusinessStatus: (value: any) => void
  createPriorityLevel: number
  setCreatePriorityLevel: (value: any) => void
  isCreating: boolean
  isGeocoding: boolean
  createError: string | null
  handleCreatePOI: () => void

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

  // Details tab
  setEditedPoi: Dispatch<SetStateAction<any>>
  isSaving: boolean
  isAdmin: boolean
  enhancedCategories: any[]
  clients: any[]
  images: any[]
  openInGoogleMaps: () => void
  handleSaveChanges: () => void
  handleDelete: () => void
  handleGarbage: () => void

  // Shared content state (description + audio + review)
  isLoading: boolean
  editedPoi: any
  descriptions: any[]
  currentDescription: string
  setCurrentDescription: (value: string) => void
  originalDescription: string
  generationLanguage: string
  setGenerationLanguage: (value: string) => void
  verificationResult: any
  referenceLinks: string[]
  setReferenceLinks: (links: string[]) => void
  isGeneratingAudio: boolean

  // Description tab
  audioDuration: number
  setAudioDuration: (value: number) => void
  isGenerating: boolean
  isSavingDescription: boolean
  isSavingReferenceLinks: boolean
  generateDescription: () => void
  resetDescription: () => void
  saveDescriptionAndNextStep: () => void
  saveReferenceLinks: () => void

  // Narration-audio tab
  currentAudioUrl: string | null
  selectedGender: string
  setSelectedGender: (value: any) => void
  selectedLanguages: string[]
  setSelectedLanguages: (value: any) => void
  isTranslating: boolean
  translatedDescriptions: any[]
  audioProgress: { current: number; total: number; currentTask: string }
  audioResults: string[]
  showResults: boolean
  setShowResults: (value: boolean) => void
  regenerateAllAudios: () => void
  regenerateTranslation: (language: string, gender: string) => void
  deleteTranslation: (id: string, language: string, gender: string) => void
  fetchAdditionalData: (forcePoiId?: string, forceUpdate?: boolean) => void
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

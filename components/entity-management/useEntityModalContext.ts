'use client'

/**
 * useEntityModalContext — produz um POIModalContextValue completo para reusar as
 * abas de POI (a aba unificada TriggerPointsTab: mapa com toggle Triggers|Boundary)
 * em Eventos/Locais. Como eventos e locais SÃO linhas de core.attractions, os
 * serviços das abas (keyed por attraction_id) funcionam sem mudança: boundary via
 * /api/pois/update-boundary, trigger points via /api/trigger-points/* (TriggerPointsManager).
 *
 * Só os campos que essas abas consomem têm implementação real (getPoi, canEdit,
 * boundary state+handlers, invalidateAllPOICaches). O resto do contexto (create,
 * group, details, description, narration) é stub — nunca é renderizado aqui.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { POIModalContextValue, BoundaryLatLng } from '@/components/poi-management/POIModalContext'
import { extractPolygonCoordinates } from '@/components/ui/GoogleMapComponent'
import { fetchBoundary, saveBoundary, deleteBoundary, sanitizeBoundary } from '@/lib/core/poi-boundary-service'
import { useEntityContent } from './useEntityContent'

interface Options {
  entityId: string
  name: string
  coordinates?: { latitude: number; longitude: number }
  canEdit: boolean
  onClose: () => void
  invalidate: () => void
  showFeedback?: (message: string, type: 'success' | 'error') => void
}

const noop = () => {}

export function useEntityModalContext(opts: Options): POIModalContextValue {
  const { entityId, name, coordinates, canEdit, onClose, invalidate } = opts

  const [boundaryPolygon, setBoundaryPolygon] = useState<BoundaryLatLng[] | null>(null)
  const [existingBoundary, setExistingBoundary] = useState<BoundaryLatLng[] | null>(null)
  const [isDrawingEnabled, setIsDrawingEnabled] = useState(false)
  const [isSavingBoundary, setIsSavingBoundary] = useState(false)

  // Carrega o boundary persistido do atrativo (evento/local).
  useEffect(() => {
    if (!entityId) return
    let active = true
    fetchBoundary(entityId)
      .then((b) => { if (active) { setExistingBoundary(b); setBoundaryPolygon(b) } })
      .catch(() => {})
    return () => { active = false }
  }, [entityId])

  const showFeedback = useCallback(
    (message: string, type: 'success' | 'error') => {
      if (opts.showFeedback) return opts.showFeedback(message, type)
      if (type === 'error') console.error(message)
    },
    [opts]
  )

  const requestConfirm = useCallback(
    async (message: string) => (typeof window !== 'undefined' ? window.confirm(message) : true),
    []
  )

  // Conteúdo real (descrição / áudio / tradução) reusando o substrato de attractions.
  const content = useEntityContent({ entityId, name, showFeedback, requestConfirm, invalidate })

  const getPoi = useCallback(
    () => ({
      id: entityId,
      name,
      coordinates: coordinates ? { latitude: coordinates.latitude, longitude: coordinates.longitude } : undefined,
      google_types: [] as string[],
    }),
    [entityId, name, coordinates]
  )

  const handleBoundaryPolygonComplete = useCallback((polygon: any) => {
    try {
      const coords = extractPolygonCoordinates(polygon)
      if (Array.isArray(coords) && coords.length) setBoundaryPolygon(coords)
    } catch { /* noop */ }
  }, [])

  const handleSaveBoundary = useCallback(async () => {
    if (!boundaryPolygon || boundaryPolygon.length < 3) return
    setIsSavingBoundary(true)
    try {
      await saveBoundary(entityId, sanitizeBoundary(boundaryPolygon))
      setExistingBoundary(boundaryPolygon)
      setIsDrawingEnabled(false)
      invalidate()
      showFeedback('Boundary salvo', 'success')
    } catch (e: any) {
      showFeedback(e?.message || 'Falha ao salvar boundary', 'error')
    } finally {
      setIsSavingBoundary(false)
    }
  }, [boundaryPolygon, entityId, invalidate, showFeedback])

  const handleDeleteBoundary = useCallback(async () => {
    if (!(await requestConfirm('Remover boundary?'))) return
    setIsSavingBoundary(true)
    try {
      await deleteBoundary(entityId)
      setBoundaryPolygon(null)
      setExistingBoundary(null)
      invalidate()
    } catch (e: any) {
      showFeedback(e?.message || 'Falha ao remover boundary', 'error')
    } finally {
      setIsSavingBoundary(false)
    }
  }, [entityId, invalidate, requestConfirm, showFeedback])

  return useMemo<POIModalContextValue>(() => ({
    // Shell / shared (real)
    getPoi,
    canEdit,
    isCreateMode: false,
    onClose,
    invalidateAllPOICaches: invalidate,
    showFeedback,
    requestConfirm,

    // Boundary tab (real)
    boundaryPolygon,
    setBoundaryPolygon,
    existingBoundary,
    isDrawingEnabled,
    setIsDrawingEnabled,
    isSavingBoundary,
    handleBoundaryPolygonComplete,
    handleSaveBoundary,
    handleDeleteBoundary,

    // Create tab (stub — não renderizado)
    createName: '', setCreateName: noop, createCoordinates: null, setCreateCoordinates: noop,
    createLocation: null, createBoundary: null, setCreateBoundary: noop, createCategory: '',
    setCreateCategory: noop, createType: '', setCreateType: noop, createOwnerId: '', setCreateOwnerId: noop,
    createBusinessStatus: '', setCreateBusinessStatus: noop, createPriorityLevel: 3, setCreatePriorityLevel: noop,
    isCreating: false, isGeocoding: false, createError: null, handleCreatePOI: noop,

    // Group-POIs tab (stub)
    groupInfo: null, nearbyPOIs: [], selectedPOIs: [], drawnPolygon: null, groupName: '',
    setGroupName: noop, groupLoading: false, handleTogglePOI: noop, handlePolygonComplete: noop, handleSaveGroup: noop,

    // Details tab (stub — Details é renderizado pelo drawer, não por esta aba)
    setEditedPoi: noop, isSaving: false, isAdmin: canEdit, enhancedCategories: [], clients: [], images: [],
    openInGoogleMaps: noop, handleSaveChanges: noop, handleDelete: noop, handleGarbage: noop,

    // editedPoi não vem do content (só fallback de categoria na DescriptionTab)
    editedPoi: null,

    // Conteúdo REAL: descrição, áudio, tradução do nome, tradução da descrição,
    // áudio por idioma — via useEntityContent (substrato attraction_descriptions).
    ...content,
  }), [
    getPoi, canEdit, onClose, invalidate, showFeedback, requestConfirm,
    boundaryPolygon, existingBoundary, isDrawingEnabled, isSavingBoundary,
    handleBoundaryPolygonComplete, handleSaveBoundary, handleDeleteBoundary,
    content,
  ])
}

/**
 * OSM Selection Hook
 * 
 * Manages POI selection state
 * 
 * @module lib/hooks/use-osm-selection
 */

'use client'

import { useState, useCallback, useMemo } from 'react'

export function useOSMSelection<T extends { uuid_id: string }>(items: T[]) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  // Toggle single selection
  const toggleSelection = useCallback((id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }, [])

  // Select all visible items
  const selectAll = useCallback(() => {
    setSelectedIds(new Set(items.map(item => item.uuid_id)))
  }, [items])

  // Clear selection
  const clearSelection = useCallback(() => {
    setSelectedIds(new Set())
  }, [])

  // Toggle all (select if not all selected, clear if all selected)
  const toggleAll = useCallback(() => {
    if (selectedIds.size === items.length) {
      clearSelection()
    } else {
      selectAll()
    }
  }, [selectedIds.size, items.length, selectAll, clearSelection])

  // Check if item is selected
  const isSelected = useCallback((id: string) => selectedIds.has(id), [selectedIds])

  // Get selected items
  const selectedItems = useMemo(() => {
    return items.filter(item => selectedIds.has(item.uuid_id))
  }, [items, selectedIds])

  // Check if all are selected
  const allSelected = useMemo(() => {
    return items.length > 0 && selectedIds.size === items.length
  }, [items.length, selectedIds.size])

  // Check if some are selected
  const someSelected = useMemo(() => {
    return selectedIds.size > 0 && selectedIds.size < items.length
  }, [selectedIds.size, items.length])

  return {
    selectedIds,
    selectedItems,
    selectedCount: selectedIds.size,
    allSelected,
    someSelected,
    isSelected,
    toggleSelection,
    selectAll,
    clearSelection,
    toggleAll
  }
}

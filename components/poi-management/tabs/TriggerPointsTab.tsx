'use client'

/**
 * Trigger Points tab — thin wrapper that delegates to TriggerPointsManager.
 * Reference template for the incremental tab-extraction refactor: a tab reads
 * everything it needs from POIModalContext instead of receiving props from the
 * 5k-line monolith.
 */

import { TriggerPointsManager } from '../TriggerPointsManager'
import { usePOIModalContext } from '../POIModalContext'

export function TriggerPointsTab() {
  const { getPoi, invalidateAllPOICaches } = usePOIModalContext()
  const poi = getPoi()
  const coordinates = poi?.coordinates

  return (
    <div className="h-[80vh]">
      <TriggerPointsManager
        attractionId={poi?.id || ''}
        attractionName={poi?.name || ''}
        attractionCoordinates={coordinates ? { lat: coordinates.latitude, lng: coordinates.longitude } : undefined}
        attractionTypes={poi?.google_types || []}
        onUpdate={invalidateAllPOICaches}
      />
    </div>
  )
}

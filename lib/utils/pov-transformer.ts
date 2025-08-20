import { POVItem, TriggerPointFromPOV } from '@/types/pov-types'

export function transformPOVToTriggerPoint(
  pov: POVItem, 
  attractionId: string, 
  priority: number
): TriggerPointFromPOV {
  return {
    attraction_id: attractionId,
    latitude: pov.lat,
    longitude: pov.lng,
    expected_bearing: pov.azimuth_deg,
    radius_meters: Math.min(pov.distance_m, 500), // Limitar a 500m
    type: priority === 1 ? 'primary' : priority <= 3 ? 'secondary' : 'fallback',
    priority: priority,
    name: pov.name,
    description: `${pov.vantage} - ${pov.access} access - ${pov.visibility_quality} visibility`,
    access: pov.access,
    is_active: true
  }
}

export function transformPOVsToTriggerPoints(
  povs: POVItem[], 
  attractionId: string
): TriggerPointFromPOV[] {
  return povs.map((pov, index) => 
    transformPOVToTriggerPoint(pov, attractionId, index + 1)
  )
}

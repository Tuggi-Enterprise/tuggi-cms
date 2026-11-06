'use client'

/**
 * The joined line of a version on the map (#1106): recorded stretches solid, the uncovered ones
 * (BR-ROTA-008 item 7, as the server stored them) dashed, and the stops numbered in the author's
 * order. Same Google Maps loader and styles of `RouteEditorModal`.
 */

import { useEffect, useRef } from 'react'
import { Wrapper, Status } from '@googlemaps/react-wrapper'
import { useTranslations } from 'next-intl'
import { GOOGLE_MAPS_LIBRARIES, GOOGLE_MAPS_VERSION } from '@/lib/maps-config'
import { splitLineAtGaps, type LatLng, type RevisionStop, type UncoveredSegment } from '@/lib/routes/route-revisions'

export interface RevisionMapProps {
  line: LatLng[]
  segments: UncoveredSegment[]
  stops: RevisionStop[]
}

const RECORDED_COLOR = '#00719F'
const UNCOVERED_COLOR = '#6B7280'
const ANNOTATION_COLOR = '#FF6B35'
const STORY_COLOR = '#00719F'

function MapCanvas({ line, segments, stops }: RevisionMapProps) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!ref.current || typeof google === 'undefined') return
    const map = new google.maps.Map(ref.current, { mapTypeControl: false, streetViewControl: false, fullscreenControl: true })
    const bounds = new google.maps.LatLngBounds()
    const { recorded, uncovered } = splitLineAtGaps(line, segments)
    const drawn: Array<google.maps.Polyline | google.maps.Marker> = []
    for (const path of recorded) {
      drawn.push(new google.maps.Polyline({ path, map, strokeColor: RECORDED_COLOR, strokeOpacity: 0.9, strokeWeight: 4 }))
      path.forEach((p) => bounds.extend(p))
    }
    for (const path of uncovered) {
      drawn.push(new google.maps.Polyline({
        path, map, strokeColor: UNCOVERED_COLOR, strokeOpacity: 0, strokeWeight: 3,
        icons: [{ icon: { path: 'M 0,-1 0,1', strokeOpacity: 0.9, scale: 3 }, offset: '0', repeat: '14px' }],
      }))
      path.forEach((p) => bounds.extend(p))
    }
    stops.forEach((s, i) => {
      if (s.lat === null || s.lng === null) return
      const position = { lat: s.lat, lng: s.lng }
      bounds.extend(position)
      drawn.push(new google.maps.Marker({
        position, map, title: s.title ?? undefined,
        label: { text: String(i + 1), color: 'white', fontSize: '11px', fontWeight: 'bold' },
        icon: {
          path: google.maps.SymbolPath.CIRCLE, scale: 11, fillOpacity: 1, strokeColor: 'white', strokeWeight: 2,
          fillColor: s.kind === 'annotation' ? ANNOTATION_COLOR : STORY_COLOR,
        },
      }))
    })
    if (!bounds.isEmpty()) map.fitBounds(bounds, 32)
    return () => drawn.forEach((d) => d.setMap(null))
  }, [line, segments, stops])
  return <div ref={ref} className="h-80 w-full rounded-lg border border-gray-200" />
}

export function RevisionMap(props: RevisionMapProps) {
  const t = useTranslations('Pages.RouteReview')
  if (props.line.length < 2 && props.stops.length === 0) {
    return <p className="text-sm text-gray-500">{t('no_line')}</p>
  }
  return (
    <div className="space-y-1">
      <Wrapper
        apiKey={process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || ''}
        libraries={GOOGLE_MAPS_LIBRARIES}
        version={GOOGLE_MAPS_VERSION}
        render={(status) => (status === Status.FAILURE ? <p className="text-sm text-red-700">{t('map_failed')}</p> : <div className="h-80 w-full animate-pulse rounded-lg bg-gray-100" />)}
      >
        <MapCanvas {...props} />
      </Wrapper>
      <p className="flex gap-4 text-xs text-gray-600">
        <span><span aria-hidden className="mr-1 inline-block h-0.5 w-5 align-middle" style={{ background: RECORDED_COLOR }} />{t('map_recorded')}</span>
        <span><span aria-hidden className="mr-1 inline-block w-5 border-t-2 border-dashed align-middle" style={{ borderColor: UNCOVERED_COLOR }} />{t('map_uncovered')}</span>
        <span><span aria-hidden className="mr-1 inline-block h-2.5 w-2.5 rounded-full align-middle" style={{ background: ANNOTATION_COLOR }} />{t('annotation')}</span>
        <span><span aria-hidden className="mr-1 inline-block h-2.5 w-2.5 rounded-full align-middle" style={{ background: STORY_COLOR }} />{t('story')}</span>
      </p>
    </div>
  )
}

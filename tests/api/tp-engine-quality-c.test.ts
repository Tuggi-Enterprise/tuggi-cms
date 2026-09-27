import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  VisibilityClass,
  classifyVisibility,
} from '../../lib/services/trigger-points-google/config/visibility-class'

// TP engine audit, 2026-09-27, slice C (#779). Visual check on 11 Rio POIs.

describe('BR-AUDIO-010 — a synthetic boundary (node circle) never decides the class', () => {
  it('a neighbourhood node is AREA, in OSM or Nominatim tag shape', () => {
    const synthetic = { heightM: 0, prominenceM: 0, areaM2: 0 }
    assert.equal(classifyVisibility({ ...synthetic, tags: { place: 'suburb' } }), VisibilityClass.AREA)
    assert.equal(classifyVisibility({ ...synthetic, tags: { class: 'place', type: 'suburb' } }), VisibilityClass.AREA)
  })

  it('a bust node with no footprint stays POINT_LOW; a prominent node is a landmark, whatever the circle', () => {
    assert.equal(classifyVisibility({ heightM: 2.5, prominenceM: 0, areaM2: 0, tags: { memorial: 'bust' } }), VisibilityClass.POINT_LOW)
    assert.equal(classifyVisibility({ heightM: 0, prominenceM: 331, areaM2: 0 }), VisibilityClass.LANDMARK_HIGH)
  })
})

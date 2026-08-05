import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { geoJSONToPaths, geoJSONToPoints, geoJSONPartCount } from '../../lib/maps/geojson-paths'

const square = (x: number, y: number): [number, number][] => [
  [x, y], [x + 0.001, y], [x + 0.001, y + 0.001], [x, y + 0.001], [x, y],
]

describe('geoJSONToPaths', () => {
  it('converts a Polygon and flips [lng, lat] into {lat, lng}', () => {
    const paths = geoJSONToPaths({ type: 'Polygon', coordinates: [square(2.17, 41.4)] })
    assert.equal(paths.length, 1)
    assert.deepEqual(paths[0][0], { lat: 41.4, lng: 2.17 })
  })

  it('keeps EVERY part of a MultiPolygon', () => {
    // The regression this file exists for: the old code read coordinates[0][0] and drew one
    // part. The Muralla de Segovia has 39, spread over ~2 km of wall.
    const parts = Array.from({ length: 39 }, (_, i) => [square(2.17 + i * 0.01, 41.4)])
    const paths = geoJSONToPaths({ type: 'MultiPolygon', coordinates: parts })
    assert.equal(paths.length, 39)
    assert.equal(geoJSONPartCount({ type: 'MultiPolygon', coordinates: parts }), 39)
  })

  it('keeps interior rings, so courtyards stay holes', () => {
    const outer = square(2.17, 41.4)
    const hole: [number, number][] = [
      [2.1702, 41.4002], [2.1704, 41.4002], [2.1704, 41.4004], [2.1702, 41.4004], [2.1702, 41.4002],
    ]
    assert.equal(geoJSONToPaths({ type: 'Polygon', coordinates: [outer, hole] }).length, 2)
  })

  it('drops rings that cannot enclose an area', () => {
    const degenerate = [[[2.17, 41.4], [2.18, 41.4]]]
    assert.deepEqual(geoJSONToPaths({ type: 'Polygon', coordinates: degenerate }), [])
  })

  it('returns empty instead of throwing on junk', () => {
    // One broken boundary must not take the whole map down.
    for (const bad of [null, undefined, {}, { type: 'Point', coordinates: [1, 2] }, { type: 'Polygon' }]) {
      assert.deepEqual(geoJSONToPaths(bad), [])
    }
  })

  it('flattens every vertex for fitBounds', () => {
    const parts = [[square(2.17, 41.4)], [square(2.18, 41.4)]]
    assert.equal(geoJSONToPoints({ type: 'MultiPolygon', coordinates: parts }).length, 10)
  })
})

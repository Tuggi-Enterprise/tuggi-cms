/**
 * Scenic roads enter as one POI per road (lib/services/osm-scenic-roads + poi-filter#isScenicRoad).
 * Operator order of 2026-10-07: the Tuggi tourist drives, and the Großglockner-Hochalpenstraße,
 * Silvretta, Gerlos, Nockalm, Timmelsjoch and Villacher Alpenstraße were cut with every `highway`.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { parseOplRelation, buildRouteFeature, isScenicRoadRelation } from '../../lib/services/osm-scenic-roads'
import { shouldFilterPOI, pickCategory } from '../../lib/shared/poi-filter'

const OPL = 'r9344306 v12 dV c0 t2024-01-01T00:00:00Z i0 u Tfrom=Innerkrems,name=Nockalmstra%df%e,route=road,scenic=yes,type=route,wikidata=Q718641 Mw1@,w2@,n3@stop'

describe('scenic roads', () => {
  it('parses an OPL relation with escaped tags and its way members', () => {
    const rel = parseOplRelation(OPL)!
    assert.equal(rel.id, 9344306)
    assert.equal(rel.tags.name, 'Nockalmstraße')
    assert.deepEqual(rel.wayIds, [1, 2])
    assert.equal(isScenicRoadRelation(rel.tags), true)
    assert.equal(isScenicRoadRelation({ type: 'route', route: 'road', name: 'Gerlos Straße', ref: 'B165' }), false)
  })

  it('builds one MultiLineString feature from the member ways that have geometry', () => {
    const rel = parseOplRelation(OPL)!
    const f = buildRouteFeature(rel, new Map([[1, [[13.8, 46.9], [13.81, 46.91]]]]))
    assert.equal(f.geometry.type, 'MultiLineString')
    assert.equal(f.geometry.coordinates.length, 1)
    assert.equal(f.properties['@type'], 'relation')
    assert.equal(buildRouteFeature(rel, new Map()), null)
  })

  it('the elite filter keeps the scenic road relation and still drops other routes and road ways', () => {
    const road = { name: 'Nockalmstraße', type: 'route', route: 'road', scenic: 'yes', wikidata: 'Q718641' }
    assert.equal(shouldFilterPOI({ properties: road }).remove, false)
    assert.equal(pickCategory(road), 'scenic_road')
    assert.equal(shouldFilterPOI({ properties: { name: 'Gerlos Straße', type: 'route', route: 'road', ref: 'B165' } }).remove, true)
    assert.equal(shouldFilterPOI({ properties: { name: 'Nockalmstraße', highway: 'tertiary' } }).remove, true)
  })
})

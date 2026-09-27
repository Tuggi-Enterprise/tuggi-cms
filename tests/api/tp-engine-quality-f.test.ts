import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { isPublicWay } from '../../lib/services/trigger-points-google/config/visibility-class'

// TP engine calibration, 2026-09-27, round F (#772). Spec: docs/arquitetura/cms/motor-de-tp.md.

describe('BR-AUDIO-010, INV-E7a — no TP on a way closed to the public', () => {
  it('access=private|no|military and military=* close the way; a mode tag reopens it', () => {
    assert.equal(isPublicWay({ highway: 'service', access: 'private' }), false) // Doca 11 de Junho (Ilha Fiscal)
    assert.equal(isPublicWay({ highway: 'service', access: 'no' }), false)
    assert.equal(isPublicWay({ highway: 'service', access: 'military' }), false)
    assert.equal(isPublicWay({ highway: 'service', military: 'naval_base' }), false)
    assert.equal(isPublicWay({ highway: 'pedestrian', access: 'no', foot: 'yes' }), true)
    assert.equal(isPublicWay({ highway: 'residential', access: 'destination' }), true)
    assert.equal(isPublicWay({ highway: 'primary' }), true)
    assert.equal(isPublicWay(undefined), true)
  })
})

describe('INV-E3 — the engine never reads a registered height', () => {
  it('buildEngineInput carries no estimated_height_m', async () => {
    const { PoiMigrationPipeline } = await import('../../lib/services/poi-migration-pipeline')
    const input = PoiMigrationPipeline.buildEngineInput(
      { id: 'x', name: 'X', estimated_height_m: 120, osm_tags: { height: '12' } },
      { latitude: -22.9, longitude: -43.2 },
    ) as Record<string, unknown>
    assert.equal('height' in input, false)
    assert.deepEqual(input.tags, { height: '12' }) // a measured OSM tag still reaches the engine
  })
})

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { candidateKey, poiTraceRows, stepTraceRows } from '../../lib/services/trigger-points-google/utils/engine-trace'
import { VisibilityClass } from '../../lib/services/trigger-points-google/config/visibility-class'
import { buildClassification } from '../../lib/services/trigger-points-google/services/poi-classifier.service'

// E0 trace (docs/arquitetura/cms/motor-de-tp.md): pure information, BR-AUDIO-010.

const at = (lat: number) => ({ location: { lat, lng: -43.2 } })

describe('E0 / BR-AUDIO-010 — engine trace: one row per POI for E1–E6, one per candidate for E7–E11', () => {
  it('a step records every candidate as kept or dropped, and a merged one as new', () => {
    const a = at(-22.9), b = at(-22.91), merged = at(-22.905)
    const rows = stepTraceRows({
      poiId: 'p', stage: 'E8', rule: 'visibility-map-builder#checkExactVisibility',
      before: [a, b], after: [a, merged], value: () => 'edge 10 m', limit: 'LOS',
    })
    assert.deepEqual(rows.map(r => [r.candidate, r.decision]), [
      [candidateKey(a.location), 'kept'],
      [candidateKey(b.location), 'dropped'],
      [candidateKey(merged.location), 'kept'],
    ])
    assert.match(rows[2].value, /^new; /)
    assert.ok(rows.every(r => r.poi_id === 'p' && r.stage === 'E8' && r.limit === 'LOS'))
  })

  it('E1–E6 rows carry the measured value and source; a failed DEM is marked, never a silent 0 (INV-E4c)', () => {
    const physical = {
      heightM: 12, heightSource: 'tag_default' as const, groundTopM: null, groundSource: 'none' as const, topPoint: null,
      cityBaseM: 9, cityBaseSource: 'geonames:3451190', prominenceM: null, areaM2: 8000, classRule: 'structure_height' as const,
    }
    const rows = poiTraceRows('p', {
      type: 'polygon', coordinates: [], center: { lat: 0, lng: 0 }, area_m2: 8000, perimeter_m: 0, confidence: 1, source: 'osm',
      physical, classification: buildClassification(VisibilityClass.STRUCTURE, { heightM: 12, prominenceM: null, areaM2: 8000 }),
    } as any)
    const by = (rule: string) => rows.find(r => r.rule === rule)!
    assert.deepEqual(rows.map(r => r.stage), ['E1', 'E3', 'E4', 'E4', 'E4', 'E5', 'E6', 'E6'])
    assert.equal(by('visibility-class#resolveHeightM').value, '12 m (tag_default)')
    assert.equal(by('elevation-service#groundTop').decision, 'dropped')
    assert.equal(by('visibility-class#prominenceOverCityM').value, 'null')
    assert.equal(by('visibility-class#visibilityClassRule').value, 'structure (structure_height)')
  })

  it('the dry-run writes the trace with the same CSV escaping', async () => {
    const { toTraceCsvLines, TRACE_CSV_COLUMNS } = await import('../../lib/services/tp-dry-run')
    assert.deepEqual(TRACE_CSV_COLUMNS, ['poi_id', 'stage', 'rule', 'candidate', 'value', 'limit', 'decision'])
    const [line] = toTraceCsvLines([{ poi_id: 'p', stage: 'E11', rule: 'r', candidate: '-22.9,-43.2', value: 'a, b', limit: 'x', decision: 'kept' }])
    assert.equal(line, 'p,E11,r,"-22.9,-43.2","a, b",x,kept')
  })
})

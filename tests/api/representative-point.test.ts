/**
 * Pin of an areal/linear OSM object (lib/utils/geometry#representativePoint), used by
 * scripts/import-geojson-homolog#getPointFromGeometry. It used to be the first vertex of the ring:
 * Czech homolog 2026-10-09, 12,396 of 12,456 areal/linear POIs on the edge, up to 34 km off.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { representativePoint, calculatePolygonCenter } from '../../lib/utils/geometry'

// Shapes in a 1 m-ish grid near Prague, [lon, lat].
const at = (x: number, y: number) => [14.4 + x * 0.001, 50.08 + y * 0.001]
const ring = (pts: number[][]) => [...pts.map(([x, y]) => at(x, y)), at(pts[0][0], pts[0][1])]

function inside(p: number[], rings: number[][][]): boolean {
  let c = false
  for (const r of rings) {
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      if ((r[i][1] > p[1]) !== (r[j][1] > p[1]) && p[0] < ((r[j][0] - r[i][0]) * (p[1] - r[i][1])) / (r[j][1] - r[i][1]) + r[i][0]) c = !c
    }
  }
  return c
}

const L = [ring([[0, 0], [2, 0], [2, 1], [1, 1], [1, 3], [0, 3]])]
const C = [ring([[0, 0], [3, 0], [3, 1], [1, 1], [1, 2], [3, 2], [3, 3], [0, 3]])]

describe('representativePoint: the pin sits inside the areal, mid-line on the linear', () => {
  it('L-shaped polygon: pin inside', () => {
    const p = representativePoint({ type: 'Polygon', coordinates: L })!
    assert.ok(inside(p, L), `pin ${p} outside the L`)
  })

  it('C-shaped polygon: pin inside, where the vertex average falls in the gap', () => {
    const p = representativePoint({ type: 'Polygon', coordinates: C })!
    assert.ok(inside(p, C), `pin ${p} outside the C`)
    const avg = calculatePolygonCenter(C[0].map(([lng, lat]) => ({ lat, lng })))
    assert.equal(inside([avg.lng, avg.lat], C), false, 'vertex average is not a pin')
  })

  it('polygon with a hole: pin not in the hole', () => {
    const donut = [ring([[0, 0], [4, 0], [4, 4], [0, 4]]), ring([[1, 1], [3, 1], [3, 3], [1, 3]])]
    const p = representativePoint({ type: 'Polygon', coordinates: donut })!
    assert.ok(inside(p, donut), `pin ${p} in the hole`)
  })

  it('MultiPolygon: pin inside the largest part', () => {
    const big = [ring([[10, 0], [14, 0], [14, 4], [10, 4]])]
    const p = representativePoint({ type: 'MultiPolygon', coordinates: [[ring([[0, 0], [1, 0], [1, 1], [0, 1]])], big] })!
    assert.ok(inside(p, big))
  })

  it('LineString: middle of the line by length, not the first vertex', () => {
    const p = representativePoint({ type: 'LineString', coordinates: [at(0, 0), at(1, 0), at(4, 0)] })!
    const mid = at(2, 0)
    assert.ok(Math.abs(p[0] - mid[0]) < 1e-6 && Math.abs(p[1] - mid[1]) < 1e-6, `pin ${p}`)
  })

  it('MultiLineString (street joined from segments): middle of the longest segment', () => {
    const p = representativePoint({ type: 'MultiLineString', coordinates: [[at(0, 0), at(1, 0)], [at(0, 5), at(0, 9)]] })!
    const mid = at(0, 7)
    assert.ok(Math.abs(p[0] - mid[0]) < 1e-6 && Math.abs(p[1] - mid[1]) < 1e-6, `pin ${p}`)
  })

  it('Point stays the point', () => {
    assert.deepEqual(representativePoint({ type: 'Point', coordinates: at(1, 1) }), at(1, 1))
  })
})

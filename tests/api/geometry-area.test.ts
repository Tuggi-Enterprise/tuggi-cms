import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { calculatePolygonArea } from '../../lib/utils/geometry'

// A cópia da Edge Function (Deno) precisa concordar com a do Next — runtimes diferentes não
// compartilham módulo, então a paridade vira teste em vez de abstração.
// O import é dinâmico de propósito: supabase/functions/ fica fora do tsconfig e usa imports
// com extensão .ts (estilo Deno). Um import estático arrastaria o módulo para o programa do
// tsc e quebraria o type-check com TS5097.
const edgeModulePath = '../../supabase/functions/generate-trigger-points/lib/utils/geometry.ts'
type AreaFn = (c: Array<{ lat: number; lng: number }>) => number

/** Quadrado de `side` graus com o canto sudoeste em (lat, lng). */
function square(lat: number, lng: number, side: number) {
  return [
    { lat, lng },
    { lat, lng: lng + side },
    { lat: lat + side, lng: lng + side },
    { lat: lat + side, lng },
  ]
}

describe('calculatePolygonArea', () => {
  it('shrinks with the cosine of latitude', () => {
    // Same span in degrees, different latitudes: meridians converge, so the 60° cell must be
    // about half of the equatorial one. The old shoelace-over-radians returned them equal —
    // that is the bug this guards.
    const atEquator = calculatePolygonArea(square(0, 0, 0.1))
    const at60 = calculatePolygonArea(square(60, 0, 0.1))
    assert.ok(Math.abs(at60 / atEquator - 0.5) < 0.01, `esperado ~0.5, veio ${(at60 / atEquator).toFixed(4)}`)
  })

  it('matches the known area of a one-degree cell at the equator', () => {
    // 1° de latitude ≈ 111,19 km; no equador 1° de longitude vale o mesmo.
    // Área de referência ≈ 111.195² m² ≈ 1,2364e10 m², com 0,5% de tolerância.
    const area = calculatePolygonArea(square(0, 0, 1))
    const esperado = 12_308_778_361 // ST_Area(geography) medido no PostGIS
    assert.ok(Math.abs(area / esperado - 1) < 0.005, `esperado ~${esperado}, veio ${area}`)
  })

  it('no longer overestimates a Barcelona boundary by 1/cos(latitude)', () => {
    // Retângulo na latitude da Sagrada Família (41,4° N), que é onde o defeito apareceu:
    // lá a fórmula antiga gravou 21.213 m² para um boundary de 15.933 m² reais — 1,331×,
    // que é exatamente 1/cos(41,4°).
    const sagradaFamilia = [
      { lat: 41.402551, lng: 2.172567 },
      { lat: 41.402551, lng: 2.175877 },
      { lat: 41.404551, lng: 2.175877 },
      { lat: 41.404551, lng: 2.172567 },
    ]
    const area = calculatePolygonArea(sagradaFamilia)
    const postgis = 61_480 // ST_Area(geography) medido no PostGIS para este retângulo
    assert.ok(Math.abs(area / postgis - 1) < 0.01, `esperado ~${postgis}, veio ${area}`)
  })

  it('degenerate input is zero, not NaN', () => {
    assert.equal(calculatePolygonArea([]), 0)
    assert.equal(calculatePolygonArea([{ lat: 1, lng: 1 }, { lat: 2, lng: 2 }]), 0)
  })

  it('Next and Edge Function copies agree', async () => {
    const calculatePolygonAreaEdge: AreaFn = (await import(edgeModulePath)).calculatePolygonArea
    for (const poly of [square(0, 0, 0.1), square(41.4, 2.17, 0.01), square(60, 10, 0.5)]) {
      const a = calculatePolygonArea(poly)
      const b = calculatePolygonAreaEdge(poly)
      // A do Next arredonda e aplica piso 1; comparamos com tolerância de 1 m².
      assert.ok(Math.abs(a - b) <= 1, `Next=${a} Edge=${b}`)
    }
  })
})

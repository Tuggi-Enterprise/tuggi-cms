import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { TriggerPointSavingService, toDbBearing } from '@/lib/services/trigger-point-saving'

// #779: `expected_bearing` é `real` (float4). 359.99999999999997 passa na validação JS (< 360) e o
// banco arredonda para 360, violando `chk_bearing_range` e derrubando o replace atômico do POI.
describe('#779 — bearing gravado fica em [0, 360) depois do float4 do banco', () => {
  it('valor que o float4 arredonda para 360 vira 0', () => {
    const almost = 360 - 1e-13
    assert.ok(almost < 360)
    assert.equal(Math.fround(almost), 360)
    assert.equal(toDbBearing(almost), 0)
  })

  it('360, negativo e acima de uma volta normalizam; valor normal passa intacto', () => {
    assert.equal(toDbBearing(360), 0)
    assert.equal(toDbBearing(-90), 270)
    assert.equal(toDbBearing(725), 5)
    assert.equal(toDbBearing(359.5), 359.5)
    assert.equal(toDbBearing(0), 0)
  })

  it('ausência continua ausência', () => {
    assert.equal(toDbBearing(null), null)
    assert.equal(toDbBearing(undefined), undefined)
  })

  it('os dois funis de escrita aplicam a normalização', () => {
    const insert = TriggerPointSavingService.prepareTriggerPointForDB({
      attraction_id: 'a', lat: -22.7, lng: -46.7, expected_bearing: 360 - 1e-13, type: 'primary',
    } as any)
    assert.equal(insert.expected_bearing, 0)
    const update = TriggerPointSavingService.prepareTriggerPointForUpdate({ expected_bearing: 360 } as any)
    assert.equal(update.expected_bearing, 0)
  })
})

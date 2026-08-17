/**
 * `planBatch` — o que o botão "traduzir e gerar" escreve no bucket.
 *
 * Regressão vivida: o lote iterava **todos** os gêneros do catálogo em vez dos
 * marcados na tela. O operador pediu tradução das chaves em `male`, e o CMS gerou
 * `female` junto — arquivo que ninguém pediu, num bucket público, com custo de TTS e
 * de tradução. Nenhum erro apareceu, porque do ponto de vista do código estava tudo
 * certo: era a regra que estava errada.
 *
 * Por isso a regra saiu do componente e virou função pura: o que decide escrita em
 * bucket é testável, e agora é testado.
 *
 * Run with: npm run test:api
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  planBatch,
  type SystemAudioFamily,
  type SystemAudioScript,
  type VoiceGender,
} from '@/lib/audio/system-audio-client'

const FOLDERS: Record<SystemAudioFamily, string> = {
  directional: 'directional-audios',
  notice: 'notice-audios',
}

const LEFT: SystemAudioScript = {
  key: 'left',
  family: 'directional',
  sourceText: 'à sua esquerda',
  trigger: '',
}
const OFFLINE: SystemAudioScript = {
  key: 'offline',
  family: 'notice',
  sourceText: 'Você está sem internet agora.',
  trigger: '',
}
const NO_COPY: SystemAudioScript = {
  key: 'passactive',
  family: 'notice',
  sourceText: null,
  trigger: '',
}

const sourceTextOf = (script: SystemAudioScript) => script.sourceText ?? ''

function plan(overrides: Partial<Parameters<typeof planBatch>[0]> = {}) {
  return planBatch({
    scripts: [LEFT, OFFLINE],
    folders: FOLDERS,
    locales: ['pt-br', 'en-us'],
    genders: ['male'] as VoiceGender[],
    existing: new Set<string>(),
    overwrite: false,
    sourceTextOf,
    ...overrides,
  })
}

test('só as vozes marcadas entram no lote', () => {
  const males = plan({ genders: ['male'] })

  assert.equal(males.length, 4, '2 chaves × 2 idiomas × 1 voz')
  assert.equal(
    males.filter((t) => t.gender === 'female').length,
    0,
    'female não foi pedido e não pode ser gerado'
  )
})

test('marcar as duas vozes dobra o lote', () => {
  const both = plan({ genders: ['male', 'female'] })

  assert.equal(both.length, 8)
  assert.equal(both.filter((t) => t.gender === 'male').length, 4)
  assert.equal(both.filter((t) => t.gender === 'female').length, 4)
})

test('nenhuma voz marcada gera nada', () => {
  assert.deepEqual(plan({ genders: [] }), [])
})

test('nenhum idioma marcado gera nada', () => {
  assert.deepEqual(plan({ locales: [] }), [])
})

test('o que já existe fica de fora, a menos que se peça para regerar', () => {
  const existing = new Set(['directional-audios/left_pt-br_male.mp3'])

  const skipping = plan({ existing })
  assert.equal(skipping.length, 3)
  assert.equal(
    skipping.some((t) => t.script.key === 'left' && t.locale === 'pt-br'),
    false
  )

  const regenerating = plan({ existing, overwrite: true })
  assert.equal(regenerating.length, 4)
})

test('chave sem copy não entra no lote — não se gera clipe vazio', () => {
  const targets = plan({ scripts: [LEFT, NO_COPY] })

  assert.equal(targets.length, 2)
  assert.equal(
    targets.some((t) => t.script.key === 'passactive'),
    false
  )
})

test('a existência é conferida pelo caminho completo, com a pasta da família', () => {
  // `left` é direcional e `offline` é aviso: um arquivo numa pasta não pode fazer o
  // planejador pular o da outra só porque o nome do arquivo coincide.
  const existing = new Set(['notice-audios/left_pt-br_male.mp3'])
  const targets = plan({ existing })

  assert.equal(targets.length, 4, 'nada foi pulado — o caminho não bate com nenhum alvo')
})

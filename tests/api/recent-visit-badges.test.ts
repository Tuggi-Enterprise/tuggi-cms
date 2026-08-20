/**
 * Os dois SSOTs que o cartão do radar ("POIs ouvidas agora") lê para dizer
 * *como* o áudio tocou e *em que idioma*.
 *
 * `visit_source` chega com três valores de três escritores diferentes do app, e
 * dois deles são o mesmo fato para quem lê o dashboard — o Trigger Point disparou
 * sozinho. Sem esse agrupamento no lugar certo, cada tela que mostrar a coluna
 * inventa o seu, que é como um fato ganha dois donos.
 *
 * A bandeira sai do subtag de região do BCP-47, nunca do idioma: `en` sozinho não
 * tem bandeira, e `en-us`/`en-gb` têm duas. O último teste é o que garante que a
 * sigla continua ao lado — o Windows não desenha indicador regional.
 *
 * Run with: npm run test:api
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { visitSourceKind } from '@/lib/shared/visit-source'
import { languageFlag } from '@/lib/shared/language-flag'

test('trigger_point e audio_trigger são o mesmo engajamento automático', () => {
  // O nativo Android grava `trigger_point`; a fila offline do RN grava
  // `audio_trigger`. Caminho de gravação diferente, mesmo fato na tela.
  assert.equal(visitSourceKind('trigger_point'), 'trigger_point')
  assert.equal(visitSourceKind('audio_trigger'), 'trigger_point')
})

test('poi_detail_screen é play manual', () => {
  assert.equal(visitSourceKind('poi_detail_screen'), 'manual_play')
})

test('ausência, NULL e valor novo caem em unknown — a UI não afirma nada', () => {
  // `core.dashboard_realtime_activity` ainda não devolve a coluna; as outras RPCs
  // mandam o literal 'unknown' no lugar de NULL.
  assert.equal(visitSourceKind(undefined), 'unknown')
  assert.equal(visitSourceKind(null), 'unknown')
  assert.equal(visitSourceKind('unknown'), 'unknown')
  assert.equal(visitSourceKind('walking_tour_2027'), 'unknown')
})

test('a bandeira vem da região, e distingue en-us de en-gb', () => {
  assert.equal(languageFlag('pt-br'), '🇧🇷')
  assert.equal(languageFlag('pt-pt'), '🇵🇹')
  assert.equal(languageFlag('en-us'), '🇺🇸')
  assert.equal(languageFlag('en-gb'), '🇬🇧')
  assert.equal(languageFlag('es-es'), '🇪🇸')
  assert.equal(languageFlag('it-it'), '🇮🇹')
  assert.equal(languageFlag('de-de'), '🇩🇪')
  assert.equal(languageFlag('fr-fr'), '🇫🇷')
})

test('código sem região não vira bandeira chutada', () => {
  for (const code of ['en', 'unknown', '', null, undefined, 'pt-']) {
    assert.equal(languageFlag(code as any), null, `${code} não tem região`)
  }
})

test('a bandeira é um par de indicadores regionais, não o texto do código', () => {
  // Windows não desenha o par e mostra as duas letras; por isso o cartão sempre
  // imprime a sigla ao lado. Aqui só se prova que o que sai é o par.
  const flag = languageFlag('pt-br')!
  assert.deepEqual([...flag].map((c) => c.codePointAt(0)), [0x1f1e7, 0x1f1f7])
})

/**
 * O local sem coordenada não cai mais numa aba vazia — e a tela não chama isso de erro de sistema.
 *
 * O DEFEITO, relatado pelo operador em 2026-08-26. O local que a aprovação do parceiro cria nasce
 * SEM coordenada e COM endereço (`lib/partner-form/place-prefill`). A faixa da esteira manda o
 * operador para `Limite & Triggers` pela pendência `Nenhum ponto de disparo ativo`, e lá
 * `TriggerPointsManager` mostrava `erro de sistema do fetch` — a frase que chama de defeito da
 * máquina o estado normal do registro — com o mapa sem montar. Medido em `Cozi +`
 * (`56744ca1-9637-4e97-bec2-f93ac1e4158f`): `formatted_address` preenchido, `attraction_coordinate`
 * sem linha.
 *
 * Mutações que deixam esta suíte vermelha:
 *  · `resolveOpeningTab` deixar de rebaixar `trigger-points` quando falta a coordenada;
 *  · o drawer voltar a semear a aba direto do `initialTab`;
 *  · a aba `Limite & Triggers` sem coordenada voltar a renderizar `TriggerPointsTab`;
 *  · `TriggerPointsManager` voltar a descartar o `error` do PostgREST e usar uma frase só;
 *  · qualquer um dos três idiomas ficar sem as chaves novas.
 *
 * Run with: npm run test:api
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import {
  COORDINATE_DEPENDENT_TABS,
  resolveOpeningTab,
  tabNeedsCoordinate,
} from '../../lib/entity-management/coordinate-gate'

const root = resolve(import.meta.dirname, '../..')
const read = (path: string) => readFileSync(resolve(root, path), 'utf8')
const messages = (locale: string) => JSON.parse(read(`messages/${locale}.json`))

const DRAWER = 'components/entity-management/EntityManagementDrawer.tsx'
const MANAGER = 'components/poi-management/TriggerPointsManager.tsx'

/** O fonte SEM comentários — toda asserção sobre o que um arquivo FAZ lê isto. */
function code(path: string): string {
  return read(path)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

test('a coordenada é pré-requisito só das abas que partem dela', () => {
  assert.equal(tabNeedsCoordinate('trigger-points'), true)
  // Descrever e narrar um local sem pino é trabalho válido e adiantado: barrar seria inventar
  // uma dependência que o produto não tem.
  assert.equal(tabNeedsCoordinate('description'), false)
  assert.equal(tabNeedsCoordinate('narration-audio'), false)
  assert.equal(tabNeedsCoordinate('details'), false)
  assert.deepEqual([...COORDINATE_DEPENDENT_TABS], ['trigger-points'])
})

test('sem coordenada, o deep link para Limite & Triggers é rebaixado para Detalhes', () => {
  assert.equal(
    resolveOpeningTab({ requested: 'trigger-points', hasCoordinate: false }),
    'details',
    'é em Detalhes que o mapa abre sobre o endereço e o clique vira coordenada'
  )
  assert.equal(resolveOpeningTab({ requested: 'trigger-points', hasCoordinate: true }), 'trigger-points')
})

test('o rebaixamento não alcança nenhuma outra aba', () => {
  assert.equal(resolveOpeningTab({ requested: 'description', hasCoordinate: false }), 'description')
  assert.equal(resolveOpeningTab({ requested: 'narration-audio', hasCoordinate: false }), 'narration-audio')
  assert.equal(resolveOpeningTab({ requested: undefined, hasCoordinate: true }), 'details')
  assert.equal(resolveOpeningTab({ requested: null, hasCoordinate: false }), 'details')
})

test('o drawer decide a aba pelo portão, e não pelo initialTab cru', () => {
  const drawer = code(DRAWER)

  assert.match(drawer, /resolveOpeningTab\(\{\s*requested: initialTab,\s*hasCoordinate\s*\}\)/)
  // Espera a carga: durante ela `coordinates` é `undefined` para TODO registro, e agir ali
  // jogaria para Detalhes até quem tem coordenada.
  assert.match(drawer, /if \(!isOpen \|\| loading \|\| !initialTab \|\| seeded\.current\) return/)
  // Uma vez por abertura: `coordinates` é objeto novo a cada render de quem chama, e um efeito
  // sem trava devolveria o operador à aba semeada a cada clique.
  assert.match(drawer, /seeded\.current = true/)
})

test('a aba Limite & Triggers sem coordenada explica e leva a Detalhes', () => {
  const drawer = code(DRAWER)

  assert.match(drawer, /!hasCoordinate && tabNeedsCoordinate\('trigger-points'\)/)
  assert.match(drawer, /coordinate_required\.title/)
  assert.match(drawer, /coordinate_required\.body/)
  assert.match(drawer, /onClick=\{\(\) => setActiveTab\('details'\)\}/)

  // O painel do pré-requisito vem ANTES do TriggerPointsTab: sem centro, o mapa de trigger
  // points não tem de onde partir e era ele quem produzia o painel vermelho.
  const gate = drawer.indexOf("!hasCoordinate && tabNeedsCoordinate('trigger-points')")
  const tab = drawer.indexOf('<TriggerPointsTab />')
  assert.ok(gate > -1 && tab > gate, 'o portão precisa preceder a renderização da aba')
})

test('o manager separa a coordenada ausente do fetch que falhou', () => {
  const manager = code(MANAGER)

  // O `error` do PostgREST era descartado — é ele quem distingue as duas ausências.
  assert.match(manager, /const \{ data, error: fetchError \} = await supabase/)
  assert.match(
    manager,
    /fetchError \? t\('errors\.coordinate_fetch_failed'\) : t\('errors\.missing_coordinates'\)/
  )
})

test('as duas frases existem nos três idiomas, e nenhuma delas culpa o fetch', () => {
  for (const locale of ['pt', 'en', 'es']) {
    const m = messages(locale)

    const required = m.Modals.POIDetails.coordinate_required
    for (const key of ['title', 'body', 'action']) {
      assert.ok(required?.[key], `${locale}: falta Modals.POIDetails.coordinate_required.${key}`)
    }

    const errors = m.Modals.TriggerPointsManager.errors
    assert.ok(errors.coordinate_fetch_failed, `${locale}: falta errors.coordinate_fetch_failed`)
    assert.ok(errors.missing_coordinates, `${locale}: falta errors.missing_coordinates`)
    // A frase da ausência normal não pode voltar a falar de sistema, de fetch ou de erro: é
    // exatamente o que mandava o operador fechar e reabrir uma tela que responderia o mesmo.
    assert.doesNotMatch(errors.missing_coordinates, /fetch|sistema|system/i, locale)
  }
})

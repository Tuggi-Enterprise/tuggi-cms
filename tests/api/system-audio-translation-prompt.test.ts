/**
 * `buildSystemAudioPrompt` — o prompt que traduz as linhas faladas de sistema.
 *
 * Defeito vivido, em produção: o direcional `logo à frente` virou **"Logo ahead"**
 * em inglês. A tradução usava `translateText`, que é o tradutor de copy de
 * marketing, e uma das regras dele é *"Do NOT translate brand names"*. Somada ao
 * falso amigo — "logo" em português é "já/bem", em inglês é logotipo —, a regra
 * mandou preservar a palavra. Ninguém viu até alguém tocar o áudio, porque o
 * arquivo no bucket não guarda o texto falado.
 *
 * O que o modelo devolve não é determinístico; o que a gente pede é. Estes testes
 * fixam o pedido.
 *
 * Módulo Deno puro nesta função, carregado por caminho montado em tempo de execução.
 *
 * Run with: npm run test:api
 */

import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

interface TranslationModule {
  buildSystemAudioPrompt: (
    text: string,
    targetLanguage: string,
    kind: 'direction' | 'notice'
  ) => string
}

const MODULE_PATH = resolve(
  import.meta.dirname,
  '../../supabase/functions/_shared/translationUtility.ts'
)

let mod: TranslationModule

before(async () => {
  mod = (await import(pathToFileURL(MODULE_PATH).href)) as TranslationModule
})

test('o prompt manda traduzir TODA palavra — sem exceção de marca', () => {
  const prompt = mod.buildSystemAudioPrompt('logo à frente', 'en-us', 'direction')

  assert.match(prompt, /TRANSLATE EVERY WORD/i)
  assert.doesNotMatch(
    prompt,
    /do not translate brand names/i,
    'é a regra que preservou "logo" e produziu "Logo ahead"'
  )
})

test('o prompt avisa do falso amigo que causou o defeito', () => {
  const prompt = mod.buildSystemAudioPrompt('logo à frente', 'en-us', 'direction')

  assert.match(prompt, /"logo"/)
  assert.match(prompt, /right\/just|right ahead/i)
})

test('direção e aviso pedem registros diferentes', () => {
  const direction = mod.buildSystemAudioPrompt('à sua esquerda', 'de-de', 'direction')
  const notice = mod.buildSystemAudioPrompt('Sua internet voltou.', 'de-de', 'notice')

  assert.match(direction, /DIRECTION CUE/i)
  assert.match(direction, /on your left|just ahead/i)
  assert.match(notice, /NOTICE/i)
  assert.notEqual(direction, notice)
})

test('o texto e o idioma alvo entram no prompt', () => {
  const prompt = mod.buildSystemAudioPrompt('Sua internet voltou.', 'ko-kr', 'notice')

  assert.match(prompt, /Sua internet voltou\./)
  assert.match(prompt, /ko-kr/)
  assert.match(prompt, /Korean/i, 'o nome do idioma vem do getLanguageName, que é o SSOT')
})

test('nada de marketing sobra: sem markdown, sem placeholder, sem tom de campanha', () => {
  const prompt = mod.buildSystemAudioPrompt('à sua direita', 'fr-fr', 'direction')

  assert.doesNotMatch(prompt, /marketing/i)
  assert.doesNotMatch(prompt, /call-to-action/i)
  assert.doesNotMatch(prompt, /\{\{/, 'não há placeholder nestas linhas')
})

test('o prompt pede linha curta e registro falado — é áudio no carro', () => {
  const prompt = mod.buildSystemAudioPrompt('logo à frente', 'ja-jp', 'direction')

  assert.match(prompt, /as short as the original/i)
  assert.match(prompt, /spoken/i)
  assert.match(prompt, /Output ONLY the translated line/i)
})

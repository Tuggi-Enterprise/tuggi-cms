/**
 * `supabase/functions/_shared/systemAudioScripts.ts` — a convenção de nome dos áudios
 * de sistema, que é contrato com o app.
 *
 * O app monta `{pasta}/{chave}_{locale}_{genero}.mp3` à mão em três serviços
 * (`DirectionalAudioPreloadService`, `AppInitializationService`,
 * `simpleAudioService`). Se o parser aceitar uma forma que o app não monta — ou
 * recusar uma que ele monta — o clipe some do carro sem nenhum erro aparecer.
 *
 * O mesmo parser é o único guarda do DELETE da Edge Function: só caminho que ele
 * aceita pode ser apagado, e é o que mantém prefixo, curinga e bucket fora de alcance.
 *
 * O módulo é fonte Deno (`.ts` nos specifiers), então é carregado por caminho montado
 * em tempo de execução. É puro, não precisa do global `Deno`.
 *
 * Run with: npm run test:api
 */

import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

interface ParsedPath {
  family: 'directional' | 'notice'
  key: string
  locale: string
  gender: 'male' | 'female'
}

interface ScriptsModule {
  SYSTEM_AUDIO_SCRIPTS: ReadonlyArray<{
    key: string
    family: 'directional' | 'notice'
    sourceText: string | null
    trigger: string
  }>
  SYSTEM_AUDIO_LOCALES: ReadonlyArray<string>
  SYSTEM_AUDIO_GENDERS: ReadonlyArray<'male' | 'female'>
  SYSTEM_AUDIO_FOLDER: Record<'directional' | 'notice', string>
  RESERVED_FILES: ReadonlySet<string>
  buildSystemAudioPath: (
    family: 'directional' | 'notice',
    key: string,
    locale: string,
    gender: 'male' | 'female'
  ) => string
  parseSystemAudioPath: (path: string) => ParsedPath | null
}

const MODULE_PATH = resolve(
  import.meta.dirname,
  '../../supabase/functions/_shared/systemAudioScripts.ts'
)

let mod: ScriptsModule

before(async () => {
  mod = (await import(pathToFileURL(MODULE_PATH).href)) as ScriptsModule
})

test('build → parse é ida e volta para todas as combinações do catálogo', () => {
  let combinations = 0

  for (const script of mod.SYSTEM_AUDIO_SCRIPTS) {
    for (const locale of mod.SYSTEM_AUDIO_LOCALES) {
      for (const gender of mod.SYSTEM_AUDIO_GENDERS) {
        const path = mod.buildSystemAudioPath(script.family, script.key, locale, gender)
        const parsed = mod.parseSystemAudioPath(path)

        assert.deepEqual(
          parsed,
          { family: script.family, key: script.key, locale, gender },
          `não reconheceu ${path}`
        )
        combinations++
      }
    }
  }

  // 13 chaves × 12 locales × 2 gêneros. Um número aqui é o que denuncia chave
  // removida sem querer.
  assert.equal(combinations, 312)
})

test('o nome que o app monta hoje continua sendo aceito', () => {
  assert.deepEqual(mod.parseSystemAudioPath('directional-audios/left_pt-br_male.mp3'), {
    family: 'directional',
    key: 'left',
    locale: 'pt-br',
    gender: 'male',
  })
})

test('chave com separador é recusada na construção — quebraria o parser de três segmentos', () => {
  assert.throws(() => mod.buildSystemAudioPath('notice', 'balance_1h', 'pt-br', 'male'))
  assert.throws(() => mod.buildSystemAudioPath('notice', 'balance-1h', 'pt-br', 'male'))
})

test('locale e gênero fora do catálogo são recusados', () => {
  assert.throws(() => mod.buildSystemAudioPath('notice', 'offline', 'pt-BR', 'male'))
  assert.throws(() => mod.buildSystemAudioPath('notice', 'offline', 'nl-nl', 'male'))
  assert.throws(() =>
    mod.buildSystemAudioPath('notice', 'offline', 'pt-br', 'neutral' as 'male')
  )
})

test('parser recusa tudo que não é exatamente um arquivo de áudio de sistema', () => {
  const refused = [
    'directional-audios/silent.mp3',            // no-op do app, não é nosso
    'directional-audios/.emptyFolderPlaceholder',
    'directional-audios',                        // prefixo
    'directional-audios/',                       // prefixo com barra
    'directional-audios/left_pt-br_male.wav',    // extensão errada
    'directional-audios/left_pt-br.mp3',         // dois segmentos
    'directional-audios/left_pt-br_male_2.mp3',  // quatro segmentos
    'master_audio/abc/abc-pt-br-male.mp3',       // áudio de POI, outra pasta
    'notice-audios/../master_audio/x.mp3',       // travessia
    '../notice-audios/offline_pt-br_male.mp3',
    'notice-audios/offline_pt-br_male.mp3/x',
  ]

  for (const path of refused) {
    assert.equal(mod.parseSystemAudioPath(path), null, `deveria recusar ${path}`)
  }
})

test('as duas pastas são as que o app lê, e o silent.mp3 é reservado', () => {
  assert.equal(mod.SYSTEM_AUDIO_FOLDER.directional, 'directional-audios')
  assert.equal(mod.SYSTEM_AUDIO_FOLDER.notice, 'notice-audios')
  assert.ok(mod.RESERVED_FILES.has('silent.mp3'))
})

test('as chaves de aviso estão no catálogo — as 9 do §10 e `missedpoi` —, e as sem copy estão marcadas', () => {
  const notices = mod.SYSTEM_AUDIO_SCRIPTS.filter((s) => s.family === 'notice').map((s) => s.key)

  // `missedpoi` é a única que não vem do §10: ela avisa o POI que passou sem ser
  // narrado por falta de saldo. As outras nove são as do documento, e a lista é
  // fechada de propósito — chave a mais aqui é arquivo a mais num bucket público.
  assert.deepEqual(notices.sort(), [
    'balance15min',
    'balance1h',
    'balanceend',
    'locationoff',
    'missedpoi',
    'offline',
    'online',
    'passactive',
    'welcomeend',
    'welcomestart',
  ])

  const pending = mod.SYSTEM_AUDIO_SCRIPTS.filter((s) => s.sourceText === null)
  assert.deepEqual(pending, [], 'toda chave tem copy pt-BR escrita')
})

test('as três direções existem e têm copy', () => {
  const directions = mod.SYSTEM_AUDIO_SCRIPTS.filter((s) => s.family === 'directional')
  assert.deepEqual(directions.map((d) => d.key).sort(), ['front', 'left', 'right'])
  assert.ok(directions.every((d) => typeof d.sourceText === 'string' && d.sourceText.length > 0))
})

test('a direção "à frente" tem a chave `front`, que é a que o app pede', () => {
  // `directionCalculationService.ts` do app produz 'left' | 'right' | 'front' | 'back'
  // e três serviços montam `${direction}_${locale}_${gender}.mp3` a partir disso.
  // Uma chave `ahead` geraria um arquivo que ninguém busca — o direcional de frente
  // sumiria em campo sem erro nenhum aparecer no CMS.
  const ahead = mod.SYSTEM_AUDIO_SCRIPTS.find((s) => s.key === 'ahead')
  assert.equal(ahead, undefined, 'a chave é `front`; renomear exige mudar o app')

  const front = mod.SYSTEM_AUDIO_SCRIPTS.find((s) => s.key === 'front')
  assert.ok(front, 'a chave `front` tem que existir')
  assert.equal(
    mod.buildSystemAudioPath('directional', 'front', 'pt-br', 'male'),
    'directional-audios/front_pt-br_male.mp3'
  )
})

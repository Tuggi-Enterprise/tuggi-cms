/**
 * `supabase/functions/_shared/loudness.ts` — a medição e a normalização que dão
 * volume aos áudios de sistema.
 *
 * O alvo é o do Spotify em "Normal": −14 LUFS integrado, true peak abaixo de
 * −1 dBTP. Hoje o pipeline entrega por volta de RMS −19, que é o "Quiet" do Spotify,
 * porque o `effectsProfileId` normaliza por conta própria e ignora `volumeGainDb` —
 * medição já registrada em `ttsGenerator.ts`.
 *
 * A referência da medição é a própria BS.1770-4: um seno a plena escala tem loudness
 * conhecida, e é isso que ancora o teste em vez de um número saído do nosso código.
 *
 * Módulo Deno puro, carregado por caminho montado em tempo de execução.
 *
 * Run with: npm run test:api
 */

import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

interface MonoAudio {
  samples: Float32Array
  sampleRate: number
}

interface LoudnessModule {
  measureLufs: (audio: MonoAudio) => number
  measureTruePeakDbtp: (audio: MonoAudio) => number
  limitTruePeak: (
    audio: MonoAudio,
    ceilingDbtp?: number
  ) => { audio: MonoAudio; maxReductionDb: number }
  normalizeLoudness: (
    audio: MonoAudio,
    targetLufs?: number,
    ceilingDbtp?: number,
    options?: { limiter?: boolean; maxGainDb?: number }
  ) => {
    audio: MonoAudio
    inputLufs: number
    outputLufs: number
    outputTruePeakDbtp: number
    appliedGainDb: number
    limiterReductionDb: number
    peakLimited: boolean
  }
  decodeWavToMono: (bytes: Uint8Array) => MonoAudio
  monoToPcm16: (audio: MonoAudio) => Int16Array
  SPOTIFY_TARGET_LUFS: number
  SPOTIFY_CEILING_DBTP: number
}

const MODULE_PATH = resolve(import.meta.dirname, '../../supabase/functions/_shared/loudness.ts')

const SAMPLE_RATE = 24000

/** Seno de amplitude `amp`, `seconds` de duração, no rate nativo da voz. */
function sine(amp: number, seconds = 3, freq = 1000, sampleRate = SAMPLE_RATE): MonoAudio {
  const samples = new Float32Array(Math.round(seconds * sampleRate))
  for (let i = 0; i < samples.length; i++) {
    samples[i] = amp * Math.sin((2 * Math.PI * freq * i) / sampleRate)
  }
  return { samples, sampleRate }
}

/** WAV 16-bit mono, o formato exato que o `LINEAR16` do Google devolve. */
function wav(audio: MonoAudio): Uint8Array {
  const pcmBytes = audio.samples.length * 2
  const buffer = new ArrayBuffer(44 + pcmBytes)
  const view = new DataView(buffer)
  const bytes = new Uint8Array(buffer)

  const ascii = (at: number, text: string) => {
    for (let i = 0; i < text.length; i++) bytes[at + i] = text.charCodeAt(i)
  }

  ascii(0, 'RIFF')
  view.setUint32(4, 36 + pcmBytes, true)
  ascii(8, 'WAVE')
  ascii(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)                      // PCM
  view.setUint16(22, 1, true)                      // mono
  view.setUint32(24, audio.sampleRate, true)
  view.setUint32(28, audio.sampleRate * 2, true)   // byte rate
  view.setUint16(32, 2, true)                      // block align
  view.setUint16(34, 16, true)                     // bits
  ascii(36, 'data')
  view.setUint32(40, pcmBytes, true)

  for (let i = 0; i < audio.samples.length; i++) {
    view.setInt16(44 + i * 2, Math.round(audio.samples[i] * 32767), true)
  }

  return bytes
}

let mod: LoudnessModule

before(async () => {
  mod = (await import(pathToFileURL(MODULE_PATH).href)) as LoudnessModule
})

test('seno a plena escala mede perto de −3 LUFS, como manda a BS.1770', () => {
  // Um seno de amplitude 1 tem potência média 0,5 → −3,01 dBFS. A ponderação K em
  // 1 kHz é ~0 dB, então a loudness fica na mesma casa.
  const measured = mod.measureLufs(sine(1))
  assert.ok(Math.abs(measured - -3.01) < 0.5, `mediu ${measured} LUFS`)
})

test('cair 10 dB na amplitude cai 10 LU na medição', () => {
  const loud = mod.measureLufs(sine(1))
  const quiet = mod.measureLufs(sine(Math.pow(10, -10 / 20)))
  assert.ok(Math.abs(loud - quiet - 10) < 0.2, `${loud} vs ${quiet}`)
})

test('silêncio digital não vira ganho infinito', () => {
  const silence: MonoAudio = { samples: new Float32Array(SAMPLE_RATE), sampleRate: SAMPLE_RATE }
  const result = mod.normalizeLoudness(silence)

  assert.equal(result.appliedGainDb, 0)
  assert.equal(result.peakLimited, false)
  assert.ok(!Number.isFinite(result.inputLufs))
})

test('clipe silencioso chega ao alvo de −14 LUFS sem passar de −1 dBTP', () => {
  // −30 dBFS: bem abaixo do alvo, sobra headroom de sobra para o ganho.
  const quiet = sine(Math.pow(10, -30 / 20))
  const result = mod.normalizeLoudness(quiet)

  assert.ok(Math.abs(result.outputLufs - mod.SPOTIFY_TARGET_LUFS) < 0.3, `${result.outputLufs} LUFS`)
  assert.ok(result.outputTruePeakDbtp <= mod.SPOTIFY_CEILING_DBTP + 0.05, `${result.outputTruePeakDbtp} dBTP`)
  assert.equal(result.peakLimited, false)
  assert.ok(result.appliedGainDb > 0)

  // E a medição do resultado confirma a promessa, não só a aritmética do ganho.
  assert.ok(Math.abs(mod.measureLufs(result.audio) - mod.SPOTIFY_TARGET_LUFS) < 0.3)
})

test('clipe alto demais desce até o alvo', () => {
  const result = mod.normalizeLoudness(sine(1))

  assert.ok(result.appliedGainDb < 0)
  assert.ok(Math.abs(result.outputLufs - mod.SPOTIFY_TARGET_LUFS) < 0.3, `${result.outputLufs} LUFS`)
  assert.equal(result.peakLimited, false)
})

// ---------------------------------------------------------------------------
// O caso que motivou o limitador. Medido em produção: os dois primeiros arquivos
// gerados saíram a −19,01 e −18,92 LUFS, com pico já em −1,5 dBTP. Fator de crista
// de ~17 dB — o primeiro decibel de ganho estoura o teto, e só o ganho puro
// entregava exatamente a altura do acervo antigo, que é o que o operador ouviu.
// ---------------------------------------------------------------------------

/**
 * Sinal com o mesmo fator de crista do material real: corpo por volta de −19 LUFS e
 * transientes periódicos quase no fundo de escala, como os plosivos da fala.
 */
function spiky(base = 0.16, spike = 0.85, seconds = 3): MonoAudio {
  const audio = sine(base, seconds, 200)
  for (let i = 0; i < audio.samples.length; i += Math.round(SAMPLE_RATE * 0.25)) {
    for (let k = 0; k < 12; k++) {
      if (i + k < audio.samples.length) audio.samples[i + k] = spike * (k % 2 === 0 ? 1 : -1)
    }
  }
  return audio
}

test('sem limitador, o pico trava o ganho e o clipe fica na altura antiga', () => {
  const result = mod.normalizeLoudness(spiky(), -14, -1, { limiter: false })

  assert.equal(result.peakLimited, true)
  assert.ok(
    result.outputLufs < -17.5,
    `ganho puro deveria empacar perto de −19, deu ${result.outputLufs}`
  )
})

test('com limitador, o mesmo clipe chega ao alvo sem passar do teto', () => {
  const source = spiky()
  const result = mod.normalizeLoudness(source, -14, -1)

  assert.ok(Math.abs(result.outputLufs - -14) < 0.3, `${result.outputLufs} LUFS`)
  assert.ok(result.outputTruePeakDbtp <= -1 + 0.05, `${result.outputTruePeakDbtp} dBTP`)
  assert.ok(result.limiterReductionDb > 0, 'o limitador tinha que ter atuado')
  assert.equal(result.peakLimited, false)

  // E a medição do arquivo entregue confirma — não é aritmética do ganho.
  assert.ok(Math.abs(mod.measureLufs(result.audio) - -14) < 0.3)
})

test('o alvo é parâmetro: −11 sai mais alto que −14, os dois dentro do teto', () => {
  const normal = mod.normalizeLoudness(spiky(), -14, -1)
  const loud = mod.normalizeLoudness(spiky(), -11, -1)

  assert.ok(loud.outputLufs > normal.outputLufs + 2, `${loud.outputLufs} vs ${normal.outputLufs}`)
  assert.ok(loud.outputTruePeakDbtp <= -1 + 0.05)
})

test('o limitador só toca no que passa do teto', () => {
  const quiet = sine(Math.pow(10, -20 / 20))
  const result = mod.limitTruePeak(quiet, -1)

  assert.equal(result.maxReductionDb, 0)
  for (let i = 0; i < quiet.samples.length; i += 331) {
    assert.equal(result.audio.samples[i], quiet.samples[i])
  }
})

test('o limitador segura o transiente antes de ele chegar — sem clipping', () => {
  const source = spiky(0.05, 1.2)
  const result = mod.limitTruePeak(source, -1)

  assert.ok(result.maxReductionDb > 0)
  assert.ok(mod.measureTruePeakDbtp(result.audio) <= -1 + 0.05)

  // Nenhuma amostra saturou: limitador é ganho variável, não corte.
  for (const sample of result.audio.samples) assert.ok(Math.abs(sample) < 1)
})

test('true peak enxerga o pico entre amostras, que o pico de amostra não vê', () => {
  // Seno em 6 kHz a 24 kHz: 4 amostras por ciclo, deslocado de fase para que
  // nenhuma delas caia no topo da onda.
  const samples = new Float32Array(SAMPLE_RATE)
  for (let i = 0; i < samples.length; i++) {
    samples[i] = 0.9 * Math.sin((2 * Math.PI * 6000 * i) / SAMPLE_RATE + Math.PI / 4)
  }
  const audio = { samples, sampleRate: SAMPLE_RATE }

  let samplePeak = 0
  for (const s of samples) samplePeak = Math.max(samplePeak, Math.abs(s))

  const truePeak = Math.pow(10, mod.measureTruePeakDbtp(audio) / 20)
  assert.ok(truePeak > samplePeak, `true peak ${truePeak} deveria superar o pico de amostra ${samplePeak}`)
})

test('o WAV do LINEAR16 é lido de volta com o rate e as amostras certas', () => {
  const original = sine(0.5, 0.5)
  const decoded = mod.decodeWavToMono(wav(original))

  assert.equal(decoded.sampleRate, SAMPLE_RATE)
  assert.equal(decoded.samples.length, original.samples.length)

  for (let i = 0; i < decoded.samples.length; i += 97) {
    assert.ok(Math.abs(decoded.samples[i] - original.samples[i]) < 1e-3)
  }
})

test('a volta para PCM 16 bits satura em vez de dar a volta', () => {
  const hot: MonoAudio = { samples: Float32Array.from([1.5, -1.5, 0]), sampleRate: SAMPLE_RATE }
  const pcm = mod.monoToPcm16(hot)

  assert.equal(pcm[0], 32767)
  assert.equal(pcm[1], -32768)
  assert.equal(pcm[2], 0)
})

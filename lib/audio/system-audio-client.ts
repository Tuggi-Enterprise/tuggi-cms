/**
 * Types and browser calls for the system audio screen.
 *
 * Deliberately holds no catalogue: keys, locales, copy, voices and the file-name
 * parser all live in `supabase/functions/_shared/systemAudioScripts.ts`, which is the
 * side that also writes the files. Restating any of it here would create the second
 * list that goes stale — the screen renders whatever `GET /api/system-audio` says.
 */

export type SystemAudioFamily = 'directional' | 'notice'
export type VoiceGender = 'male' | 'female'
export type VoiceTier = 'legacy' | 'hd'

export interface SystemAudioScript {
  key: string
  family: SystemAudioFamily
  /** pt-BR source copy. `null` means design has not written the line yet. */
  sourceText: string | null
  trigger: string
}

export interface SystemAudioLocale {
  locale: string
  /** False for pt-PT: Google does not publish Chirp 3: HD for it. */
  hdAvailable: boolean
  /** Voz sugerida para este idioma, por gênero. `null` quando não há Chirp 3: HD. */
  recommendedVoice: Record<VoiceGender, string> | null
}

export interface SystemAudioFile {
  path: string
  bytes: number | null
  updatedAt: string | null
  publicUrl: string
}

export interface SystemAudioCatalogue {
  scripts: SystemAudioScript[]
  locales: SystemAudioLocale[]
  genders: VoiceGender[]
  voices: { name: string; gender: VoiceGender }[]
  defaultVoice: Record<VoiceGender, string>
  /** Mapa idioma → voz recomendada, para a tela mostrar o que vai sair. */
  voiceByLocale: Record<string, Record<VoiceGender, string>>
  sourceLocale: string
  folders: Record<SystemAudioFamily, string>
}

export interface SystemAudioInventory {
  catalogue: SystemAudioCatalogue
  files: SystemAudioFile[]
}

export interface GenerateRequest {
  family: SystemAudioFamily
  key: string
  locale: string
  gender: VoiceGender
  tier: VoiceTier
  voiceName?: string
  speakingRate?: number
  effectsProfile?: boolean
  /** Texto-**fonte** em pt-BR. Para os outros idiomas ele é traduzido, não falado como está. */
  text?: string
  /** Falado literalmente, sem tradução — para consertar uma tradução ruim. */
  finalText?: string
  previewOnly?: boolean
  /** Loudness target in LUFS. −14 é o "Normal" do Spotify; −11, o "Loud". */
  targetLufs?: number
}

export interface GenerateResult {
  path: string
  publicUrl: string
  bytes: number
  text: string
  /** `true` quando o texto falado saiu de tradução automática do pt-BR. */
  translated: boolean
  voice: string
  tierRequested: VoiceTier
  /** `legacy` while `tierRequested` is `hd` means the locale has no HD voice. */
  tierUsed: VoiceTier
  sampleRate: number
  bitrateKbps: number
  loudness: {
    targetLufs: number
    inputLufs: number | null
    outputLufs: number | null
    truePeakDbtp: number | null
    appliedGainDb: number | null
    /** Quanto o limitador segurou os transientes. 0 = não atuou. */
    limiterReductionDb: number | null
    /** `true` quando nem com limitador o alvo foi alcançado. */
    peakLimited: boolean
  }
}

export interface PreviewResult {
  path: string
  text: string
  translated: boolean
}

async function parse<T>(res: Response): Promise<T> {
  const payload = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(payload?.error || `Request failed (${res.status})`)
  return payload as T
}

export async function fetchInventory(): Promise<SystemAudioInventory> {
  return parse<SystemAudioInventory>(await fetch('/api/system-audio', { cache: 'no-store' }))
}

export async function generateSystemAudio(body: GenerateRequest): Promise<GenerateResult> {
  return parse<GenerateResult>(
    await fetch('/api/system-audio', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  )
}

export async function previewSystemAudioText(
  body: Omit<GenerateRequest, 'previewOnly'>
): Promise<PreviewResult> {
  return parse<PreviewResult>(
    await fetch('/api/system-audio', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, previewOnly: true }),
    })
  )
}

export async function deleteSystemAudio(path: string): Promise<{ deleted: string }> {
  return parse<{ deleted: string }>(
    await fetch('/api/system-audio', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path }),
    })
  )
}

/** `{folder}/{key}_{locale}_{gender}.mp3`, the closed convention. */
export function fileKey(family: SystemAudioFamily, folders: Record<SystemAudioFamily, string>, key: string, locale: string, gender: VoiceGender): string {
  return `${folders[family]}/${key}_${locale}_${gender}.mp3`
}

export interface BatchTarget {
  script: SystemAudioScript
  locale: string
  gender: VoiceGender
}

export interface BatchPlanInput {
  scripts: SystemAudioScript[]
  folders: Record<SystemAudioFamily, string>
  locales: string[]
  /** Vozes marcadas na tela. Só estas são geradas. */
  genders: VoiceGender[]
  /** Caminhos que já existem no bucket. */
  existing: Set<string>
  /** `true` regera o que já existe; `false` só preenche buraco. */
  overwrite: boolean
  /** Texto-fonte por chave, já com a edição do operador aplicada. */
  sourceTextOf: (script: SystemAudioScript) => string
}

/**
 * O que um lote vai gerar, em ordem.
 *
 * Mora aqui, e não dentro do componente, porque foi esta regra que produziu arquivo
 * que ninguém pediu: o lote iterava **todos** os gêneros do catálogo em vez dos
 * marcados na tela, e quem queria só `male` levou `female` junto. Regra que decide o
 * que é escrito num bucket público é regra que se testa.
 */
export function planBatch(input: BatchPlanInput): BatchTarget[] {
  const { scripts, folders, locales, genders, existing, overwrite, sourceTextOf } = input
  const targets: BatchTarget[] = []

  for (const script of scripts) {
    if (!sourceTextOf(script)) continue
    for (const locale of locales) {
      for (const gender of genders) {
        const path = fileKey(script.family, folders, script.key, locale, gender)
        if (!overwrite && existing.has(path)) continue
        targets.push({ script, locale, gender })
      }
    }
  }

  return targets
}

/**
 * Bandeira e rótulo curto por locale — só apresentação. A **lista** de idiomas
 * continua vindo da Edge Function (`catalogue.locales`), que é quem grava os arquivos;
 * isto aqui só sabe desenhar o que ela mandar, e um locale sem entrada cai no código.
 */
export const LOCALE_DISPLAY: Record<string, { flag: string; short: string }> = {
  'pt-br': { flag: '🇧🇷', short: 'Brasil' },
  'pt-pt': { flag: '🇵🇹', short: 'Portugal' },
  'en-us': { flag: '🇺🇸', short: 'US' },
  'en-gb': { flag: '🇬🇧', short: 'UK' },
  'es-es': { flag: '🇪🇸', short: 'España' },
  'fr-fr': { flag: '🇫🇷', short: 'France' },
  'de-de': { flag: '🇩🇪', short: 'DE' },
  'it-it': { flag: '🇮🇹', short: 'IT' },
  'ja-jp': { flag: '🇯🇵', short: 'JP' },
  'ko-kr': { flag: '🇰🇷', short: 'KR' },
  'cmn-cn': { flag: '🇨🇳', short: 'CN' },
  'ru-ru': { flag: '🇷🇺', short: 'RU' },
}

export const localeDisplay = (locale: string) =>
  LOCALE_DISPLAY[locale] ?? { flag: '🏳️', short: locale }

export function formatBytes(bytes: number | null): string {
  if (bytes === null) return '—'
  if (bytes < 1024) return `${bytes} B`
  return `${(bytes / 1024).toFixed(1)} KB`
}

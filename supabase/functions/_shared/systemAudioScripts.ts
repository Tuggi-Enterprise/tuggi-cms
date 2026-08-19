// _shared/systemAudioScripts.ts
//
// The catalogue of audio that belongs to no POI: the three direction cues the player
// puts in front of a narration, and the notices of the hourly model.
//
// Naming is closed by the operator and must not drift — the app builds the URL by
// convention in three places (`DirectionalAudioPreloadService`,
// `AppInitializationService`, `simpleAudioService`):
//
//     {family}/{key}_{locale}_{gender}.mp3        →  left_pt-br_male.mp3
//
// Three segments, underscore-separated, so **the key itself carries no underscore
// and no hyphen**. The parser lives in `lib/audio/system-audio.ts` on the CMS side
// and is mirrored by `parseSystemAudioPath` here.
//
// Copy: **pt-BR is the only text written by a human**, and every other locale is a
// translation of it made at generation time. That is the whole editorial model here —
// the operator writes and approves one line, then asks for the other eleven languages.
// Editing the text in the CMS edits the pt-BR source; the translation follows.

export type SystemAudioFamily = 'directional' | 'notice';

export interface SystemAudioScript {
  key: string;
  family: SystemAudioFamily;
  /** Source copy, pt-BR. `null` means the copy has not been written yet. */
  sourceText: string | null;
  /** What fires this clip in the app — context for the operator, not behaviour. */
  trigger: string;
}

/** Storage prefix per family, inside the `travel-app-audios` bucket. */
export const SYSTEM_AUDIO_FOLDER: Record<SystemAudioFamily, string> = {
  directional: 'directional-audios',
  notice: 'notice-audios',
};

/** Source locale of every `sourceText` below. */
export const SOURCE_LOCALE = 'pt-br';

/**
 * Files in `directional-audios/` that are not `{key}_{locale}_{gender}.mp3` and must
 * be left alone. `silent.mp3` is the app's no-op track.
 */
export const RESERVED_FILES: ReadonlySet<string> = new Set(['silent.mp3', '.emptyFolderPlaceholder']);

export const SYSTEM_AUDIO_SCRIPTS: ReadonlyArray<SystemAudioScript> = [
  // ─── Direction cues (BR-AUDIO-014: they play when a trigger point fired) ───────
  {
    key: 'left',
    family: 'directional',
    sourceText: 'à sua esquerda',
    trigger: 'POI à esquerda da rota, disparo por trigger point',
  },
  {
    key: 'right',
    family: 'directional',
    sourceText: 'à sua direita',
    trigger: 'POI à direita da rota, disparo por trigger point',
  },
  {
    // ⚠️ The key is `front`, not `ahead`, and it is not ours to choose: the app
    // computes the direction as `'left' | 'right' | 'front' | 'back'`
    // (`directionCalculationService.ts`) and builds the file name from that string
    // in three services. A file named `ahead_*` would never be requested by anyone.
    // Renaming means changing the app and waiting for a store release.
    key: 'front',
    family: 'directional',
    sourceText: 'logo à frente',
    trigger: 'POI à frente na rota, disparo por trigger point',
  },

  // ─── Notices of the hourly model (PROMPTdevmodelohoras §10) ────────────────────
  {
    key: 'balance1h',
    family: 'notice',
    sourceText: 'Você ainda tem uma hora de áudio comigo.',
    trigger: 'saldo cruza 60 min, estado metered',
  },
  {
    key: 'balance15min',
    family: 'notice',
    sourceText:
      'Faltam quinze minutos de áudio. Quando você parar em algum lugar, dá para adicionar mais horas no aplicativo.',
    trigger: 'saldo cruza 15 min, estado metered',
  },
  {
    key: 'balanceend',
    family: 'notice',
    sourceText:
      'Suas horas acabaram, então vou parar de narrar por enquanto. O mapa e as rotas continuam funcionando normalmente.',
    trigger: 'saldo zera com passe comprado',
  },
  {
    key: 'welcomeend',
    family: 'notice',
    sourceText:
      'Suas horas gratuitas acabaram, então vou parar de narrar por enquanto. Quando quiser continuar, você encontra os passes no aplicativo.',
    trigger: 'saldo zera vindo da concessão de boas-vindas',
  },
  {
    key: 'locationoff',
    family: 'notice',
    sourceText:
      'Não estou conseguindo ver onde você está, então não consigo narrar os lugares. Quando parar, confira a permissão de localização no aplicativo.',
    trigger: 'permissão de localização revogada com sessão ativa',
  },
  {
    key: 'offline',
    family: 'notice',
    sourceText:
      'Você está sem internet agora, mas pode seguir tranquilo. Eu continuo narrando com o conteúdo que já está salvo no seu telefone.',
    trigger: 'offline persistente ≥ 60 s com sessão ativa',
  },
  {
    key: 'online',
    family: 'notice',
    sourceText: 'Sua internet voltou.',
    trigger: 'conexão estável ≥ 30 s após episódio já anunciado',
  },
  {
    key: 'welcomestart',
    family: 'notice',
    sourceText:
      'Boa viagem. Vou te contando sobre os lugares no caminho, e suas horas só correm quando você está em movimento.',
    trigger: 'primeira sessão com deslocamento detectado',
  },
  {
    key: 'passactive',
    family: 'notice',
    sourceText: 'Seu passe está ativo. Já volto a narrar os lugares do caminho.',
    trigger: 'direito concedido durante sessão ativa',
  },
  {
    // Placeholder copy: the final line is the operator's, written on the screen —
    // the `Texto base` field of `SystemAudioManager` edits this source before
    // generating, and the other eleven languages are translations of it.
    key: 'missedpoi',
    family: 'notice',
    sourceText:
      'Você acabou de passar por um lugar que eu teria contado, mas suas horas acabaram.',
    trigger: 'primeiro POI alcançado sem saldo; cooldown de 20 min, teto de 3 por sessão',
  },
];

export const getScript = (key: string): SystemAudioScript | undefined =>
  SYSTEM_AUDIO_SCRIPTS.find((s) => s.key === key);

/**
 * Locales the app offers as audio languages (`AUDIO_LANGUAGES`, TTSLanguageContext).
 * Lower-case, because that is what the app writes into the URL.
 */
export const SYSTEM_AUDIO_LOCALES: ReadonlyArray<string> = [
  'pt-br',
  'pt-pt',
  'en-us',
  'en-gb',
  'es-es',
  'fr-fr',
  'de-de',
  'it-it',
  'ja-jp',
  'ko-kr',
  'cmn-cn',
  'ru-ru',
];

export const SYSTEM_AUDIO_GENDERS: ReadonlyArray<'male' | 'female'> = ['male', 'female'];

/** `{key}` must not contain the separator, or the three-segment parser breaks. */
const KEY_PATTERN = /^[a-z0-9]+$/;

export function buildSystemAudioPath(
  family: SystemAudioFamily,
  key: string,
  locale: string,
  gender: 'male' | 'female',
): string {
  if (!KEY_PATTERN.test(key)) throw new Error(`Invalid system audio key: "${key}"`);
  if (!SYSTEM_AUDIO_LOCALES.includes(locale)) throw new Error(`Unsupported locale: "${locale}"`);
  if (!SYSTEM_AUDIO_GENDERS.includes(gender)) throw new Error(`Unsupported gender: "${gender}"`);

  return `${SYSTEM_AUDIO_FOLDER[family]}/${key}_${locale}_${gender}.mp3`;
}

export interface ParsedSystemAudioPath {
  family: SystemAudioFamily;
  key: string;
  locale: string;
  gender: 'male' | 'female';
}

/**
 * Parses a full storage path back into its parts, or returns `null` when the path is
 * not a system audio file. Used to validate deletion targets: only a path this
 * function accepts may ever be removed, which is what keeps a prefix or a bucket out
 * of reach of the CMS button.
 */
export function parseSystemAudioPath(path: string): ParsedSystemAudioPath | null {
  const segments = path.split('/');
  if (segments.length !== 2) return null;

  const [folder, fileName] = segments;
  const family = (Object.keys(SYSTEM_AUDIO_FOLDER) as SystemAudioFamily[]).find(
    (f) => SYSTEM_AUDIO_FOLDER[f] === folder,
  );
  if (!family) return null;
  if (RESERVED_FILES.has(fileName)) return null;
  if (!fileName.endsWith('.mp3')) return null;

  const parts = fileName.slice(0, -'.mp3'.length).split('_');
  if (parts.length !== 3) return null;

  const [key, locale, gender] = parts;
  if (!KEY_PATTERN.test(key)) return null;
  if (!SYSTEM_AUDIO_LOCALES.includes(locale)) return null;
  if (gender !== 'male' && gender !== 'female') return null;

  return { family, key, locale, gender };
}

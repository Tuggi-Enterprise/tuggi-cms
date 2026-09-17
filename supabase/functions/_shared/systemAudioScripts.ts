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
    // The key the app asks for when the network drops — BR-AUDIO-022 item 2.7.
    // It is `offline` and there is no other: a `nointernet` key was created on
    // 2026-09-01 to carry a neutral text, and the operator REVERTED it on
    // 2026-09-02. The recorded promise below is TRUE for whoever downloaded the
    // offline area (BR-MONETIZACAO-019) and empty for whoever did not; the
    // accepted distance is BR-AUDIO-027, `Divergência 2`. The clip that replaced
    // it was never recorded, so the drop was silent in the field.
    //
    // Re-recording this text is the operator's call (`_perguntas-abertas.md`
    // 104) and does not block the key.
    key: 'offline',
    family: 'notice',
    sourceText:
      'Você está sem internet agora, mas pode seguir tranquilo. Eu continuo narrando com o conteúdo que já está salvo no seu telefone.',
    trigger: 'queda de rede persistente ≥ 30 s com sessão de guia ativa',
  },
  {
    key: 'online',
    family: 'notice',
    sourceText: 'Sua internet voltou.',
    trigger: 'conexão estável ≥ 30 s depois de `offline` ter falado no mesmo episódio',
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
  // ---------------------------------------------------------------------------
  // Class `ranking` — BR-AUDIO-022 item 8, #747 (épico #737).
  //
  // Three keys, rises only: a fall never becomes audio (the tourist causes the
  // rise, another account causes the fall — that one goes by push). The ordinal
  // is IN the key, so none of the three interpolates anything, and BR-RANKING-002
  // forbids the number of participants: no `de 13`, no percentage, no fraction.
  // BR-RANKING-006 forbids any mention of a prize.
  //
  // The copy below is the `design` recommendation of
  // `docs/design/spec-comunicacao-ranking-2026-09.md` §3.2, and it is a
  // PLACEHOLDER in the same sense `missedpoi` above is: the final line is the
  // operator's (BR-AUDIO-027, edge case 1), written in the `Texto base` field of
  // `SystemAudioManager` before generating.
  //
  // Two rulers before generating (spec §3.3): the pt-BR source is at most 50
  // characters, and each generated MP3 at most 3.5 s in every language —
  // `ffprobe -v error -show_entries format=duration -of csv=p=0 <file>.mp3`. The
  // reason is not silence: the clip waits behind a narration and is followed by
  // the direction cue plus the next POI, so at 80 km/h every second of notice is
  // a place that already went by.
  //
  // Present tense in all five, and that is a translation decision: `fr` and `it`
  // inflect the participle for gender (`tu es passé`, `sei salito`) and a
  // recorded clip cannot be taken back — there is no OTA (BR-OPERACAO-002).
  {
    key: 'rankingtop3',
    family: 'notice',
    sourceText: 'Você está entre os três primeiros esta semana.',
    trigger: 'subida para dentro do top 3 confirmada pelo servidor; uma vez por sessão',
  },
  {
    key: 'rankingsecond',
    family: 'notice',
    sourceText: 'Você está em segundo lugar esta semana.',
    trigger: 'subida para a 2ª posição confirmada pelo servidor; uma vez por sessão',
  },
  {
    key: 'rankingfirst',
    family: 'notice',
    sourceText: 'Você está em primeiro lugar esta semana.',
    trigger: 'subida para a 1ª posição confirmada pelo servidor; uma vez por sessão',
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

// _shared/ttsGenerator.ts
//
// Single source of truth for which Google voice speaks, in which tier, with which
// audio settings. Two tiers exist:
//
//   `legacy` — Neural2/WaveNet, the voices every POI narration was generated with.
//   `hd`     — Chirp 3: HD (`{locale}-Chirp3-HD-{Voice}`), the "áudio 3D" option in
//              the CMS. GA in 11 of the app's 12 locales; **pt-PT is not on Google's
//              list**, so it falls back to `legacy` and says so (`tierUsed`).
//
// Calling `generateAudioWithTTS` without options keeps the exact request body the
// POI pipeline has always sent — no narration changes sound because of the new tier.

export type VoiceTier = 'legacy' | 'hd';

export type VoiceGender = 'male' | 'female';

/**
 * The Chirp 3: HD roster, as published by Google (name + gender only — the docs
 * carry no timbre descriptor, so choosing between them is done by ear in the CMS).
 */
export const CHIRP3_HD_VOICES: ReadonlyArray<{ name: string; gender: VoiceGender }> = [
  { name: 'Achernar', gender: 'female' },
  { name: 'Achird', gender: 'male' },
  { name: 'Algenib', gender: 'male' },
  { name: 'Algieba', gender: 'male' },
  { name: 'Alnilam', gender: 'male' },
  { name: 'Aoede', gender: 'female' },
  { name: 'Autonoe', gender: 'female' },
  { name: 'Callirrhoe', gender: 'female' },
  { name: 'Charon', gender: 'male' },
  { name: 'Despina', gender: 'female' },
  { name: 'Enceladus', gender: 'male' },
  { name: 'Erinome', gender: 'female' },
  { name: 'Fenrir', gender: 'male' },
  { name: 'Gacrux', gender: 'female' },
  { name: 'Iapetus', gender: 'male' },
  { name: 'Kore', gender: 'female' },
  { name: 'Laomedeia', gender: 'female' },
  { name: 'Leda', gender: 'female' },
  { name: 'Orus', gender: 'male' },
  { name: 'Puck', gender: 'male' },
  { name: 'Pulcherrima', gender: 'female' },
  { name: 'Rasalgethi', gender: 'male' },
  { name: 'Sadachbia', gender: 'male' },
  { name: 'Sadaltager', gender: 'male' },
  { name: 'Schedar', gender: 'male' },
  { name: 'Sulafat', gender: 'female' },
  { name: 'Umbriel', gender: 'male' },
  { name: 'Vindemiatrix', gender: 'female' },
  { name: 'Zephyr', gender: 'female' },
  { name: 'Zubenelgenubi', gender: 'male' },
];

/** Fallback pair for a locale with no recommendation of its own. */
export const CHIRP3_HD_DEFAULT_VOICE: Record<VoiceGender, string> = {
  male: 'Charon',
  female: 'Kore',
};

/**
 * Recommended voice per locale — **a hypothesis, not a measurement.**
 *
 * Google publishes no per-language voice guidance: the Chirp 3: HD table carries name,
 * gender and locale availability, and nothing else. What it does publish, on the Gemini
 * speech docs, is a one-word character for each of the 30 voices, and that is one of the
 * two things this map is built on.
 *
 * The other is that languages carry their own pitch register, independently of the
 * speaker's anatomy: bilingual studies find Japanese with a higher F0 level and wider
 * span than English, Korean higher than English, and German lower and narrower than
 * English. So a voice that reads as authoritative in German reads as odd in Spanish —
 * not because the accent is wrong, but because the register is.
 *
 * Therefore: this map is a defensible starting point, **not** a finding. Whoever has a
 * native ear should compare the recommendation against the fallback pair in the CMS —
 * two clips per language — and correct the line. A wrong persona is inaudible to a
 * non-native ear, which is exactly why it survives.
 *
 * `pt-PT` is absent on purpose: Google does not publish Chirp 3: HD for it, and it falls
 * back to the WaveNet voice of its own locale.
 */
export const CHIRP3_HD_VOICE_BY_LOCALE: Record<string, Record<VoiceGender, string>> = {
  // Informativo e próximo — é a voz do guia na língua da casa.
  'pt-br': { male: 'Charon', female: 'Sulafat' },      // Informative / Warm
  // Registro mais alto e span maior que o inglês; clareza acima de gravidade.
  'ja-jp': { male: 'Umbriel', female: 'Achernar' },    // Easy-going / Soft
  'ko-kr': { male: 'Achird', female: 'Leda' },         // Friendly / Youthful
  // Língua tonal: timbre gravelly ou breathy embaça o contorno de tom.
  'cmn-cn': { male: 'Iapetus', female: 'Erinome' },    // Clear / Clear
  // Inglês americano: informativo; britânico, mais contido.
  'en-us': { male: 'Rasalgethi', female: 'Kore' },     // Informative / Firm
  'en-gb': { male: 'Sadaltager', female: 'Vindemiatrix' }, // Knowledgeable / Gentle
  // Espanhol não fala grave: brilho e energia, não peso.
  'es-es': { male: 'Puck', female: 'Autonoe' },        // Upbeat / Bright
  'it-it': { male: 'Sadachbia', female: 'Laomedeia' }, // Lively / Upbeat
  'fr-fr': { male: 'Schedar', female: 'Despina' },     // Even / Smooth
  // Alemão: nível de F0 mais baixo e span mais estreito que o inglês. `Algieba` é
  // escolha de ouvido do operador (2026-08-17), não dedução — e ouvido ganha de tabela.
  'de-de': { male: 'Algieba', female: 'Gacrux' },      // Smooth / Mature
  'ru-ru': { male: 'Orus', female: 'Pulcherrima' },    // Firm / Forward
};

/** Voz recomendada para o par (locale, gênero), com o fallback global. */
export const recommendedVoice = (language: string, gender: VoiceGender): string =>
  CHIRP3_HD_VOICE_BY_LOCALE[language.toLowerCase()]?.[gender] ?? CHIRP3_HD_DEFAULT_VOICE[gender];

/**
 * Locales where Chirp 3: HD is generally available, restricted to the ones the app
 * actually offers (`AUDIO_LANGUAGES` in the app's TTSLanguageContext).
 * `pt-PT` is deliberately absent — Google does not publish it for this tier.
 */
export const CHIRP3_HD_LANGUAGE_CODES: ReadonlySet<string> = new Set([
  'pt-BR',
  'en-US',
  'en-GB',
  'es-ES',
  'fr-FR',
  'de-DE',
  'it-IT',
  'ja-JP',
  'ko-KR',
  'cmn-CN',
  'ru-RU',
]);

export interface ResolvedVoice {
  /** Full Google voice name, e.g. `pt-BR-Chirp3-HD-Charon` or `pt-BR-Neural2-B`. */
  name: string;
  languageCode: string;
  pitch: number;
  /** Tier that ended up being used — differs from the request when HD is missing. */
  tierUsed: VoiceTier;
}

// Voice mapping for Google Cloud TTS
export const getVoiceConfig = (
  language: string,
  gender: VoiceGender,
  tier: VoiceTier = 'legacy',
  voiceName?: string,
): ResolvedVoice => {
  // Comprehensive voice mapping for 13 supported languages
  const voiceMap: Record<string, { male: string; female: string; languageCode: string }> = {
    // English
    // English
    'en': { male: 'en-US-Neural2-J', female: 'en-US-Neural2-F', languageCode: 'en-US' },
    'en-us': { male: 'en-US-Neural2-J', female: 'en-US-Neural2-F', languageCode: 'en-US' },
    'en-gb': { male: 'en-GB-Neural2-D', female: 'en-GB-Neural2-A', languageCode: 'en-GB' },
    
    // Portuguese
    'pt': { male: 'pt-BR-Neural2-B', female: 'pt-BR-Neural2-A', languageCode: 'pt-BR' },
    'pt-br': { male: 'pt-BR-Neural2-B', female: 'pt-BR-Neural2-A', languageCode: 'pt-BR' },
    'pt-pt': { male: 'pt-PT-Wavenet-B', female: 'pt-PT-Wavenet-A', languageCode: 'pt-PT' },
    
    // Spanish
    'es': { male: 'es-ES-Neural2-B', female: 'es-ES-Neural2-A', languageCode: 'es-ES' },
    'es-es': { male: 'es-ES-Neural2-B', female: 'es-ES-Neural2-A', languageCode: 'es-ES' },
    'es-us': { male: 'es-US-Neural2-B', female: 'es-US-Neural2-A', languageCode: 'es-US' },
    
    // German
    'de': { male: 'de-DE-Neural2-B', female: 'de-DE-Neural2-A', languageCode: 'de-DE' },
    'de-de': { male: 'de-DE-Neural2-B', female: 'de-DE-Neural2-A', languageCode: 'de-DE' },
    
    // French
    'fr': { male: 'fr-FR-Neural2-B', female: 'fr-FR-Neural2-A', languageCode: 'fr-FR' },
    'fr-fr': { male: 'fr-FR-Neural2-B', female: 'fr-FR-Neural2-A', languageCode: 'fr-FR' },
    
    // Italian
    'it': { male: 'it-IT-Neural2-C', female: 'it-IT-Neural2-A', languageCode: 'it-IT' },
    'it-it': { male: 'it-IT-Neural2-C', female: 'it-IT-Neural2-A', languageCode: 'it-IT' },
    
    // Japanese
    'ja': { male: 'ja-JP-Neural2-C', female: 'ja-JP-Neural2-B', languageCode: 'ja-JP' },
    'ja-jp': { male: 'ja-JP-Neural2-C', female: 'ja-JP-Neural2-B', languageCode: 'ja-JP' },
    
    // Chinese (Mandarin) — Simplified (cmn-CN). ⚠️ cmn-CN NÃO tem Neural2 no Google
    // (só Standard/WaveNet) — o antigo cmn-CN-Neural2-C dava 400 "voice does not exist".
    // WaveNet existe e aceita SSML.
    'zh': { male: 'cmn-CN-Wavenet-B', female: 'cmn-CN-Wavenet-A', languageCode: 'cmn-CN' },
    'cmn-cn': { male: 'cmn-CN-Wavenet-B', female: 'cmn-CN-Wavenet-A', languageCode: 'cmn-CN' },
    'zh-cn': { male: 'cmn-CN-Wavenet-B', female: 'cmn-CN-Wavenet-A', languageCode: 'cmn-CN' },
    
    // Korean
    'ko': { male: 'ko-KR-Neural2-C', female: 'ko-KR-Neural2-A', languageCode: 'ko-KR' },
    'ko-kr': { male: 'ko-KR-Neural2-C', female: 'ko-KR-Neural2-A', languageCode: 'ko-KR' },
    
    // Russian
    'ru': { male: 'ru-RU-Wavenet-B', female: 'ru-RU-Wavenet-A', languageCode: 'ru-RU' },
    'ru-ru': { male: 'ru-RU-Wavenet-B', female: 'ru-RU-Wavenet-A', languageCode: 'ru-RU' },
  };

  const normalizedLang = language.toLowerCase();
  const voices = voiceMap[normalizedLang];

  if (!voices) {
    // Fallback to English Neural voices
    console.log(`[Voice Config] Language ${language} not found, using English fallback`);
    return {
      name: gender === 'male' ? 'en-US-Neural2-J' : 'en-US-Neural2-F',
      languageCode: 'en-US',
      pitch: gender === 'male' ? -1.5 : -1.0,
      tierUsed: 'legacy',
    };
  }

  // Lower pitch for more "authority" and less "robot"
  const pitch = gender === 'male' ? -1.5 : -1.0;

  if (tier === 'hd' && CHIRP3_HD_LANGUAGE_CODES.has(voices.languageCode)) {
    // Sem escolha explícita, vale a recomendação DO IDIOMA — não uma voz global. Um
    // lote atravessa doze línguas de uma vez, e fixar uma voz para todas apaga
    // exatamente a diferença de registro que o mapa existe para respeitar.
    const requested = voiceName && CHIRP3_HD_VOICES.some((v) => v.name === voiceName)
      ? voiceName
      : recommendedVoice(normalizedLang, gender);

    return {
      name: `${voices.languageCode}-Chirp3-HD-${requested}`,
      languageCode: voices.languageCode,
      pitch,
      tierUsed: 'hd',
    };
  }

  if (tier === 'hd') {
    console.log(`[Voice Config] Chirp 3: HD unavailable for ${voices.languageCode}, falling back to legacy`);
  }

  return {
    name: voices[gender],
    languageCode: voices.languageCode,
    pitch,
    tierUsed: 'legacy',
  };
};

/** Language codes the HD tier can serve, given the app's locale keys. */
export const isHdAvailable = (language: string): boolean =>
  getVoiceConfig(language, 'male', 'hd').tierUsed === 'hd';

/**
 * Sanitores text for SSML to avoid XML errors
 */
const escapeSsml = (text: string) => {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
};

export interface SynthesisOptions {
  /** `legacy` (default) keeps the exact POI-pipeline behaviour. */
  tier?: VoiceTier;
  /** Chirp 3: HD voice name (`Charon`, `Kore`, …). Ignored outside the HD tier. */
  voiceName?: string;
  /** 0.25–2.0. Default 1.1, the rate every narration has been generated at. */
  speakingRate?: number;
  /** `MP3` (default, 32 kbps fixed at Google) or `LINEAR16` for post-processing. */
  audioEncoding?: 'MP3' | 'LINEAR16';
  /** Car-speaker EQ. On by default — Tuggi is played in a car. */
  effectsProfile?: boolean;
  /**
   * The 300 ms break after the first phrase, which exists to let a POI name land
   * before the narration continues. Meaningless on a 2 s cue, so callers doing
   * system audio turn it off.
   */
  dramaticPause?: boolean;
}

export interface SynthesisResult {
  audio: ArrayBuffer;
  voice: ResolvedVoice;
  encoding: 'MP3' | 'LINEAR16';
}

/**
 * One call to Google's `text:synthesize`, with the voice resolved by tier.
 *
 * Chirp 3: HD accepts SSML on synchronous requests, so the same `<speak>` envelope
 * serves both tiers — the leading 500 ms break is what keeps Bluetooth devices from
 * clipping the first word, and that problem does not depend on the voice.
 */
export const synthesizeSpeech = async (
  text: string,
  language: string,
  gender: VoiceGender,
  apiKey: string,
  options: SynthesisOptions = {},
): Promise<SynthesisResult> => {
  const {
    tier = 'legacy',
    voiceName,
    speakingRate = 1.1,
    audioEncoding = 'MP3',
    effectsProfile = true,
    dramaticPause = true,
  } = options;

  console.log(`[TTS] Starting audio generation for language: ${language}, gender: ${gender}, tier: ${tier}`);

  const voiceConfig = getVoiceConfig(language, gender, tier, voiceName);
  let sanitizedText = escapeSsml(text);

  // Dynamic Prosody: Inject a dramatic pause after the first phrase (POI Name)
  // This looks for the first comma, period, or hyphen, provided it's within the first 80 characters.
  const firstPunctuationMatch = dramaticPause ? sanitizedText.match(/^(.{5,80}?)([,.\-])/) : null;
  if (firstPunctuationMatch && firstPunctuationMatch.index === 0) {
      const matchLength = firstPunctuationMatch[0].length;
      // Reconstruct text with a 300ms break inserted right after the punctuation
      sanitizedText = sanitizedText.substring(0, matchLength) +
                      `<break time="300ms"/>` +
                      sanitizedText.substring(matchLength);
  }

  // Use SSML for better control over the narration
  // Adding a short 500ms break at the beginning helps with Bluetooth devices that might clip the start
  const requestBody = {
    input: {
      ssml: `<speak><break time="500ms"/>${sanitizedText}</speak>`
    },
    voice: {
      languageCode: voiceConfig.languageCode,
      name: voiceConfig.name,
      ssmlGender: gender.toUpperCase(),
    },
    audioConfig: {
      // MP3 é 32 kbps FIXO no Google (o enum não tem variante de bitrate maior —
      // tem LINEAR16, OGG_OPUS, M4A, PCM). Quem quer resolução pede LINEAR16 e
      // encoda por conta própria — ver `mp3Encoder.ts`.
      audioEncoding,
      // 1.1 (não 1.2): um pouco mais lento = mais claro (idosos/não-nativos/CJK).
      speakingRate,
      // ⚠️ volumeGainDb é IGNORADO quando há effectsProfileId — o perfil normaliza
      // a saída (medido: ganho 0 == ganho +8 com o perfil; pico −2 dBFS / RMS −19).
      // Mantido 0 por honestidade. Volume acima disso vem de normalização LUFS
      // pós-processo (`loudness.ts`), não do volumeGainDb.
      volumeGainDb: 0.0,
      // Perfil automotivo (Tuggi = guia de carro): EQ/dinâmica p/ som de carro e
      // normaliza a loudness pra um nível consistente. Confirmado: "Car speakers".
      ...(effectsProfile ? { effectsProfileId: ['large-automotive-class-device'] } : {}),
      // sampleRateHertz omitido de propósito → rate NATIVO da voz (24kHz), o ótimo.
      // Setar Hz só converteria e pioraria (doc do Google).
    },
  };

  const response = await fetch(
    `https://texttospeech.googleapis.com/v1/text:synthesize?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    }
  );

  console.log(`[TTS] Response status: ${response.status} ${response.statusText}`);

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`[TTS] Error response:`, errorText);
    throw new Error(`Google TTS API error: ${response.statusText} - ${errorText}`);
  }

  const data = await response.json();
  // console.log(`[TTS] Response data keys:`, Object.keys(data));

  if (!data.audioContent) {
    console.error(`[TTS] No audio content in response:`, data);
    throw new Error('No audio content received from Google TTS');
  }

  console.log(`[TTS] Audio content length: ${data.audioContent.length} characters`);

  // Convert base64 to ArrayBuffer
  const audioBuffer = Uint8Array.from(atob(data.audioContent), c => c.charCodeAt(0));
  console.log(`[TTS] Audio buffer size: ${audioBuffer.byteLength} bytes`);

  return { audio: audioBuffer.buffer, voice: voiceConfig, encoding: audioEncoding };
};

/**
 * The POI/route pipeline's entry point, unchanged: MP3, legacy voice, automotive
 * profile, dramatic pause. Kept as a thin wrapper so there is one request body in
 * the codebase and not two that drift apart.
 */
export const generateAudioWithTTS = async (
  text: string,
  language: string,
  gender: VoiceGender,
  apiKey: string,
  options: SynthesisOptions = {},
): Promise<ArrayBuffer> => {
  const { audio } = await synthesizeSpeech(text, language, gender, apiKey, options);
  return audio;
};

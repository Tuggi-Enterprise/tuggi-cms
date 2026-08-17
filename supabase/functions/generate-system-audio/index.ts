// generate-system-audio
//
// The audio that belongs to no POI: the three direction cues and the notices of the
// hourly model. Files land in `travel-app-audios` under the closed convention
// `{folder}/{key}_{locale}_{gender}.mp3`, which is what the app builds by hand in
// `DirectionalAudioPreloadService`, `AppInitializationService` and
// `simpleAudioService` — the name is a contract, not a detail.
//
//   GET     → catalogue + inventory (what exists, what is missing, what has no copy)
//   POST    → synthesise one clip and upload it (`previewOnly` resolves text only)
//   DELETE  → remove ONE file, by a path the parser accepts. Never a prefix.
//
// Two voice tiers, both resolved in `_shared/ttsGenerator.ts`:
//   `legacy` — Neural2/WaveNet, the voice the catalogue was built with;
//   `hd`     — Chirp 3: HD, the "áudio 3D" option. Not available for pt-PT, which
//              falls back to `legacy` and reports it instead of faking an accent.
//
// Loudness: Google hands back either a 32 kbps MP3 or LINEAR16. We ask for LINEAR16,
// normalise to −14 LUFS with a −1 dBTP ceiling (Spotify's "Normal" target) and encode
// MP3 at 64 kbps mono, 24 kHz — the voice's native rate.

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { getSecretKey } from '../_shared/secret-key.ts';
import { validateAuthHeader } from '../_shared/auth-middleware.ts';
import { translateSystemAudioLine } from '../_shared/translationUtility.ts';
import {
  CHIRP3_HD_DEFAULT_VOICE,
  CHIRP3_HD_VOICE_BY_LOCALE,
  CHIRP3_HD_VOICES,
  isHdAvailable,
  recommendedVoice,
  synthesizeSpeech,
  type VoiceGender,
  type VoiceTier,
} from '../_shared/ttsGenerator.ts';
import {
  decodeWavToMono,
  monoToPcm16,
  normalizeLoudness,
  SPOTIFY_CEILING_DBTP,
  SPOTIFY_TARGET_LUFS,
} from '../_shared/loudness.ts';
import { DEFAULT_MP3_KBPS, encodeMp3Mono } from '../_shared/mp3Encoder.ts';
import {
  buildSystemAudioPath,
  getScript,
  parseSystemAudioPath,
  SOURCE_LOCALE,
  SYSTEM_AUDIO_FOLDER,
  SYSTEM_AUDIO_GENDERS,
  SYSTEM_AUDIO_LOCALES,
  SYSTEM_AUDIO_SCRIPTS,
  type SystemAudioFamily,
} from '../_shared/systemAudioScripts.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Content-Type': 'application/json',
};

const BUCKET = 'travel-app-audios';

const PROJECT_URL = Deno.env.get('PROJECT_URL') || Deno.env.get('SUPABASE_URL') || '';
const GOOGLE_CLOUD_API_KEY =
  Deno.env.get('GOOGLE_TTS_API_KEY') || Deno.env.get('GOOGLE_CLOUD_API_KEY') || '';
const GEMINI_API_KEY =
  Deno.env.get('GOOGLE_GEMINI_API_KEY') || Deno.env.get('GEMINI_API_KEY') || '';

const supabaseAdmin = createClient(PROJECT_URL, getSecretKey());

/**
 * Speaking rate for system audio. 1.0, not the 1.1 the POI narration uses: these are
 * one-line clips where clarity beats pace, and a rushed "à sua esquerda" is a cue the
 * driver has to replay in their head.
 */
const SYSTEM_SPEAKING_RATE = 1.0;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: corsHeaders });

// ─── Auth ───────────────────────────────────────────────────────────────────────

/** Only a CMS admin (or the service role) may write to a public bucket. */
async function requireAdmin(req: Request): Promise<Response | null> {
  const auth = await validateAuthHeader(req);

  if (!auth.valid) {
    return json({ error: auth.error || 'Unauthorized' }, auth.statusCode || 401);
  }
  if (auth.role !== 'admin' && auth.role !== 'service_role') {
    return json({ error: 'Forbidden: system audio is admin-only' }, 403);
  }
  return null;
}

// ─── GET: catalogue + inventory ─────────────────────────────────────────────────

interface StoredFile {
  path: string;
  bytes: number | null;
  updatedAt: string | null;
  publicUrl: string;
}

async function listFamily(family: SystemAudioFamily): Promise<StoredFile[]> {
  const folder = SYSTEM_AUDIO_FOLDER[family];
  const { data, error } = await supabaseAdmin.storage.from(BUCKET).list(folder, { limit: 1000 });

  if (error) throw new Error(`Failed to list ${folder}: ${error.message}`);

  return (data || [])
    .map((entry) => {
      const path = `${folder}/${entry.name}`;
      // Anything that is not a system audio file (`silent.mp3`, placeholders) is not
      // ours to report — and, more to the point, not ours to delete.
      if (!parseSystemAudioPath(path)) return null;

      const { data: url } = supabaseAdmin.storage.from(BUCKET).getPublicUrl(path);
      return {
        path,
        bytes: (entry.metadata?.size as number | undefined) ?? null,
        updatedAt: entry.updated_at ?? null,
        publicUrl: url.publicUrl,
      };
    })
    .filter((f): f is StoredFile => f !== null);
}

async function handleGet(): Promise<Response> {
  const files = [...(await listFamily('directional')), ...(await listFamily('notice'))];

  return json({
    catalogue: {
      scripts: SYSTEM_AUDIO_SCRIPTS,
      locales: SYSTEM_AUDIO_LOCALES.map((locale) => ({
        locale,
        hdAvailable: isHdAvailable(locale),
        // A voz que sai se ninguém escolher nada — por idioma, não global.
        recommendedVoice: isHdAvailable(locale)
          ? { male: recommendedVoice(locale, 'male'), female: recommendedVoice(locale, 'female') }
          : null,
      })),
      genders: SYSTEM_AUDIO_GENDERS,
      voices: CHIRP3_HD_VOICES,
      defaultVoice: CHIRP3_HD_DEFAULT_VOICE,
      voiceByLocale: CHIRP3_HD_VOICE_BY_LOCALE,
      sourceLocale: SOURCE_LOCALE,
      folders: SYSTEM_AUDIO_FOLDER,
    },
    files,
  });
}

// ─── POST: synthesise ───────────────────────────────────────────────────────────

interface GenerateBody {
  family?: SystemAudioFamily;
  key?: string;
  locale?: string;
  gender?: VoiceGender;
  tier?: VoiceTier;
  voiceName?: string;
  speakingRate?: number;
  effectsProfile?: boolean;
  /**
   * Overrides the pt-BR source text. It is a **source**, not a final line: for any
   * other locale it gets translated, exactly like the catalogue copy would.
   */
  text?: string
  /**
   * Spoken verbatim, no translation. For the case where the operator is fixing one
   * bad translation instead of writing the source.
   */
  finalText?: string;
  /** Resolve (and translate) the text without synthesising or uploading. */
  previewOnly?: boolean;
  targetLufs?: number;
  bitrateKbps?: number;
}

interface ResolvedText {
  text: string;
  /** True when Gemini produced it, i.e. no human has read this exact line. */
  translated: boolean;
}

/**
 * Text for one (key, locale).
 *
 * The editorial model is one source line in pt-BR and eleven translations of it:
 * the operator writes and approves the pt-BR once, then asks for the other languages.
 * So `text` — whether it comes from the catalogue or from the operator's edit — is a
 * **source**, and it gets translated for every locale that is not pt-BR.
 *
 * `finalText` is the escape hatch for fixing one bad translation: spoken verbatim.
 */
async function resolveText(
  key: string,
  locale: string,
  override?: string,
  finalText?: string,
): Promise<ResolvedText> {
  if (finalText && finalText.trim().length > 0) {
    return { text: finalText.trim(), translated: false };
  }

  const script = getScript(key);
  if (!script) throw new Error(`Unknown system audio key: "${key}"`);

  const source = override?.trim() || script.sourceText;
  if (!source) {
    throw new Error(`Key "${key}" has no copy yet — design has to write the line first`);
  }

  if (locale === SOURCE_LOCALE) return { text: source, translated: false };

  if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY not configured: cannot translate copy');

  // Tradutor próprio, não o de marketing: aquele manda preservar nome de marca, e
  // com isso o "logo" de `logo à frente` virou logotipo e o inglês falou "Logo ahead".
  const translated = await translateSystemAudioLine(
    source,
    locale,
    GEMINI_API_KEY,
    script.family === 'directional' ? 'direction' : 'notice',
  );
  if (!translated || translated.trim().length === 0) {
    throw new Error(`Translation of "${key}" into ${locale} came back empty`);
  }
  return { text: translated.trim(), translated: true };
}

async function handlePost(req: Request): Promise<Response> {
  const body = (await req.json()) as GenerateBody;

  const { family, key, locale, gender } = body;
  if (!family || !key || !locale || !gender) {
    return json({ error: 'family, key, locale and gender are required' }, 400);
  }

  let storagePath: string;
  try {
    storagePath = buildSystemAudioPath(family, key, locale, gender);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Invalid target' }, 400);
  }

  let resolved: ResolvedText;
  try {
    resolved = await resolveText(key, locale, body.text, body.finalText);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Copy unavailable' }, 422);
  }

  const text = resolved.text;

  if (body.previewOnly) {
    return json({ path: storagePath, text, translated: resolved.translated });
  }

  if (!GOOGLE_CLOUD_API_KEY) {
    return json({ error: 'GOOGLE_TTS_API_KEY not configured' }, 500);
  }

  // 1. Synthesise as LINEAR16 — the only way past Google's 32 kbps MP3 ceiling.
  const synthesis = await synthesizeSpeech(text, locale, gender, GOOGLE_CLOUD_API_KEY, {
    tier: body.tier ?? 'legacy',
    voiceName: body.voiceName,
    speakingRate: body.speakingRate ?? SYSTEM_SPEAKING_RATE,
    audioEncoding: 'LINEAR16',
    effectsProfile: body.effectsProfile ?? true,
    // No dramatic pause: that break exists to let a POI name land, and these clips
    // have no name in them.
    dramaticPause: false,
  });

  // 2. Normalise to the Spotify target, then encode.
  const decoded = decodeWavToMono(new Uint8Array(synthesis.audio));
  const normalized = normalizeLoudness(decoded, clampTarget(body.targetLufs), SPOTIFY_CEILING_DBTP);
  const mp3 = encodeMp3Mono(
    monoToPcm16(normalized.audio),
    normalized.audio.sampleRate,
    body.bitrateKbps ?? DEFAULT_MP3_KBPS,
  );

  // 3. Upload, replacing whatever was there. `upsert` matters: the operator
  // regenerates the same name when comparing tiers by ear.
  const { error: uploadError } = await supabaseAdmin.storage
    .from(BUCKET)
    .upload(storagePath, mp3, { contentType: 'audio/mpeg', upsert: true });

  if (uploadError) {
    return json({ error: `Upload failed: ${uploadError.message}` }, 500);
  }

  const { data: url } = supabaseAdmin.storage.from(BUCKET).getPublicUrl(storagePath);

  return json({
    path: storagePath,
    publicUrl: url.publicUrl,
    bytes: mp3.byteLength,
    text,
    translated: resolved.translated,
    voice: synthesis.voice.name,
    tierRequested: body.tier ?? 'legacy',
    tierUsed: synthesis.voice.tierUsed,
    sampleRate: normalized.audio.sampleRate,
    bitrateKbps: body.bitrateKbps ?? DEFAULT_MP3_KBPS,
    loudness: {
      targetLufs: clampTarget(body.targetLufs),
      inputLufs: round1(normalized.inputLufs),
      outputLufs: round1(normalized.outputLufs),
      truePeakDbtp: round1(normalized.outputTruePeakDbtp),
      appliedGainDb: round1(normalized.appliedGainDb),
      limiterReductionDb: round1(normalized.limiterReductionDb),
      peakLimited: normalized.peakLimited,
    },
  });
}

const round1 = (value: number): number | null =>
  Number.isFinite(value) ? Math.round(value * 10) / 10 : null;

/**
 * Loudness target the operator may ask for, bounded. −24 is quieter than anything we
 * would ship; past −9 the limiter works hard enough to hear, and a direction cue that
 * sounds crushed is worse than one that is a decibel quieter than the music.
 */
const clampTarget = (requested?: number): number => {
  if (typeof requested !== 'number' || !Number.isFinite(requested)) return SPOTIFY_TARGET_LUFS;
  return Math.max(-24, Math.min(-9, requested));
};

// ─── DELETE: one file, by exact path ────────────────────────────────────────────

async function handleDelete(req: Request): Promise<Response> {
  const body = (await req.json().catch(() => ({}))) as { path?: string };
  const path = body.path;

  if (!path) return json({ error: 'path is required' }, 400);

  // The parser is the whole guard: it accepts exactly one shape, in exactly two
  // folders, and rejects `silent.mp3`, prefixes, wildcards and traversal alike.
  if (!parseSystemAudioPath(path)) {
    return json({ error: `Refused: "${path}" is not a system audio file` }, 400);
  }

  const { error } = await supabaseAdmin.storage.from(BUCKET).remove([path]);
  if (error) return json({ error: `Delete failed: ${error.message}` }, 500);

  return json({ deleted: path });
}

// ─── Entry point ────────────────────────────────────────────────────────────────

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const denied = await requireAdmin(req);
  if (denied) return denied;

  try {
    if (req.method === 'GET') return await handleGet();
    if (req.method === 'POST') return await handlePost(req);
    if (req.method === 'DELETE') return await handleDelete(req);
    return json({ error: `Method ${req.method} not allowed` }, 405);
  } catch (error) {
    console.error('[generate-system-audio] Unhandled error:', error);
    return json({ error: error instanceof Error ? error.message : 'Internal error' }, 500);
  }
});

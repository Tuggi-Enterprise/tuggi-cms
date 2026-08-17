// _shared/mp3Encoder.ts
//
// MP3 encoding for the system audio clips.
//
// Why we encode ourselves: Google's `MP3` encoding is documented as "MP3 audio at
// 32kbps" and the enum has no higher-bitrate variant. Asking for `LINEAR16` and
// encoding here is what buys both the resolution and the loudness control, while
// keeping the `.mp3` extension the app builds its URLs with
// (`DirectionalAudioPreloadService`, `AppInitializationService`,
// `simpleAudioService` — three places, all hard-coded to `.mp3`).
//
// Bitrate: 64 kbps mono at the voice's native 24 kHz. A 2 s direction cue lands
// around 16 KB, a 6 s notice around 48 KB — irrelevant for download, and clearly
// above the 32 kbps Google would have given us.

import lamejsModule from 'https://esm.sh/@breezystack/lamejs@1.2.7';

/** Default bitrate for speech at 24 kHz mono. Valid MPEG-2 rate. */
export const DEFAULT_MP3_KBPS = 64;

/** Rates the MPEG-2 layer III frame header can actually carry. */
const VALID_KBPS = [8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];

interface Mp3EncoderCtor {
  new (channels: number, sampleRate: number, kbps: number): {
    encodeBuffer(left: Int16Array): Int8Array | Uint8Array;
    flush(): Int8Array | Uint8Array;
  };
}

/**
 * `lamejs` ships as a CommonJS bundle: through esm.sh it can arrive as the default
 * export or as a named one depending on how the interop shim resolves. Both shapes
 * are accepted so a bundler change does not silently break audio generation.
 */
function resolveEncoder(): Mp3EncoderCtor {
  const candidates = [
    (lamejsModule as { Mp3Encoder?: unknown }).Mp3Encoder,
    (lamejsModule as { default?: { Mp3Encoder?: unknown } }).default?.Mp3Encoder,
  ];

  const found = candidates.find((c) => typeof c === 'function');
  if (!found) throw new Error('lamejs: Mp3Encoder not found in module exports');
  return found as Mp3EncoderCtor;
}

/**
 * Encodes 16-bit mono PCM to MP3.
 *
 * @param pcm mono samples, 16-bit signed
 * @param sampleRate the rate `pcm` was sampled at (24000 for Google TTS natively)
 * @param kbps constant bitrate; must be one the MPEG frame header allows
 */
export function encodeMp3Mono(
  pcm: Int16Array,
  sampleRate: number,
  kbps: number = DEFAULT_MP3_KBPS,
): Uint8Array {
  if (!VALID_KBPS.includes(kbps)) {
    throw new Error(`Invalid MP3 bitrate ${kbps} kbps. Allowed: ${VALID_KBPS.join(', ')}`);
  }

  const Encoder = resolveEncoder();
  const encoder = new Encoder(1, sampleRate, kbps);

  // 1152 samples is one MPEG layer III granule pair; feeding whole frames avoids
  // the encoder buffering partial ones.
  const BLOCK = 1152;
  const chunks: Uint8Array[] = [];

  // `encodeBuffer` reuses its internal buffer between calls, so each chunk has to be
  // copied out before the next call overwrites it.
  const copyOut = (view: Int8Array | Uint8Array): Uint8Array =>
    new Uint8Array(view.buffer, view.byteOffset, view.length).slice();

  for (let offset = 0; offset < pcm.length; offset += BLOCK) {
    const block = pcm.subarray(offset, Math.min(offset + BLOCK, pcm.length));
    const encoded = encoder.encodeBuffer(block);
    if (encoded.length > 0) chunks.push(copyOut(encoded));
  }

  const tail = encoder.flush();
  if (tail.length > 0) chunks.push(copyOut(tail));

  const total = chunks.reduce((sum, c) => sum + c.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }

  return out;
}

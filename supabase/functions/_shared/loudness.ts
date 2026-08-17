// _shared/loudness.ts
//
// Loudness measurement and normalisation, ITU-R BS.1770-4, for the system audio
// clips (directional + notices).
//
// Why this exists: Google TTS gives back either a 32 kbps MP3 or raw LINEAR16, and
// neither is normalised to anything we chose. Measured on the current pipeline
// (`ttsGenerator.ts`), the automotive effects profile lands the output around
// RMS −19 dBFS, which is the "Quiet" setting of Spotify (−19 LUFS). The target here
// is Spotify's "Normal": −14 LUFS integrated, true peak below −1 dBTP.
//
// The module is pure — no Deno globals, no network — so the CMS test suite can load
// it directly (`tests/api/loudness.test.ts`).

/** Mono float samples in [-1, 1] plus the rate they were sampled at. */
export interface MonoAudio {
  samples: Float32Array;
  sampleRate: number;
}

/** Spotify's "Normal" playback target — the loudness we aim the clips at. */
export const SPOTIFY_TARGET_LUFS = -14;

/** Spotify's recommended ceiling for lossy masters. */
export const SPOTIFY_CEILING_DBTP = -1;

/** Absolute gate of BS.1770-4: blocks quieter than this never count. */
const ABSOLUTE_GATE_LUFS = -70;

/** BS.1770 measures in 400 ms blocks overlapping by 75%. */
const BLOCK_MS = 400;
const BLOCK_OVERLAP = 0.75;

/**
 * K-weighting, stage 1 — high-shelf "head effect" filter.
 * Coefficients are the ones tabulated in BS.1770-4 for 48 kHz.
 */
const SHELF_48K = {
  b0: 1.53512485958697,
  b1: -2.69169618940638,
  b2: 1.19839281085285,
  a1: -1.69065929318241,
  a2: 0.73248077421585,
};

/** K-weighting, stage 2 — RLB high-pass, also tabulated at 48 kHz. */
const RLB_48K = {
  b0: 1.0,
  b1: -2.0,
  b2: 1.0,
  a1: -1.99004745483398,
  a2: 0.99007225036621,
};

/**
 * The rate the tabulated coefficients belong to. Anything else is resampled to
 * this rate before measuring — cheaper and less error-prone than re-deriving the
 * biquads per rate, and the resampling only affects the measurement, never the
 * audio we ship.
 */
const MEASUREMENT_RATE = 48000;

interface Biquad {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

function applyBiquad(input: Float32Array, c: Biquad): Float32Array {
  const out = new Float32Array(input.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;

  for (let i = 0; i < input.length; i++) {
    const x0 = input[i];
    const y0 = c.b0 * x0 + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
    out[i] = y0;
    x2 = x1;
    x1 = x0;
    y2 = y1;
    y1 = y0;
  }

  return out;
}

/**
 * Linear resampling — good enough for loudness measurement, which integrates over
 * 400 ms blocks and is insensitive to the interpolation error. Never used on the
 * audio that gets encoded.
 */
function resampleLinear(samples: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return samples;

  const ratio = to / from;
  const length = Math.max(1, Math.round(samples.length * ratio));
  const out = new Float32Array(length);

  for (let i = 0; i < length; i++) {
    const pos = i / ratio;
    const i0 = Math.floor(pos);
    const i1 = Math.min(i0 + 1, samples.length - 1);
    const frac = pos - i0;
    out[i] = samples[i0] * (1 - frac) + samples[i1] * frac;
  }

  return out;
}

function meanSquare(samples: Float32Array, start: number, end: number): number {
  let sum = 0;
  for (let i = start; i < end; i++) sum += samples[i] * samples[i];
  return sum / (end - start);
}

/** Block loudness of BS.1770-4 for a single channel (channel weight G = 1). */
function blockLoudness(ms: number): number {
  if (ms <= 0) return Number.NEGATIVE_INFINITY;
  return -0.691 + 10 * Math.log10(ms);
}

/**
 * Integrated (gated) loudness in LUFS, per BS.1770-4.
 *
 * Returns `-Infinity` for digital silence — callers must treat that as "nothing to
 * normalise" rather than as an enormous gain.
 */
export function measureLufs(audio: MonoAudio): number {
  const at48k = resampleLinear(audio.samples, audio.sampleRate, MEASUREMENT_RATE);
  const weighted = applyBiquad(applyBiquad(at48k, SHELF_48K), RLB_48K);

  const blockSize = Math.round((MEASUREMENT_RATE * BLOCK_MS) / 1000);
  const step = Math.max(1, Math.round(blockSize * (1 - BLOCK_OVERLAP)));

  // Clip shorter than one block: measure what there is instead of returning
  // silence. Directional clips are ~2 s, but a one-word notice can be shorter.
  if (weighted.length < blockSize) {
    return blockLoudness(meanSquare(weighted, 0, weighted.length));
  }

  const blocks: number[] = [];
  for (let start = 0; start + blockSize <= weighted.length; start += step) {
    blocks.push(meanSquare(weighted, start, start + blockSize));
  }

  // Gate 1 — absolute threshold.
  const aboveAbsolute = blocks.filter((ms) => blockLoudness(ms) > ABSOLUTE_GATE_LUFS);
  if (aboveAbsolute.length === 0) return Number.NEGATIVE_INFINITY;

  // Gate 2 — relative threshold, 10 LU below the loudness of what survived gate 1.
  const meanAbsolute = aboveAbsolute.reduce((a, b) => a + b, 0) / aboveAbsolute.length;
  const relativeGate = blockLoudness(meanAbsolute) - 10;

  const aboveRelative = aboveAbsolute.filter((ms) => blockLoudness(ms) > relativeGate);
  const kept = aboveRelative.length > 0 ? aboveRelative : aboveAbsolute;

  const meanKept = kept.reduce((a, b) => a + b, 0) / kept.length;
  return blockLoudness(meanKept);
}

/**
 * True peak in dBTP. BS.1770 asks for at least 4× oversampling before reading the
 * peak, because the sample peak of a 24 kHz signal can sit well below the peak of
 * the reconstructed waveform. Oversampling here is a windowed-sinc polyphase FIR.
 */
export function measureTruePeakDbtp(audio: MonoAudio): number {
  const oversampled = oversample4x(audio.samples);

  let peak = 0;
  for (let i = 0; i < oversampled.length; i++) {
    const abs = Math.abs(oversampled[i]);
    if (abs > peak) peak = abs;
  }

  if (peak === 0) return Number.NEGATIVE_INFINITY;
  return 20 * Math.log10(peak);
}

const OVERSAMPLE_FACTOR = 4;
/** Half-length of the interpolation kernel, in input samples. */
const KERNEL_HALF = 12;

function blackman(n: number, length: number): number {
  const x = (2 * Math.PI * n) / (length - 1);
  return 0.42 - 0.5 * Math.cos(x) + 0.08 * Math.cos(2 * x);
}

/**
 * Polyphase kernel, computed once. It used to be evaluated inside the sample loop
 * — two `Math.sin`/`Math.cos` per tap per sample — which made a 45 s clip take
 * minutes. The coefficients do not depend on the audio, only on the phase.
 */
const POLYPHASE_KERNEL: Float32Array[] = (() => {
  const taps = KERNEL_HALF * 2 * OVERSAMPLE_FACTOR + 1;
  const phases: Float32Array[] = [];

  for (let phase = 0; phase < OVERSAMPLE_FACTOR; phase++) {
    const offset = phase / OVERSAMPLE_FACTOR;
    const coefficients = new Float32Array(KERNEL_HALF * 2 + 1);

    for (let k = -KERNEL_HALF; k <= KERNEL_HALF; k++) {
      const t = offset - k;
      const sinc = t === 0 ? 1 : Math.sin(Math.PI * t) / (Math.PI * t);
      coefficients[k + KERNEL_HALF] = sinc * blackman((t + KERNEL_HALF) * OVERSAMPLE_FACTOR, taps);
    }

    phases.push(coefficients);
  }

  return phases;
})();

function oversample4x(samples: Float32Array): Float32Array {
  if (samples.length === 0) return samples;

  const out = new Float32Array(samples.length * OVERSAMPLE_FACTOR);

  for (let i = 0; i < samples.length; i++) {
    const from = Math.max(-KERNEL_HALF, -i);
    const to = Math.min(KERNEL_HALF, samples.length - 1 - i);

    for (let phase = 0; phase < OVERSAMPLE_FACTOR; phase++) {
      const kernel = POLYPHASE_KERNEL[phase];
      let acc = 0;
      for (let k = from; k <= to; k++) acc += samples[i + k] * kernel[k + KERNEL_HALF];
      out[i * OVERSAMPLE_FACTOR + phase] = acc;
    }
  }

  return out;
}

/**
 * Per input sample, the largest absolute value the reconstructed waveform reaches
 * around it. This is what the limiter has to hold below the ceiling — the sample
 * peak alone lets an inter-sample overshoot through, and the D/A converter clips it.
 */
function truePeakEnvelope(samples: Float32Array): Float32Array {
  const oversampled = oversample4x(samples);
  const envelope = new Float32Array(samples.length);

  for (let i = 0; i < samples.length; i++) {
    let peak = 0;
    for (let phase = 0; phase < OVERSAMPLE_FACTOR; phase++) {
      const value = Math.abs(oversampled[i * OVERSAMPLE_FACTOR + phase]);
      if (value > peak) peak = value;
    }
    envelope[i] = peak;
  }

  return envelope;
}

export interface LimiterResult {
  audio: MonoAudio;
  /** Deepest gain reduction the limiter applied, in dB (0 = it never engaged). */
  maxReductionDb: number;
}

/** Look-ahead, in seconds: the limiter starts ducking before the transient lands. */
const LIMITER_LOOKAHEAD_S = 0.002;
/** Release time constant. Long enough that speech does not pump, short enough to recover between words. */
const LIMITER_RELEASE_S = 0.06;

/**
 * True-peak limiter with look-ahead.
 *
 * Why it exists: the clips come out of Google with a crest factor around 17 dB —
 * loudness at −19 LUFS while the peaks are already at −1.5 dBTP. Pure gain cannot
 * fix that: one decibel of gain and the peaks are over the ceiling. Measured on the
 * first files generated in production, the peak ceiling capped the gain at ~0.5 dB
 * and the output landed at −19, the same level as the POI narration.
 *
 * The transients that hold a speech clip down are plosives and sibilants, not
 * content — holding them back a few dB is inaudible and buys the whole gain.
 */
export function limitTruePeak(
  audio: MonoAudio,
  ceilingDbtp: number = SPOTIFY_CEILING_DBTP,
): LimiterResult {
  const ceiling = Math.pow(10, ceilingDbtp / 20);
  const envelope = truePeakEnvelope(audio.samples);
  const n = audio.samples.length;

  // Gain each sample would need, on its own, to sit at the ceiling.
  const needed = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    needed[i] = envelope[i] > ceiling ? ceiling / envelope[i] : 1;
  }

  // Look-ahead: the gain at sample i is the smallest requirement inside the window
  // ahead of it, so the duck is already in place when the transient arrives.
  // Monotonic deque — O(n), because a clip can be minutes long.
  const lookahead = Math.max(1, Math.round(LIMITER_LOOKAHEAD_S * audio.sampleRate));
  const windowed = new Float32Array(n);
  const deque: number[] = [];
  let head = 0;

  const push = (index: number) => {
    while (deque.length > head && needed[deque[deque.length - 1]] >= needed[index]) deque.pop();
    deque.push(index);
  };

  for (let i = 0; i < Math.min(lookahead, n); i++) push(i);

  for (let i = 0; i < n; i++) {
    const limit = Math.min(n - 1, i + lookahead);
    if (i + lookahead <= limit) push(i + lookahead);
    while (deque.length > head && deque[head] < i) head++;
    windowed[i] = needed[deque[head]];
  }

  // Instant attack (the look-ahead already smoothed the approach), exponential
  // release, so the gain climbs back between words instead of jumping.
  const releaseCoefficient = Math.exp(-1 / (LIMITER_RELEASE_S * audio.sampleRate));
  const out = new Float32Array(n);
  let gain = 1;
  let minGain = 1;

  for (let i = 0; i < n; i++) {
    const target = windowed[i];
    gain = target < gain ? target : target + (gain - target) * releaseCoefficient;
    if (gain < minGain) minGain = gain;
    out[i] = audio.samples[i] * gain;
  }

  return {
    audio: { samples: out, sampleRate: audio.sampleRate },
    maxReductionDb: minGain >= 1 ? 0 : -20 * Math.log10(minGain),
  };
}

export interface NormalizationResult {
  audio: MonoAudio;
  /** Loudness before the gain, in LUFS. */
  inputLufs: number;
  /** Loudness after the gain, in LUFS — measured on the result, not predicted. */
  outputLufs: number;
  /** True peak after the gain, in dBTP. */
  outputTruePeakDbtp: number;
  /** Total gain applied before limiting, in dB. */
  appliedGainDb: number;
  /** Deepest gain reduction the limiter applied, in dB (0 = it never engaged). */
  limiterReductionDb: number;
  /** True when the target was still out of reach after limiting. */
  peakLimited: boolean;
}

export interface NormalizationOptions {
  /**
   * Limiter on (default). Off means pure gain, which stops at whatever the peak
   * allows — the behaviour that put the first production files at −19 LUFS.
   */
  limiter?: boolean;
  /** Ceiling on how much gain may be applied, so a quiet clip does not bring its own noise floor up with it. */
  maxGainDb?: number;
}

/** Above this, gain stops buying loudness and starts buying room tone. */
const DEFAULT_MAX_GAIN_DB = 20;

/** How close to the target counts as arrived. */
const TARGET_TOLERANCE_LU = 0.1;

/**
 * Brings the clip to `targetLufs` while holding the true peak at `ceilingDbtp`.
 *
 * Gain alone does not get there. Google's output has a crest factor around 17 dB —
 * peaks already at −1.5 dBTP with loudness at −19 LUFS — so the first decibel of
 * gain hits the ceiling. The loop below gains, limits the transients, measures the
 * result and corrects, which is the ordinary way a master reaches a loudness target.
 *
 * `outputLufs` is measured on the delivered audio, never inferred from the gain:
 * limiting changes loudness, and a number that only adds up on paper is the kind
 * that reports −14 while the file plays at −19.
 */
export function normalizeLoudness(
  audio: MonoAudio,
  targetLufs: number = SPOTIFY_TARGET_LUFS,
  ceilingDbtp: number = SPOTIFY_CEILING_DBTP,
  options: NormalizationOptions = {},
): NormalizationResult {
  const { limiter = true, maxGainDb = DEFAULT_MAX_GAIN_DB } = options;

  const inputLufs = measureLufs(audio);
  const inputPeakDbtp = measureTruePeakDbtp(audio);

  // Digital silence: nothing to scale, and any gain would be infinite.
  if (!Number.isFinite(inputLufs) || !Number.isFinite(inputPeakDbtp)) {
    return {
      audio,
      inputLufs,
      outputLufs: inputLufs,
      outputTruePeakDbtp: inputPeakDbtp,
      appliedGainDb: 0,
      limiterReductionDb: 0,
      peakLimited: false,
    };
  }

  const applyGain = (source: MonoAudio, db: number): MonoAudio => {
    const factor = Math.pow(10, db / 20);
    const scaled = new Float32Array(source.samples.length);
    for (let i = 0; i < source.samples.length; i++) scaled[i] = source.samples[i] * factor;
    return { samples: scaled, sampleRate: source.sampleRate };
  };

  if (!limiter) {
    const headroomDb = ceilingDbtp - inputPeakDbtp;
    const gainDb = Math.min(targetLufs - inputLufs, headroomDb, maxGainDb);
    const output = applyGain(audio, gainDb);

    return {
      audio: output,
      inputLufs,
      outputLufs: inputLufs + gainDb,
      outputTruePeakDbtp: inputPeakDbtp + gainDb,
      appliedGainDb: gainDb,
      limiterReductionDb: 0,
      peakLimited: headroomDb < targetLufs - inputLufs,
    };
  }

  let current = audio;
  let currentLufs = inputLufs;
  let totalGainDb = 0;
  let maxReductionDb = 0;

  // Gain, limit, re-measure, repeat. The first pass does most of it and each
  // further one closes what the limiter took back; measured on a real direction
  // cue, the whole loop costs ~150 ms for a 1,8 s clip.
  for (let pass = 0; pass < 8; pass++) {
    const remainingDb = targetLufs - currentLufs;
    if (Math.abs(remainingDb) < TARGET_TOLERANCE_LU) break;

    const stepDb = Math.min(remainingDb, maxGainDb - totalGainDb);
    if (stepDb <= 0 && remainingDb > 0) break;

    current = applyGain(current, stepDb);
    totalGainDb += stepDb;

    const limited = limitTruePeak(current, ceilingDbtp);
    current = limited.audio;
    if (limited.maxReductionDb > maxReductionDb) maxReductionDb = limited.maxReductionDb;

    currentLufs = measureLufs(current);
  }

  const outputTruePeakDbtp = measureTruePeakDbtp(current);

  return {
    audio: current,
    inputLufs,
    outputLufs: currentLufs,
    outputTruePeakDbtp,
    appliedGainDb: totalGainDb,
    limiterReductionDb: maxReductionDb,
    peakLimited: currentLufs < targetLufs - TARGET_TOLERANCE_LU,
  };
}

// ─── WAV / PCM helpers ──────────────────────────────────────────────────────────

/**
 * Reads the `LINEAR16` payload Google returns (16-bit PCM wrapped in a WAV header)
 * into mono float samples. Multi-channel input is averaged down; the TTS voices are
 * mono, so this is a guard, not a feature.
 */
export function decodeWavToMono(bytes: Uint8Array): MonoAudio {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  const magic = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
  if (magic !== 'RIFF') throw new Error(`Not a WAV file (magic="${magic}")`);

  let sampleRate = 0;
  let channels = 1;
  let bitsPerSample = 16;
  let dataStart = -1;
  let dataLength = 0;

  // Walk the chunk list — Google puts `fmt ` before `data`, but the header size is
  // not fixed, so the offsets cannot be hard-coded.
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const id = String.fromCharCode(
      bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3],
    );
    const size = view.getUint32(offset + 4, true);
    const body = offset + 8;

    if (id === 'fmt ') {
      channels = view.getUint16(body + 2, true);
      sampleRate = view.getUint32(body + 4, true);
      bitsPerSample = view.getUint16(body + 14, true);
    } else if (id === 'data') {
      dataStart = body;
      dataLength = Math.min(size, bytes.length - body);
      break;
    }

    offset = body + size + (size % 2);
  }

  if (dataStart < 0) throw new Error('WAV has no data chunk');
  if (bitsPerSample !== 16) throw new Error(`Unsupported WAV bit depth: ${bitsPerSample}`);
  if (!sampleRate) throw new Error('WAV has no sample rate');

  const frames = Math.floor(dataLength / 2 / channels);
  const samples = new Float32Array(frames);

  for (let frame = 0; frame < frames; frame++) {
    let sum = 0;
    for (let ch = 0; ch < channels; ch++) {
      const at = dataStart + (frame * channels + ch) * 2;
      sum += view.getInt16(at, true) / 32768;
    }
    samples[frame] = sum / channels;
  }

  return { samples, sampleRate };
}

/** Float samples back to 16-bit PCM, with the clamp that keeps −1/+1 from wrapping. */
export function monoToPcm16(audio: MonoAudio): Int16Array {
  const pcm = new Int16Array(audio.samples.length);
  for (let i = 0; i < audio.samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, audio.samples[i]));
    pcm[i] = Math.round(clamped * (clamped < 0 ? 32768 : 32767));
  }
  return pcm;
}

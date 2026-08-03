/**
 * Automated checks on generated audio.
 *
 * These catch the failures a listener would catch, before a listener spends
 * time on them — a truncated clip, a silent one, one that clips, one at the
 * wrong sample rate. They do not replace the listening decision: nothing here
 * can accept an asset, and a clean result only makes one eligible for review.
 *
 * WAV is parsed directly rather than shelled out to a decoder. The point of QA
 * is to notice a malformed file, and a decoder that repairs its input while
 * reading is exactly the wrong tool for that.
 */

export interface AudioFinding {
  rule: string;
  detail: string;
}

export interface WavInfo {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  frames: number;
  durationMs: number;
  /** Peak absolute amplitude, 0..1. */
  peak: number;
  /** Root-mean-square amplitude, 0..1. */
  rms: number;
  /** Samples at or beyond full scale. */
  clippedSamples: number;
  /** Leading and trailing near-silence, in milliseconds. */
  leadingSilenceMs: number;
  trailingSilenceMs: number;
  /** Chunks present beyond the ones a bare PCM WAV needs. */
  extraChunks: string[];
}

const SILENCE_THRESHOLD = 0.005;
/** 16-bit full scale. A sample at ±32767 has hit the ceiling. */
const CLIP_THRESHOLD = 32700;

export class WavParseError extends Error {}

/**
 * Parse a 16-bit PCM WAV and measure it.
 *
 * Throws rather than returning partial information: a file that cannot be
 * parsed has no measurements worth reporting, and the caller turns the throw
 * into a finding.
 */
export function parseWav(bytes: Buffer): WavInfo {
  if (bytes.length < 44) throw new WavParseError('shorter than a WAV header');
  if (bytes.toString('ascii', 0, 4) !== 'RIFF') throw new WavParseError('no RIFF marker');
  if (bytes.toString('ascii', 8, 12) !== 'WAVE') throw new WavParseError('not a WAVE file');

  const declared = bytes.readUInt32LE(4);
  if (declared + 8 !== bytes.length) {
    // A truncated download is the common cause, and it is worth naming rather
    // than silently decoding whatever arrived.
    throw new WavParseError(
      `RIFF size says ${declared + 8} bytes but the file is ${bytes.length}`,
    );
  }

  let offset = 12;
  let fmt: { sampleRate: number; channels: number; bitsPerSample: number } | null = null;
  let data: Buffer | null = null;
  const extraChunks: string[] = [];

  while (offset + 8 <= bytes.length) {
    const id = bytes.toString('ascii', offset, offset + 4);
    const size = bytes.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (body + size > bytes.length) {
      throw new WavParseError(`chunk '${id}' claims ${size} bytes but the file ends first`);
    }

    if (id === 'fmt ') {
      const format = bytes.readUInt16LE(body);
      if (format !== 1) throw new WavParseError(`format ${format} is not uncompressed PCM`);
      fmt = {
        channels: bytes.readUInt16LE(body + 2),
        sampleRate: bytes.readUInt32LE(body + 4),
        bitsPerSample: bytes.readUInt16LE(body + 14),
      };
    } else if (id === 'data') {
      data = bytes.subarray(body, body + size);
    } else {
      // LIST/INFO chunks carry encoder names and timestamps, which make output
      // non-reproducible. Recorded so the caller can flag them.
      extraChunks.push(id.trim());
    }

    offset = body + size + (size % 2);
  }

  if (!fmt) throw new WavParseError('no fmt chunk');
  if (!data) throw new WavParseError('no data chunk');
  if (fmt.bitsPerSample !== 16) {
    throw new WavParseError(`${fmt.bitsPerSample}-bit samples are not supported`);
  }

  const totalSamples = Math.floor(data.length / 2);
  const frames = Math.floor(totalSamples / fmt.channels);
  if (frames === 0) throw new WavParseError('no audio frames');

  let peakRaw = 0;
  let sumSquares = 0;
  let clippedSamples = 0;
  for (let i = 0; i < totalSamples; i++) {
    const sample = data.readInt16LE(i * 2);
    const magnitude = Math.abs(sample);
    if (magnitude > peakRaw) peakRaw = magnitude;
    if (magnitude >= CLIP_THRESHOLD) clippedSamples++;
    sumSquares += (sample / 32768) ** 2;
  }

  const framesPerMs = fmt.sampleRate / 1000;
  const silenceRun = (from: number, step: number): number => {
    let count = 0;
    for (let frame = from; frame >= 0 && frame < frames; frame += step) {
      let quiet = true;
      for (let channel = 0; channel < fmt!.channels; channel++) {
        const index = frame * fmt!.channels + channel;
        if (Math.abs(data!.readInt16LE(index * 2)) / 32768 > SILENCE_THRESHOLD) {
          quiet = false;
          break;
        }
      }
      if (!quiet) break;
      count++;
    }
    return Math.round(count / framesPerMs);
  };

  return {
    sampleRate: fmt.sampleRate,
    channels: fmt.channels,
    bitsPerSample: fmt.bitsPerSample,
    frames,
    durationMs: Math.round(frames / framesPerMs),
    peak: peakRaw / 32768,
    rms: Math.sqrt(sumSquares / totalSamples),
    clippedSamples,
    leadingSilenceMs: silenceRun(0, 1),
    trailingSilenceMs: silenceRun(frames - 1, -1),
    extraChunks,
  };
}

export interface QaExpectation {
  sampleRate: number;
  channels: number;
  format: 'wav' | 'mp3';
  /** Bytes the generator recorded, to catch a mismatch against what arrived. */
  expectedSha256: string;
  actualSha256: string;
  /** Words in the text that was spoken, used to sanity-check the duration. */
  spokenText: string;
}

const MIN_DURATION_MS = 250;
const MAX_DURATION_MS = 30_000;
const MAX_LEADING_SILENCE_MS = 700;
const MAX_TRAILING_SILENCE_MS = 1200;
const MIN_RMS = 0.005;
const MAX_CLIPPED_FRACTION = 0.001;
/** Slowest plausible speech. Below this, the clip is probably truncated. */
const MIN_MS_PER_WORD = 90;

/**
 * Run every check. An empty result makes the asset eligible for a listener; it
 * does not make it accepted.
 */
export function checkAudio(bytes: Buffer, expected: QaExpectation): AudioFinding[] {
  const findings: AudioFinding[] = [];
  const add = (rule: string, detail: string) => findings.push({ rule, detail });

  if (expected.actualSha256 !== expected.expectedSha256) {
    // The bytes are not the bytes that were recorded, so nothing else measured
    // here describes the asset in the database.
    add(
      'hash_mismatch',
      `stored bytes hash ${expected.actualSha256.slice(0, 12)}…, metadata says ` +
        `${expected.expectedSha256.slice(0, 12)}…`,
    );
    return findings;
  }

  if (bytes.length === 0) {
    add('empty_object', 'the stored object is zero bytes');
    return findings;
  }

  if (expected.format === 'mp3') {
    // MP3 is a derived serving asset; the canonical master is WAV. Only its
    // framing is checked here, and the measurements come from the master.
    const isId3 = bytes.toString('ascii', 0, 3) === 'ID3';
    const isFrame = bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0;
    if (!isId3 && !isFrame) add('not_decodable', 'no ID3 tag or MPEG frame sync at the start');
    if (isId3) {
      // An ID3 tag usually carries an encoder name and a timestamp, which makes
      // the output non-reproducible.
      add('unexpected_metadata', 'ID3 tag present; strip metadata for reproducible output');
    }
    return findings;
  }

  let info: WavInfo;
  try {
    info = parseWav(bytes);
  } catch (error) {
    add('not_decodable', (error as Error).message);
    return findings;
  }

  if (info.sampleRate !== expected.sampleRate) {
    add('sample_rate', `${info.sampleRate} Hz, expected ${expected.sampleRate} Hz`);
  }
  if (info.channels !== expected.channels) {
    add('channel_count', `${info.channels} channel(s), expected ${expected.channels}`);
  }
  if (info.durationMs < MIN_DURATION_MS) {
    add('too_short', `${info.durationMs} ms`);
  }
  if (info.durationMs > MAX_DURATION_MS) {
    add('too_long', `${info.durationMs} ms`);
  }
  if (info.rms < MIN_RMS) {
    add('silent', `RMS ${info.rms.toFixed(5)} is below ${MIN_RMS}`);
  }
  if (info.clippedSamples / (info.frames * info.channels) > MAX_CLIPPED_FRACTION) {
    add('clipping', `${info.clippedSamples} sample(s) at or beyond full scale`);
  }
  if (info.leadingSilenceMs > MAX_LEADING_SILENCE_MS) {
    add('leading_silence', `${info.leadingSilenceMs} ms before speech starts`);
  }
  if (info.trailingSilenceMs > MAX_TRAILING_SILENCE_MS) {
    add('trailing_silence', `${info.trailingSilenceMs} ms after speech ends`);
  }
  if (info.extraChunks.length > 0) {
    add('unexpected_metadata', `extra chunk(s): ${info.extraChunks.join(', ')}`);
  }

  const words = canonicalWords(expected.spokenText);
  if (words > 0 && info.durationMs / words < MIN_MS_PER_WORD) {
    // Audible speech that is far too brief for the text is the signature of a
    // clip that was cut off, which duration alone would not catch.
    add(
      'input_mismatch',
      `${info.durationMs} ms for ${words} word(s) is too brief to be the whole text`,
    );
  }

  return findings;
}

function canonicalWords(text: string): number {
  return (text ?? '').trim() ? (text ?? '').trim().split(/\s+/).length : 0;
}

/**
 * Duplicate detection across a batch.
 *
 * Two different inputs producing byte-identical audio means the engine ignored
 * the text — the same wrong recording served for two headwords. It is invisible
 * per-asset and obvious across a batch.
 */
export function findDuplicateAudio(
  assets: Array<{ id: string; audioSha256: string; inputTextSha256: string }>,
): AudioFinding[] {
  const byAudio = new Map<string, Array<{ id: string; inputTextSha256: string }>>();
  for (const asset of assets) {
    byAudio.set(asset.audioSha256, [...(byAudio.get(asset.audioSha256) ?? []), asset]);
  }

  const findings: AudioFinding[] = [];
  for (const [hash, group] of byAudio) {
    const distinctInputs = new Set(group.map((a) => a.inputTextSha256));
    if (group.length > 1 && distinctInputs.size > 1) {
      findings.push({
        rule: 'duplicate_audio',
        detail:
          `${group.length} assets with ${distinctInputs.size} different inputs share audio ` +
          `${hash.slice(0, 12)}…: ${group.map((a) => a.id).join(', ')}`,
      });
    }
  }
  return findings;
}

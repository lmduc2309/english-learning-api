/**
 * Inventory and quarantine audio produced by voices DSD does not approve.
 *
 * The problem this solves is that old artifacts outlive the decision to stop
 * using them. Amy and Ryan were the defaults for months: their model files are
 * still on disk, and so is audio generated from them. Left alone, any of it
 * could be picked up by a cache, a fixture, or a hand-run script and end up in
 * front of a customer — which is the licensing exposure the voice change existed
 * to remove.
 *
 * Two rules shape the tool.
 *
 * **It moves, it never deletes.** A quarantined file goes to a non-serving
 * prefix and stays there. Some of it is evidence — the record of what was
 * generated with what — and a tool that could delete evidence during a licensing
 * review is a tool nobody should run. Reclaiming the disk is a separate,
 * deliberate act.
 *
 * **It refuses to break a serving key without a replacement.** Quarantining
 * audio that something is still serving turns a licensing problem into an outage.
 * Anything with a live serving reference is reported as blocked until an approved
 * replacement exists.
 *
 * The classification is deliberately broader than Amy and Ryan. A voice absent
 * from the lock has no recorded provenance, which is the same problem in a less
 * obvious form — `out_piper/` here also held Lessac and LibriTTS-R output that
 * nobody had decided about.
 *
 * USAGE:
 *   npm run dsd:audio:quarantine                     # dry run + manifest
 *   npm run dsd:audio:quarantine -- --write          # move to quarantine
 *   npm run dsd:audio:quarantine -- --root <dir>
 */
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config();

export const BLOCKED_VOICES = ['en_US-amy-medium', 'en_US-ryan-medium'];

/** Voice ids that appear in DSD paths and keys, mapped to engine voices. */
export const PUBLIC_TO_ENGINE: Record<string, string> = {
  'en-aria': 'en_US-ljspeech-medium',
  'en-guy': 'en_US-norman-medium',
};

export type Classification = 'approved' | 'blocked' | 'unapproved' | 'unknown';

export interface ScannedItem {
  /** Filesystem path or object key. */
  location: string;
  size: number;
  sha256: string;
  /** True when something still serves this location. */
  hasServingReference?: boolean;
}

export interface ManifestEntry extends ScannedItem {
  detectedVoice: string | null;
  classification: Classification;
  proposedAction: 'keep' | 'quarantine' | 'blocked_needs_replacement' | 'review';
  reason: string;
}

export interface QuarantineManifest {
  manifest_version: number;
  generated_at: string;
  approved_voices: string[];
  blocked_voices: string[];
  counts: Record<string, number>;
  bytes: Record<string, number>;
  entries: ManifestEntry[];
}

/**
 * Identify the voice a file came from.
 *
 * Filenames and keys are the only signal available for loose artifacts — a WAV
 * carries no voice metadata, and adding one would be inventing provenance rather
 * than recovering it. So an unrecognisable name classifies as unknown and gets a
 * human, not a guess.
 */
export function detectVoice(location: string, knownVoices: string[]): string | null {
  const haystack = location.toLowerCase();

  // Longest first, so en_US-libritts_r-medium is not matched as a prefix of
  // something shorter.
  for (const voice of [...knownVoices].sort((a, b) => b.length - a.length)) {
    if (haystack.includes(voice.toLowerCase())) return voice;
  }
  for (const [publicId, engineVoice] of Object.entries(PUBLIC_TO_ENGINE)) {
    // A content-addressed DSD key names the public voice, not the model.
    if (new RegExp(`(^|/)${publicId}(/|_|-)`).test(haystack)) return engineVoice;
  }

  // A bare model-ish name that is not in any list. Recognised as a voice so it
  // can be classified as unapproved rather than dismissed as noise.
  //
  // The tail is a lookahead rather than \b: an underscore is a word character,
  // so \b never matched `en_US-lessac-medium__long.wav` and four real files
  // classified as unknown instead of unapproved.
  const guess = /(en_[a-z]{2}-[a-z0-9]+(?:_[a-z0-9]+)*-(?:low|medium|high))(?=$|[^a-z0-9])/i.exec(
    location,
  );
  return guess ? guess[1] : null;
}

export function classify(
  detectedVoice: string | null,
  approvedVoices: string[],
): Classification {
  if (!detectedVoice) return 'unknown';
  if (BLOCKED_VOICES.includes(detectedVoice)) return 'blocked';
  if (approvedVoices.includes(detectedVoice)) return 'approved';
  return 'unapproved';
}

export interface QuarantinePlanInput {
  items: ScannedItem[];
  approvedVoices: string[];
  /** Engine voices for which an approved replacement asset already exists. */
  replacementsAvailable?: string[];
}

export function planQuarantine(input: QuarantinePlanInput): ManifestEntry[] {
  const replacements = new Set(input.replacementsAvailable ?? []);

  return input.items.map((item): ManifestEntry => {
    const detectedVoice = detectVoice(item.location, [
      ...input.approvedVoices,
      ...BLOCKED_VOICES,
    ]);
    const classification = classify(detectedVoice, input.approvedVoices);

    if (classification === 'approved') {
      return {
        ...item,
        detectedVoice,
        classification,
        proposedAction: 'keep',
        reason: `${detectedVoice} is an approved voice`,
      };
    }

    if (classification === 'unknown') {
      // Deleting or moving something nobody can identify is how the only copy of
      // an artifact disappears.
      return {
        ...item,
        detectedVoice,
        classification,
        proposedAction: 'review',
        reason: 'no voice could be identified from the name; a person must decide',
      };
    }

    // blocked or unapproved from here on.
    if (item.hasServingReference && !replacements.has(detectedVoice!)) {
      return {
        ...item,
        detectedVoice,
        classification,
        proposedAction: 'blocked_needs_replacement',
        reason:
          `something still serves this and no approved replacement exists for ` +
          `${detectedVoice}; regenerate first, or quarantining it becomes an outage`,
      };
    }

    return {
      ...item,
      detectedVoice,
      classification,
      proposedAction: 'quarantine',
      reason:
        classification === 'blocked'
          ? `${detectedVoice} is blocked: its training dataset does not permit commercial use`
          : `${detectedVoice} is not in the voice lock, so it has no recorded provenance`,
    };
  });
}

export function buildManifest(
  generatedAt: string,
  approvedVoices: string[],
  entries: ManifestEntry[],
): QuarantineManifest {
  const counts: Record<string, number> = {};
  const bytes: Record<string, number> = {};
  for (const entry of entries) {
    counts[entry.proposedAction] = (counts[entry.proposedAction] ?? 0) + 1;
    bytes[entry.proposedAction] = (bytes[entry.proposedAction] ?? 0) + entry.size;
  }

  return {
    manifest_version: 1,
    generated_at: generatedAt,
    approved_voices: approvedVoices,
    blocked_voices: BLOCKED_VOICES,
    counts,
    bytes,
    entries: [...entries].sort((a, b) => a.location.localeCompare(b.location)),
  };
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, canonical(v)]),
    );
  }
  return value;
}

/**
 * Digest of the manifest, and an HMAC when a key is configured.
 *
 * The digest makes the manifest tamper-evident; the HMAC makes it attributable.
 * Without DSD_QUARANTINE_HMAC_KEY only the digest is produced, and the report
 * says so rather than implying a signature exists.
 */
export function signManifest(manifest: QuarantineManifest): {
  digest: string;
  hmac: string | null;
} {
  const payload = JSON.stringify(canonical(manifest));
  const digest = crypto.createHash('sha256').update(payload, 'utf8').digest('hex');
  const key = process.env.DSD_QUARANTINE_HMAC_KEY;
  return {
    digest,
    hmac: key ? crypto.createHmac('sha256', key).update(payload, 'utf8').digest('hex') : null,
  };
}

/** Where a quarantined file goes. Outside every serving path, by construction. */
export function quarantinePath(root: string, timestamp: string, location: string): string {
  const stamp = timestamp.replace(/[^0-9]/g, '').slice(0, 14);
  const relative = path.isAbsolute(location) ? path.relative(root, location) : location;
  return path.join(root, 'quarantine', stamp, relative);
}

// ─── I/O ────────────────────────────────────────────────────────────────────

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const AUDIO_EXTENSIONS = new Set(['.wav', '.mp3', '.onnx', '.json', '.ort']);

function sha256File(file: string): string {
  const digest = crypto.createHash('sha256');
  const handle = fs.openSync(file, 'r');
  try {
    const buffer = Buffer.alloc(8 * 1024 * 1024);
    let read: number;
    while ((read = fs.readSync(handle, buffer, 0, buffer.length, null)) > 0) {
      digest.update(buffer.subarray(0, read));
    }
  } finally {
    fs.closeSync(handle);
  }
  return digest.digest('hex');
}

function scanDirectory(root: string): ScannedItem[] {
  const items: ScannedItem[] = [];
  const walk = (directory: string) => {
    if (!fs.existsSync(directory)) return;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      // Never descend into the quarantine prefix; re-quarantining is noise.
      if (entry.isDirectory()) {
        if (entry.name !== 'quarantine') walk(full);
        continue;
      }
      if (!AUDIO_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue;
      const stats = fs.statSync(full);
      items.push({ location: full, size: stats.size, sha256: sha256File(full) });
    }
  };
  walk(root);
  return items;
}

/** Roots scanned by default: the TTS model cache and its generated output. */
export const DEFAULT_ROOTS = [
  '../tts-service/.piper-models',
  '../tts-service/out_piper',
  '../tts-service/out',
  './uploads',
];

function approvedVoicesFromLock(): string[] {
  const lockPath = path.resolve(
    process.cwd(),
    process.env.DSD_TTS_VOICE_LOCK ?? '../tts-service/models/piper-voices.lock.json',
  );
  if (!fs.existsSync(lockPath)) {
    throw new Error(
      `No TTS voice lock at ${lockPath}; without it there is no list of approved voices ` +
        'and everything would classify as unapproved.',
    );
  }
  const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  return (lock.voices ?? []).map((voice: any) => voice.modelId);
}

async function main(): Promise<void> {
  const approvedVoices = approvedVoicesFromLock();
  const roots = arg('root') ? [arg('root')!] : DEFAULT_ROOTS;
  const generatedAt = new Date().toISOString();

  const items: ScannedItem[] = [];
  for (const root of roots) {
    const resolved = path.resolve(process.cwd(), root);
    const found = scanDirectory(resolved);
    if (found.length > 0) console.log(`  scanned ${found.length} file(s) under ${root}`);
    items.push(...found);
  }

  if (items.length === 0) {
    console.log('Nothing to inventory.');
    return;
  }

  const entries = planQuarantine({ items, approvedVoices });
  const manifest = buildManifest(generatedAt, approvedVoices, entries);
  const signature = signManifest(manifest);

  console.log(`\n${items.length} artifact(s) inventoried.`);
  for (const [action, count] of Object.entries(manifest.counts).sort()) {
    const megabytes = (manifest.bytes[action] / 1024 / 1024).toFixed(1);
    console.log(`  ${String(count).padStart(4)}  ${action.padEnd(28)} ${megabytes} MB`);
  }

  console.log('\nby classification:');
  for (const entry of manifest.entries) {
    if (entry.classification === 'approved') continue;
    console.log(
      `  ${entry.classification.padEnd(11)} ${entry.sha256.slice(0, 12)}… ` +
        `${path.basename(entry.location)}`,
    );
    console.log(`              ${entry.reason}`);
  }

  const output = arg('output') ?? 'data/dsd/audio';
  const manifestFile = path.resolve(
    process.cwd(),
    output,
    `quarantine-${generatedAt.replace(/[^0-9]/g, '').slice(0, 14)}.json`,
  );
  fs.mkdirSync(path.dirname(manifestFile), { recursive: true });
  fs.writeFileSync(
    manifestFile,
    JSON.stringify({ ...manifest, digest: signature.digest, hmac: signature.hmac }, null, 2) + '\n',
  );
  console.log(`\nmanifest ${manifestFile}`);
  console.log(`digest   ${signature.digest}`);
  console.log(
    signature.hmac
      ? `hmac     ${signature.hmac}`
      : 'hmac     not signed (set DSD_QUARANTINE_HMAC_KEY to attribute this manifest)',
  );

  const blocked = manifest.entries.filter(
    (entry) => entry.proposedAction === 'blocked_needs_replacement',
  );
  if (blocked.length > 0) {
    console.error(`\n${blocked.length} artifact(s) cannot be quarantined yet:`);
    for (const entry of blocked) console.error(`  - ${entry.location}: ${entry.reason}`);
  }

  if (!process.argv.includes('--write')) {
    console.log('\nDRY RUN — nothing moved. Re-run with --write.');
    return;
  }

  const toMove = manifest.entries.filter((entry) => entry.proposedAction === 'quarantine');
  let moved = 0;
  for (const entry of toMove) {
    const root = path.resolve(process.cwd(), roots[0]);
    const destination = quarantinePath(
      path.dirname(entry.location),
      generatedAt,
      path.basename(entry.location),
    );
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    // Renamed, never unlinked. Some of this is the record of what was generated
    // with what, and a licensing review should not destroy its own evidence.
    fs.renameSync(entry.location, destination);
    moved++;
    console.log(`  moved ${path.basename(entry.location)} -> ${path.relative(root, destination)}`);
  }

  console.log(`\nQuarantined ${moved} artifact(s). Nothing was deleted.`);
  console.log('See docs/dsd-corpus/AUDIO-QUARANTINE-RUNBOOK.md to restore or reclaim.');
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}

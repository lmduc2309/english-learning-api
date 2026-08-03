import * as fs from 'fs';
import * as path from 'path';
import {
  BLOCKED_VOICES,
  ScannedItem,
  buildManifest,
  classify,
  detectVoice,
  planQuarantine,
  quarantinePath,
  signManifest,
} from './audio-quarantine';

const APPROVED = ['en_US-ljspeech-medium', 'en_US-norman-medium'];
const KNOWN = [...APPROVED, ...BLOCKED_VOICES];

function item(location: string, overrides: Partial<ScannedItem> = {}): ScannedItem {
  return { location, size: 1000, sha256: 'a'.repeat(64), ...overrides };
}

const plan = (items: ScannedItem[], replacements?: string[]) =>
  planQuarantine({ items, approvedVoices: APPROVED, replacementsAvailable: replacements });

describe('detectVoice', () => {
  it('finds an approved voice in a model filename', () => {
    expect(detectVoice('/x/.piper-models/en_US-ljspeech-medium.onnx', KNOWN)).toBe(
      'en_US-ljspeech-medium',
    );
  });

  it('finds a blocked voice in generated audio', () => {
    expect(detectVoice('out_piper/en_US-amy-medium__long.wav', KNOWN)).toBe('en_US-amy-medium');
  });

  it('finds a voice nobody listed, so it can be judged rather than ignored', () => {
    // The trailing boundary is a lookahead, not \b: an underscore is a word
    // character, so \b never matched `medium__long` and four real files
    // classified as unknown instead of unapproved.
    expect(detectVoice('out_piper/en_US-lessac-medium__long.wav', KNOWN)).toBe(
      'en_US-lessac-medium',
    );
    expect(detectVoice('out_piper/en_US-libritts_r-medium__short.wav', KNOWN)).toBe(
      'en_US-libritts_r-medium',
    );
  });

  it('handles a name at the very end of a path', () => {
    expect(detectVoice('cache/en_US-lessac-medium', KNOWN)).toBe('en_US-lessac-medium');
  });

  it('maps a DSD public voice id to its engine voice', () => {
    // A content-addressed DSD key names the public voice, not the model.
    expect(detectVoice(`dsd/audio/en-aria/${'a'.repeat(64)}.wav`, KNOWN)).toBe(
      'en_US-ljspeech-medium',
    );
    expect(detectVoice(`dsd/audio/en-guy/${'a'.repeat(64)}.mp3`, KNOWN)).toBe(
      'en_US-norman-medium',
    );
  });

  it('prefers the longest match, so one voice is not read as another', () => {
    expect(detectVoice('en_US-libritts_r-medium.onnx', [...KNOWN, 'en_US-libritts-medium'])).toBe(
      'en_US-libritts_r-medium',
    );
  });

  it('returns null when nothing identifiable is present', () => {
    // A WAV carries no voice metadata, and inventing one would be manufacturing
    // provenance rather than recovering it.
    expect(detectVoice('out/__Ngọc_Lan___nữ__long.wav', KNOWN)).toBeNull();
    expect(detectVoice('uploads/recording-2026-01-01.wav', KNOWN)).toBeNull();
  });
});

describe('classify', () => {
  it.each(BLOCKED_VOICES)('calls %s blocked', (voice) => {
    expect(classify(voice, APPROVED)).toBe('blocked');
  });

  it.each(APPROVED)('calls %s approved', (voice) => {
    expect(classify(voice, APPROVED)).toBe('approved');
  });

  it('calls an unlisted voice unapproved', () => {
    expect(classify('en_US-lessac-medium', APPROVED)).toBe('unapproved');
  });

  it('calls an unidentifiable file unknown', () => {
    expect(classify(null, APPROVED)).toBe('unknown');
  });
});

describe('planQuarantine', () => {
  it('keeps approved models', () => {
    const entries = plan([item('.piper-models/en_US-ljspeech-medium.onnx')]);
    expect(entries[0]).toMatchObject({ classification: 'approved', proposedAction: 'keep' });
  });

  it('quarantines a blocked voice and says why', () => {
    const entries = plan([item('out_piper/en_US-amy-medium__long.wav')]);
    expect(entries[0].proposedAction).toBe('quarantine');
    expect(entries[0].reason).toMatch(/does not permit commercial use/);
  });

  it('quarantines an unapproved voice for a different reason', () => {
    const entries = plan([item('out_piper/en_US-lessac-medium__long.wav')]);
    expect(entries[0]).toMatchObject({ classification: 'unapproved', proposedAction: 'quarantine' });
    expect(entries[0].reason).toMatch(/no recorded provenance/);
  });

  it('sends an unidentifiable file to a person, never to quarantine', () => {
    // Moving something nobody can identify is how the only copy disappears.
    const entries = plan([item('out/__Ngọc_Lan___nữ__long.wav')]);
    expect(entries[0].proposedAction).toBe('review');
  });

  it('sends a served but unidentifiable file to review, not quarantine', () => {
    // 'en-amy' is not a DSD public voice id and the filename names no model, so
    // this is unidentifiable rather than blocked — and it is still being served.
    const entries = plan([item('dsd/audio/en-amy/x.wav', { hasServingReference: true })]);
    expect(entries[0]).toMatchObject({ classification: 'unknown', proposedAction: 'review' });
  });

  it('refuses a served blocked artifact until a replacement exists', () => {
    const served = item('out_piper/en_US-amy-medium__long.wav', { hasServingReference: true });
    expect(plan([served])[0]).toMatchObject({
      proposedAction: 'blocked_needs_replacement',
    });
    expect(plan([served])[0].reason).toMatch(/regenerate first/);
  });

  it('allows it once an approved replacement exists', () => {
    const served = item('out_piper/en_US-amy-medium__long.wav', { hasServingReference: true });
    expect(plan([served], ['en_US-amy-medium'])[0].proposedAction).toBe('quarantine');
  });

  it('carries the hash and size through, so the manifest is a record', () => {
    const entries = plan([item('out_piper/en_US-amy-medium__long.wav', { size: 4242, sha256: 'b'.repeat(64) })]);
    expect(entries[0]).toMatchObject({ size: 4242, sha256: 'b'.repeat(64) });
  });
});

describe('buildManifest', () => {
  const entries = plan([
    item('.piper-models/en_US-ljspeech-medium.onnx', { size: 100 }),
    item('out_piper/en_US-amy-medium__long.wav', { size: 200 }),
    item('out_piper/en_US-ryan-medium__long.wav', { size: 300 }),
    item('out/unknown.wav', { size: 400 }),
  ]);

  it('counts and sums bytes by proposed action', () => {
    const manifest = buildManifest('2026-08-03T00:00:00.000Z', APPROVED, entries);
    expect(manifest.counts).toEqual({ keep: 1, quarantine: 2, review: 1 });
    expect(manifest.bytes).toEqual({ keep: 100, quarantine: 500, review: 400 });
  });

  it('records which voices were approved and which blocked', () => {
    const manifest = buildManifest('2026-08-03T00:00:00.000Z', APPROVED, entries);
    expect(manifest.approved_voices).toEqual(APPROVED);
    expect(manifest.blocked_voices).toEqual(BLOCKED_VOICES);
  });

  it('is ordered, so two runs over the same tree produce the same manifest', () => {
    const a = buildManifest('2026-08-03T00:00:00.000Z', APPROVED, entries);
    const b = buildManifest('2026-08-03T00:00:00.000Z', APPROVED, [...entries].reverse());
    expect(a).toEqual(b);
  });
});

describe('signManifest', () => {
  const manifest = buildManifest('2026-08-03T00:00:00.000Z', APPROVED, plan([item('x/en_US-amy-medium.onnx')]));

  it('digests the manifest so tampering is detectable', () => {
    expect(signManifest(manifest).digest).toMatch(/^[0-9a-f]{64}$/);
  });

  it('changes when any entry changes', () => {
    const other = buildManifest('2026-08-03T00:00:00.000Z', APPROVED, plan([item('x/en_US-ryan-medium.onnx')]));
    expect(signManifest(manifest).digest).not.toBe(signManifest(other).digest);
  });

  it('does not depend on key order', () => {
    expect(signManifest(manifest).digest).toBe(signManifest({ ...manifest }).digest);
  });

  it('reports no HMAC rather than implying a signature exists', () => {
    const previous = process.env.DSD_QUARANTINE_HMAC_KEY;
    delete process.env.DSD_QUARANTINE_HMAC_KEY;
    expect(signManifest(manifest).hmac).toBeNull();
    if (previous !== undefined) process.env.DSD_QUARANTINE_HMAC_KEY = previous;
  });

  it('attributes the manifest when a key is configured', () => {
    const previous = process.env.DSD_QUARANTINE_HMAC_KEY;
    process.env.DSD_QUARANTINE_HMAC_KEY = 'test-key';
    expect(signManifest(manifest).hmac).toMatch(/^[0-9a-f]{64}$/);
    if (previous === undefined) delete process.env.DSD_QUARANTINE_HMAC_KEY;
    else process.env.DSD_QUARANTINE_HMAC_KEY = previous;
  });
});

describe('quarantinePath', () => {
  it('lands outside every serving path', () => {
    const destination = quarantinePath('/models', '2026-08-03T09:00:00.000Z', 'en_US-amy-medium.onnx');
    expect(destination).toBe('/models/quarantine/20260803090000/en_US-amy-medium.onnx');
  });

  it('groups a run under one timestamp, so it can be undone as a unit', () => {
    const a = quarantinePath('/m', '2026-08-03T09:00:00.000Z', 'a.wav');
    const b = quarantinePath('/m', '2026-08-03T09:00:00.000Z', 'b.wav');
    expect(path.dirname(a)).toBe(path.dirname(b));
  });
});

describe('the tool never deletes', () => {
  const code = fs
    .readFileSync(path.resolve(__dirname, 'audio-quarantine.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

  it('unlinks nothing', () => {
    // Some of these artifacts are the record of what was generated with what,
    // and a licensing review should not destroy its own evidence.
    expect(code).not.toMatch(/unlinkSync|rmSync|rmdirSync|\brm\b/);
  });

  it('moves by rename', () => {
    expect(code).toMatch(/renameSync/);
  });

  it('does not descend into its own quarantine prefix', () => {
    expect(code).toMatch(/entry\.name !== 'quarantine'/);
  });
});

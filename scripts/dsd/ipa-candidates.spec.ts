import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const SCRIPT = path.resolve(__dirname, 'ipa-candidates.py');
const source = fs.readFileSync(SCRIPT, 'utf8');

function run(): { status: number; stderr: string; stdout: string } {
  try {
    const stdout = execFileSync('python3', [SCRIPT, '--batch', 'B-TEST'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, stdout, stderr: '' };
  } catch (error: any) {
    return { status: error.status ?? 1, stdout: String(error.stdout ?? ''), stderr: String(error.stderr ?? '') };
  }
}

describe('the generator refuses to run', () => {
  const result = run();

  it('exits non-zero while the tool locks are incomplete', () => {
    // A pinned revision fixes what the code says; the artifact digest fixes
    // what was executed. Without both, a candidate is not reproducible.
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/artifactSha256/);
  });

  it('refuses a tool that is only a candidate in the registry', () => {
    expect(result.stderr).toMatch(/not approved in the tool registry/);
  });

  it('names every reason rather than the first', () => {
    for (const tool of ['misaki', 'microsoft-phonetic-matching']) {
      expect(result.stderr).toContain(tool);
    }
  });

  it('prints nothing on stdout when it refuses', () => {
    expect(result.stdout.trim()).toBe('');
  });
});

describe('eSpeak is kept out of the environment', () => {
  it('refuses to run if an unapproved phonemiser is importable', () => {
    // Misaki falls back to eSpeak when its lexicon misses. fallback=None asks
    // it not to; refusing when eSpeak exists at all means a future default
    // cannot quietly turn it back on.
    expect(source).toMatch(/FORBIDDEN_MODULES\s*=\s*\("espeakng", "espeak", "phonemizer"\)/);
    expect(source).toMatch(/importlib\.util\.find_spec\(module\) is not None/);
  });

  it('checks the environment variables that point at an eSpeak install', () => {
    expect(source).toMatch(/PHONEMIZER_ESPEAK_LIBRARY/);
    expect(source).toMatch(/ESPEAK_DATA_PATH/);
  });

  it('is not installed here, so the check is meaningful rather than vacuous', () => {
    const probe = execFileSync(
      'python3',
      ['-c', 'import importlib.util,sys; sys.stdout.write(str(any(importlib.util.find_spec(m) for m in ("espeakng","espeak","phonemizer"))))'],
      { encoding: 'utf8' },
    );
    expect(probe).toBe('False');
  });
});

describe('how it calls the tool', () => {
  it('asks for American English with no fallback', () => {
    expect(source).toMatch(/en\.G2P\(trf=False, british=False, fallback=None\)/);
  });

  it('digests the exact input it was given', () => {
    expect(source).toMatch(/def headword_digest/);
    expect(source).toMatch(/hashlib\.sha256/);
    expect(source).toMatch(/unicodedata\.normalize\("NFC"/);
  });

  it('emits the tool identity with every candidate', () => {
    for (const field of ['tool_id', 'tool_revision', 'artifact_sha256', 'input_headword_hash']) {
      expect(source).toContain(`"${field}"`);
    }
  });

  it('imports the tool only after the refusals have run', () => {
    // Imported inside generate(), not at module scope, so the checks execute
    // in an environment where the package may not be installed at all.
    const moduleScopeImports = source.match(/^(?:import|from) .*$/gm) ?? [];
    expect(moduleScopeImports.join(' ')).not.toMatch(/misaki/);
    expect(source).toMatch(/from misaki import en/);
  });

  it('emits no status field, because a candidate has nothing to promote', () => {
    // Docstrings explain the rule; only code can break it.
    const code = source.replace(/"""[\s\S]*?"""/g, '').replace(/^\s*#.*$/gm, '');
    const emitted = code.match(/rows\.append\(\s*\{[\s\S]*?\n\s*\}\s*\)/)![0];
    expect(emitted).toContain('candidate_ipa');
    expect(emitted).not.toMatch(/status/);
    expect(emitted).not.toMatch(/approved|published/);
  });
});

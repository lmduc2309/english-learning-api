/**
 * Verify a release package offline.
 *
 * "Offline" is the whole point: this needs no database, no network and no
 * credentials. Anyone holding a package and a clean checkout of this repository
 * can establish whether the bytes they have are the bytes that were signed.
 *
 * The trust root is `data/dsd/release-public-keys.json` from that clean
 * checkout — never the `RELEASE-PUBLIC-KEY.pem` inside the package. Anyone able
 * to alter a manifest can alter a key sitting beside it, so a verifier that
 * trusted the bundled copy would only be checking the package against itself.
 * The bundled key still has to match the registry; a mismatch means the package
 * is misleading about who signed it.
 *
 * USAGE:
 *   npm run dsd:release:verify -- --dir dist/dsd-corpus/DSD-REL-V1-5000-a1b2c3d4
 *   npm run dsd:release:verify -- --dir <dir> --keys /path/to/reviewed-keys.json
 */
import * as fs from 'fs';
import * as path from 'path';
import {
  NEVER_LISTED,
  PublicKeyEntry,
  VerifyProblem,
  sha256,
  verifyRelease,
} from './lib/release-package';

export const DEFAULT_KEY_REGISTRY = 'data/dsd/release-public-keys.json';

/** Every file under a directory, as manifest-relative paths. */
export function collectFiles(root: string): Record<string, { sha256: string; bytes: number }> {
  const files: Record<string, { sha256: string; bytes: number }> = {};

  const walk = (directory: string) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      const relative = path.relative(root, full).split(path.sep).join('/');
      const bytes = fs.readFileSync(full);
      files[relative] = { sha256: sha256(bytes), bytes: bytes.length };
    }
  };

  walk(root);
  return files;
}

export interface VerifyOptions {
  directory: string;
  keyRegistryPath: string;
  now: string;
}

export function verifyDirectory(options: VerifyOptions): VerifyProblem[] {
  const root = path.resolve(process.cwd(), options.directory);
  if (!fs.existsSync(root)) {
    return [{ code: 'manifest_missing', detail: `${options.directory} does not exist` }];
  }

  const read = (relative: string): Buffer | null => {
    const file = path.join(root, relative);
    return fs.existsSync(file) ? fs.readFileSync(file) : null;
  };

  const manifestBytes = read('00_manifest.json');
  const signatureBytes = read('00_manifest.sig');
  const checksums = read('checksums.sha256');
  const bundledKey = read('RELEASE-PUBLIC-KEY.pem');

  const registryPath = path.resolve(process.cwd(), options.keyRegistryPath);
  let trustedKeys: PublicKeyEntry[] = [];
  if (fs.existsSync(registryPath)) {
    trustedKeys = JSON.parse(fs.readFileSync(registryPath, 'utf8')).keys ?? [];
  }

  const presentFiles = collectFiles(root);
  // The manifest, its signature and the checksum index are not content, so they
  // are not compared against the manifest's own artifact list.
  for (const path of NEVER_LISTED) delete presentFiles[path];

  return verifyRelease({
    manifestBytes,
    signatureBase64: signatureBytes ? signatureBytes.toString('utf8').trim() : null,
    trustedKeys,
    bundledKeyPem: bundledKey ? bundledKey.toString('utf8') : null,
    presentFiles,
    checksumsBytes: checksums,
    now: options.now,
  });
}

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function main(): void {
  const directory = arg('dir');
  if (!directory) throw new Error('--dir is required');

  const keyRegistryPath = arg('keys') ?? DEFAULT_KEY_REGISTRY;
  const problems = verifyDirectory({
    directory,
    keyRegistryPath,
    now: new Date().toISOString(),
  });

  if (process.argv.includes('--json')) {
    console.log(JSON.stringify({ directory, problems, verified: problems.length === 0 }, null, 2));
  } else if (problems.length === 0) {
    console.log(`VERIFIED  ${directory}`);
    console.log(`trust root: ${keyRegistryPath}`);
  } else {
    console.error(`FAILED  ${directory}`);
    console.error(`trust root: ${keyRegistryPath}\n`);
    for (const problem of problems) {
      console.error(`  ${problem.code.padEnd(26)} ${problem.detail}`);
    }
  }

  if (problems.length > 0) process.exit(1);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error((error as Error).message);
    process.exit(1);
  }
}

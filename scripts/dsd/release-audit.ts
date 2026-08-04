/**
 * Development entry point for the release audit.
 *
 * The implementation lives in src/dsd-corpus/release/gather.ts so that it
 * compiles into dist and `dsd:release:audit:prod` runs exactly this code. This
 * file exists only so the command reads like every other dsd:* tool.
 *
 * USAGE:
 *   npm run dsd:release:audit -- --release DSD-REL-V1-5000-a1b2c3d4 \
 *     --channel public --territories data/dsd/releases/territories.json
 */
import { runReleaseAudit } from '../../src/dsd-corpus/release/gather';

export * from '../../src/dsd-corpus/release/gather';

if (require.main === module) {
  runReleaseAudit().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}

/**
 * Production entry point for the release audit.
 *
 * Compiled into dist, so `dsd:release:audit:prod` runs the same gathering and
 * the same decision as the development command. A release gate that differs
 * between environments is not a gate.
 */
import { runReleaseAudit } from './gather';

runReleaseAudit().catch((error) => {
  console.error(error.message);
  process.exit(1);
});

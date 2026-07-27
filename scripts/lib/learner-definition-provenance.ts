import { OEWN_SHA256, OEWN_VERSION } from './oewn';

export const DEFINITION_SOURCE_VERSION_MAX_LENGTH = 40;
export const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/;

export interface DefinitionProvenanceInput {
  definitionSource?: unknown;
  definitionSourceVersion?: unknown;
  definitionSourceArtifactSha256?: unknown;
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isOewnSource(value: unknown): boolean {
  if (!nonEmptyString(value)) return false;
  const normalized = value.trim().toLocaleLowerCase('en-US');
  return normalized === 'oewn' || normalized.startsWith('open english wordnet');
}

/**
 * New curation batches must pin the exact source version and artifact digest.
 * Database columns remain nullable so pre-migration rows stay readable, but the
 * supported curation path never creates another unpinned learner sense.
 */
export function validateDefinitionProvenance(
  input: DefinitionProvenanceInput,
  at: string,
): string[] {
  const errors: string[] = [];
  const version = input.definitionSourceVersion;
  const digest = input.definitionSourceArtifactSha256;

  if (!nonEmptyString(version)) {
    errors.push(`${at}: definition_source_version is required`);
  } else if (version.trim().length > DEFINITION_SOURCE_VERSION_MAX_LENGTH) {
    errors.push(
      `${at}: definition_source_version must be at most ${DEFINITION_SOURCE_VERSION_MAX_LENGTH} characters`,
    );
  }

  if (!nonEmptyString(digest)) {
    errors.push(`${at}: definition_source_artifact_sha256 is required`);
  } else if (!SHA256_HEX_PATTERN.test(digest.trim())) {
    errors.push(
      `${at}: definition_source_artifact_sha256 must be exactly 64 lowercase hexadecimal characters`,
    );
  }

  if (isOewnSource(input.definitionSource)) {
    if (nonEmptyString(version) && version.trim() !== OEWN_VERSION) {
      errors.push(
        `${at}: Open English WordNet definition_source_version must match pinned version ${OEWN_VERSION}`,
      );
    }
    if (nonEmptyString(digest) && digest.trim() !== OEWN_SHA256) {
      errors.push(
        `${at}: Open English WordNet definition_source_artifact_sha256 must match the pinned ${OEWN_VERSION} artifact`,
      );
    }
  }

  return errors;
}

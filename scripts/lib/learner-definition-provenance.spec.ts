import {
  validateDefinitionProvenance,
} from './learner-definition-provenance';

describe('learner definition provenance', () => {
  const sha256 = '9ca6d1dcb75f822fdd66617f7d9da48142ace38dd544d6ad5e2feca1674ad3fe';

  it('accepts a pinned source version and lowercase SHA-256 digest', () => {
    expect(validateDefinitionProvenance({
      definitionSource: 'Open English WordNet',
      definitionSourceVersion: '2025',
      definitionSourceArtifactSha256: sha256,
    }, 'row 1')).toEqual([]);
  });

  it.each([
    [{}, 'definition_source_version is required'],
    [{ definitionSourceVersion: '2025' }, 'definition_source_artifact_sha256 is required'],
    [{ definitionSourceVersion: 'x'.repeat(41), definitionSourceArtifactSha256: sha256 }, 'definition_source_version must be at most 40 characters'],
    [{ definitionSourceVersion: '2025', definitionSourceArtifactSha256: sha256.toUpperCase() }, 'definition_source_artifact_sha256 must be exactly 64 lowercase hexadecimal characters'],
    [{ definitionSourceVersion: '2025', definitionSourceArtifactSha256: 'abc' }, 'definition_source_artifact_sha256 must be exactly 64 lowercase hexadecimal characters'],
  ])('rejects incomplete or unstable provenance: %j', (input, expected) => {
    expect(validateDefinitionProvenance(input, 'row 1')).toContain(
      `row 1: ${expected}`,
    );
  });

  it('rejects valid-looking provenance that does not match the pinned OEWN artifact', () => {
    expect(validateDefinitionProvenance({
      definitionSource: 'Open English WordNet',
      definitionSourceVersion: '2024',
      definitionSourceArtifactSha256: '0'.repeat(64),
    }, 'row 1')).toEqual(expect.arrayContaining([
      'row 1: Open English WordNet definition_source_version must match pinned version 2025',
      'row 1: Open English WordNet definition_source_artifact_sha256 must match the pinned 2025 artifact',
    ]));
  });
});

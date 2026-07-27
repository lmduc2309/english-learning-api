import { DefinitionDto, PronunciationDto } from './dto/lookup-word.dto';
import { Definition } from './entities/definition.entity';
import { LearnerEntry } from './entities/learner-entry.entity';
import {
  definitionQualityFlags,
  exampleQualityFlags,
  isUnsafeVietnamese,
} from './dictionary-quality';

export function cefrToLegacyLevel(cefrLevel: string | null | undefined): string {
  switch (cefrLevel?.toUpperCase()) {
    case 'A1':
    case 'A2':
      return 'beginner';
    case 'B1':
    case 'B2':
      return 'intermediate';
    case 'C1':
    case 'C2':
      return 'advanced';
    default:
      return 'unclassified';
  }
}

export function presentLearnerDefinitions(
  learnerEntry: LearnerEntry | null | undefined,
): DefinitionDto[] {
  return (learnerEntry?.senses || [])
    .filter((sense) => sense.status === 'published')
    .sort((a, b) => a.senseOrder - b.senseOrder)
    .flatMap((sense) => {
      const vietnamese = (sense.translations || []).find(
        (translation) => {
          const locale = translation.locale.toLowerCase();
          return (
            (locale === 'vi' || locale.startsWith('vi-')) &&
            translation.reviewStatus === 'approved'
          );
        },
      );
      if (!vietnamese) return [];

      return [{
        pos: sense.partOfSpeech,
        definition_en: sense.definitionEn,
        definition_vi: vietnamese.text,
        level: cefrToLegacyLevel(sense.cefrLevel),
        cefr_level: sense.cefrLevel || undefined,
        cefr_source: sense.cefrSource || undefined,
        cefr_basis: sense.cefrBasis || undefined,
        cefr_source_version: sense.cefrSourceVersion || undefined,
        cefr_source_license: sense.cefrSourceLicense || undefined,
        examples: (sense.examples || [])
          .filter((example) => example.reviewStatus === 'approved')
          .sort((a, b) => a.exampleOrder - b.exampleOrder)
          .map((example) => ({
            en: example.exampleEn,
            vi: example.exampleVi,
          })),
        data_status: 'reviewed',
        quality_flags: [],
        is_learner_visible: true,
        source: sense.definitionSource,
        source_license: sense.definitionSourceLicense,
        definition_source_version: sense.definitionSourceVersion || undefined,
        definition_source_artifact_sha256:
          sense.definitionSourceArtifactSha256 || undefined,
        translation_source: vietnamese.source,
        translation_source_license: vietnamese.sourceLicense,
        translation_method: vietnamese.method,
        sense_id: sense.id,
        sense_key: sense.senseKey,
      }];
    });
}

export function presentRawDefinitions(definitions: Definition[] | null | undefined): DefinitionDto[] {
  return [...(definitions || [])]
    .sort((a, b) => a.definitionOrder - b.definitionOrder)
    .flatMap((definition) => {
      const qualityFlags = Array.from(new Set([
        ...(definition.qualityFlags || []),
        ...definitionQualityFlags(definition.definitionEn, definition.definitionVi),
      ]));
      if (
        qualityFlags.includes('raw_markup') ||
        qualityFlags.includes('empty_definition')
      ) {
        return [];
      }
      const unsafeVietnamese = isUnsafeVietnamese(qualityFlags);
      const examples = (definition.examples || []).flatMap((example) => {
        const exampleFlags = Array.from(new Set([
          ...(example.qualityFlags || []),
          ...exampleQualityFlags(example.exampleEn, example.exampleVi),
        ]));
        if (
          isUnsafeVietnamese(exampleFlags) ||
          exampleFlags.includes('example_too_long') ||
          exampleFlags.includes('raw_markup') ||
          exampleFlags.includes('empty_definition')
        ) {
          return [];
        }
        return [{ en: example.exampleEn, vi: example.exampleVi }];
      });

      return [{
        pos: definition.partOfSpeech,
        definition_en: definition.definitionEn,
        definition_vi: unsafeVietnamese ? undefined : definition.definitionVi,
        // Legacy difficulty was derived from word length and is not CEFR.
        // Omit it from raw fallback so clients cannot present it as a trusted
        // learner level; curated senses expose the compatibility label above.
        level: undefined,
        examples,
        data_status: unsafeVietnamese ? 'quarantined' : 'raw',
        quality_flags: qualityFlags,
        // This is a trust/eligibility flag, not a transport filter. The legacy
        // tables remain useful as an explicitly unverified reference fallback,
        // but only the normalized learner_* overlay can be learner-visible.
        is_learner_visible: false,
        source: definition.source || undefined,
        sense_key: definition.sourceSenseId || undefined,
      }];
    });
}

export function presentLearnerPronunciations(
  learnerEntry: LearnerEntry | null | undefined,
): PronunciationDto[] {
  return (learnerEntry?.pronunciations || [])
    .filter((pronunciation) => pronunciation.reviewStatus === 'approved')
    .sort((a, b) => a.priority - b.priority)
    .filter(
      (pronunciation, index, all) =>
        all.findIndex(
          (candidate) =>
            candidate.accent.toUpperCase() === pronunciation.accent.toUpperCase(),
        ) === index,
    )
    .map((pronunciation) => ({
      accent: pronunciation.accent.toUpperCase(),
      ipa: pronunciation.ipa,
    }));
}

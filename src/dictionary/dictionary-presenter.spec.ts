import {
  cefrToLegacyLevel,
  presentLearnerDefinitions,
  presentLearnerPronunciations,
  presentRawDefinitions,
} from './dictionary-presenter';

describe('dictionary presenter', () => {
  it.each([
    ['A1', 'beginner'],
    ['A2', 'beginner'],
    ['B1', 'intermediate'],
    ['B2', 'intermediate'],
    ['C1', 'advanced'],
    ['C2', 'advanced'],
    [undefined, 'unclassified'],
  ])('maps CEFR %s to the legacy level %s', (cefr, legacy) => {
    expect(cefrToLegacyLevel(cefr)).toBe(legacy);
  });

  it('publishes only senses with an independently approved Vietnamese translation', () => {
    const definitions = presentLearnerDefinitions({
      senses: [
        {
          id: 'approved-sense',
          status: 'published',
          senseOrder: 2,
          partOfSpeech: 'verb',
          definitionEn: 'To learn about a subject.',
          cefrLevel: 'A1',
          translations: [{
            locale: 'vi-VN',
            text: 'học về một môn học',
            source: 'human review',
            sourceLicense: 'project-owned',
            method: 'independent_human_review',
            reviewStatus: 'approved',
          }],
          examples: [{
            exampleOrder: 1,
            exampleEn: 'I study English.',
            exampleVi: 'Tôi học tiếng Anh.',
            reviewStatus: 'approved',
          }],
          definitionSource: 'Open English WordNet',
          definitionSourceLicense: 'CC BY 4.0',
          definitionSourceVersion: '2025',
          definitionSourceArtifactSha256: '9ca6d1dcb75f822fdd66617f7d9da48142ace38dd544d6ad5e2feca1674ad3fe',
          senseKey: 'study-v-1',
        },
        {
          id: 'draft-translation',
          status: 'published',
          senseOrder: 1,
          translations: [{
            locale: 'vi',
            text: 'không được lộ',
            reviewStatus: 'draft',
          }],
          examples: [],
        },
      ],
    } as any);

    expect(definitions).toHaveLength(1);
    expect(definitions[0]).toMatchObject({
      sense_id: 'approved-sense',
      definition_vi: 'học về một môn học',
      level: 'beginner',
      data_status: 'reviewed',
      definition_source_version: '2025',
      definition_source_artifact_sha256: '9ca6d1dcb75f822fdd66617f7d9da48142ace38dd544d6ad5e2feca1674ad3fe',
    });
  });

  it('suppresses contaminated raw Vietnamese and unsafe examples', () => {
    const definitions = presentRawDefinitions([
      {
        definitionOrder: 1,
        partOfSpeech: 'noun',
        definitionEn: 'A system of communication.',
        definitionVi: '语言',
        level: 'intermediate',
        reviewStatus: 'raw',
        qualityFlags: [],
        isLearnerVisible: true,
        examples: [{
          exampleEn: 'Language connects people.',
          exampleVi: '语言连接人们。',
          reviewStatus: 'raw',
          qualityFlags: [],
          isLearnerVisible: true,
        }],
      },
      {
        definitionOrder: 2,
        partOfSpeech: 'noun',
        definitionEn: '(obsolete|rare) Broken source markup.',
        definitionVi: 'bản dịch không nên được hiển thị',
        level: 'intermediate',
        reviewStatus: 'raw',
        qualityFlags: [],
        isLearnerVisible: true,
        examples: [],
      },
      {
        definitionOrder: 3,
        partOfSpeech: 'noun',
        definitionEn: 'A second safe definition.',
        definitionVi: 'một định nghĩa an toàn khác',
        level: 'intermediate',
        reviewStatus: 'raw',
        qualityFlags: [],
        isLearnerVisible: false,
        examples: [{
          exampleEn: '<small>broken example markup</small>',
          exampleVi: 'ví dụ bị lỗi',
          reviewStatus: 'raw',
          qualityFlags: [],
          isLearnerVisible: false,
        }],
      },
    ] as any);

    expect(definitions).toHaveLength(2);
    expect(definitions[0]).toMatchObject({
      definition_vi: undefined,
      data_status: 'quarantined',
      is_learner_visible: false,
      examples: [],
    });
    expect(definitions[0].quality_flags).toContain('vi_contains_cjk');
    expect(definitions[1].examples).toEqual([]);
  });

  it('returns safe legacy content as reference-only even when its stale flag is true', () => {
    const definitions = presentRawDefinitions([{
      definitionOrder: 1,
      partOfSpeech: 'verb',
      definitionEn: 'To learn about a subject.',
      definitionVi: 'học về một môn học',
      level: 'beginner',
      reviewStatus: 'reviewed',
      qualityFlags: [],
      isLearnerVisible: true,
      examples: [{
        exampleEn: 'I study English every day.',
        exampleVi: 'Tôi học tiếng Anh mỗi ngày.',
        reviewStatus: 'reviewed',
        qualityFlags: [],
        isLearnerVisible: false,
      }],
    }] as any);

    expect(definitions).toEqual([expect.objectContaining({
      definition_vi: 'học về một môn học',
      level: undefined,
      data_status: 'raw',
      is_learner_visible: false,
      examples: [{
        en: 'I study English every day.',
        vi: 'Tôi học tiếng Anh mỗi ngày.',
      }],
    })]);
  });

  it('does not mix unreviewed legacy pronunciation into curated learner content', () => {
    const pronunciations = presentLearnerPronunciations({
      pronunciations: [
        {
          accent: 'US',
          ipa: '/stʌdi/',
          priority: 1,
          reviewStatus: 'approved',
        },
        {
          accent: 'UK',
          ipa: '/unreviewed/',
          priority: 2,
          reviewStatus: 'draft',
        },
      ],
    } as any);

    expect(pronunciations).toEqual([{
      accent: 'US',
      ipa: '/stʌdi/',
    }]);
  });
});

import { ApiProperty } from '@nestjs/swagger';

export class PronunciationDto {
  @ApiProperty({ example: 'US' })
  accent: string;

  @ApiProperty({ example: '/həˈloʊ/' })
  ipa: string;

  @ApiProperty({ 
    example: 'https://api.dictionaryapi.dev/media/pronunciations/en/hello-us.mp3', 
    required: false,
    description: 'Audio URL for pronunciation' 
  })
  audio_url?: string;
}

export class ExampleDto {
  @ApiProperty({ example: 'Hello! How are you?' })
  en: string;

  @ApiProperty({ example: 'Xin chào! Bạn khỏe không?' })
  vi: string;
}

export class DefinitionDto {
  @ApiProperty({ example: 'interjection' })
  pos: string;

  @ApiProperty({ example: 'used as a greeting' })
  definition_en: string;

  @ApiProperty({ example: 'xin chào, chào', required: false })
  definition_vi?: string;

  @ApiProperty({
    example: 'beginner',
    required: false,
    description:
      'Compatibility difficulty label derived from reviewed sense-level CEFR. Omitted for raw fallback content.',
  })
  level?: string;

  @ApiProperty({ type: [ExampleDto] })
  examples: ExampleDto[];

  @ApiProperty({
    example: 'raw',
    enum: ['raw', 'machine_translated', 'aligned', 'reviewed', 'quarantined', 'generated'],
  })
  data_status: string;

  @ApiProperty({ example: ['raw_markup'], type: [String] })
  quality_flags: string[];

  @ApiProperty({
    example: false,
    description:
      'Trust eligibility, not API visibility. Legacy raw fallback rows can be returned for reference with false; only independently reviewed learner content is true.',
  })
  is_learner_visible: boolean;

  @ApiProperty({ example: 'Open English WordNet', required: false })
  source?: string;

  @ApiProperty({ example: 'CC BY 4.0', required: false })
  source_license?: string;

  @ApiProperty({ example: '2025', required: false })
  definition_source_version?: string;

  @ApiProperty({
    example: '9ca6d1dcb75f822fdd66617f7d9da48142ace38dd544d6ad5e2feca1674ad3fe',
    required: false,
    description: 'SHA-256 of the exact definition-source artifact used during curation.',
  })
  definition_source_artifact_sha256?: string;

  @ApiProperty({ example: 'DuskStillDev bilingual review', required: false })
  translation_source?: string;

  @ApiProperty({ example: 'project-owned', required: false })
  translation_source_license?: string;

  @ApiProperty({ example: 'independent_human_review', required: false })
  translation_method?: string;

  @ApiProperty({ example: 'oewn-01234567-n', required: false })
  sense_key?: string;

  @ApiProperty({ example: '06418901-v', required: false })
  sense_id?: string;

  @ApiProperty({ example: 'A1', enum: ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'], required: false })
  cefr_level?: string;

  @ApiProperty({ example: 'human_review', required: false })
  cefr_source?: string;

  @ApiProperty({ example: 'independent_human_review', required: false })
  cefr_basis?: string;

  @ApiProperty({ example: '2026-07', required: false })
  cefr_source_version?: string;

  @ApiProperty({ example: 'CC BY 4.0', required: false })
  cefr_source_license?: string;
}

export class LookupWordResponseDto {
  @ApiProperty({ example: 'hello' })
  word: string;

  @ApiProperty({ type: [PronunciationDto] })
  pronunciations: PronunciationDto[];

  @ApiProperty({ type: [DefinitionDto] })
  definitions: DefinitionDto[];

  @ApiProperty({
    example: { plural: 'hellos', present: 'helloing' },
    required: false,
  })
  word_forms?: Record<string, string>;

  @ApiProperty({ example: ['hi', 'hey', 'greetings'], required: false })
  synonyms?: string[];

  @ApiProperty({ example: 150, required: false })
  frequency_rank?: number;

  @ApiProperty({ example: 'NGSL 1', required: false })
  learner_band?: string;

  @ApiProperty({ example: 'NGSL', required: false })
  rank_source?: string;

  @ApiProperty({ example: '1.2', required: false })
  rank_source_version?: string;

  @ApiProperty({ example: 'CC BY-SA 4.0', required: false })
  rank_source_license?: string;

  @ApiProperty({
    example: 'curated',
    enum: ['curated', 'raw_fallback', 'generated_fallback'],
    required: false,
  })
  data_source?: 'curated' | 'raw_fallback' | 'generated_fallback';
}

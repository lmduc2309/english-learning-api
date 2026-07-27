import { MigrationInterface, QueryRunner } from 'typeorm';

// Keep this range aligned with scripts/clean-cjk.ts: CJK punctuation,
// extensions, unified ideographs, compatibility ideographs, and full-width forms.
const pgCjk = `('[' || chr(12288) || '-' || chr(12351) || chr(13312) || '-' || chr(19903) || chr(19968) || '-' || chr(40959) || chr(63744) || '-' || chr(64255) || chr(65280) || '-' || chr(65519) || ']')`;

export class ExpandDictionaryCjkQuality1721401100000 implements MigrationInterface {
  name = 'ExpandDictionaryCjkQuality1721401100000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE definitions
      SET quality_flags = CASE
            WHEN quality_flags @> ARRAY['vi_contains_cjk']::text[] THEN quality_flags
            ELSE array_append(quality_flags, 'vi_contains_cjk')
          END,
          is_learner_visible = false
      WHERE definition_vi ~ ${pgCjk}`);
    await queryRunner.query(`
      UPDATE examples
      SET quality_flags = CASE
            WHEN quality_flags @> ARRAY['vi_contains_cjk']::text[] THEN quality_flags
            ELSE array_append(quality_flags, 'vi_contains_cjk')
          END,
          is_learner_visible = false
      WHERE example_vi ~ ${pgCjk}`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Do not make quarantined content learner-visible during rollback because a
    // row may carry other safety flags. Remove only the expanded-range marker.
    await queryRunner.query(`UPDATE definitions SET quality_flags = array_remove(quality_flags, 'vi_contains_cjk') WHERE definition_vi ~ ${pgCjk}`);
    await queryRunner.query(`UPDATE examples SET quality_flags = array_remove(quality_flags, 'vi_contains_cjk') WHERE example_vi ~ ${pgCjk}`);
  }
}

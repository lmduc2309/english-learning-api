import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { CreateLegacyBaseline1721399000000 } from './1721399000000-CreateLegacyBaseline';
import { AddMobileLearning1721400000000 } from './1721400000000-AddMobileLearning';
import { AddDictionaryQuality1721401000000 } from './1721401000000-AddDictionaryQuality';
import { ExpandDictionaryCjkQuality1721401100000 } from './1721401100000-ExpandDictionaryCjkQuality';
import { AddLearnerSenses1721401200000 } from './1721401200000-AddLearnerSenses';
import { MarkLegacyDictionaryReferenceOnly1721401300000 } from './1721401300000-MarkLegacyDictionaryReferenceOnly';
import { AddLearnerDefinitionProvenance1721401400000 } from './1721401400000-AddLearnerDefinitionProvenance';
import { AddVietnameseGlossSearch1721401500000 } from './1721401500000-AddVietnameseGlossSearch';
import { DedupeLegacyDictionaryRows1721402000000 } from './1721402000000-DedupeLegacyDictionaryRows';
import { NormalizeRawMarkupDefinitions1721402100000 } from './1721402100000-NormalizeRawMarkupDefinitions';
import { NormalizeCjkPunctuation1721402200000 } from './1721402200000-NormalizeCjkPunctuation';
import { DedupeWordPartOfSpeech1721402300000 } from './1721402300000-DedupeWordPartOfSpeech';
import { BackupCjkTranslations1721402350000 } from './1721402350000-BackupCjkTranslations';
import { RecomputeLegacyQualityFlags1721402400000 } from './1721402400000-RecomputeLegacyQualityFlags';
import { RemoveEmptyDefinitions1721403000000 } from './1721403000000-RemoveEmptyDefinitions';
import { NormalizeExampleMarkup1721403100000 } from './1721403100000-NormalizeExampleMarkup';
import { ClassifyVietnameseEchoes1721403200000 } from './1721403200000-ClassifyVietnameseEchoes';
import { EnforceLearnerProvenance1721403300000 } from './1721403300000-EnforceLearnerProvenance';
import { StrengthenCommercialPublication1721403400000 } from './1721403400000-StrengthenCommercialPublication';
import { AddPrimaryVietnameseSearch1721403500000 } from './1721403500000-AddPrimaryVietnameseSearch';

const migrations = [
  CreateLegacyBaseline1721399000000,
  AddMobileLearning1721400000000,
  AddDictionaryQuality1721401000000,
  ExpandDictionaryCjkQuality1721401100000,
  AddLearnerSenses1721401200000,
  MarkLegacyDictionaryReferenceOnly1721401300000,
  AddLearnerDefinitionProvenance1721401400000,
  AddVietnameseGlossSearch1721401500000,
  DedupeLegacyDictionaryRows1721402000000,
  NormalizeRawMarkupDefinitions1721402100000,
  NormalizeCjkPunctuation1721402200000,
  DedupeWordPartOfSpeech1721402300000,
  BackupCjkTranslations1721402350000,
  RecomputeLegacyQualityFlags1721402400000,
  RemoveEmptyDefinitions1721403000000,
  NormalizeExampleMarkup1721403100000,
  ClassifyVietnameseEchoes1721403200000,
  EnforceLearnerProvenance1721403300000,
  StrengthenCommercialPublication1721403400000,
  AddPrimaryVietnameseSearch1721403500000,
];

const dataSource = new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  username: process.env.DB_USERNAME || 'dictionary_user',
  password: process.env.DB_PASSWORD || 'dictionary_pass',
  database: process.env.DB_DATABASE || 'english_learning_db',
  entities: [`${__dirname}/../**/*.entity.js`],
  migrations,
  migrationsTableName: 'app_migrations',
  migrationsTransactionMode: 'each',
  synchronize: false,
  logging: ['error', 'schema'],
});

async function main(): Promise<void> {
  const command = process.argv[2];
  if (command !== 'show' && command !== 'run') {
    throw new Error('Usage: node dist/migrations/runner.js <show|run>');
  }
  await dataSource.initialize();
  if (command === 'show') {
    const pending = await dataSource.showMigrations();
    console.log(pending ? 'Pending migrations exist.' : 'Database migrations are current.');
  } else {
    const applied = await dataSource.runMigrations({ transaction: 'each' });
    console.log(
      `Applied ${applied.length} migration(s): `
      + `${applied.map((migration) => migration.name).join(', ') || 'none'}`,
    );
  }
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (dataSource.isInitialized) await dataSource.destroy();
  });

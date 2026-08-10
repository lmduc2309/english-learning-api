import { MigrationInterface } from 'typeorm';
import { CreateDsdCorpusCore1785628800000 } from './1785628800000-CreateDsdCorpusCore';
import { AddDsdSimilarityAudit1785628900000 } from './1785628900000-AddDsdSimilarityAudit';
import { AddDsdIpaCandidates1785629000000 } from './1785629000000-AddDsdIpaCandidates';
import { AddDsdAudioAssets1785629100000 } from './1785629100000-AddDsdAudioAssets';
import { AddDsdRelations1785629200000 } from './1785629200000-AddDsdRelations';
import { AddDsdReleaseBuilds1785629300000 } from './1785629300000-AddDsdReleaseBuilds';
import { AddDsdServingViews1785629400000 } from './1785629400000-AddDsdServingViews';
import { HardenDsdCommercialBoundary1785629500000 } from './1785629500000-HardenDsdCommercialBoundary';
import { GrantDsdOperationalMetadata1785629600000 } from './1785629600000-GrantDsdOperationalMetadata';
import { AddDsdGenerationJobs1785629700000 } from './1785629700000-AddDsdGenerationJobs';

/**
 * DSD migration list.
 *
 * Registered explicitly, in order, exactly as the legacy runner does. Keeping
 * this list hand-written rather than glob-loaded means a migration cannot
 * appear in production merely by existing on disk.
 */
export const DSD_MIGRATIONS: Array<new () => MigrationInterface> = [
  CreateDsdCorpusCore1785628800000,
  AddDsdSimilarityAudit1785628900000,
  AddDsdIpaCandidates1785629000000,
  AddDsdAudioAssets1785629100000,
  AddDsdRelations1785629200000,
  AddDsdReleaseBuilds1785629300000,
  AddDsdServingViews1785629400000,
  HardenDsdCommercialBoundary1785629500000,
  GrantDsdOperationalMetadata1785629600000,
  AddDsdGenerationJobs1785629700000,
];

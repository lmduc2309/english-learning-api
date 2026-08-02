import { MigrationInterface } from 'typeorm';
import { CreateDsdCorpusCore1785628800000 } from './1785628800000-CreateDsdCorpusCore';
import { AddDsdSimilarityAudit1785628900000 } from './1785628900000-AddDsdSimilarityAudit';
import { AddDsdIpaCandidates1785629000000 } from './1785629000000-AddDsdIpaCandidates';

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
];

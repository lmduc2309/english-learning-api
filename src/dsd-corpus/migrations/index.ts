import { MigrationInterface } from 'typeorm';

/**
 * DSD migration list.
 *
 * Registered explicitly, in order, exactly as the legacy runner does. Task 3
 * adds the first entry (`CreateDsdCoreSchema`). Keeping this list hand-written
 * rather than glob-loaded means a migration cannot appear in production merely
 * by existing on disk.
 */
export const DSD_MIGRATIONS: Array<new () => MigrationInterface> = [];

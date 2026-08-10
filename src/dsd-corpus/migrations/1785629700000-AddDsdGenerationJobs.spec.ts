import { QueryRunner } from 'typeorm';
import { AddDsdGenerationJobs1785629700000 } from './1785629700000-AddDsdGenerationJobs';

describe('AddDsdGenerationJobs migration', () => {
  it('creates a clean-room job ledger with limits and no legacy-bearing columns', async () => {
    const sql: string[] = [];
    const runner = { query: jest.fn(async (statement: string) => sql.push(statement)) } as unknown as QueryRunner;
    await new AddDsdGenerationJobs1785629700000().up(runner);
    const joined = sql.join('\n');

    expect(joined).toContain('CREATE TABLE "dsd_generation_runs"');
    expect(joined).toContain('CREATE TABLE "dsd_generation_jobs"');
    expect(joined).toContain('"max_cost_microusd"');
    expect(joined).toContain('"input_sha256"');
    expect(joined).toContain('generation job identity and hashes are immutable');
    expect(joined).not.toMatch(/legacy_id|word_id|definition_en|example_en|similarity_match/i);
  });

  it('drops only generation-owned objects', async () => {
    const sql: string[] = [];
    const runner = { query: jest.fn(async (statement: string) => sql.push(statement)) } as unknown as QueryRunner;
    await new AddDsdGenerationJobs1785629700000().down(runner);
    expect(sql.join('\n')).toContain('DROP TABLE IF EXISTS "dsd_generation_jobs"');
    expect(sql.join('\n')).not.toContain('dsd_entries');
  });
});

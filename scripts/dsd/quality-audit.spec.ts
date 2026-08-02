import * as fs from 'fs';
import * as path from 'path';
import { criticalFindings } from '../../src/dsd-corpus/quality/dsd-quality';
import { QualityInput, auditRecords, formatFindings } from './quality-audit';

function clean(): QualityInput {
  return {
    definitions: [
      {
        entityId: 'd1',
        headword: 'rehearse',
        partOfSpeech: 'verb',
        definitionEn: 'To practise a performance before presenting it to an audience.',
        usageLabels: ['general'],
      },
    ],
    translations: [
      {
        entityId: 't1',
        headword: 'rehearse',
        definitionEn: 'To practise a performance before presenting it to an audience.',
        locale: 'vi',
        text: 'diễn tập',
      },
    ],
    examples: [
      {
        entityId: 'x1',
        headword: 'rehearse',
        partOfSpeech: 'verb',
        exampleEn: 'The choir rehearses every Thursday evening.',
        exampleVi: 'Dàn hợp xướng diễn tập vào mỗi tối thứ Năm.',
      },
    ],
  };
}

describe('auditRecords', () => {
  it('reports nothing for clean content', () => {
    expect(auditRecords(clean())).toEqual([]);
  });

  it('runs the record rules and the corpus rules together', () => {
    const input = clean();
    input.definitions.push({ ...input.definitions[0], entityId: 'd2' });
    input.translations[0].text = 'rehearse';

    const rules = auditRecords(input).map((f) => f.rule);
    expect(rules).toContain('duplicate_definition');
    expect(rules).toContain('headword_echo');
  });

  it('separates critical findings from warnings', () => {
    const input = clean();
    input.definitions[0].definitionEn = 'To rehearse a piece of music with the other players.';
    const findings = auditRecords(input);
    expect(findings.map((f) => f.rule)).toContain('defines_with_headword');
    expect(criticalFindings(findings)).toEqual([]);
  });
});

describe('formatFindings', () => {
  it('puts critical findings first', () => {
    const input = clean();
    input.definitions[0].definitionEn = 'To rehearse.';
    const lines = formatFindings(auditRecords(input));
    expect(lines[0]).toMatch(/critical/);
  });
});

describe('isolation', () => {
  const source = fs.readFileSync(path.resolve(__dirname, 'quality-audit.ts'), 'utf8');
  const modules = [...source.matchAll(/from '([^']+)'/g)].map((m) => m[1]);

  it('opens no legacy connection', () => {
    // The audit reads DSD. A legacy import here would put source wording one
    // refactor away from a rule that could compare against it.
    expect(modules.length).toBeGreaterThan(0);
    for (const module of modules) {
      expect(module).toMatch(/^dotenv$|dsd-corpus/);
    }
    expect(source).not.toMatch(/DB_DATABASE|LEGACY_AUDIT_DATABASE_URL/);
  });

  it('connects with the read-only auditor role', () => {
    expect(source).toMatch(/createDsdDataSource\('audit'/);
    expect(source).not.toMatch(/createDsdDataSource\('curator'/);
  });
});

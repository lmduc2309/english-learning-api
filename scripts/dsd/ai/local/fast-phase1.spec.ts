import * as fs from 'fs';

describe('fast common-first phase', () => {
  const protocol = fs.readFileSync(require.resolve('./protocol'), 'utf8');
  const scorer = fs.readFileSync(require.resolve('./rank-common.py'), 'utf8');
  const pipeline = fs.readFileSync(require.resolve('./fast-phase1'), 'utf8');

  it('uses deterministic local likelihood ranking without generating inventory text', () => {
    expect(scorer).toContain('local_model_headword_likelihood');
    expect(scorer).toContain('mx.logsumexp');
    expect(scorer).toContain('score_file_sha256');
    expect(scorer).toContain('fcntl.LOCK_EX | fcntl.LOCK_NB');
    expect(scorer).toContain('scores_by_id');
  });

  it('binds every batched English and critic result to all input ids', () => {
    expect(protocol).toContain('english_batch output must contain every input entry exactly once');
    expect(protocol).toContain('critic_batch output must contain every input entry exactly once');
    expect(pipeline).toContain("validCompleted(path.join(dir, 'english.requests.jsonl'");
  });

  it('gates a ranked reserve fail-closed before English authoring', () => {
    expect(pipeline).toContain("command === 'prepare-common-gate'");
    expect(pipeline).toContain("validCompleted(path.join(dir, 'gate.requests.jsonl'");
    expect(pipeline).toContain('({ i: index, headword: row.headword })');
    expect(pipeline).toContain('entries.find((candidate) => candidate.i === id)');
    expect(pipeline).toContain('only ${passed.size} gated headwords passed; need ${target}');
    expect(pipeline).toContain("[...passed].sort((a, b) => a - b).slice(0, target)");
    expect(pipeline.indexOf("command === 'materialize-gated'")).toBeLessThan(
      pipeline.indexOf("command === 'prepare-english'"),
    );
  });
});

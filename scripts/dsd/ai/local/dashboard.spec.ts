import * as fs from 'fs';

describe('local corpus dashboard safety', () => {
  const source = fs.readFileSync(require.resolve('./dashboard'), 'utf8');

  it('binds only to localhost and exposes a read-only status route', () => {
    expect(source).toContain("server.listen(PORT, '127.0.0.1'");
    expect(source).toContain("req.url === '/api/status'");
    expect(source).not.toMatch(/writeFile|appendFile|unlink|rmSync|spawn/);
  });

  it('shows every local model stage and the production safety boundary', () => {
    for (const stage of ['inventory', 'inventory_critic', 'english', 'critic', 'translate']) {
      expect(source).toContain(`'${stage}'`);
    }
    expect(source).toContain('production is unchanged');
  });
});

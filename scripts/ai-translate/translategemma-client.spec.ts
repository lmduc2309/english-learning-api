import * as http from 'http';
import { AddressInfo } from 'net';
import { parseDescriptor } from './render-prompt';
import { TranslateGemmaClient } from './translategemma-client';

const descriptor = parseDescriptor(
  {
    sourceLangCode: 'en',
    targetLangCode: 'vi',
    prefix: '<start_of_turn>user\nTRANSLATE en vi: ',
    suffix: '<end_of_turn>\n<start_of_turn>model\n',
  },
  { source: 'en', target: 'vi' },
);

interface Recorded {
  path: string;
  body: any;
}

/** A real llama.cpp-shaped server, so the client is exercised over real HTTP. */
async function startServer(
  handler: (recorded: Recorded, res: http.ServerResponse, callNumber: number) => void,
): Promise<{ url: string; calls: Recorded[]; close: () => Promise<void> }> {
  const calls: Recorded[] = [];

  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => {
      const recorded = { path: req.url || '', body: raw ? JSON.parse(raw) : null };
      calls.push(recorded);
      handler(recorded, res, calls.length);
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;

  return {
    url: `http://127.0.0.1:${port}`,
    calls,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

function respond(res: http.ServerResponse, payload: unknown, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

describe('TranslateGemmaClient', () => {
  let server: Awaited<ReturnType<typeof startServer>> | null = null;

  afterEach(async () => {
    if (server) await server.close();
    server = null;
  });

  it('posts to the raw /completion endpoint, never the chat-completions path', async () => {
    server = await startServer((_r, res) => respond(res, { content: 'một con chó' }));
    const client = new TranslateGemmaClient({ serverUrl: server.url, descriptor });

    await client.translate('A dog.');

    expect(server.calls).toHaveLength(1);
    expect(server.calls[0].path).toBe('/completion');
  });

  it('sends the fully rendered prompt, wrapped in the template', async () => {
    server = await startServer((_r, res) => respond(res, { content: 'một con chó' }));
    const client = new TranslateGemmaClient({ serverUrl: server.url, descriptor });

    await client.translate('A dog.');

    expect(server.calls[0].body.prompt).toBe(
      '<start_of_turn>user\nTRANSLATE en vi: A dog.<end_of_turn>\n<start_of_turn>model\n',
    );
  });

  it('requests greedy decoding so the run is reproducible', async () => {
    server = await startServer((_r, res) => respond(res, { content: 'x' }));
    const client = new TranslateGemmaClient({ serverUrl: server.url, descriptor });

    await client.translate('A dog.');

    expect(server.calls[0].body.temperature).toBe(0);
  });

  it('stops generation at the end-of-turn marker', async () => {
    server = await startServer((_r, res) => respond(res, { content: 'x' }));
    const client = new TranslateGemmaClient({ serverUrl: server.url, descriptor });

    await client.translate('A dog.');

    expect(server.calls[0].body.stop).toContain('<end_of_turn>');
  });

  it('returns the trimmed translation', async () => {
    server = await startServer((_r, res) => respond(res, { content: '  một con chó\n' }));
    const client = new TranslateGemmaClient({ serverUrl: server.url, descriptor });

    const result = await client.translate('A dog.');

    expect(result.text).toBe('một con chó');
  });

  it('retries a server error and returns the eventual success', async () => {
    server = await startServer((_r, res, call) => {
      if (call === 1) return respond(res, { error: 'busy' }, 503);
      respond(res, { content: 'một con chó' });
    });
    const client = new TranslateGemmaClient({
      serverUrl: server.url,
      descriptor,
      retryDelayMs: 1,
    });

    const result = await client.translate('A dog.');

    expect(result.text).toBe('một con chó');
    expect(server.calls).toHaveLength(2);
  });

  it('throws once retries are exhausted rather than returning empty text', async () => {
    server = await startServer((_r, res) => respond(res, { error: 'down' }, 500));
    const client = new TranslateGemmaClient({
      serverUrl: server.url,
      descriptor,
      retries: 2,
      retryDelayMs: 1,
    });

    await expect(client.translate('A dog.')).rejects.toThrow(/500/);
    expect(server.calls).toHaveLength(2);
  });

  it('derives confidence from the mean token logprob', async () => {
    server = await startServer((_r, res) =>
      respond(res, {
        content: 'một con chó',
        completion_probabilities: [{ logprob: -0.2 }, { logprob: -0.4 }],
      }),
    );
    const client = new TranslateGemmaClient({ serverUrl: server.url, descriptor });

    const result = await client.translate('A dog.');

    // exp(mean(-0.2, -0.4)) = exp(-0.3)
    expect(result.confidence).toBeCloseTo(Math.exp(-0.3), 6);
  });

  it('reports null confidence when the runtime omits logprobs', async () => {
    server = await startServer((_r, res) => respond(res, { content: 'một con chó' }));
    const client = new TranslateGemmaClient({ serverUrl: server.url, descriptor });

    const result = await client.translate('A dog.');

    expect(result.confidence).toBeNull();
  });

  // MLX is the other Phase 0 benchmark candidate. It serves the
  // OpenAI-compatible /v1/completions and returns a different response shape.
  describe('against an MLX-style server', () => {
    it('posts to the configured completion path', async () => {
      server = await startServer((_r, res) => respond(res, { choices: [{ text: 'x' }] }));
      const client = new TranslateGemmaClient({
        serverUrl: server.url,
        descriptor,
        completionPath: '/v1/completions',
      });

      await client.translate('A dog.');

      expect(server.calls[0].path).toBe('/v1/completions');
    });

    it('reads the translation out of the OpenAI-shaped response', async () => {
      server = await startServer((_r, res) =>
        respond(res, { choices: [{ text: '  một con chó ' }] }),
      );
      const client = new TranslateGemmaClient({
        serverUrl: server.url,
        descriptor,
        completionPath: '/v1/completions',
      });

      const result = await client.translate('A dog.');

      expect(result.text).toBe('một con chó');
    });

    it('sends max_tokens, which is what the OpenAI-shaped API expects', async () => {
      server = await startServer((_r, res) => respond(res, { choices: [{ text: 'x' }] }));
      const client = new TranslateGemmaClient({
        serverUrl: server.url,
        descriptor,
        completionPath: '/v1/completions',
      });

      await client.translate('A dog.');

      expect(server.calls[0].body.max_tokens).toBeGreaterThan(0);
    });
  });

  it('fails loudly when the response carries no recognisable text field', async () => {
    server = await startServer((_r, res) => respond(res, { unexpected: true }));
    const client = new TranslateGemmaClient({
      serverUrl: server.url,
      descriptor,
      retries: 1,
      retryDelayMs: 1,
    });

    await expect(client.translate('A dog.')).rejects.toThrow(/no translation text/i);
  });
});

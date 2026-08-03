import { Test } from '@nestjs/testing';
import { TtsService } from './tts.service';
import { LocalTtsClient } from './local-tts.client';
import { RedisCacheService } from '../../common/cache/redis-cache.service';

function makeCache() {
  const store = new Map<string, unknown>();
  return {
    store,
    get: jest.fn(async (key: string) => store.get(key) ?? null),
    set: jest.fn(async (key: string, value: unknown) => {
      store.set(key, value);
    }),
  } as unknown as RedisCacheService & { store: Map<string, unknown> };
}

async function buildService(opts: {
  cache?: ReturnType<typeof makeCache>;
  synthesize?: jest.Mock;
} = {}) {
  const cache = opts.cache ?? makeCache();
  const client = {
    synthesize:
      opts.synthesize ??
      jest.fn().mockResolvedValue(Buffer.from([0xff, 0xe3, 0x18])),
  };
  const module = await Test.createTestingModule({
    providers: [
      TtsService,
      { provide: LocalTtsClient, useValue: client },
      { provide: RedisCacheService, useValue: cache },
    ],
  }).compile();
  return { svc: module.get(TtsService), cache, client };
}

describe('TtsService.synthesize', () => {
  it('passes engine + engineVoice from the catalog to the client', async () => {
    const { svc, client } = await buildService();
    await svc.synthesize('Hello.', 'en-guy');
    expect(client.synthesize).toHaveBeenCalledWith({
      engine: 'piper',
      voice: 'en_US-norman-medium',
      text: 'Hello.',
    });
  });

  it('passes Piper voice for English voice ids', async () => {
    const { svc, client } = await buildService();
    await svc.synthesize('Hello.', 'en-aria');
    expect(client.synthesize).toHaveBeenCalledWith({
      engine: 'piper',
      voice: 'en_US-ljspeech-medium',
      text: 'Hello.',
    });
  });

  it('returns MP3 bytes and stores them base64-encoded on cache miss', async () => {
    const { svc, cache } = await buildService();
    const buf = await svc.synthesize('Hello.', 'en-aria');
    expect(buf).toEqual(Buffer.from([0xff, 0xe3, 0x18]));
    const [storedKey, storedValue] = Array.from(cache.store.entries())[0];
    expect(storedKey).toMatch(/^tts:en-aria:[a-f0-9]{64}$/);
    expect(typeof storedValue).toBe('string');
    expect(Buffer.from(storedValue as string, 'base64').equals(buf)).toBe(true);
  });

  it('returns cached bytes without calling the client on cache hit', async () => {
    const cache = makeCache();
    const { svc, client } = await buildService({ cache });
    await svc.synthesize('Hello.', 'en-aria');
    client.synthesize.mockClear();
    const buf = await svc.synthesize('Hello.', 'en-aria');
    expect(buf).toEqual(Buffer.from([0xff, 0xe3, 0x18]));
    expect(client.synthesize).not.toHaveBeenCalled();
  });

  it('throws BAD_REQUEST when voiceId is unknown', async () => {
    const { svc } = await buildService();
    await expect(svc.synthesize('hi', 'bogus' as never)).rejects.toMatchObject({
      status: 400,
    });
  });

  it('throws BAD_REQUEST when text is empty', async () => {
    const { svc } = await buildService();
    await expect(svc.synthesize('', 'en-aria')).rejects.toMatchObject({
      status: 400,
    });
  });

  it('throws BAD_REQUEST when text is whitespace only', async () => {
    const { svc } = await buildService();
    await expect(svc.synthesize('   ', 'en-aria')).rejects.toMatchObject({
      status: 400,
    });
  });

  it('throws BAD_REQUEST when text exceeds 600 characters', async () => {
    const { svc } = await buildService();
    await expect(svc.synthesize('a'.repeat(601), 'en-aria')).rejects.toMatchObject(
      { status: 400 },
    );
  });

  it('passes text unchanged (no implicit trim/normalize)', async () => {
    const { svc, client } = await buildService();
    await svc.synthesize('hello world', 'en-aria');
    expect(client.synthesize).toHaveBeenCalledWith({
      engine: 'piper',
      voice: 'en_US-ljspeech-medium',
      text: 'hello world',
    });
  });

  it('uses 30-day TTL when storing cache entries', async () => {
    const { svc, cache } = await buildService();
    await svc.synthesize('Hello.', 'en-aria');
    expect(cache.set).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.objectContaining({ ttl: 60 * 60 * 24 * 30 }),
    );
  });
});

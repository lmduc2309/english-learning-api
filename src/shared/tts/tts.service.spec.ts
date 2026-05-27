import { Test } from '@nestjs/testing';
import { TtsService } from './tts.service';
import { AzureTtsClient } from './azure-tts.client';
import { RedisCacheService } from '../../common/cache/redis-cache.service';

function makeCache() {
  const store = new Map<string, unknown>();
  return {
    store,
    get: jest.fn(async (key: string) => store.get(key) ?? null),
    set: jest.fn(async (key: string, value: unknown) => { store.set(key, value); }),
  } as unknown as RedisCacheService & { store: Map<string, unknown> };
}

async function buildService(opts: {
  cache?: ReturnType<typeof makeCache>;
  synthesize?: jest.Mock;
} = {}) {
  const cache = opts.cache ?? makeCache();
  const azureClient = { synthesize: opts.synthesize ?? jest.fn().mockResolvedValue(Buffer.from([0xff, 0xe3, 0x18])) };
  const module = await Test.createTestingModule({
    providers: [
      TtsService,
      { provide: AzureTtsClient, useValue: azureClient },
      { provide: RedisCacheService, useValue: cache },
    ],
  }).compile();
  return { svc: module.get(TtsService), cache, azureClient };
}

describe('TtsService.synthesize', () => {
  it('returns Azure bytes and stores them base64-encoded on cache miss', async () => {
    const { svc, cache, azureClient } = await buildService();
    const buf = await svc.synthesize('Xin chào.', 'vi-hoaimi');
    expect(buf).toEqual(Buffer.from([0xff, 0xe3, 0x18]));
    expect(azureClient.synthesize).toHaveBeenCalledWith('Xin chào.', 'vi-VN-HoaiMyNeural', 'vi-VN');
    const [storedKey, storedValue] = Array.from(cache.store.entries())[0];
    expect(storedKey).toMatch(/^tts:vi-hoaimi:[a-f0-9]{64}$/);
    expect(typeof storedValue).toBe('string');
    expect(Buffer.from(storedValue as string, 'base64').equals(buf)).toBe(true);
  });

  it('returns cached bytes without calling Azure on cache hit', async () => {
    const cache = makeCache();
    const { svc, azureClient } = await buildService({ cache });
    await svc.synthesize('Xin chào.', 'vi-hoaimi'); // populate
    azureClient.synthesize.mockClear();
    const buf = await svc.synthesize('Xin chào.', 'vi-hoaimi');
    expect(buf).toEqual(Buffer.from([0xff, 0xe3, 0x18]));
    expect(azureClient.synthesize).not.toHaveBeenCalled();
  });

  it('throws BAD_REQUEST when voiceId is unknown', async () => {
    const { svc } = await buildService();
    await expect(svc.synthesize('hi', 'bogus' as never)).rejects.toMatchObject({ status: 400 });
  });

  it('throws BAD_REQUEST when text is empty', async () => {
    const { svc } = await buildService();
    await expect(svc.synthesize('', 'vi-hoaimi')).rejects.toMatchObject({ status: 400 });
  });

  it('throws BAD_REQUEST when text exceeds 600 characters', async () => {
    const { svc } = await buildService();
    await expect(svc.synthesize('a'.repeat(601), 'vi-hoaimi')).rejects.toMatchObject({ status: 400 });
  });

  it('uses 30-day TTL when storing cache entries', async () => {
    const { svc, cache } = await buildService();
    await svc.synthesize('Xin chào.', 'vi-hoaimi');
    expect(cache.set).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.objectContaining({ ttl: 60 * 60 * 24 * 30 }),
    );
  });
});

import { LocalTtsClient, LocalTtsError } from './local-tts.client';
import { ConfigService } from '@nestjs/config';

function fakeConfig(url = 'http://localhost:8001'): ConfigService {
  return {
    get: jest.fn((path: string) =>
      path === 'ttsService' ? { url } : undefined,
    ),
  } as unknown as ConfigService;
}

describe('LocalTtsClient', () => {
  const ORIGINAL_FETCH = global.fetch;
  afterEach(() => {
    global.fetch = ORIGINAL_FETCH;
    jest.restoreAllMocks();
  });

  it('POSTs to /synth with engine, voice, text and returns the MP3 buffer', async () => {
    const mp3 = new Uint8Array([0xff, 0xe3, 0x18, 0x00]);
    const fetchMock = jest.fn().mockResolvedValue(
      new Response(mp3, { status: 200, headers: { 'content-type': 'audio/mpeg' } }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;
    const client = new LocalTtsClient(fakeConfig());
    const buf = await client.synthesize({
      engine: 'piper',
      voice: 'en_US-ryan-medium',
      text: 'Hello.',
    });
    expect(buf).toBeInstanceOf(Buffer);
    expect(buf.equals(Buffer.from(mp3))).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://localhost:8001/synth');
    expect(init.method).toBe('POST');
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(init.body)).toEqual({
      engine: 'piper',
      voice: 'en_US-ryan-medium',
      text: 'Hello.',
    });
  });

  it('throws LocalTtsError on non-200', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      new Response(JSON.stringify({ detail: 'engine_failed:RuntimeError' }), {
        status: 503,
      }),
    ) as unknown as typeof fetch;
    const client = new LocalTtsClient(fakeConfig());
    await expect(
      client.synthesize({ engine: 'piper', voice: 'en_US-ryan-medium', text: 'hi' }),
    ).rejects.toMatchObject({ name: 'LocalTtsError', status: 503 });
  });

  it('throws LocalTtsError 503 when fetch is aborted (timeout)', async () => {
    global.fetch = jest.fn().mockImplementation(() => {
      const err = new Error('aborted');
      err.name = 'AbortError';
      return Promise.reject(err);
    }) as unknown as typeof fetch;
    const client = new LocalTtsClient(fakeConfig());
    await expect(
      client.synthesize({ engine: 'piper', voice: 'en_US-ryan-medium', text: 'hi' }),
    ).rejects.toMatchObject({
      name: 'LocalTtsError',
      status: 503,
      message: expect.stringMatching(/timeout/i),
    });
  });

  it('throws LocalTtsError 503 when fetch rejects with a non-abort error', async () => {
    global.fetch = jest.fn().mockRejectedValue(
      Object.assign(new Error('ECONNREFUSED'), { name: 'TypeError' }),
    ) as unknown as typeof fetch;
    const client = new LocalTtsClient(fakeConfig());
    await expect(
      client.synthesize({ engine: 'piper', voice: 'en_US-ryan-medium', text: 'hi' }),
    ).rejects.toMatchObject({
      name: 'LocalTtsError',
      status: 503,
      message: expect.stringMatching(/network|ECONNREFUSED/),
    });
  });
});

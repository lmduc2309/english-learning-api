import { AzureTtsClient, AzureTtsError } from './azure-tts.client';
import { ConfigService } from '@nestjs/config';

function fakeConfig(overrides: Partial<{ key: string; region: string }> = {}): ConfigService {
  const azureTts = { key: 'fake-key', region: 'southeastasia', ...overrides };
  return { get: jest.fn((path: string) => (path === 'azureTts' ? azureTts : undefined)) } as unknown as ConfigService;
}

describe('AzureTtsClient', () => {
  const ORIGINAL_FETCH = global.fetch;
  afterEach(() => {
    global.fetch = ORIGINAL_FETCH;
    jest.restoreAllMocks();
  });

  it('posts SSML with correct headers and body', async () => {
    const fetchMock = jest.fn().mockResolvedValue(
      new Response(new Uint8Array([0xff, 0xe3]), { status: 200, headers: { 'content-type': 'audio/mpeg' } }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    const client = new AzureTtsClient(fakeConfig());
    const buf = await client.synthesize('Xin chào.', 'vi-VN-HoaiMyNeural', 'vi-VN');

    expect(buf).toBeInstanceOf(Buffer);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://southeastasia.tts.speech.microsoft.com/cognitiveservices/v1');
    expect(init.method).toBe('POST');
    expect(init.headers['Ocp-Apim-Subscription-Key']).toBe('fake-key');
    expect(init.headers['X-Microsoft-OutputFormat']).toBe('audio-24khz-48kbitrate-mono-mp3');
    expect(init.headers['Content-Type']).toBe('application/ssml+xml');
    expect(init.body).toContain('<speak version="1.0" xml:lang="vi-VN">');
    expect(init.body).toContain('<voice name="vi-VN-HoaiMyNeural">Xin chào.</voice>');
  });

  it('XML-escapes special characters in text', async () => {
    const fetchMock = jest.fn().mockResolvedValue(
      new Response(new Uint8Array([0x00]), { status: 200 }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;
    const client = new AzureTtsClient(fakeConfig());
    await client.synthesize('Cats & dogs <fast> "quote" \'apos\'', 'en-US-AriaNeural', 'en-US');
    const body = fetchMock.mock.calls[0][1].body as string;
    expect(body).toContain('Cats &amp; dogs &lt;fast&gt; &quot;quote&quot; &apos;apos&apos;');
    expect(body).not.toContain('Cats & dogs <fast>');
  });

  it('throws AzureTtsError with status 401 when Azure rejects the key', async () => {
    global.fetch = jest.fn().mockResolvedValue(new Response('Unauthorized', { status: 401 })) as unknown as typeof fetch;
    const client = new AzureTtsClient(fakeConfig());
    await expect(client.synthesize('hi', 'en-US-AriaNeural', 'en-US')).rejects.toMatchObject({
      name: 'AzureTtsError',
      status: 401,
    });
  });

  it('throws AzureTtsError with retryAfter on 429', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      new Response('rate limited', { status: 429, headers: { 'Retry-After': '7' } }),
    ) as unknown as typeof fetch;
    const client = new AzureTtsClient(fakeConfig());
    await expect(client.synthesize('hi', 'en-US-AriaNeural', 'en-US')).rejects.toMatchObject({
      name: 'AzureTtsError',
      status: 429,
      retryAfter: 7,
    });
  });

  it('throws AzureTtsError on 5xx', async () => {
    global.fetch = jest.fn().mockResolvedValue(new Response('boom', { status: 503 })) as unknown as typeof fetch;
    const client = new AzureTtsClient(fakeConfig());
    await expect(client.synthesize('hi', 'en-US-AriaNeural', 'en-US')).rejects.toMatchObject({
      name: 'AzureTtsError',
      status: 503,
    });
  });

  it('throws AzureTtsError when AZURE_SPEECH_KEY is missing', async () => {
    const client = new AzureTtsClient(fakeConfig({ key: '' }));
    await expect(client.synthesize('hi', 'en-US-AriaNeural', 'en-US')).rejects.toMatchObject({
      name: 'AzureTtsError',
      status: 503,
    });
  });

  it('throws AzureTtsError 503 when fetch is aborted (timeout)', async () => {
    global.fetch = jest.fn().mockImplementation(() => {
      const err = new Error('aborted');
      err.name = 'AbortError';
      return Promise.reject(err);
    }) as unknown as typeof fetch;
    const client = new AzureTtsClient(fakeConfig());
    await expect(client.synthesize('hi', 'en-US-AriaNeural', 'en-US')).rejects.toMatchObject({
      name: 'AzureTtsError',
      status: 503,
      message: expect.stringMatching(/timeout/i),
    });
  });

  it('throws AzureTtsError 503 when fetch rejects with a non-abort error', async () => {
    global.fetch = jest.fn().mockRejectedValue(
      Object.assign(new Error('ECONNREFUSED'), { name: 'TypeError' }),
    ) as unknown as typeof fetch;
    const client = new AzureTtsClient(fakeConfig());
    await expect(client.synthesize('hi', 'en-US-AriaNeural', 'en-US')).rejects.toMatchObject({
      name: 'AzureTtsError',
      status: 503,
      message: expect.stringMatching(/network|ECONNREFUSED/),
    });
  });
});

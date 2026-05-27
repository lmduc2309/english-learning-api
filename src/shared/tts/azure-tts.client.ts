import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export class AzureTtsError extends Error {
  name = 'AzureTtsError';
  constructor(public status: number, message: string, public retryAfter?: number) {
    super(message);
  }
}

const OUTPUT_FORMAT = 'audio-24khz-48kbitrate-mono-mp3';
const TIMEOUT_MS = 10_000;

function escapeXml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

@Injectable()
export class AzureTtsClient {
  private readonly logger = new Logger(AzureTtsClient.name);

  constructor(private readonly config: ConfigService) {}

  async synthesize(text: string, azureName: string, language: string): Promise<Buffer> {
    const { key, region } = this.config.get<{ key: string; region: string }>('azureTts') ?? { key: '', region: '' };
    if (!key) {
      this.logger.error('AZURE_SPEECH_KEY not set');
      throw new AzureTtsError(503, 'TTS not configured');
    }

    const url = `https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`;
    const ssml = `<speak version="1.0" xml:lang="${escapeXml(language)}"><voice name="${escapeXml(azureName)}">${escapeXml(text)}</voice></speak>`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: {
          'Ocp-Apim-Subscription-Key': key,
          'X-Microsoft-OutputFormat': OUTPUT_FORMAT,
          'Content-Type': 'application/ssml+xml',
        },
        body: ssml,
        signal: controller.signal,
      });
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        throw new AzureTtsError(503, 'Azure TTS timeout');
      }
      throw new AzureTtsError(503, `Azure TTS network error: ${err?.message ?? 'unknown'}`);
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        this.logger.error(`Azure rejected request (${res.status}) — check AZURE_SPEECH_KEY`);
        throw new AzureTtsError(res.status, 'Azure authentication failed');
      }
      if (res.status === 429) {
        const raw = res.headers.get('Retry-After');
        const retryAfter = raw !== null && !Number.isNaN(Number(raw)) ? Number(raw) : undefined;
        throw new AzureTtsError(429, 'Azure rate limited', retryAfter);
      }
      throw new AzureTtsError(res.status, `Azure TTS failed: ${res.status}`);
    }

    const arr = await res.arrayBuffer();
    return Buffer.from(arr);
  }
}

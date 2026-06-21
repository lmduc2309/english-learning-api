import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export class LocalTtsError extends Error {
  name = 'LocalTtsError';
  constructor(public status: number, message: string) {
    super(message);
  }
}

export interface SynthesizeOptions {
  engine: 'piper';
  voice: string;
  text: string;
}

const TIMEOUT_MS = 10_000;

@Injectable()
export class LocalTtsClient {
  private readonly logger = new Logger(LocalTtsClient.name);

  constructor(private readonly config: ConfigService) {}

  async synthesize(opts: SynthesizeOptions): Promise<Buffer> {
    const { url } = this.config.get<{ url: string }>('ttsService') ?? { url: '' };
    if (!url) {
      this.logger.error('TTS_SERVICE_URL not set');
      throw new LocalTtsError(503, 'TTS service not configured');
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(`${url}/synth`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(opts),
        signal: controller.signal,
      });
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        throw new LocalTtsError(503, 'TTS service timeout');
      }
      throw new LocalTtsError(
        503,
        `TTS service network error: ${err?.message ?? 'unknown'}`,
      );
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      let detail = `status ${res.status}`;
      try {
        const body = (await res.json()) as { detail?: string };
        if (body?.detail) detail = body.detail;
      } catch {
        // body wasn't JSON; keep status-only message
      }
      throw new LocalTtsError(res.status, detail);
    }

    const arr = await res.arrayBuffer();
    return Buffer.from(arr);
  }
}

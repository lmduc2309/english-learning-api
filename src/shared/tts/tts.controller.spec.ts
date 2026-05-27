import { Test } from '@nestjs/testing';
import { TtsController } from './tts.controller';
import { TtsService } from './tts.service';
import { AzureTtsError } from './azure-tts.client';
import { Response } from 'express';

function fakeRes(): Response & { _data?: Buffer; _status?: number; _headers: Record<string, string> } {
  const res: any = { _headers: {} };
  res.setHeader = (k: string, v: string) => { res._headers[k] = v; };
  res.status = (s: number) => { res._status = s; return res; };
  res.send = (data: Buffer) => { res._data = data; return res; };
  res.end = res.send;
  return res;
}

async function buildController(svcOverrides: Partial<TtsService> = {}) {
  const svc = { synthesize: jest.fn(), ...svcOverrides } as unknown as TtsService;
  const module = await Test.createTestingModule({
    controllers: [TtsController],
    providers: [{ provide: TtsService, useValue: svc }],
  }).compile();
  return { ctrl: module.get(TtsController), svc };
}

describe('TtsController', () => {
  it('GET /tts/voices returns public catalog (no azureName field)', async () => {
    const { ctrl } = await buildController();
    const voices = ctrl.voices();
    expect(voices.length).toBeGreaterThan(0);
    for (const v of voices) {
      expect(v).not.toHaveProperty('azureName');
      expect(v).toEqual(expect.objectContaining({ id: expect.any(String), label: expect.any(String) }));
    }
  });

  it('POST /tts streams audio/mpeg bytes from the service', async () => {
    const mp3 = Buffer.from([0xff, 0xe3, 0x18, 0x00]);
    const { ctrl, svc } = await buildController({ synthesize: jest.fn().mockResolvedValue(mp3) });
    const res = fakeRes();
    await ctrl.synth({ text: 'Xin chào.', voiceId: 'vi-hoaimi' }, res);
    expect(svc.synthesize).toHaveBeenCalledWith('Xin chào.', 'vi-hoaimi');
    expect(res._headers['Content-Type']).toBe('audio/mpeg');
    expect(res._data?.equals(mp3)).toBe(true);
  });

  it('POST /tts maps AzureTtsError 503 to 503 response', async () => {
    const { ctrl } = await buildController({
      synthesize: jest.fn().mockRejectedValue(new AzureTtsError(503, 'Azure timeout')),
    });
    const res = fakeRes();
    await ctrl.synth({ text: 'hi', voiceId: 'vi-hoaimi' }, res);
    expect(res._status).toBe(503);
  });

  it('POST /tts propagates Retry-After when AzureTtsError has retryAfter', async () => {
    const { ctrl } = await buildController({
      synthesize: jest.fn().mockRejectedValue(new AzureTtsError(429, 'rate limited', 7)),
    });
    const res = fakeRes();
    await ctrl.synth({ text: 'hi', voiceId: 'vi-hoaimi' }, res);
    expect(res._status).toBe(503);
    expect(res._headers['Retry-After']).toBe('7');
  });

  it('POST /tts re-throws BadRequestException so Nest filter handles it', async () => {
    const { BadRequestException } = await import('@nestjs/common');
    const { ctrl } = await buildController({
      synthesize: jest.fn().mockRejectedValue(new BadRequestException('text must not be empty')),
    });
    const res = fakeRes();
    await expect(ctrl.synth({ text: '', voiceId: 'vi-hoaimi' }, res)).rejects.toBeInstanceOf(BadRequestException);
    expect(res._status).toBeUndefined(); // controller didn't write a response
  });
});

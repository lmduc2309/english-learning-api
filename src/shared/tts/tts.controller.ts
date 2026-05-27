import { Body, Controller, Get, Post, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { TtsService } from './tts.service';
import { publicCatalog } from './voice-catalog';
import { AzureTtsError } from './azure-tts.client';

interface SynthBody {
  text: string;
  voiceId: string;
}

@Controller('tts')
@UseGuards(JwtAuthGuard)
export class TtsController {
  constructor(private readonly svc: TtsService) {}

  @Get('voices')
  voices() {
    return publicCatalog();
  }

  @Post()
  async synth(@Body() body: SynthBody, @Res() res: Response): Promise<void> {
    try {
      const mp3 = await this.svc.synthesize(body?.text, body?.voiceId);
      res.setHeader('Content-Type', 'audio/mpeg');
      res.setHeader('Content-Length', String(mp3.length));
      res.status(200).send(mp3);
    } catch (err: any) {
      if (err instanceof AzureTtsError) {
        if (err.retryAfter !== undefined) res.setHeader('Retry-After', String(err.retryAfter));
        res.status(503).send({ message: err.message });
        return;
      }
      // BadRequestException (from validation) bubbles via re-throw so Nest handles it
      throw err;
    }
  }
}

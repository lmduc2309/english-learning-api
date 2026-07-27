import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { StartSessionDto } from './dto/start-session.dto';
import { StartSessionResponseDto } from './dto/start-session.response.dto';
import { SubmitAttemptDto } from './dto/submit-attempt.dto';
import { SubmitAttemptResponseDto } from './dto/submit-attempt.response.dto';
import { FinishSessionResponseDto } from './dto/finish-session.response.dto';
import { VerbalMappingService } from './verbal-mapping.service';

@Controller('verbal-mapping')
@UseGuards(JwtAuthGuard)
export class VerbalMappingController {
  constructor(private readonly svc: VerbalMappingService) {}

  @Post('sessions')
  startSession(
    @Request() req,
    @Body() dto: StartSessionDto,
  ): Promise<StartSessionResponseDto> {
    return this.svc.startSession(req.user.userId, dto);
  }

  @Post('sessions/:id/attempts')
  submitAttempt(
    @Request() req,
    @Param('id', ParseUUIDPipe) sessionId: string,
    @Body() dto: SubmitAttemptDto,
  ): Promise<SubmitAttemptResponseDto> {
    return this.svc.submitAttempt(req.user.userId, sessionId, dto);
  }

  @Post('sessions/:id/finish')
  finish(
    @Request() req,
    @Param('id', ParseUUIDPipe) sessionId: string,
  ): Promise<FinishSessionResponseDto> {
    return this.svc.finish(req.user.userId, sessionId);
  }

  @Get('sessions/:id/summary')
  summary(
    @Request() req,
    @Param('id', ParseUUIDPipe) sessionId: string,
  ): Promise<FinishSessionResponseDto> {
    return this.svc.getSummary(req.user.userId, sessionId);
  }
}

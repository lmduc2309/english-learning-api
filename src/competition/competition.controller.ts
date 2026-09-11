import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import {
  CreateCompetitionRoomDto,
  JoinCompetitionRoomDto,
  PlayerCredentialsDto,
  StartCompetitionDto,
  SubmitCompetitionAnswerDto,
  UseCompetitionHintDto,
} from './dto/competition.dto';
import { CompetitionService } from './competition.service';

@Controller('serious/competition')
export class CompetitionController {
  constructor(private readonly competition: CompetitionService) {}

  @Post('rooms')
  create(@Body() dto: CreateCompetitionRoomDto) {
    return this.competition.createRoom(dto);
  }

  @Post('rooms/:code/join')
  join(@Param('code') code: string, @Body() dto: JoinCompetitionRoomDto) {
    return this.competition.joinRoom(code, dto);
  }

  @Get('rooms/:code')
  snapshot(
    @Param('code') code: string,
    @Query('playerId') playerId: string,
    @Query('playerToken') playerToken: string,
  ) {
    return this.competition.getSnapshot(code, { playerId, playerToken });
  }

  @Post('rooms/:code/start')
  start(@Param('code') code: string, @Body() dto: StartCompetitionDto) {
    return this.competition.startRoom(code, dto);
  }

  @Post('rooms/:code/hint')
  hint(@Param('code') code: string, @Body() dto: UseCompetitionHintDto) {
    return this.competition.useHint(code, dto);
  }

  @Post('rooms/:code/answers')
  answer(@Param('code') code: string, @Body() dto: SubmitCompetitionAnswerDto) {
    return this.competition.submitAnswer(code, dto);
  }
}

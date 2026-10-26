import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { CreateWordsfallRoomDto, JoinWordsfallRoomDto, StartWordsfallRoomDto, SubmitWordsfallAnswerDto } from './dto/wordsfall.dto';
import { WordsfallService } from './wordsfall.service';

@Controller('serious/wordsfall/rooms')
export class WordsfallController {
  constructor(private readonly wordsfall: WordsfallService) {}

  @Post()
  create(@Body() dto: CreateWordsfallRoomDto) { return this.wordsfall.create(dto); }

  @Post(':code/join')
  join(@Param('code') code: string, @Body() dto: JoinWordsfallRoomDto) { return this.wordsfall.join(code, dto); }

  @Get(':code')
  snapshot(@Param('code') code: string, @Query('playerId') playerId: string, @Query('playerToken') playerToken: string) {
    return this.wordsfall.snapshot(code, { playerId, playerToken });
  }

  @Post(':code/start')
  start(@Param('code') code: string, @Body() dto: StartWordsfallRoomDto) { return this.wordsfall.start(code, dto); }

  @Post(':code/answers')
  answer(@Param('code') code: string, @Body() dto: SubmitWordsfallAnswerDto) { return this.wordsfall.answer(code, dto); }
}

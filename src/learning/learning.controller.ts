import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Request, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RateReviewDto } from './dto/rate-review.dto';
import { LearningService } from './learning.service';

@Controller('serious')
@UseGuards(JwtAuthGuard)
export class LearningController {
  constructor(private service: LearningService) {}
  @Get('history') history(@Request() req) { return this.service.history(req.user.userId); }
  @Post('history') record(@Request() req, @Body() body) { return this.service.recordHistory(req.user.userId, body); }
  @Post('history/import') import(@Request() req, @Body() body: { items: any[] }) { return this.service.importHistory(req.user.userId, body.items || []); }
  @Delete('history') clear(@Request() req) { return this.service.clearHistory(req.user.userId); }
  @Get('word-folders') folders(@Request() req) { return this.service.folders(req.user.userId); }
  @Post('word-folders') createFolder(@Request() req, @Body() body: { name: string; color?: string }) { return this.service.createFolder(req.user.userId, body.name, body.color); }
  @Patch('word-folders/:id') updateFolder(@Request() req, @Param('id') id: string, @Body() body) { return this.service.updateFolder(req.user.userId, id, body); }
  @Delete('word-folders/:id') removeFolder(@Request() req, @Param('id') id: string) { return this.service.removeFolder(req.user.userId, id); }
  @Put('word-folders/:folderId/words/:wordId') add(@Request() req, @Param('folderId') folderId: string, @Param('wordId') wordId: string) { return this.service.setMembership(req.user.userId, folderId, wordId, true); }
  @Delete('word-folders/:folderId/words/:wordId') remove(@Request() req, @Param('folderId') folderId: string, @Param('wordId') wordId: string) { return this.service.setMembership(req.user.userId, folderId, wordId, false); }
  @Get('review/due') due(@Request() req) { return this.service.due(req.user.userId); }
  @Post('review/:wordId/rating') rate(@Request() req, @Param('wordId') id: string, @Body() body: RateReviewDto) { return this.service.rate(req.user.userId, id, body.rating); }
  @Post('learning/sync') sync(@Request() req, @Body() body) { return this.service.sync(req.user.userId, body); }
}

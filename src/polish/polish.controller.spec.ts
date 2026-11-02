import { BadRequestException, ParseUUIDPipe, ValidationPipe } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PolishRequestDto } from './dto/polish-request.dto';
import { PolishOwnerGuard } from './polish-owner.guard';
import { PolishController } from './polish.controller';

describe('PolishController', () => {
  const service = {
    polish: jest.fn().mockResolvedValue({ tone: 'neutral', finalText: 'x', corrections: [] }),
    saveSession: jest.fn().mockResolvedValue({ id: 's1' }),
    listSessions: jest.fn().mockResolvedValue([]),
    deleteSession: jest.fn().mockResolvedValue(undefined),
    savePhrase: jest.fn().mockResolvedValue({ id: 'p1' }),
    listPhrases: jest.fn().mockResolvedValue([]),
    updatePhrase: jest.fn().mockResolvedValue({ id: 'p1' }),
    deletePhrase: jest.fn().mockResolvedValue(undefined),
    notebook: jest.fn().mockResolvedValue({ patterns: [] }),
  };
  const controller = new PolishController(service as any);
  const req = { user: { userId: 'u1', email: 'a@b.c', role: 'user' } };
  const pipe = new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true });

  beforeEach(() => jest.clearAllMocks());

  it('is protected by JwtAuthGuard then PolishOwnerGuard', () => {
    expect(Reflect.getMetadata('__guards__', PolishController)).toEqual([
      JwtAuthGuard,
      PolishOwnerGuard,
    ]);
  });

  it('access returns allowed', () => {
    expect(controller.access()).toEqual({ allowed: true });
  });

  it('polish delegates text and tone', async () => {
    await controller.polish({ text: 'hello', tone: 'formal' });
    expect(service.polish).toHaveBeenCalledWith('hello', 'formal');
  });

  it('polish body with 3001 chars is rejected with 400 naming text', async () => {
    const err: any = await pipe
      .transform(
        { text: 'a'.repeat(3001), tone: 'neutral' },
        { type: 'body', metatype: PolishRequestDto },
      )
      .catch((e) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect(JSON.stringify(err.getResponse().message)).toMatch(/text/);
    expect(JSON.stringify(err.getResponse().message)).not.toMatch(/tone/);
  });

  it('polish body with exactly 3000 chars passes validation', async () => {
    const dto = await pipe.transform(
      { text: 'a'.repeat(3000), tone: 'neutral' },
      { type: 'body', metatype: PolishRequestDto },
    );
    expect(dto.text).toHaveLength(3000);
  });

  it('id params reject malformed uuids with 400', async () => {
    const uuidPipe = new ParseUUIDPipe();
    await expect(
      uuidPipe.transform('not-a-uuid', { type: 'param', data: 'id' }),
    ).rejects.toThrow(BadRequestException);
    const params = Reflect.getMetadata(
      '__routeArguments__',
      PolishController,
      'deleteSession',
    );
    expect(Object.values<any>(params).some((a) => a.pipes?.includes(ParseUUIDPipe))).toBe(true);
  });

  it('polish body text is trimmed', async () => {
    const dto = await pipe.transform(
      { text: '  hi  ', tone: 'neutral' },
      { type: 'body', metatype: PolishRequestDto },
    );
    expect(dto.text).toBe('hi');
  });

  it('session routes delegate with the user id', async () => {
    const dto = { sourceApp: 'Slack' } as any;
    await expect(controller.saveSession(req, dto)).resolves.toEqual({ id: 's1' });
    expect(service.saveSession).toHaveBeenCalledWith('u1', dto);
    await controller.listSessions(req);
    expect(service.listSessions).toHaveBeenCalledWith('u1');
    await controller.deleteSession(req, 's1');
    expect(service.deleteSession).toHaveBeenCalledWith('u1', 's1');
  });

  it('phrase routes delegate with the user id', async () => {
    const dto = { text: 't' } as any;
    await controller.savePhrase(req, dto);
    expect(service.savePhrase).toHaveBeenCalledWith('u1', dto);
    await controller.listPhrases(req);
    expect(service.listPhrases).toHaveBeenCalledWith('u1');
    const upd = { situationCode: 'x' } as any;
    await controller.updatePhrase(req, 'p1', upd);
    expect(service.updatePhrase).toHaveBeenCalledWith('u1', 'p1', upd);
    await controller.deletePhrase(req, 'p1');
    expect(service.deletePhrase).toHaveBeenCalledWith('u1', 'p1');
  });

  it('notebook delegates with the user id', async () => {
    await controller.notebook(req);
    expect(service.notebook).toHaveBeenCalledWith('u1');
  });
});

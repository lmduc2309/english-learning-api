import { BadGatewayException, HttpException, NotFoundException } from '@nestjs/common';
import { validate } from 'class-validator';
import { UpdatePhraseDto } from './dto/update-phrase.dto';
import { LlmService } from '../llm/llm.service';
import { PolishService } from './polish.service';
import { PolishSession } from './entities/polish-session.entity';
import { SavePhraseDto } from './dto/save-phrase.dto';

function repository(overrides: Record<string, unknown> = {}) {
  return {
    find: jest.fn().mockResolvedValue([]),
    findOne: jest.fn().mockResolvedValue(null),
    save: jest.fn(async (value) => value),
    create: jest.fn((value) => value),
    delete: jest.fn().mockResolvedValue({ affected: 1 }),
    ...overrides,
  };
}

const ok = (finalText: string, corrections: unknown[] = []) =>
  JSON.stringify({ finalText, corrections });

function setup(...responses: Array<string | Error>) {
  const completeOwnerTool = jest.fn();
  for (const r of responses) {
    if (r instanceof Error) completeOwnerTool.mockRejectedValueOnce(r);
    else completeOwnerTool.mockResolvedValueOnce(r);
  }
  const service = new PolishService(
    { completeOwnerTool } as unknown as LlmService,
    repository() as never,
    repository() as never,
    repository() as never,
  );
  return { service, completeOwnerTool };
}

describe('PolishService.polish', () => {
  it('returns a result with the tone echoed', async () => {
    const { service, completeOwnerTool } = setup(
      ok('I went home.', [
        {
          kind: 'grammar',
          patternCode: 'other',
          wrong: 'I goed home.',
          right: 'I went home.',
          explanationVi: 'Dong tu bat quy tac',
          minor: false,
        },
      ]),
    );
    const res = await service.polish('I goed home.', 'casual');
    expect(res.tone).toBe('casual');
    expect(res.finalText).toBe('I went home.');
    expect(res.corrections).toHaveLength(1);
    expect(completeOwnerTool).toHaveBeenCalledWith(expect.any(Array), {
      temperature: 0.3,
      timeoutMs: 25000,
    });
  });

  it('retries once after a non-JSON response', async () => {
    const { service, completeOwnerTool } = setup('not json', ok('Hello.'));
    const res = await service.polish('Hello.', 'neutral');
    expect(res.finalText).toBe('Hello.');
    expect(completeOwnerTool).toHaveBeenCalledTimes(2);
    const second = completeOwnerTool.mock.calls[1][0] as Array<{ role: string }>;
    expect(second.filter((m) => m.role === 'system')).toHaveLength(2);
  });

  it('throws BadGatewayException after two invalid responses', async () => {
    const { service, completeOwnerTool } = setup('nope', 'still nope');
    await expect(service.polish('Hello.', 'neutral')).rejects.toBeInstanceOf(
      BadGatewayException,
    );
    expect(completeOwnerTool).toHaveBeenCalledTimes(2);
  });

  it('retries with a note naming a dropped protected token, then 502', async () => {
    const draft = 'We release v2.3 on 14/11';
    const { service, completeOwnerTool } = setup(
      ok('We release v2.3 next week'),
      ok('We release v2.3 soon'),
    );
    await expect(service.polish(draft, 'neutral')).rejects.toBeInstanceOf(
      BadGatewayException,
    );
    expect(completeOwnerTool).toHaveBeenCalledTimes(2);
    const second = completeOwnerTool.mock.calls[1][0] as Array<{
      role: string;
      content: string;
    }>;
    expect(second.some((m) => m.role === 'system' && m.content.includes('14/11'))).toBe(true);
  });

  it('succeeds when the retry restores the protected token', async () => {
    const draft = 'We release v2.3 on 14/11';
    const { service } = setup(ok('We release v2.3 soon'), ok('We ship v2.3 on 14/11'));
    const res = await service.polish(draft, 'neutral');
    expect(res.finalText).toBe('We ship v2.3 on 14/11');
  });

  it('keeps a perfect draft unchanged', async () => {
    const draft = 'Thanks for your help.';
    const { service } = setup(ok(draft));
    const res = await service.polish(draft, 'neutral');
    expect(res.finalText).toBe(draft);
    expect(res.corrections).toEqual([]);
  });

  it('propagates a 503 from the LLM unchanged', async () => {
    const err = new HttpException('LLM service is disabled', 503);
    const { service, completeOwnerTool } = setup(err);
    await expect(service.polish('Hello.', 'neutral')).rejects.toBe(err);
    expect(completeOwnerTool).toHaveBeenCalledTimes(1);
  });
});

const USER = '11111111-1111-1111-1111-111111111111';

function dataSetup(llmResponse?: string | Error) {
  const completeOwnerTool = jest.fn();
  if (llmResponse instanceof Error) completeOwnerTool.mockRejectedValue(llmResponse);
  else if (llmResponse !== undefined) completeOwnerTool.mockResolvedValue(llmResponse);
  const sessions = repository({
    save: jest.fn(async (v) => ({ id: 'sess-1', ...v })),
  });
  const corrections = repository();
  const em = {
    getRepository: jest.fn((entity) => (entity === PolishSession ? sessions : corrections)),
  };
  Object.assign(sessions, { manager: { transaction: jest.fn(async (fn) => fn(em)) } });
  const phrases = repository({
    save: jest.fn(async (v) => ({ id: 'ph-1', createdAt: new Date('2026-11-01'), ...v })),
  });
  const service = new PolishService(
    { completeOwnerTool } as unknown as LlmService,
    sessions as never,
    corrections as never,
    phrases as never,
  );
  return { service, sessions, corrections, phrases, completeOwnerTool };
}

describe('PolishService sessions', () => {
  it('stores the session and corrections, recomputing kind from the catalog', async () => {
    const { service, sessions, corrections } = dataSetup();
    const res = await service.saveSession(USER, {
      sourceApp: 'Slack',
      tone: 'neutral',
      rawText: 'I goed',
      editedText: 'I went',
      corrections: [
        { kind: 'tone', patternCode: 'verb_tense', wrong: 'goed', right: 'went', explanationVi: 'x', minor: false },
        { kind: 'grammar', patternCode: 'made_up', wrong: 'a', right: 'b', explanationVi: 'y', minor: true },
      ],
    });
    expect(res).toEqual({ id: 'sess-1' });
    expect(sessions.save).toHaveBeenCalledWith(expect.objectContaining({ userId: USER, sourceApp: 'Slack' }));
    const rows = corrections.save.mock.calls[0][0];
    expect(rows[0]).toMatchObject({ sessionId: 'sess-1', kind: 'grammar', patternCode: 'verb_tense', wrongText: 'goed', rightText: 'went' });
    expect(rows[1]).toMatchObject({ patternCode: 'other', minor: true });
    expect((sessions as any).manager.transaction).toHaveBeenCalledTimes(1);
  });

  it('propagates a correction write failure out of the transaction', async () => {
    const { service, corrections } = dataSetup();
    corrections.save.mockRejectedValueOnce(new Error('db down'));
    await expect(
      service.saveSession(USER, {
        sourceApp: 'Slack',
        tone: 'neutral',
        rawText: 'I goed',
        editedText: 'I went',
        corrections: [
          { kind: 'grammar', patternCode: 'verb_tense', wrong: 'goed', right: 'went', explanationVi: 'x', minor: false },
        ],
      }),
    ).rejects.toThrow('db down');
  });

  it('rejects deleting a session that is not the users', async () => {
    const { service } = dataSetup();
    const { sessions } = dataSetup();
    sessions.delete.mockResolvedValue({ affected: 0 });
    const svc = new PolishService({} as LlmService, sessions as never, repository() as never, repository() as never);
    await expect(svc.deleteSession(USER, 'nope')).rejects.toBeInstanceOf(NotFoundException);
    expect(service).toBeDefined();
  });

  it('lists sessions with their corrections', async () => {
    const { service, sessions, corrections } = dataSetup();
    sessions.find.mockResolvedValue([
      { id: 's1', sourceApp: 'Mail', tone: 'formal', rawText: 'r', editedText: 'e', createdAt: new Date('2026-11-01') },
    ]);
    corrections.find.mockResolvedValue([
      { sessionId: 's1', kind: 'grammar', patternCode: 'article', wrongText: 'a', rightText: 'the', explanationVi: 'v', minor: false },
    ]);
    const res = await service.listSessions(USER);
    expect(sessions.find).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: USER }, take: 50 }));
    expect(res[0].corrections).toEqual([
      { kind: 'grammar', patternCode: 'article', wrong: 'a', right: 'the', explanationVi: 'v', minor: false },
    ]);
  });
});

describe('PolishService phrases', () => {
  const dto = { text: 'I will circle back', sourceSentence: 'I will circle back soon.' };

  it('tags the situation with the LLM', async () => {
    const { service, phrases } = dataSetup(JSON.stringify({ situation: 'follow_up' }));
    const res = await service.savePhrase(USER, dto);
    expect(res.situationCode).toBe('follow_up');
    expect(phrases.save).toHaveBeenCalled();
  });

  it('falls back to other when the LLM fails', async () => {
    const { service } = dataSetup(new Error('boom'));
    expect((await service.savePhrase(USER, dto)).situationCode).toBe('other');
  });

  it('falls back to other for an unknown code', async () => {
    const { service } = dataSetup(JSON.stringify({ situation: 'nonsense' }));
    expect((await service.savePhrase(USER, dto)).situationCode).toBe('other');
  });

  it('falls back to other for non-JSON output', async () => {
    const { service } = dataSetup('not json');
    expect((await service.savePhrase(USER, dto)).situationCode).toBe('other');
  });

  it('returns the existing phrase on a case-insensitive duplicate', async () => {
    const { service, phrases, completeOwnerTool } = dataSetup();
    const existing = { id: 'old', text: 'I Will Circle Back', sourceSentence: 's', situationCode: 'follow_up', createdAt: new Date('2026-10-01') };
    phrases.findOne.mockResolvedValue(existing);
    const res = await service.savePhrase(USER, dto);
    expect(res.id).toBe('old');
    expect(phrases.save).not.toHaveBeenCalled();
    expect(completeOwnerTool).not.toHaveBeenCalled();
  });

  it('updates a phrase situation and 404s for another user', async () => {
    const { service, phrases } = dataSetup();
    phrases.findOne.mockResolvedValueOnce({ id: 'p', userId: USER, text: 't', sourceSentence: 's', situationCode: 'other', createdAt: new Date() });
    const res = await service.updatePhrase(USER, 'p', { situationCode: 'apologize' });
    expect(res.situationCode).toBe('apologize');
    await expect(service.updatePhrase(USER, 'x', { situationCode: 'apologize' })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('truncates a long source sentence to 1000 characters instead of rejecting', async () => {
    const { service, phrases } = dataSetup(JSON.stringify({ situation: 'follow_up' }));
    const long = '😀' + 'a'.repeat(1499);
    const input = Object.assign(new SavePhraseDto(), { text: 'circle back', sourceSentence: long });
    expect(await validate(input)).toHaveLength(0);
    const res = await service.savePhrase(USER, input);
    expect(Array.from(res.sourceSentence)).toHaveLength(1000);
    expect(res.sourceSentence.startsWith('😀a')).toBe(true);
    expect(phrases.save.mock.calls[0][0].sourceSentence).toBe(res.sourceSentence);
  });

  it('still rejects a phrase longer than 200 characters', async () => {
    const input = Object.assign(new SavePhraseDto(), { text: 'a'.repeat(201), sourceSentence: 's' });
    expect(await validate(input)).toHaveLength(1);
  });

  it('deletes only the users phrase', async () => {
    const { service, phrases } = dataSetup();
    phrases.delete.mockResolvedValue({ affected: 0 });
    await expect(service.deletePhrase(USER, 'x')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('UpdatePhraseDto', () => {
  it('rejects a situation outside the catalog', async () => {
    const dto = Object.assign(new UpdatePhraseDto(), { situationCode: 'bogus' });
    expect(await validate(dto)).toHaveLength(1);
  });
  it('accepts a catalog situation', async () => {
    const dto = Object.assign(new UpdatePhraseDto(), { situationCode: 'apologize' });
    expect(await validate(dto)).toHaveLength(0);
  });
});

describe('PolishService.notebook', () => {
  it('loads the user rows and aggregates them', async () => {
    const sessionRepo = repository({
      find: jest.fn().mockResolvedValue([
        { id: 's1', rawText: 'raw', editedText: 'ed', createdAt: new Date() },
      ]),
    });
    const correctionRepo = repository({
      find: jest.fn().mockResolvedValue([
        { sessionId: 's1', kind: 'grammar', patternCode: 'article', wrongText: 'a', rightText: 'the', explanationVi: 'x', minor: false },
        { sessionId: 's1', kind: 'tone', patternCode: 'too_direct', wrongText: 'b', rightText: 'c', explanationVi: 'y', minor: false },
      ]),
    });
    const service = new PolishService(
      {} as unknown as LlmService,
      sessionRepo as never,
      correctionRepo as never,
      repository() as never,
    );
    const view = await service.notebook('u1');
    expect(sessionRepo.find).toHaveBeenCalledWith({ where: { userId: 'u1' } });
    expect(view.totalSessions).toBe(1);
    expect(view.patterns.map((p) => p.code)).toEqual(['article']);
    expect(view.tone).toHaveLength(1);
  });

  it('returns an empty view without querying corrections', async () => {
    const correctionRepo = repository();
    const service = new PolishService(
      {} as unknown as LlmService,
      repository() as never,
      correctionRepo as never,
      repository() as never,
    );
    expect(await service.notebook('u1')).toEqual({ totalSessions: 0, patterns: [], tone: [] });
    expect(correctionRepo.find).not.toHaveBeenCalled();
  });
});

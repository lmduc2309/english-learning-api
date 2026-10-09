import { BadRequestException } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { LlmService } from '../llm/llm.service';
import { CompetitionService } from './competition.service';
import { CompetitionAnswer } from './entities/competition-answer.entity';
import { CompetitionPlayer } from './entities/competition-player.entity';
import { CompetitionRoom } from './entities/competition-room.entity';

describe('CompetitionService paragraph race rooms', () => {
  const words = Array.from({ length: 60 }, (_, index) => `word-${index + 1}`);

  function makeService() {
    const rooms = {
      existsBy: jest.fn().mockResolvedValue(false),
      create: jest.fn((input) => ({ id: 'room-1', ...input })),
      save: jest.fn(async (room) => room),
    } as unknown as Repository<CompetitionRoom>;
    const players = {
      create: jest.fn((input) => input),
      save: jest.fn(async (player) => ({ id: 'player-1', ...player })),
    } as unknown as Repository<CompetitionPlayer>;
    const answers = {} as Repository<CompetitionAnswer>;
    const llm = {
      generateParagraphRaceCards: jest.fn(async (sets: string[][]) => sets.map((answerSet) => ({
        prompt: answerSet.map((_, index) => `[[${index + 1}]]`).join(' belongs in a clear sentence. '),
        answers: answerSet,
      }))),
    } as unknown as LlmService;
    const service = new CompetitionService(
      rooms,
      players,
      answers,
      {} as DataSource,
      llm,
    );
    return { service, rooms, llm };
  }

  it('creates 30 fixed-length rounds from 60 words and hides the answer order in options', async () => {
    const { service, rooms, llm } = makeService();

    await service.createRoom({
      name: 'Context Sprint',
      hostName: 'Linh',
      secondsPerQuestion: 55,
      questionMode: 'fill-blank',
      gameMode: 'paragraph-race',
      words,
    });

    const sets = (llm.generateParagraphRaceCards as jest.Mock).mock.calls[0][0] as string[][];
    expect(sets).toHaveLength(30);
    expect(new Set(sets.flat())).toEqual(new Set(words));
    const roomInput = (rooms.create as jest.Mock).mock.calls[0][0] as CompetitionRoom;
    expect(roomInput.secondsPerQuestion).toBe(45);
    expect(roomInput.questions).toHaveLength(30);
    roomInput.questions.forEach((question) => {
      expect(question.options).toHaveLength(question.answers!.length);
      expect(new Set(question.options)).toEqual(new Set(question.answers));
      expect(question.options).not.toEqual(question.answers);
    });
  });

  it('rejects paragraph rooms outside the 60–90 word range before calling AI', async () => {
    const { service, llm } = makeService();

    await expect(service.createRoom({
      name: 'Too small',
      hostName: 'Linh',
      secondsPerQuestion: 30,
      questionMode: 'fill-blank',
      gameMode: 'paragraph-race',
      words: words.slice(0, 59),
    })).rejects.toBeInstanceOf(BadRequestException);
    expect(llm.generateParagraphRaceCards).not.toHaveBeenCalled();
  });

  it('builds rounds from manually entered paragraphs without calling AI', async () => {
    const { service, rooms, llm } = makeService();

    await service.createRoom({
      name: 'Offline Sprint',
      hostName: 'Linh',
      secondsPerQuestion: 30,
      questionMode: 'fill-blank',
      gameMode: 'paragraph-race',
      paragraphs: [
        'Maya [went] to the coast with a [brief] map.',
        'The [experienced] guide offered a [practical] plan.',
        'They [climbed] the hill and [admired] the view.',
      ],
    });

    expect(llm.generateParagraphRaceCards).not.toHaveBeenCalled();
    const roomInput = (rooms.create as jest.Mock).mock.calls[0][0] as CompetitionRoom;
    expect(roomInput.questions).toHaveLength(3);
    expect(roomInput.questions[0]).toMatchObject({
      gameMode: 'paragraph-race',
      prompt: 'Maya [[1]] to the coast with a [[2]] map.',
      answers: ['went', 'brief'],
      answer: '["went","brief"]',
    });
    expect(new Set(roomInput.questions[0].options)).toEqual(new Set(['went', 'brief']));
  });

  it('names the first invalid manual paragraph', async () => {
    const { service } = makeService();

    await expect(service.createRoom({
      name: 'Offline Sprint',
      hostName: 'Linh',
      secondsPerQuestion: 30,
      gameMode: 'paragraph-race',
      paragraphs: ['A [b] and [c].', 'Only [one] blank.', 'A [d] and [e].'],
    })).rejects.toThrow('Paragraph 2 needs 2 to 6 words in [brackets]');
  });

  it('accepts manual paragraphs only for Paragraph Race', async () => {
    const { service } = makeService();

    await expect(service.createRoom({
      name: 'Typed',
      hostName: 'Linh',
      secondsPerQuestion: 30,
      gameMode: 'typed',
      paragraphs: ['A [b] and [c].', 'A [d] and [e].', 'A [f] and [g].'],
    })).rejects.toBeInstanceOf(BadRequestException);
  });
});

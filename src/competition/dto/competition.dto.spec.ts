import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CreateCompetitionRoomDto } from './competition.dto';

describe('CreateCompetitionRoomDto', () => {
  const base = { name: 'Room', hostName: 'Linh', secondsPerQuestion: 30, gameMode: 'paragraph-race' };
  const invalidFields = (body: object) =>
    validateSync(plainToInstance(CreateCompetitionRoomDto, { ...base, ...body }))
      .map((error) => error.property);

  it('accepts written paragraphs without a word list', () => {
    expect(invalidFields({ paragraphs: ['A [b] [c]', 'A [d] [e]', 'A [f] [g]'] })).toEqual([]);
  });

  it('still requires words when no paragraphs are given', () => {
    expect(invalidFields({})).toEqual(['words']);
    expect(invalidFields({ words: ['adapt', 'brief', 'vivid'] })).toEqual([]);
  });

  it('requires 3 to 30 paragraphs', () => {
    expect(invalidFields({ paragraphs: ['A [b] [c]', 'A [d] [e]'] })).toEqual(['paragraphs']);
    expect(invalidFields({ paragraphs: Array(31).fill('A [b] [c]') })).toEqual(['paragraphs']);
  });

  it('accepts 0 to 3 decoy blocks per paragraph', () => {
    const paragraphs = ['A [b] [c]', 'A [d] [e]', 'A [f] [g]'];
    expect(invalidFields({ paragraphs, decoys: 0 })).toEqual([]);
    expect(invalidFields({ paragraphs, decoys: 3 })).toEqual([]);
    expect(invalidFields({ paragraphs, decoys: 4 })).toEqual(['decoys']);
    expect(invalidFields({ paragraphs, decoys: 1.5 })).toEqual(['decoys']);
  });
});

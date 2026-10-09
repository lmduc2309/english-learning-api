import { isAllowedVerbForm } from './verb-forms';

describe('isAllowedVerbForm', () => {
  it('accepts the unchanged word', () => {
    expect(isAllowedVerbForm('brief', 'brief')).toBe(true);
    expect(isAllowedVerbForm('Climb', 'climb')).toBe(true);
  });

  it('accepts regular past forms', () => {
    expect(isAllowedVerbForm('climb', 'climbed')).toBe(true);
    expect(isAllowedVerbForm('hesitate', 'hesitated')).toBe(true);
    expect(isAllowedVerbForm('study', 'studied')).toBe(true);
    expect(isAllowedVerbForm('stop', 'stopped')).toBe(true);
    expect(isAllowedVerbForm('panic', 'panicked')).toBe(true);
    expect(isAllowedVerbForm('enjoy', 'enjoyed')).toBe(true);
  });

  it('accepts irregular past and past participle forms', () => {
    expect(isAllowedVerbForm('go', 'went')).toBe(true);
    expect(isAllowedVerbForm('go', 'gone')).toBe(true);
    expect(isAllowedVerbForm('take', 'taken')).toBe(true);
    expect(isAllowedVerbForm('get', 'gotten')).toBe(true);
    expect(isAllowedVerbForm('learn', 'learnt')).toBe(true);
    expect(isAllowedVerbForm('learn', 'learned')).toBe(true);
  });

  it('inflects only the first word of a phrasal verb', () => {
    expect(isAllowedVerbForm('give up', 'gave up')).toBe(true);
    expect(isAllowedVerbForm('look after', 'looked after')).toBe(true);
    expect(isAllowedVerbForm('give up', 'gave in')).toBe(false);
  });

  it('rejects invented, regularised irregular, and non-past forms', () => {
    expect(isAllowedVerbForm('go', 'goed')).toBe(false);
    expect(isAllowedVerbForm('take', 'taked')).toBe(false);
    expect(isAllowedVerbForm('climb', 'climbs')).toBe(false);
    expect(isAllowedVerbForm('climb', 'climbing')).toBe(false);
    expect(isAllowedVerbForm('book', 'books')).toBe(false);
    expect(isAllowedVerbForm('brief', 'vivid')).toBe(false);
  });
});

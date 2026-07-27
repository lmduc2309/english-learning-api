import { scheduleReview } from './leitner';

describe('scheduleReview', () => {
  const now = new Date('2026-07-19T00:00:00.000Z');
  it('resets failed words to stage zero', () => expect(scheduleReview(4, 'again', now).stage).toBe(0));
  it('keeps hard words at their stage and delays one day', () => expect(scheduleReview(3, 'hard', now)).toEqual({ stage: 3, nextReviewAt: new Date('2026-07-20T00:00:00.000Z') }));
  it('advances easy words without exceeding mastery', () => expect(scheduleReview(5, 'easy', now).stage).toBe(5));
});
